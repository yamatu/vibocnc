package controllers

import (
	"context"
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
	BatchSize          int      `json:"batch_size"`
}

type bulkAutoCategorizeReq struct {
	bulkProductScopeReq
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

type bulkAutoCategorizeItem struct {
	ProductID     uint   `json:"product_id"`
	SKU           string `json:"sku"`
	Model         string `json:"model"`
	Brand         string `json:"brand"`
	CategorySlug  string `json:"category_slug"`
	CategoryID    uint   `json:"category_id"`
	PreviousCatID uint   `json:"previous_category_id"`
	PartType      string `json:"part_type"`
	MatchRule     string `json:"match_rule"`
	Action        string `json:"action"`
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
	return selector
}

func categorySlugMap(db *gorm.DB) map[string]uint {
	out := map[string]uint{}
	var cats []models.Category
	if err := db.Model(&models.Category{}).Where("is_active = ?", true).Find(&cats).Error; err == nil {
		for _, c := range cats {
			out[c.Slug] = c.ID
		}
	}
	return out
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

// Admin: PUT /api/v1/admin/products/bulk-auto-categorize
func (pc *ProductController) BulkAutoCategorizeProducts(c *gin.Context) {
	var req bulkAutoCategorizeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = 500
	}

	db := config.GetDB()
	selector := buildBulkProductSelector(db, req.bulkProductScopeReq).Select("id", "sku", "model", "part_number", "brand", "category_id", "name", "short_description", "description", "meta_title", "meta_description", "meta_keywords")
	catBySlug := categorySlugMap(db)

	var batch []models.Product
	updated := int64(0)
	skipped := int64(0)
	failed := int64(0)
	samples := make([]bulkAutoCategorizeItem, 0, 50)

	err := selector.FindInBatches(&batch, batchSize, func(txBatch *gorm.DB, _ int) error {
		for _, p := range batch {
			brand := p.Brand
			if strings.TrimSpace(req.Brand) != "" {
				brand = services.CanonicalBrandName(req.Brand)
			}
			model := services.NormalizeProductModel(p.Model)
			if model == "" {
				model = services.NormalizeProductModel(p.PartNumber)
			}
			if model == "" {
				model = services.NormalizeProductModel(p.SKU)
			}

			inference := services.InferProductCategory(brand, model)
			categoryID := catBySlug[inference.CategorySlug]
			if categoryID == 0 {
				skipped++
				if len(samples) < 50 {
					samples = append(samples, bulkAutoCategorizeItem{
						ProductID:     p.ID,
						SKU:           p.SKU,
						Model:         model,
						Brand:         brand,
						CategorySlug:  inference.CategorySlug,
						CategoryID:    categoryID,
						PreviousCatID: p.CategoryID,
						PartType:      inference.PartType,
						MatchRule:     inference.MatchRule,
						Action:        "skipped",
					})
				}
				continue
			}

			updates := map[string]any{}
			if p.CategoryID != categoryID {
				updates["category_id"] = categoryID
			}
			if strings.TrimSpace(p.Brand) == "" || strings.TrimSpace(req.Brand) != "" {
				updates["brand"] = services.CanonicalBrandName(brand)
			}
			if strings.TrimSpace(p.Model) == "" && model != "" {
				updates["model"] = model
			}
			if strings.TrimSpace(p.PartNumber) == "" && model != "" {
				updates["part_number"] = model
			}

			if enr, err := services.EnrichProductByBrand(brand, model); err == nil {
				if strings.TrimSpace(p.Name) == "" {
					updates["name"] = enr.Name
				}
				if strings.TrimSpace(p.ShortDescription) == "" {
					updates["short_description"] = enr.ShortDescription
				}
				if strings.TrimSpace(p.Description) == "" {
					updates["description"] = enr.Description
				}
				if strings.TrimSpace(p.MetaTitle) == "" {
					updates["meta_title"] = enr.MetaTitle
				}
				if strings.TrimSpace(p.MetaDescription) == "" {
					updates["meta_description"] = enr.MetaDescription
				}
				if strings.TrimSpace(p.MetaKeywords) == "" {
					updates["meta_keywords"] = enr.MetaKeywords
				}
			}

			action := "skipped"
			if len(updates) > 0 {
				if err := db.Model(&models.Product{}).Where("id = ?", p.ID).Updates(updates).Error; err != nil {
					failed++
					if len(samples) < 50 {
						samples = append(samples, bulkAutoCategorizeItem{
							ProductID:     p.ID,
							SKU:           p.SKU,
							Model:         model,
							Brand:         brand,
							CategorySlug:  inference.CategorySlug,
							CategoryID:    categoryID,
							PreviousCatID: p.CategoryID,
							PartType:      inference.PartType,
							MatchRule:     inference.MatchRule,
							Action:        "failed",
						})
					}
					continue
				}
				updated++
				action = "updated"
			} else {
				skipped++
			}

			if len(samples) < 50 {
				samples = append(samples, bulkAutoCategorizeItem{
					ProductID:     p.ID,
					SKU:           p.SKU,
					Model:         model,
					Brand:         brand,
					CategorySlug:  inference.CategorySlug,
					CategoryID:    categoryID,
					PreviousCatID: p.CategoryID,
					PartType:      inference.PartType,
					MatchRule:     inference.MatchRule,
					Action:        action,
				})
			}
		}
		return nil
	}).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to auto categorize products", Error: err.Error()})
		return
	}

	if updated > 0 {
		// Keep the user-facing request fast; cache invalidation is best-effort.
		go services.InvalidatePublicCaches(context.Background(), "product:bulk-auto-categorize", nil)
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Bulk auto categorization completed",
		Data: gin.H{
			"updated": updated,
			"skipped": skipped,
			"failed":  failed,
			"items":   samples,
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
