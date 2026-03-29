package controllers

import (
	"context"
	"encoding/json"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"sync"
)

type ProductController struct{}

var imagesTableOnce sync.Once
var imagesTableExists bool
var faqsTableOnce sync.Once
var faqsTableExists bool

func hasImagesTable() bool {
	imagesTableOnce.Do(func() {
		if config.DB != nil {
			imagesTableExists = config.DB.Migrator().HasTable(&models.ProductImage{})
		}
	})
	return imagesTableExists
}

func hasProductFAQsTable() bool {
	faqsTableOnce.Do(func() {
		if config.DB != nil {
			faqsTableExists = config.DB.Migrator().HasTable(&models.ProductFAQ{})
		}
	})
	return faqsTableExists
}

// helper: apply common preloads; conditionally include Images only when table exists
func withProductPreloads(db *gorm.DB) *gorm.DB {
	q := db.Preload("Category").
		Preload("Attributes").
		Preload("Translations").
		Preload("PurchaseLinks", "is_active = ?", true)
	// Avoid 500 when product_images table is not present yet
	if hasImagesTable() {
		q = q.Preload("Images")
	}
	return q
}

// lighter preloads for public product endpoints (reduce extra queries)
func withPublicProductPreloads(db *gorm.DB) *gorm.DB {
	q := db.Preload("Category").
		Preload("PurchaseLinks", "is_active = ?", true).
		Preload("Reviews", "is_approved = ?", true)
	if hasProductFAQsTable() {
		q = q.Preload("FAQs", "is_active = ?", true)
	}
	if hasImagesTable() {
		q = q.Preload("Images")
	}
	return q
}

// Shared finder for SKU-based retrieval with tolerant matching
func findProductBySKUInternal(sku string) (models.Product, error) {
	var product models.Product
	db := config.GetDB()

	normalized := strings.TrimSpace(sku)
	upper := strings.ToUpper(normalized)
	candMap := map[string]bool{}
	candidates := []string{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if !candMap[s] {
			candMap[s] = true
			candidates = append(candidates, s)
		}
	}
	add(normalized)
	if strings.HasPrefix(upper, "FANUC-") {
		add(normalized[6:])
	}
	if strings.HasPrefix(upper, "FANUC ") {
		add(normalized[6:])
	}
	add(upper)
	add("FANUC-" + normalized)
	add("FANUC " + normalized)

	// Step 1: exact SKU match
	if err := withPublicProductPreloads(db).
		Where("sku IN ?", candidates).
		Order(gorm.Expr("FIELD(sku, ?) DESC, updated_at DESC", candidates)).
		First(&product).Error; err != nil {
		if err != gorm.ErrRecordNotFound {
			return product, err
		}
		// Step 2: exact model/part_number
		if err2 := withPublicProductPreloads(db).
			Where("model = ? OR part_number = ?", normalized, normalized).
			Order("updated_at DESC").
			First(&product).Error; err2 != nil {
			if err2 != gorm.ErrRecordNotFound {
				return product, err2
			}
			// Step 3: prefix fallback
			likePrefix := normalized + "%"
			if err3 := withPublicProductPreloads(db).
				Where("sku LIKE ? OR model LIKE ? OR part_number LIKE ?", likePrefix, likePrefix, likePrefix).
				Order("updated_at DESC").
				First(&product).Error; err3 != nil {
				if err3 != gorm.ErrRecordNotFound {
					return product, err3
				}
				// Step 3.5: sanitized compare (strip '-' and '/')
				sanitized := strings.ReplaceAll(strings.ReplaceAll(normalized, "-", ""), "/", "")
				if err4 := withPublicProductPreloads(db).
					Where("REPLACE(REPLACE(sku,'-',''),'/','') = ?", sanitized).
					Order("updated_at DESC").
					First(&product).Error; err4 != nil {
					return product, err4
				}
			}
		}
	}
	return product, nil
}

// Helper function to deserialize image URLs from JSON
func deserializeImageURLs(imageURLsJSON string) []string {
	if imageURLsJSON == "" {
		return []string{}
	}

	var urls []string
	if err := json.Unmarshal([]byte(imageURLsJSON), &urls); err != nil {
		return []string{}
	}

	return urls
}

// ProductResponse represents a product with deserialized image URLs
type ProductResponse struct {
	models.Product
	ImageURLs []string `json:"image_urls"`
}

// Helper function to convert Product to ProductResponse
func convertToProductResponse(product models.Product) ProductResponse {
	// Deserialize JSON ImageURLs field
	jsonImageURLs := deserializeImageURLs(product.ImageURLs)

	// Collect URLs from Images relationship
	var relationImageURLs []string
	for _, img := range product.Images {
		if img.URL != "" {
			relationImageURLs = append(relationImageURLs, img.URL)
		}
	}

	// Merge both sources, prioritizing Images relationship (more structured)
	var finalImageURLs []string
	if len(relationImageURLs) > 0 {
		finalImageURLs = relationImageURLs
	} else if len(jsonImageURLs) > 0 {
		finalImageURLs = jsonImageURLs
	}

	return ProductResponse{
		Product:   product,
		ImageURLs: finalImageURLs,
	}
}

