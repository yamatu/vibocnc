package controllers

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type bulkProductScopeReq struct {
	IDs                []uint   `json:"ids"`
	SKUs               []string `json:"skus"`
	Search             string   `json:"search"`
	CategoryID         string   `json:"category_id"`
	IncludeDescendants bool     `json:"include_descendants"`
	Status             string   `json:"status"`
	Featured           string   `json:"featured"`
	Brand              string   `json:"brand"`
	AISEOStatus        string   `json:"ai_seo_status"`
	BatchSize          int      `json:"batch_size"`
}

type bulkSelectionIDsResp struct {
	IDs   []uint `json:"ids"`
	Total int64  `json:"total"`
}

type bulkCategoryImageReq struct {
	bulkProductScopeReq
	MediaAssetID uint   `json:"media_asset_id" binding:"required"`
	ApplyMode    string `json:"apply_mode"` // fill_empty | replace_all
}

func buildBulkProductSelector(db *gorm.DB, req bulkProductScopeReq) *gorm.DB {
	selector := db.Model(&models.Product{})
	if len(req.IDs) > 0 && len(req.SKUs) > 0 {
		selector = selector.Where("id IN ? OR sku IN ?", req.IDs, req.SKUs)
	} else if len(req.IDs) > 0 {
		selector = selector.Where("id IN ?", req.IDs)
	} else if len(req.SKUs) > 0 {
		selector = selector.Where("sku IN ?", req.SKUs)
	} else {
		selector = buildProductSelector(selector, bulkDefaultImageReq{
			Search:             req.Search,
			CategoryID:         req.CategoryID,
			IncludeDescendants: req.IncludeDescendants,
			Status:             req.Status,
			Featured:           req.Featured,
		})
	}

	if brand := services.CanonicalBrandName(req.Brand); strings.TrimSpace(req.Brand) != "" {
		selector = selector.Where("LOWER(brand) = LOWER(?)", brand)
	}
	switch strings.ToLower(strings.TrimSpace(req.AISEOStatus)) {
	case "optimized", "failed", "running":
		selector = selector.Where("ai_seo_status = ?", strings.ToLower(strings.TrimSpace(req.AISEOStatus)))
	case "not_optimized":
		selector = selector.Where("ai_seo_status IS NULL OR ai_seo_status = ''")
	}
	return selector
}

func ensureProductFAQ(db *gorm.DB, productID uint, question string, answer string, sortOrder int) error {
	question = strings.TrimSpace(question)
	answer = strings.TrimSpace(answer)
	if question == "" || answer == "" {
		return nil
	}

	var existing models.ProductFAQ
	err := db.Where("product_id = ? AND question = ?", productID, question).First(&existing).Error
	if err == nil {
		updates := map[string]any{}
		if strings.TrimSpace(existing.Answer) == "" {
			updates["answer"] = answer
		}
		if !existing.IsActive {
			updates["is_active"] = true
		}
		if existing.SortOrder == 0 && sortOrder > 0 {
			updates["sort_order"] = sortOrder
		}
		if len(updates) > 0 {
			return db.Model(&existing).Updates(updates).Error
		}
		return nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	return db.Create(&models.ProductFAQ{
		ProductID: productID,
		Question:  question,
		Answer:    answer,
		IsActive:  true,
		SortOrder: sortOrder,
	}).Error
}

func upsertGeneratedProductFAQs(db *gorm.DB, product *models.Product, partType string) error {
	partType = strings.TrimSpace(partType)
	if partType == "" {
		partType = "spare part"
	}

	heading := strings.TrimSpace(product.Name)
	if heading == "" {
		heading = strings.TrimSpace(strings.Join([]string{product.Brand, product.SKU, partType}, " "))
	}

	stockAnswer := ""
	if product.StockQuantity > 0 {
		stockAnswer = fmt.Sprintf("%s is currently in stock and ready for worldwide shipment.", product.SKU)
	} else {
		stockAnswer = fmt.Sprintf("%s is available to order with %s lead time.", product.SKU, strings.TrimSpace(defaultString(product.LeadTime, "3-7 days")))
	}

	faqs := []struct {
		Question string
		Answer   string
	}{
		{
			Question: fmt.Sprintf("What is %s used for?", product.SKU),
			Answer:   fmt.Sprintf("%s is used for CNC repair, maintenance, replacement, and industrial automation support. Buyers usually match it by original part number, machine series, and cabinet configuration.", heading),
		},
		{
			Question: fmt.Sprintf("How do I confirm compatibility for %s?", product.SKU),
			Answer:   defaultString(strings.TrimSpace(product.CompatibilityInfo), fmt.Sprintf("Confirm compatibility for %s against your original part label, controller model, machine model, and option code before ordering.", product.SKU)),
		},
		{
			Question: fmt.Sprintf("Is %s in stock and how fast can it ship?", product.SKU),
			Answer:   stockAnswer,
		},
	}

	for index, faq := range faqs {
		if err := ensureProductFAQ(db, product.ID, faq.Question, faq.Answer, index+1); err != nil {
			return err
		}
	}
	return nil
}

func defaultString(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

// Admin: POST /api/v1/admin/products/selection-ids
func (pc *ProductController) GetBulkProductSelectionIDs(c *gin.Context) {
	var req bulkProductScopeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	selector := buildBulkProductSelector(db, req)

	var rows []struct {
		ID uint `json:"id"`
	}
	if err := selector.Select("id").Order("id ASC").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to fetch product selection", Error: err.Error()})
		return
	}

	ids := make([]uint, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Product selection retrieved successfully",
		Data: bulkSelectionIDsResp{
			IDs:   ids,
			Total: int64(len(ids)),
		},
	})
}

