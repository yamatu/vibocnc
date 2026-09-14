package controllers

import (
	"net/http"
	"strconv"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CategoryController struct{}

type categoryReference struct {
	ID           uint   `json:"id"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	ParentID     *uint  `json:"parent_id,omitempty"`
	ProductCount int64  `json:"product_count,omitempty"`
}

type categoryProductReference struct {
	ID       uint   `json:"id"`
	SKU      string `json:"sku"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Brand    string `json:"brand"`
	Model    string `json:"model"`
	IsActive bool   `json:"is_active"`
}

type categoryDeletionImpactResponse struct {
	Category              categoryReference          `json:"category"`
	Parent                *categoryReference         `json:"parent,omitempty"`
	DirectChildren        []categoryReference        `json:"direct_children"`
	DescendantCount       int                        `json:"descendant_count"`
	DirectProducts        []categoryProductReference `json:"direct_products"`
	ProductCount          int64                      `json:"product_count"`
	ReplacementCategories []categoryReference        `json:"replacement_categories"`
	CanDelete             bool                       `json:"can_delete"`
}

func categoryDescendantIDs(db *gorm.DB, rootID uint) ([]uint, error) {
	var rows []struct {
		ID       uint  `gorm:"column:id"`
		ParentID *uint `gorm:"column:parent_id"`
	}
	if err := db.Model(&models.Category{}).Select("id, parent_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	childrenByParent := make(map[uint][]uint, len(rows))
	for _, row := range rows {
		if row.ParentID != nil {
			childrenByParent[*row.ParentID] = append(childrenByParent[*row.ParentID], row.ID)
		}
	}

	seen := map[uint]bool{rootID: true}
	queue := []uint{rootID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, childID := range childrenByParent[current] {
			if seen[childID] {
				continue
			}
			seen[childID] = true
			queue = append(queue, childID)
		}
	}

	ids := make([]uint, 0, len(seen)-1)
	for id := range seen {
		if id != rootID {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func categoryReferenceFor(category models.Category, productCounts map[uint]int64) categoryReference {
	return categoryReference{ID: category.ID, Name: category.Name, Slug: category.Slug, ParentID: category.ParentID, ProductCount: productCounts[category.ID]}
}

func (cc *CategoryController) buildDeletionImpact(db *gorm.DB, categoryID uint) (*categoryDeletionImpactResponse, error) {
	var category models.Category
	if err := db.First(&category, categoryID).Error; err != nil {
		return nil, err
	}

	var children []models.Category
	if err := db.Where("parent_id = ?", categoryID).Order("sort_order ASC, name ASC").Find(&children).Error; err != nil {
		return nil, err
	}
	var countRows []struct {
		CategoryID uint  `gorm:"column:category_id"`
		Count      int64 `gorm:"column:count"`
	}
	if err := db.Model(&models.Product{}).Select("category_id, COUNT(*) AS count").Group("category_id").Scan(&countRows).Error; err != nil {
		return nil, err
	}
	productCounts := make(map[uint]int64, len(countRows))
	for _, row := range countRows {
		productCounts[row.CategoryID] = row.Count
	}
	productCount := productCounts[categoryID]
	var products []models.Product
	if err := db.Select("id, sku, name, slug, brand, model, is_active").Where("category_id = ?", categoryID).Order("id DESC").Limit(100).Find(&products).Error; err != nil {
		return nil, err
	}

	descendants, err := categoryDescendantIDs(db, categoryID)
	if err != nil {
		return nil, err
	}
	excluded := append([]uint{categoryID}, descendants...)
	var replacements []models.Category
	query := db.Where("id NOT IN ?", excluded).Order("sort_order ASC, name ASC")
	if err := query.Find(&replacements).Error; err != nil {
		return nil, err
	}

	impact := &categoryDeletionImpactResponse{
		Category:              categoryReferenceFor(category, productCounts),
		DescendantCount:       len(descendants),
		ProductCount:          productCount,
		CanDelete:             len(children) == 0 && productCount == 0,
		DirectChildren:        make([]categoryReference, 0, len(children)),
		DirectProducts:        make([]categoryProductReference, 0, len(products)),
		ReplacementCategories: make([]categoryReference, 0, len(replacements)),
	}
	if category.ParentID != nil {
		var parent models.Category
		if err := db.First(&parent, *category.ParentID).Error; err == nil {
			ref := categoryReferenceFor(parent, productCounts)
			impact.Parent = &ref
		}
	}
	for _, child := range children {
		impact.DirectChildren = append(impact.DirectChildren, categoryReferenceFor(child, productCounts))
	}
	for _, product := range products {
		impact.DirectProducts = append(impact.DirectProducts, categoryProductReference{ID: product.ID, SKU: product.SKU, Name: product.Name, Slug: product.Slug, Brand: product.Brand, Model: product.Model, IsActive: product.IsActive})
	}
	for _, replacement := range replacements {
		impact.ReplacementCategories = append(impact.ReplacementCategories, categoryReferenceFor(replacement, productCounts))
	}
	return impact, nil
}

// GetCategoryDeletionImpact previews the products and child categories that
// must be handled before a category can be removed.
func (cc *CategoryController) GetCategoryDeletionImpact(c *gin.Context) {
	categoryID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid category ID", Error: "invalid_id"})
		return
	}
	impact, err := cc.buildDeletionImpact(config.GetDB(), uint(categoryID))
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Category not found", Error: "category_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Category deletion impact retrieved successfully", Data: impact})
}

// GetCategories returns paginated list of categories
func (cc *CategoryController) GetCategories(c *gin.Context) {
	db := config.GetDB()

	flat := c.Query("flat") == "true"
	includeInactive := c.Query("include_inactive") == "true"

	query := db.Model(&models.Category{}).Preload("Translations").Order("sort_order ASC, name ASC")
	if !includeInactive {
		query = query.Where("is_active = ?", true)
	}

	var cats []models.Category
	if err := query.Find(&cats).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}

	tree := services.BuildCategoryTree(cats)
	// One grouped query supplies active-product counts for the whole tree, so
	// storefront pages can sort brands by size without per-category requests.
	type categoryCountRow struct {
		CategoryID uint
		Count      int64
	}
	var countRows []categoryCountRow
	if err := db.Model(&models.Product{}).
		Select("category_id AS category_id, COUNT(*) AS count").
		Where("is_active = ?", true).
		Group("category_id").
		Scan(&countRows).Error; err == nil {
		directCounts := make(map[uint]int64, len(countRows))
		for _, row := range countRows {
			directCounts[row.CategoryID] = row.Count
		}
		services.AttachCategoryProductCounts(tree, directCounts)
	}
	if flat {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Categories retrieved successfully", Data: services.FlattenCategoryTree(tree)})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Categories retrieved successfully", Data: tree})
}

// GetCategoryByPath resolves a category by nested slug path, e.g. "fanuc-controls/fanuc-power-mate".
// GET /api/v1/public/categories/path/*path
func (cc *CategoryController) GetCategoryByPath(c *gin.Context) {
	path := strings.Trim(c.Param("path"), "/")
	if path == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid path", Error: "empty_path"})
		return
	}

	// Compute paths using one scan of active categories.
	db := config.GetDB()
	var all []models.Category
	if err := db.Model(&models.Category{}).Preload("Translations").Where("is_active = ?", true).Order("sort_order ASC, name ASC").Find(&all).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}
	tree := services.BuildCategoryTree(all)
	flat := services.FlattenCategoryTree(tree)

	byID := make(map[uint]services.CategoryNode, len(flat))
	for _, n := range flat {
		byID[n.ID] = n
	}

	var node *services.CategoryNode
	for i := range flat {
		if flat[i].Path == path {
			node = &flat[i]
			break
		}
	}
	if node == nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Category not found", Error: "category_not_found"})
		return
	}

	// Build breadcrumb by following parent_id chain.
	breadcrumbNodes := make([]services.CategoryNode, 0, 8)
	cur := *node
	for {
		breadcrumbNodes = append(breadcrumbNodes, cur)
		if cur.ParentID == nil {
			break
		}
		p, ok := byID[*cur.ParentID]
		if !ok {
			break
		}
		cur = p
	}
	// reverse
	for i, j := 0, len(breadcrumbNodes)-1; i < j; i, j = i+1, j-1 {
		breadcrumbNodes[i], breadcrumbNodes[j] = breadcrumbNodes[j], breadcrumbNodes[i]
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Category retrieved successfully", Data: gin.H{"category": node, "breadcrumb": breadcrumbNodes}})
}