// GetProducts returns paginated list of products
func (pc *ProductController) GetProducts(c *gin.Context) {
	db := config.GetDB()

	// Parse pagination parameters
	page, pageSize := utils.ParsePaginationWithMax(c.Query("page"), c.Query("page_size"), 500)
	offset := utils.CalculateOffset(page, pageSize)

	// Parse filters
	categoryID := c.Query("category_id")
	includeDesc := c.Query("include_descendants") == "true"
	brand := c.Query("brand")
	search := c.Query("search")
	isActive := c.Query("is_active")
	isFeatured := c.Query("is_featured")

	// Build query (leaner preloads for public route to reduce N+1)
	isPublic := strings.Contains(c.FullPath(), "/public/")
	var query *gorm.DB
	if isPublic {
		query = db.Model(&models.Product{}).Preload("Category")
		if hasImagesTable() {
			query = query.Preload("Images")
		}
	} else {
		query = withProductPreloads(db.Model(&models.Product{}))
	}

	// Apply filters
	if categoryID != "" {
		if includeDesc {
			rootID, err := strconv.ParseUint(categoryID, 10, 32)
			if err == nil && rootID > 0 {
				ids, derr := getDescendantCategoryIDs(db, uint(rootID))
				if derr == nil && len(ids) > 0 {
					query = query.Where("category_id IN ?", ids)
				} else {
					query = query.Where("category_id = ?", categoryID)
				}
			} else {
				query = query.Where("category_id = ?", categoryID)
			}
		} else {
			query = query.Where("category_id = ?", categoryID)
		}
	}

	if brand != "" {
		query = query.Where("brand = ?", brand)
	}

	if search != "" {
		like := "%" + search + "%"
		query = query.Where("sku LIKE ? OR name LIKE ? OR description LIKE ? OR part_number LIKE ? OR model LIKE ?",
			like, like, like, like, like)
	}

	if isActive != "" {
		query = query.Where("is_active = ?", isActive == "true")
	}

	if isFeatured != "" {
		query = query.Where("is_featured = ?", isFeatured == "true")
	}

	// Get total count
	var total int64
	query.Count(&total)

	// Get products
	var products []models.Product
	if err := query.Offset(offset).Limit(pageSize).Find(&products).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to fetch products",
			Error:   err.Error(),
		})
		return
	}

	// Convert products to response format with deserialized image URLs
	var productResponses []ProductResponse
	for _, product := range products {
		productResponses = append(productResponses, convertToProductResponse(product))
	}

	// Calculate total pages
	totalPages := utils.CalculateTotalPages(total, pageSize)

	response := models.PaginationResponse{
		Data:       productResponses,
		Page:       page,
		PageSize:   pageSize,
		Total:      total,
		TotalPages: totalPages,
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Products retrieved successfully",
		Data:    response,
	})
}

// getDescendantCategoryIDs returns a slice containing rootID and all its descendants' IDs.
// It uses an in-memory walk to avoid DB-specific recursion requirements.
func getDescendantCategoryIDs(db *gorm.DB, rootID uint) ([]uint, error) {
	// Load only what we need.
	type row struct {
		ID       uint
		ParentID *uint
	}
	var rows []row
	if err := db.Model(&models.Category{}).Select("id,parent_id").Find(&rows).Error; err != nil {
		return nil, err
	}

	children := make(map[uint][]uint)
	for _, r := range rows {
		if r.ParentID == nil {
			continue
		}
		children[*r.ParentID] = append(children[*r.ParentID], r.ID)
	}

	// DFS with cycle protection.
	visited := make(map[uint]bool)
	out := make([]uint, 0)
	var walk func(id uint)
	walk = func(id uint) {
		if visited[id] {
			return
		}
		visited[id] = true
		out = append(out, id)
		for _, kid := range children[id] {
			walk(kid)
		}
	}
	walk(rootID)
	return out, nil
}