// Admin: PUT /api/v1/admin/products/bulk-category-image
func (pc *ProductController) BulkApplyCategoryImage(c *gin.Context) {
	var req bulkCategoryImageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	applyMode := strings.ToLower(strings.TrimSpace(req.ApplyMode))
	if applyMode == "" {
		applyMode = "fill_empty"
	}
	if applyMode != "fill_empty" && applyMode != "replace_all" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid apply mode", Error: "invalid_apply_mode"})
		return
	}

	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = 500
	}

	db := config.GetDB()
	var asset models.MediaAsset
	if err := db.First(&asset, req.MediaAssetID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Media asset not found", Error: "media_asset_not_found"})
		return
	}
	imageURL := asset.ToResponse().URL

	selector := buildBulkProductSelector(db, req.bulkProductScopeReq).Select("id", "sku", "image_urls")
	var batch []models.Product
	updated := int64(0)
	skipped := int64(0)

	err := selector.FindInBatches(&batch, batchSize, func(txBatch *gorm.DB, _ int) error {
		for _, p := range batch {
			urls := parseImageURLsJSON(p.ImageURLs)
			if applyMode == "fill_empty" && len(urls) > 0 {
				skipped++
				continue
			}

			next := []string{imageURL}
			if applyMode == "fill_empty" && len(urls) == 0 {
				next = []string{imageURL}
			}
			if applyMode == "replace_all" && len(urls) == 1 && urls[0] == imageURL {
				skipped++
				continue
			}
			if applyMode == "fill_empty" && len(urls) == 0 && len(next) == 1 {
				// proceed
			}
			if err := db.Model(&models.Product{}).Where("id = ?", p.ID).Update("image_urls", toImageURLsJSON(next)).Error; err != nil {
				return err
			}
			if err := services.ClearExplicitProductImageTrust(db, p.ID); err != nil {
				return err
			}
			updated++
		}
		return nil
	}).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to apply category image", Error: err.Error()})
		return
	}

	if updated > 0 {
		// Keep the user-facing request fast; cache invalidation is best-effort.
		go services.InvalidatePublicCaches(context.Background(), "product:bulk-category-image", nil)
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Bulk category image applied",
		Data: gin.H{
			"updated":    updated,
			"skipped":    skipped,
			"image_url":  imageURL,
			"apply_mode": applyMode,
		},
	})
}