type reorderCategoryItem struct {
	ID        uint  `json:"id"`
	ParentID  *uint `json:"parent_id"`
	SortOrder int   `json:"sort_order"`
}

// ReorderCategories updates parent_id + sort_order for categories in bulk.
// PUT /api/v1/admin/categories/reorder
func (cc *CategoryController) ReorderCategories(c *gin.Context) {
	var items []reorderCategoryItem
	if err := c.ShouldBindJSON(&items); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	if len(items) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: "empty_items"})
		return
	}

	db := config.GetDB()
	err := db.Transaction(func(tx *gorm.DB) error {
		for _, it := range items {
			if it.ID == 0 {
				continue
			}
			updates := map[string]any{"sort_order": it.SortOrder, "parent_id": it.ParentID}
			if e := tx.Model(&models.Category{}).Where("id = ?", it.ID).Updates(updates).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to reorder categories", Error: err.Error()})
		return
	}

	services.InvalidatePublicCaches(c.Request.Context(), "category:reorder", nil)
	invalidateAISEOCategoryReferences()
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Categories reordered successfully"})
}

// GetCategory returns a single category by ID
func (cc *CategoryController) GetCategory(c *gin.Context) {
	id := c.Param("id")

	var category models.Category
	db := config.GetDB()

	if err := db.Preload("Translations").
		Preload("Children", "is_active = ?", true).
		Preload("Children.Translations").
		Preload("Products", "is_active = ?", true).
		First(&category, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Category not found",
				Error:   "category_not_found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database error",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Category retrieved successfully",
		Data:    category,
	})
}