// LookupSEO fetches SEO/content suggestion by SKU without requiring an existing product
// POST /api/v1/admin/seo/lookup  Body: { sku: "A16B-...", source_base_url?: "https://fanucworld.com" }
func (pc *ProductController) LookupSEO(c *gin.Context) {
	var req struct {
		SKU           string `json:"sku" binding:"required"`
		SourceBaseURL string `json:"source_base_url"`
		Provider      string `json:"provider"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	if req.SourceBaseURL == "" {
		req.SourceBaseURL = "https://fanucworld.com"
	}
	sku := strings.TrimSpace(req.SKU)
	var extracted *services.ImportedSEO
	var candidate string
	attempted := []string{}

	// Provider-specific path
	if strings.ToLower(strings.TrimSpace(req.Provider)) == "ebay" {
		tmp, src, eerr := services.ImportFromEbay(sku)
		if eerr == nil && tmp != nil {
			extracted = tmp
			candidate = src
		}
		if candidate != "" {
			attempted = append(attempted, candidate)
		}
	} else {
		candidates, _ := buildCandidates(req.SourceBaseURL, sku)
		attempted = append(attempted, candidates...)
		for _, cand := range candidates {
			candidate = cand
			tmp, err := services.ExtractFromURL(cand)
			if err != nil {
				continue
			}
			// Ignore generic error pages
			if strings.Contains(strings.ToLower(tmp.Title), "tie industrial - fanucworld.com") {
				continue
			}
			if strings.Contains(strings.ToLower(tmp.MetaDescription), "warning: target url returned error") {
				continue
			}
			extracted = tmp
			break
		}
	}
	if extracted == nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "No matching source page found", Data: map[string]interface{}{"tried_urls": attempted}, Error: "not_found"})
		return
	}
	// Nothing else
	suggestion := map[string]interface{}{
		"source_url":               candidate,
		"suggest_meta_title":       extracted.Title,
		"suggest_meta_description": extracted.MetaDescription,
		"suggest_meta_keywords":    extracted.MetaKeywords,
		"suggest_description_html": extracted.DescriptionHTML,
		"suggest_category":         extracted.CategoryGuess,
		"product_jsonld":           extracted.ProductJSONLD,
		"tried_urls":               attempted,
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Imported SEO suggestions", Data: suggestion})
}

// AutoImportSEO fetches SEO/content info from a competitor site for the given product (by ID or SKU)
// POST /api/v1/admin/products/:id/auto-seo
// Body (JSON): { "source_base_url": "https://fanucworld.com", "apply": false }
// If apply=true, it will update meta_title, meta_description, meta_keywords, description; category is suggested only.
func (pc *ProductController) AutoImportSEO(c *gin.Context) {
	productID := c.Param("id")
	var req struct {
		SourceBaseURL string `json:"source_base_url"`
		Apply         bool   `json:"apply"`
		AutoCategory  bool   `json:"auto_category"`
		Provider      string `json:"provider"`
	}
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid JSON", Error: err.Error()})
		return
	}
	if req.SourceBaseURL == "" {
		req.SourceBaseURL = "https://fanucworld.com"
	}
	// default auto category
	autoCategory := true
	if !req.AutoCategory { // only false if explicitly provided
		autoCategory = false
	}

	db := config.GetDB()
	var product models.Product
	if err := db.Preload("Category").First(&product, productID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product not found", Error: "product_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}

	var extracted *services.ImportedSEO
	var candidate string
	attempted := []string{}
	if strings.ToLower(strings.TrimSpace(req.Provider)) == "ebay" {
		tmp, src, eerr := services.ImportFromEbay(product.SKU)
		if eerr == nil && tmp != nil {
			extracted = tmp
			candidate = src
		}
		if candidate != "" {
			attempted = append(attempted, candidate)
		}
	} else {
		// Build candidates from provided base or full URL + SKU variants
		candidates, _ := buildCandidates(req.SourceBaseURL, product.SKU)
		attempted = append(attempted, candidates...)
		for _, cand := range candidates {
			candidate = cand
			tmp, err := services.ExtractFromURL(cand)
			if err != nil {
				continue
			}
			if strings.Contains(strings.ToLower(tmp.Title), "tie industrial - fanucworld.com") {
				continue
			}
			if strings.Contains(strings.ToLower(tmp.MetaDescription), "warning: target url returned error") {
				continue
			}
			extracted = tmp
			break
		}
	}
	if extracted == nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "No matching source page found", Data: map[string]interface{}{"tried_urls": attempted}, Error: "not_found"})
		return
	}
	// Build suggestion
	suggestion := map[string]interface{}{
		"source_url":               candidate,
		"suggest_meta_title":       extracted.Title,
		"suggest_meta_description": extracted.MetaDescription,
		"suggest_meta_keywords":    extracted.MetaKeywords,
		"suggest_description_html": extracted.DescriptionHTML,
		"suggest_category":         extracted.CategoryGuess,
		"product_jsonld":           extracted.ProductJSONLD,
		"tried_urls":               attempted,
	}

	if !req.Apply {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Imported SEO suggestions", Data: suggestion})
		return
	}

	// Apply minimal safe fields
	product.MetaTitle = extracted.Title
	if extracted.MetaDescription != "" {
		product.MetaDescription = extracted.MetaDescription
	}
	if extracted.MetaKeywords != "" {
		product.MetaKeywords = extracted.MetaKeywords
	}
	if extracted.DescriptionHTML != "" {
		// Append if description exists but differs; otherwise replace
		if strings.TrimSpace(product.Description) == "" {
			product.Description = extracted.DescriptionHTML
		} else if !strings.Contains(product.Description, extracted.DescriptionHTML) {
			product.Description = product.Description + "\n\n" + extracted.DescriptionHTML
		}
	}
	// Auto category
	if autoCategory && strings.TrimSpace(extracted.CategoryGuess) != "" {
		db := config.GetDB()
		catName := strings.TrimSpace(extracted.CategoryGuess)
		slug := utils.GenerateSlug(catName)
		var cat models.Category
		if err := db.Where("slug = ?", slug).First(&cat).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				cat = models.Category{Name: catName, Slug: slug, Description: catName, IsActive: true}
				_ = db.Create(&cat).Error
			}
		}
		if cat.ID != 0 {
			product.CategoryID = cat.ID
		}
	}
	if err := db.Save(&product).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to apply imported SEO", Error: err.Error()})
		return
	}
	suggestion["applied"] = true
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "SEO imported and applied", Data: suggestion})
}

// buildCandidates accepts either a base domain or a direct product URL and produces a ranked candidate list
func buildCandidates(source string, sku string) ([]string, []string) {
	s := strings.TrimSpace(source)
	// if user provided a direct product URL, normalize and expand
	if strings.Contains(s, "/product/") || strings.Contains(s, "/products/") {
		if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
			s = "https://" + s
		}
		list := []string{s}
		if u, err := neturl.Parse(s); err == nil {
			segs := strings.Split(strings.Trim(u.Path, "/"), "/")
			if len(segs) >= 2 {
				last := segs[len(segs)-1]
				base := u.Scheme + "://" + u.Host
				// toggle www
				hostNoWWW := strings.TrimPrefix(u.Host, "www.")
				hostWWW := u.Host
				if !strings.HasPrefix(u.Host, "www.") {
					hostWWW = "www." + u.Host
				}
				// alt fanuc- prefix
				alt := last
				if strings.HasPrefix(last, "fanuc-") {
					alt = strings.TrimPrefix(last, "fanuc-")
				} else {
					alt = "fanuc-" + last
				}
				list = append(list,
					base+"/products/"+strings.ToLower(last)+"/",
					base+"/products/"+strings.ToLower(alt)+"/",
					u.Scheme+"://"+hostWWW+"/products/"+strings.ToLower(last)+"/",
					u.Scheme+"://"+hostWWW+"/products/"+strings.ToLower(alt)+"/",
					u.Scheme+"://"+hostNoWWW+"/products/"+strings.ToLower(last)+"/",
					u.Scheme+"://"+hostNoWWW+"/products/"+strings.ToLower(alt)+"/",
				)
			}
		}
		// de-dup
		uniq := map[string]bool{}
		out := []string{}
		for _, it := range list {
			it = strings.TrimSpace(it)
			if it == "" {
				continue
			}
			if !uniq[it] {
				uniq[it] = true
				out = append(out, it)
			}
		}
		return out, out
	}
	// else treat as base domain
	candidate, tried2, _ := services.FindCandidateURL(s, sku)
	if candidate != "" {
		return append([]string{candidate}, tried2...), tried2
	}
	return tried2, tried2
}

// GetProduct returns a single product by ID
func (pc *ProductController) GetProduct(c *gin.Context) {
	id := c.Param("id")

	var product models.Product
	db := config.GetDB()

	if err := withProductPreloads(db).First(&product, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Product not found",
				Error:   "product_not_found",
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

	// Convert to response format with deserialized image URLs
	productResponse := convertToProductResponse(product)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Product retrieved successfully",
		Data:    productResponse,
	})
}

// GetProductBySKU returns a single product by SKU
func (pc *ProductController) GetProductBySKU(c *gin.Context) {
	sku := c.Param("sku")

	product, err := findProductBySKUInternal(sku)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product not found", Error: "product_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}

	// Convert to response format with deserialized image URLs
	productResponse := convertToProductResponse(product)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Product retrieved successfully",
		Data:    productResponse,
	})
}

// GetProductBySKUQuery supports query param (safe for SKUs containing '/')
func (pc *ProductController) GetProductBySKUQuery(c *gin.Context) {
	sku := c.Query("sku")
	if strings.TrimSpace(sku) == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing sku parameter", Error: "invalid_request"})
		return
	}
	product, err := findProductBySKUInternal(sku)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product not found", Error: "product_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}
	productResponse := convertToProductResponse(product)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Product retrieved successfully", Data: productResponse})
}

// BulkUpdateProducts allows updating is_active / is_featured for multiple products
func (pc *ProductController) BulkUpdateProducts(c *gin.Context) {
	type BulkUpdateReq struct {
		IDs        []uint   `json:"ids"`
		SKUs       []string `json:"skus"`
		IsActive   *bool    `json:"is_active"`
		IsFeatured *bool    `json:"is_featured"`
		// Optional filters to select all matching records
		Search             string `json:"search"`
		CategoryID         string `json:"category_id"`
		IncludeDescendants bool   `json:"include_descendants"`
		Status             string `json:"status"`     // "active" | "inactive" | "all" | ""
		Featured           string `json:"featured"`   // "true" | "false" | ""
		BatchSize          int    `json:"batch_size"` // optional, default 500
	}

	var req BulkUpdateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	// Allow either explicit IDs/SKUs OR query filters (for select-all use case)

	// Build updates
	updates := map[string]interface{}{}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.IsFeatured != nil {
		updates["is_featured"] = *req.IsFeatured
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "No fields to update",
			Error:   "invalid_request",
		})
		return
	}

	db := config.GetDB()
	tx := db.Model(&models.Product{})
	// Selection by IDs/SKUs
	if len(req.IDs) > 0 {
		tx = tx.Where("id IN ?", req.IDs)
	}
	if len(req.SKUs) > 0 {
		tx = tx.Or("sku IN ?", req.SKUs)
	}
	// Or selection by filters (when no explicit IDs/SKUs are provided)
	if len(req.IDs) == 0 && len(req.SKUs) == 0 {
		if req.CategoryID != "" {
			if req.IncludeDescendants {
				rootID, err := strconv.ParseUint(req.CategoryID, 10, 32)
				if err == nil && rootID > 0 {
					ids, derr := getDescendantCategoryIDs(db, uint(rootID))
					if derr == nil && len(ids) > 0 {
						tx = tx.Where("category_id IN ?", ids)
					} else {
						tx = tx.Where("category_id = ?", req.CategoryID)
					}
				} else {
					tx = tx.Where("category_id = ?", req.CategoryID)
				}
			} else {
				tx = tx.Where("category_id = ?", req.CategoryID)
			}
		}
		if req.Search != "" {
			like := "%" + req.Search + "%"
			tx = tx.Where("sku LIKE ? OR name LIKE ? OR description LIKE ? OR part_number LIKE ? OR model LIKE ?", like, like, like, like, like)
		}
		if req.Status == "active" {
			tx = tx.Where("is_active = ?", true)
		} else if req.Status == "inactive" {
			tx = tx.Where("is_active = ?", false)
		}
		if req.Featured == "true" {
			tx = tx.Where("is_featured = ?", true)
		} else if req.Featured == "false" {
			tx = tx.Where("is_featured = ?", false)
		}
	}

	// If explicit IDs/SKUs provided, run a single update
	if len(req.IDs) > 0 || len(req.SKUs) > 0 {
		res := tx.Updates(updates)
		if res.Error != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to update products",
				Error:   res.Error.Error(),
			})
			return
		}
		// Keep the user-facing request fast; cache invalidation is best-effort.
		go services.InvalidatePublicCaches(context.Background(), "product:bulk-update", nil)

		c.JSON(http.StatusOK, models.APIResponse{
			Success: true,
			Message: "Products updated successfully",
			Data:    map[string]int64{"updated": res.RowsAffected},
		})
		return

	}

	// Otherwise, apply filters in batches to avoid timeouts/locks
	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = 500
	}

	var totalUpdated int64 = 0
	var batch []models.Product

	// Build a selector with same filters (without IDs/SKUs) to stream IDs
	selector := db.Model(&models.Product{})
	if req.CategoryID != "" {
		if req.IncludeDescendants {
			rootID, err := strconv.ParseUint(req.CategoryID, 10, 32)
			if err == nil && rootID > 0 {
				ids, derr := getDescendantCategoryIDs(db, uint(rootID))
				if derr == nil && len(ids) > 0 {
					selector = selector.Where("category_id IN ?", ids)
				} else {
					selector = selector.Where("category_id = ?", req.CategoryID)
				}
			} else {
				selector = selector.Where("category_id = ?", req.CategoryID)
			}
		} else {
			selector = selector.Where("category_id = ?", req.CategoryID)
		}
	}
	if req.Search != "" {
		like := "%" + req.Search + "%"
		selector = selector.Where("sku LIKE ? OR name LIKE ? OR description LIKE ? OR part_number LIKE ? OR model LIKE ?", like, like, like, like, like)
	}
	if req.Status == "active" {
		selector = selector.Where("is_active = ?", true)
	} else if req.Status == "inactive" {
		selector = selector.Where("is_active = ?", false)
	}
	if req.Featured == "true" {
		selector = selector.Where("is_featured = ?", true)
	} else if req.Featured == "false" {
		selector = selector.Where("is_featured = ?", false)
	}

	if err := selector.FindInBatches(&batch, batchSize, func(txBatch *gorm.DB, _ int) error {
		// collect IDs
		ids := make([]uint, 0, len(batch))
		for _, p := range batch {
			ids = append(ids, p.ID)
		}
		if len(ids) == 0 {
			return nil
		}
		res := db.Model(&models.Product{}).Where("id IN ?", ids).Updates(updates)
		if res.Error != nil {
			return res.Error
		}
		totalUpdated += res.RowsAffected
		return nil
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update products in batches",
			Error:   err.Error(),
		})
		return
	}

	// Keep the user-facing request fast; cache invalidation is best-effort.
	go services.InvalidatePublicCaches(context.Background(), "product:bulk-update", nil)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Products updated successfully",
		Data:    map[string]int64{"updated": totalUpdated},
	})
}

// CreateProduct creates a new product
func (pc *ProductController) CreateProduct(c *gin.Context) {
	var req models.ProductCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Check if SKU already exists
	var existingProduct models.Product
	if err := db.Where("sku = ?", req.SKU).First(&existingProduct).Error; err == nil {
		c.JSON(http.StatusConflict, models.APIResponse{
			Success: false,
			Message: "Product with this SKU already exists",
			Error:   "sku_exists",
		})
		return
	}

	// Generate slug
	baseSlug := utils.GenerateSlug(req.Name)
	slug := utils.GenerateUniqueSlug(baseSlug, func(s string) bool {
		var count int64
		db.Model(&models.Product{}).Where("slug = ?", s).Count(&count)
		return count > 0
	})

	// Extract image URLs for backward compatibility
	var imageURLs []string
	for _, img := range req.Images {
		imageURLs = append(imageURLs, img.URL)
	}

	// Serialize image URLs to JSON
	var imageURLsJSON string
	if len(imageURLs) > 0 {
		imageURLsBytes, err := json.Marshal(imageURLs)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{
				Success: false,
				Message: "Invalid image URLs format",
				Error:   err.Error(),
			})
			return
		}
		imageURLsJSON = string(imageURLsBytes)
	} else {
		imageURLsJSON = "[]"
	}

	// Create product
	product := models.Product{
		SKU:              req.SKU,
		Name:             req.Name,
		Slug:             slug,
		ShortDescription: req.ShortDescription,
		Description:      req.Description,
		Price:            req.Price,
		ComparePrice:     req.ComparePrice,
		StockQuantity:    req.StockQuantity,
		Weight:           req.Weight,
		Dimensions:       req.Dimensions,
		Brand:            req.Brand,
		Model:            req.Model,
		PartNumber:       req.PartNumber,
		CategoryID:       req.CategoryID,
		IsActive:         req.IsActive,
		IsFeatured:       req.IsFeatured,
		MetaTitle:        req.MetaTitle,
		MetaDescription:  req.MetaDescription,
		MetaKeywords:     req.MetaKeywords,
		ImageURLs:        imageURLsJSON,
	}

	// Start transaction
	tx := db.Begin()

	// Create product (only known DB columns)
	if err := tx.Select("SKU", "Name", "Slug", "ShortDescription", "Description", "Price", "ComparePrice", "StockQuantity", "Weight", "Dimensions", "Brand", "Model", "PartNumber", "CategoryID", "IsActive", "IsFeatured", "MetaTitle", "MetaDescription", "MetaKeywords", "ImageURLs").Create(&product).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to create product",
			Error:   err.Error(),
		})
		return
	}

	// Create attributes
	for _, attr := range req.Attributes {
		attribute := models.ProductAttribute{
			ProductID:      product.ID,
			AttributeName:  attr.AttributeName,
			AttributeValue: attr.AttributeValue,
			SortOrder:      attr.SortOrder,
		}
		if err := tx.Create(&attribute).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to create product attributes",
				Error:   err.Error(),
			})
			return
		}
	}

	// Create translations
	for _, trans := range req.Translations {
		transSlug := utils.GenerateSlug(trans.Name)
		translation := models.ProductTranslation{
			ProductID:        product.ID,
			LanguageCode:     trans.LanguageCode,
			Name:             trans.Name,
			Slug:             transSlug,
			ShortDescription: trans.ShortDescription,
			Description:      trans.Description,
			MetaTitle:        trans.MetaTitle,
			MetaDescription:  trans.MetaDescription,
			MetaKeywords:     trans.MetaKeywords,
		}
		if err := tx.Create(&translation).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to create product translations",
				Error:   err.Error(),
			})
			return
		}
	}

	// Images are now stored in the ImageURLs JSON field, no need to create separate records
	// The image URLs are already stored in the product.ImageURLs field above

	// Commit transaction
	tx.Commit()

	productPath := services.BuildProductPublicPath(product.SKU)

	// Invalidate caches (Redis + optional Cloudflare)
	services.InvalidatePublicCaches(c.Request.Context(), "product:create", []string{productPath})

	// Trigger Next.js ISR revalidation
	services.TriggerNextRevalidate([]string{product.SKU}, []string{productPath}, true)

	// Load created product with relations (select only known columns)
	db.Select("id,sku,name,slug,short_description,description,price,compare_price,stock_quantity,weight,dimensions,brand,model,part_number,category_id,is_active,is_featured,meta_title,meta_description,meta_keywords,image_urls,created_at,updated_at").
		Preload("Category").
		First(&product, product.ID)

	c.JSON(http.StatusCreated, models.APIResponse{
		Success: true,
		Message: "Product created successfully",
		Data:    product,
	})

}

// UpdateProduct updates an existing product
func (pc *ProductController) UpdateProduct(c *gin.Context) {
	id := c.Param("id")

	var req models.ProductCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Find existing product (select minimal columns)
	var product models.Product
	if err := db.Select("id,sku,name,slug,image_urls").First(&product, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Product not found",
				Error:   "product_not_found",
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

	// Validate category exists to avoid foreign key errors
	if req.CategoryID == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Category is required", Error: "category_required"})
		return
	}
	var cat models.Category
	if err := db.First(&cat, req.CategoryID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid category", Error: "category_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: err.Error()})
		return
	}

	// Check if SKU already exists (excluding current product)
	var cnt int64
	if err := db.Model(&models.Product{}).Where("sku = ? AND id != ?", req.SKU, product.ID).Count(&cnt).Error; err == nil && cnt > 0 {
		c.JSON(http.StatusConflict, models.APIResponse{
			Success: false,
			Message: "Product with this SKU already exists",
			Error:   "sku_exists",
		})
		return
	}

	// Generate new slug if name changed
	if req.Name != product.Name {
		baseSlug := utils.GenerateSlug(req.Name)
		product.Slug = utils.GenerateUniqueSlug(baseSlug, func(s string) bool {
			var count int64
			db.Model(&models.Product{}).Where("slug = ? AND id != ?", s, product.ID).Count(&count)
			return count > 0
		})
	}

	// Extract image URLs for backward compatibility
	var imageURLs []string
	for _, img := range req.Images {
		imageURLs = append(imageURLs, img.URL)
	}

	// Serialize image URLs to JSON
	var imageURLsJSON string
	if len(imageURLs) > 0 {
		imageURLsBytes, err := json.Marshal(imageURLs)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{
				Success: false,
				Message: "Invalid image URLs format",
				Error:   err.Error(),
			})
			return
		}
		imageURLsJSON = string(imageURLsBytes)
	} else {
		imageURLsJSON = "[]"
	}

	oldSKU := product.SKU
	oldPath := services.BuildProductPublicPath(oldSKU)

	// Update product fields
	product.SKU = req.SKU
	product.Name = req.Name
	product.ShortDescription = req.ShortDescription
	product.Description = req.Description
	product.Price = req.Price
	product.ComparePrice = req.ComparePrice
	product.StockQuantity = req.StockQuantity
	product.Weight = req.Weight
	product.Dimensions = req.Dimensions
	product.Brand = req.Brand
	product.Model = req.Model
	product.PartNumber = req.PartNumber
	product.WarrantyPeriod = req.WarrantyPeriod
	product.LeadTime = req.LeadTime
	product.CategoryID = req.CategoryID
	product.IsActive = req.IsActive
	product.IsFeatured = req.IsFeatured
	product.MetaTitle = req.MetaTitle
	product.MetaDescription = req.MetaDescription
	product.MetaKeywords = req.MetaKeywords
	product.ImageURLs = imageURLsJSON

	// Start transaction
	tx := db.Begin()

	// Update product (limit to known DB columns to avoid unknown-column errors)
	// Perform explicit update to avoid referencing non-existent columns on legacy DBs
	rawSQL := `UPDATE products SET
        sku=?, name=?, slug=?, short_description=?, description=?, price=?, compare_price=?, stock_quantity=?, weight=?, dimensions=?,
        brand=?, model=?, part_number=?, warranty_period=?, lead_time=?, category_id=?, is_active=?, is_featured=?, meta_title=?, meta_description=?, meta_keywords=?, image_urls=?
        WHERE id=?`
	if err := tx.Exec(rawSQL,
		product.SKU, product.Name, product.Slug, product.ShortDescription, product.Description, product.Price, product.ComparePrice, product.StockQuantity, product.Weight, product.Dimensions,
		product.Brand, product.Model, product.PartNumber, product.WarrantyPeriod, product.LeadTime, product.CategoryID, product.IsActive, product.IsFeatured, product.MetaTitle, product.MetaDescription, product.MetaKeywords, product.ImageURLs,
		product.ID,
	).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update product",
			Error:   err.Error(),
		})
		return
	}

	// Delete existing attributes and create new ones
	tx.Where("product_id = ?", product.ID).Delete(&models.ProductAttribute{})
	for _, attr := range req.Attributes {
		attribute := models.ProductAttribute{
			ProductID:      product.ID,
			AttributeName:  attr.AttributeName,
			AttributeValue: attr.AttributeValue,
			SortOrder:      attr.SortOrder,
		}
		if err := tx.Create(&attribute).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to update product attributes",
				Error:   err.Error(),
			})
			return
		}
	}

	// Delete existing translations and create new ones
	tx.Where("product_id = ?", product.ID).Delete(&models.ProductTranslation{})
	for _, trans := range req.Translations {
		transSlug := utils.GenerateSlug(trans.Name)
		translation := models.ProductTranslation{
			ProductID:        product.ID,
			LanguageCode:     trans.LanguageCode,
			Name:             trans.Name,
			Slug:             transSlug,
			ShortDescription: trans.ShortDescription,
			Description:      trans.Description,
			MetaTitle:        trans.MetaTitle,
			MetaDescription:  trans.MetaDescription,
			MetaKeywords:     trans.MetaKeywords,
		}
		if err := tx.Create(&translation).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to update product translations",
				Error:   err.Error(),
			})
			return
		}
	}

	// Images are now stored in the ImageURLs JSON field, no need to create separate records
	// The image URLs are already stored in the product.ImageURLs field above

	// Commit transaction
	tx.Commit()

	newPath := services.BuildProductPublicPath(product.SKU)

	// Invalidate caches (Redis + optional Cloudflare)
	services.InvalidatePublicCaches(c.Request.Context(), "product:update", []string{oldPath, newPath})

	// Trigger Next.js ISR revalidation
	services.TriggerNextRevalidate([]string{oldSKU, product.SKU}, []string{oldPath, newPath}, true)

	// Load updated product with relations (select only known columns)
	db.Select("id,sku,name,slug,short_description,description,price,compare_price,stock_quantity,weight,dimensions,brand,model,part_number,category_id,is_active,is_featured,meta_title,meta_description,meta_keywords,image_urls,created_at,updated_at").
		Preload("Category").
		First(&product, product.ID)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Product updated successfully",
		Data:    product,
	})

}

// DeleteProduct deletes a product
func (pc *ProductController) DeleteProduct(c *gin.Context) {
	id := c.Param("id")

	db := config.GetDB()

	// Check if product exists
	var product models.Product
	if err := db.First(&product, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Product not found",
				Error:   "product_not_found",
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

	// Delete related records first to avoid foreign key constraints
	// Note: Images are now stored in JSON field, so no separate image table to clean up

	// Delete product attributes
	if err := db.Where("product_id = ?", id).Delete(&models.ProductAttribute{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete product attributes",
			Error:   err.Error(),
		})
		return
	}

	// Delete product translations
	if err := db.Where("product_id = ?", id).Delete(&models.ProductTranslation{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete product translations",
			Error:   err.Error(),
		})
		return
	}

	// Delete purchase links
	if err := db.Where("product_id = ?", id).Delete(&models.PurchaseLink{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete purchase links",
			Error:   err.Error(),
		})
		return
	}

	// Finally delete the product
	if err := db.Delete(&product).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete product",
			Error:   err.Error(),
		})
		return
	}

	productPath := services.BuildProductPublicPath(product.SKU)

	// Invalidate caches (Redis + optional Cloudflare)
	services.InvalidatePublicCaches(c.Request.Context(), "product:delete", []string{productPath})

	// Trigger Next.js ISR revalidation
	services.TriggerNextRevalidate([]string{product.SKU}, []string{productPath}, true)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Product deleted successfully",
	})
}

// AddImage adds an image URL to a product
func (pc *ProductController) AddImage(c *gin.Context) {
	productID := c.Param("id")

	var req models.ImageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Check if product exists
	var product models.Product
	if err := db.First(&product, productID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Product not found",
				Error:   "product_not_found",
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

	// Since we're now using JSON field for images, we need to update the image_urls field
	// Get current image URLs
	var currentURLs []string
	if product.ImageURLs != "" && product.ImageURLs != "[]" {
		if err := json.Unmarshal([]byte(product.ImageURLs), &currentURLs); err != nil {
			currentURLs = []string{}
		}
	}

	// Add new image URL
	if req.IsPrimary {
		// If this is primary, add it at the beginning
		currentURLs = append([]string{req.URL}, currentURLs...)
	} else {
		// Add at the end
		currentURLs = append(currentURLs, req.URL)
	}

	// Update the product with new image URLs
	imageURLsBytes, err := json.Marshal(currentURLs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to serialize image URLs",
			Error:   err.Error(),
		})
		return
	}

	product.ImageURLs = string(imageURLsBytes)
	if err := db.Save(&product).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update product images",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, models.APIResponse{
		Success: true,
		Message: "Image added successfully",
		Data: map[string]interface{}{
			"url":        req.URL,
			"is_primary": req.IsPrimary,
			"alt_text":   req.AltText,
		},
	})
}

// GetProductImages returns all images for a product (from JSON field)
func (pc *ProductController) GetProductImages(c *gin.Context) {
	productID := c.Param("id")

	db := config.GetDB()

	// Get product
	var product models.Product
	if err := db.First(&product, productID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Product not found",
				Error:   "product_not_found",
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

	// Parse image URLs from JSON
	var imageURLs []string
	if product.ImageURLs != "" && product.ImageURLs != "[]" {
		if err := json.Unmarshal([]byte(product.ImageURLs), &imageURLs); err != nil {
			imageURLs = []string{}
		}
	}

	// Convert to response format
	var images []map[string]interface{}
	for i, url := range imageURLs {
		images = append(images, map[string]interface{}{
			"id":         i + 1, // Fake ID for compatibility
			"url":        url,
			"is_primary": i == 0, // First image is primary
			"sort_order": i,
		})
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Product images retrieved successfully",
		Data:    images,
	})
}

// DeleteImage deletes a specific image from a product (by URL or index)
func (pc *ProductController) DeleteImage(c *gin.Context) {
	productID := c.Param("id")
	imageIndex := c.Param("imageIndex") // Changed from imageId to imageIndex

	db := config.GetDB()

	// Get product
	var product models.Product
	if err := db.First(&product, productID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, models.APIResponse{
				Success: false,
				Message: "Product not found",
				Error:   "product_not_found",
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

	// Parse current image URLs
	var currentURLs []string
	if product.ImageURLs != "" && product.ImageURLs != "[]" {
		if err := json.Unmarshal([]byte(product.ImageURLs), &currentURLs); err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{
				Success: false,
				Message: "Failed to parse image URLs",
				Error:   err.Error(),
			})
			return
		}
	}

	// Convert imageIndex to int
	var index int
	if _, err := fmt.Sscanf(imageIndex, "%d", &index); err != nil || index < 0 || index >= len(currentURLs) {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Image not found",
			Error:   "image_not_found",
		})
		return
	}

	// Remove image at index
	currentURLs = append(currentURLs[:index], currentURLs[index+1:]...)

	// Update product
	imageURLsBytes, err := json.Marshal(currentURLs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to serialize image URLs",
			Error:   err.Error(),
		})
		return
	}

	product.ImageURLs = string(imageURLsBytes)
	if err := db.Save(&product).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update product",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Image deleted successfully",
	})
}

// BulkAutoImportSEO runs auto-import for multiple products by IDs or SKUs
// POST /api/v1/admin/seo/bulk-import
// Body: { "product_ids": [1,2], "skus": ["A16B-..."], "source_base_url": "https://fanucworld.com/products/", "apply": true, "auto_category": true, "limit": 50 }
func (pc *ProductController) BulkAutoImportSEO(c *gin.Context) {
	var req struct {
		ProductIDs    []int    `json:"product_ids"`
		SKUs          []string `json:"skus"`
		SourceBaseURL string   `json:"source_base_url"`
		Apply         bool     `json:"apply"`
		AutoCategory  bool     `json:"auto_category"`
		Limit         int      `json:"limit"`
		Provider      string   `json:"provider"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	if req.SourceBaseURL == "" {
		req.SourceBaseURL = "https://fanucworld.com/products/"
	}
	if req.Limit <= 0 || req.Limit > 500 {
		req.Limit = 50
	}

	db := config.GetDB()
	type target struct {
		ID  uint
		SKU string
	}
	targets := []target{}

	if len(req.ProductIDs) > 0 {
		var prods []models.Product
		if err := db.Where("id IN ?", req.ProductIDs).Find(&prods).Error; err == nil {
			for _, p := range prods {
				targets = append(targets, target{ID: p.ID, SKU: p.SKU})
			}
		}
	}
	if len(req.SKUs) > 0 {
		var prods []models.Product
		if err := db.Where("sku IN ?", req.SKUs).Find(&prods).Error; err == nil {
			for _, p := range prods {
				targets = append(targets, target{ID: p.ID, SKU: p.SKU})
			}
		}
	}
	if len(targets) > req.Limit {
		targets = targets[:req.Limit]
	}
	if len(targets) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No targets to import"})
		return
	}

	results := make([]map[string]interface{}, 0, len(targets))
	for _, t := range targets {
		var product models.Product
		if err := db.First(&product, t.ID).Error; err != nil {
			results = append(results, map[string]interface{}{"product_id": t.ID, "sku": t.SKU, "status": "error", "error": "product_not_found"})
			continue
		}
		var candidate string
		var extracted *services.ImportedSEO
		if strings.ToLower(strings.TrimSpace(req.Provider)) == "ebay" {
			tmp, src, err := services.ImportFromEbay(product.SKU)
			if err == nil && tmp != nil {
				extracted = tmp
				candidate = src
			}
		} else {
			candidates, _ := buildCandidates(req.SourceBaseURL, product.SKU)
			for _, cand := range candidates {
				candidate = cand
				tmp, err := services.ExtractFromURL(cand)
				if err != nil {
					continue
				}
				if strings.Contains(strings.ToLower(tmp.Title), "tie industrial - fanucworld.com") {
					continue
				}
				extracted = tmp
				break
			}
			if extracted == nil {
				results = append(results, map[string]interface{}{"product_id": t.ID, "sku": t.SKU, "status": "not_found", "tried": candidates})
				continue
			}
		}
		if req.Apply {
			product.MetaTitle = extracted.Title
			if extracted.MetaDescription != "" {
				product.MetaDescription = extracted.MetaDescription
			}
			if extracted.MetaKeywords != "" {
				product.MetaKeywords = extracted.MetaKeywords
			}
			if extracted.DescriptionHTML != "" {
				if strings.TrimSpace(product.Description) == "" {
					product.Description = extracted.DescriptionHTML
				} else if !strings.Contains(product.Description, extracted.DescriptionHTML) {
					product.Description += "\n\n" + extracted.DescriptionHTML
				}
			}
			if req.AutoCategory && strings.TrimSpace(extracted.CategoryGuess) != "" {
				catName := strings.TrimSpace(extracted.CategoryGuess)
				slug := utils.GenerateSlug(catName)
				var cat models.Category
				if err := db.Where("slug = ?", slug).First(&cat).Error; err != nil {
					if err == gorm.ErrRecordNotFound {
						_ = db.Create(&models.Category{Name: catName, Slug: slug, Description: catName, IsActive: true}).Error
						_ = db.Where("slug = ?", slug).First(&cat).Error
					}
				}
				if cat.ID != 0 {
					product.CategoryID = cat.ID
				}
			}
			_ = db.Save(&product).Error
		}
		status := "fetched"
		if req.Apply {
			status = "applied"
		}
		results = append(results, map[string]interface{}{"product_id": t.ID, "sku": t.SKU, "status": status, "source_url": candidate})
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Bulk import completed", Data: results})
}
