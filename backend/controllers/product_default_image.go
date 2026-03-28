package controllers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type bulkDefaultImageReq struct {
	IDs        []uint   `json:"ids"`
	SKUs       []string `json:"skus"`
	Search     string   `json:"search"`
	CategoryID string   `json:"category_id"`
	Status     string   `json:"status"`     // "active" | "inactive" | "all" | ""
	Featured   string   `json:"featured"`   // "true" | "false" | ""
	BatchSize  int      `json:"batch_size"` // optional, default 500
}

func defaultImageURLForSKU(sku string) string {
	s := strings.TrimSpace(sku)
	if s == "" {
		s = "PRODUCT"
	}
	// Query param avoids issues with encoded slashes.
	return "/api/v1/public/products/default-image?sku=" + url.QueryEscape(s)
}

func staticDefaultImageURLForSKU(db *gorm.DB, sku string) (string, error) {
	s := strings.TrimSpace(sku)
	if s == "" {
		s = "PRODUCT"
	}

	var baseID *uint
	position := "bottom-right"
	if db != nil {
		if setting, err := services.GetOrCreateWatermarkSetting(db); err == nil {
			if setting.Enabled {
				baseID = setting.BaseMediaAssetID
			}
			position = setting.WatermarkPosition
		}
	}

	wm, err := services.GenerateWatermarkedMediaAsset(db, services.WatermarkRequest{
		BaseAssetID: baseID,
		Text:        s,
		Folder:      "watermarked-default",
		Position:    position,
	})
	if err != nil {
		if baseID != nil {
			wm, err = services.GenerateWatermarkedMediaAsset(db, services.WatermarkRequest{
				BaseAssetID: nil,
				Text:        s,
				Folder:      "watermarked-default",
				Position:    position,
			})
		}
		if err != nil {
			return "", err
		}
	}

	return "/uploads/" + wm.Asset.RelativePath, nil
}

func parseImageURLsJSON(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" || s == "[]" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return []string{}
	}
	clean := make([]string, 0, len(out))
	for _, u := range out {
		u = strings.TrimSpace(u)
		if u != "" {
			clean = append(clean, u)
		}
	}
	return clean
}

func toImageURLsJSON(urls []string) string {
	if len(urls) == 0 {
		return "[]"
	}
	b, err := json.Marshal(urls)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func buildProductSelector(db *gorm.DB, req bulkDefaultImageReq) *gorm.DB {
	q := db.Model(&models.Product{})
	if req.CategoryID != "" {
		q = q.Where("category_id = ?", req.CategoryID)
	}
	if strings.TrimSpace(req.Search) != "" {
		like := "%" + strings.TrimSpace(req.Search) + "%"
		q = q.Where("sku LIKE ? OR name LIKE ? OR description LIKE ? OR part_number LIKE ? OR model LIKE ?", like, like, like, like, like)
	}
	if req.Status == "active" {
		q = q.Where("is_active = ?", true)
	} else if req.Status == "inactive" {
		q = q.Where("is_active = ?", false)
	}
	if req.Featured == "true" {
		q = q.Where("is_featured = ?", true)
	} else if req.Featured == "false" {
		q = q.Where("is_featured = ?", false)
	}
	return q
}

// Admin: PUT /api/v1/admin/products/bulk-default-image/apply
// Apply the default SKU watermark image to products that currently have no images.
func (pc *ProductController) BulkApplyDefaultImage(c *gin.Context) {
	var req bulkDefaultImageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = 500
	}

	db := config.GetDB()
	selector := db.Model(&models.Product{}).Select("id", "sku", "image_urls")
	if len(req.IDs) > 0 {
		selector = selector.Where("id IN ?", req.IDs)
	}
	if len(req.SKUs) > 0 {
		selector = selector.Or("sku IN ?", req.SKUs)
	}
	if len(req.IDs) == 0 && len(req.SKUs) == 0 {
		selector = buildProductSelector(selector, req)
	}

	updated := int64(0)
	skipped := int64(0)

	var batch []models.Product
	if err := selector.FindInBatches(&batch, batchSize, func(txBatch *gorm.DB, _ int) error {
		for _, p := range batch {
			urls := parseImageURLsJSON(p.ImageURLs)
			if len(urls) > 0 {
				skipped++
				continue
			}
			defURL, err := staticDefaultImageURLForSKU(db, p.SKU)
			if err != nil {
				return err
			}
			if err := db.Model(&models.Product{}).Where("id = ?", p.ID).Update("image_urls", toImageURLsJSON([]string{defURL})).Error; err != nil {
				return err
			}
			updated++
		}
		batch = batch[:0]
		return nil
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to apply default images", Error: err.Error()})
		return
	}

	if updated > 0 {
		services.InvalidatePublicCaches(c.Request.Context(), "product:bulk-default-image:apply", nil)
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: gin.H{"updated": updated, "skipped": skipped}})
}

// Admin: PUT /api/v1/admin/products/bulk-default-image/remove
// Remove the default SKU watermark image URL from products (keeps other images).
func (pc *ProductController) BulkRemoveDefaultImage(c *gin.Context) {
	var req bulkDefaultImageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = 500
	}

	db := config.GetDB()
	selector := db.Model(&models.Product{}).Select("id", "sku", "image_urls")
	if len(req.IDs) > 0 {
		selector = selector.Where("id IN ?", req.IDs)
	}
	if len(req.SKUs) > 0 {
		selector = selector.Or("sku IN ?", req.SKUs)
	}
	if len(req.IDs) == 0 && len(req.SKUs) == 0 {
		selector = buildProductSelector(selector, req)
	}

	updated := int64(0)
	skipped := int64(0)
	removed := int64(0)

	var batch []models.Product
	if err := selector.FindInBatches(&batch, batchSize, func(txBatch *gorm.DB, _ int) error {
		for _, p := range batch {
			urls := parseImageURLsJSON(p.ImageURLs)
			if len(urls) == 0 {
				skipped++
				continue
			}
			defURL := defaultImageURLForSKU(p.SKU)
			staticURL, _ := staticDefaultImageURLForSKU(db, p.SKU)
			out := make([]string, 0, len(urls))
			changed := false
			for _, u := range urls {
				if strings.TrimSpace(u) == defURL {
					changed = true
					removed++
					continue
				}
				if staticURL != "" && strings.TrimSpace(u) == staticURL {
					changed = true
					removed++
					continue
				}
				// legacy path-based URL
				legacy := "/api/v1/public/products/default-image/" + url.PathEscape(strings.TrimSpace(p.SKU))
				if strings.TrimSpace(u) == legacy {
					changed = true
					removed++
					continue
				}
				out = append(out, u)
			}
			if !changed {
				skipped++
				continue
			}
			if err := db.Model(&models.Product{}).Where("id = ?", p.ID).Update("image_urls", toImageURLsJSON(out)).Error; err != nil {
				return err
			}
			updated++
		}
		batch = batch[:0]
		return nil
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to remove default images", Error: err.Error()})
		return
	}

	if updated > 0 {
		services.InvalidatePublicCaches(c.Request.Context(), "product:bulk-default-image:remove", nil)
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: gin.H{"updated": updated, "removed": removed, "skipped": skipped}})
}