// GetCategoryBySlug returns a single category by slug
func (cc *CategoryController) GetCategoryBySlug(c *gin.Context) {
	slug := c.Param("slug")

	var category models.Category
	db := config.GetDB()

	if err := db.Where("slug = ? AND is_active = ?", slug, true).
		Preload("Translations").
		Preload("Children", "is_active = ?", true).
		Preload("Children.Translations").
		Preload("Products", "is_active = ?", true).
		First(&category).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Category not found",
				Error:   "category_not_found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database error",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Category retrieved successfully",
		Data:    category,
	})
}

// CreateCategory creates a new category
func (cc *CategoryController) CreateCategory(c *gin.Context) {
	var req models.CategoryCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Generate slug
	baseSlug := utils.GenerateSlug(req.Name)
	slug := utils.GenerateUniqueSlug(baseSlug, func(s string) bool {
		var count int64
		db.Model(&models.Category{}).Where("slug = ?", s).Count(&count)
		return count > 0
	})

	// Create category
	category := models.Category{
		Name:        req.Name,
		Slug:        slug,
		Description: req.Description,
		ImageURL:    req.ImageURL,
		ParentID:    req.ParentID,
		SortOrder:   req.SortOrder,
		IsActive:    req.IsActive,
	}

	if err := db.Create(&category).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to create category",
			Error:   err.Error(),
		})
		return
	}

	services.InvalidatePublicCaches(c.Request.Context(), "category:create", nil)
	// The AI SEO prompt embeds the active taxonomy, so a new category must be
	// visible to the next job immediately rather than after the cache TTL.
	invalidateAISEOCategoryReferences()

	c.JSON(http.StatusCreated, models.APIResponse{
		Success: true,
		Message: "Category created successfully",
		Data:    category,
	})
}

// UpdateCategory updates an existing category
func (cc *CategoryController) UpdateCategory(c *gin.Context) {
	id := c.Param("id")
	categoryID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid category ID",
			Error:   "invalid_id",
		})
		return
	}

	var req models.CategoryCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Find existing category
	var category models.Category
	if err := db.First(&category, uint(categoryID)).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Category not found",
				Error:   "category_not_found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database error",
			Error:   err.Error(),
		})
		return
	}

	// Generate new slug if name changed
	if category.Name != req.Name {
		baseSlug := utils.GenerateSlug(req.Name)
		category.Slug = utils.GenerateUniqueSlug(baseSlug, func(s string) bool {
			var count int64
			db.Model(&models.Category{}).Where("slug = ? AND id != ?", s, category.ID).Count(&count)
			return count > 0
		})
	}

	// Update category
	category.Name = req.Name
	category.Description = req.Description
	category.ImageURL = req.ImageURL
	category.ParentID = req.ParentID
	category.SortOrder = req.SortOrder
	category.IsActive = req.IsActive

	if err := db.Save(&category).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update category",
			Error:   err.Error(),
		})
		return
	}

	services.InvalidatePublicCaches(c.Request.Context(), "category:update", nil)
	invalidateAISEOCategoryReferences()

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Category updated successfully",
		Data:    category,
	})
}

// DeleteCategory deletes a category
func (cc *CategoryController) DeleteCategory(c *gin.Context) {
	id := c.Param("id")
	categoryID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid category ID",
			Error:   "invalid_id",
		})
		return
	}

	db := config.GetDB()

	var category models.Category
	if err := db.First(&category, uint(categoryID)).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Category not found", Error: "category_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}

	var productCount int64
	if err := db.Model(&models.Product{}).Where("category_id = ?", uint(categoryID)).Count(&productCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database error",
			Error:   err.Error(),
		})
		return
	}

	var childCount int64
	if err := db.Model(&models.Category{}).Where("parent_id = ?", uint(categoryID)).Count(&childCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}

	reassignValue := strings.TrimSpace(c.Query("reassign_to"))
	var replacementID *uint
	if reassignValue != "" {
		value, parseErr := strconv.ParseUint(reassignValue, 10, 32)
		if parseErr != nil || value == 0 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid replacement category", Error: "invalid_replacement_category"})
			return
		}
		replacement := uint(value)
		if replacement == uint(categoryID) {
			c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "A category cannot be reassigned to itself", Error: "invalid_replacement_category"})
			return
		}
		descendants, descErr := categoryDescendantIDs(db, uint(categoryID))
		if descErr != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: descErr.Error()})
			return
		}
		for _, descendantID := range descendants {
			if descendantID == replacement {
				c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "A category cannot be moved into its own descendant", Error: "invalid_replacement_category"})
				return
			}
		}
		var replacementCategory models.Category
		if err := db.First(&replacementCategory, replacement).Error; err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Replacement category not found", Error: "replacement_category_not_found"})
			return
		}
		replacementID = &replacement
	}

	if productCount > 0 && replacementID == nil {
		c.JSON(http.StatusConflict, models.APIResponse{
			Success: false, Message: "Products must be reassigned before deleting this category", Error: "replacement_category_required",
			Data: gin.H{"product_count": productCount, "child_count": childCount},
		})
		return
	}

	if childCount > 0 && replacementID == nil && productCount == 0 {
		// Empty parent categories can be removed safely by preserving their
		// children under the deleted category's former parent.
		replacementID = category.ParentID
	}

	if childCount > 0 && replacementID == nil {
		c.JSON(http.StatusConflict, models.APIResponse{
			Success: false, Message: "Child categories must be reassigned before deleting this category", Error: "replacement_category_required",
			Data: gin.H{"product_count": productCount, "child_count": childCount},
		})
		return
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		if replacementID != nil && productCount > 0 {
			if err := tx.Model(&models.Product{}).Where("category_id = ?", uint(categoryID)).Update("category_id", *replacementID).Error; err != nil {
				return err
			}
		}
		if childCount > 0 {
			if err := tx.Model(&models.Category{}).Where("parent_id = ?", uint(categoryID)).Update("parent_id", replacementID).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&models.Category{}, uint(categoryID)).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete category",
			Error:   err.Error(),
		})
		return
	}

	services.InvalidatePublicCaches(c.Request.Context(), "category:delete", []string{"/categories", "/products", "/"})
	invalidateAISEOCategoryReferences()
	services.TriggerNextRevalidate(nil, []string{"/categories", "/products", "/"}, true)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Category deleted successfully",
	})
}
