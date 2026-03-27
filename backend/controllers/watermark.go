package controllers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
)

type WatermarkController struct{}

type watermarkSettingsResponse struct {
	ID                uint                       `json:"id"`
	Enabled           bool                       `json:"enabled"`
	WatermarkPosition string                     `json:"watermark_position"`
	BaseMediaAssetID  *uint                      `json:"base_media_asset_id"`
	BaseMediaAsset    *models.MediaAssetResponse `json:"base_media_asset,omitempty"`
}

// Admin: GET /api/v1/admin/media/watermark/settings
func (wc *WatermarkController) GetSettings(c *gin.Context) {
	db := config.GetDB()
	s, err := services.GetOrCreateWatermarkSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
		return
	}
	// preload base asset for response
	var baseAsset *models.MediaAssetResponse
	if s.BaseMediaAssetID != nil {
		var a models.MediaAsset
		if e := db.First(&a, *s.BaseMediaAssetID).Error; e == nil {
			resp := a.ToResponse()
			baseAsset = &resp
		}
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: watermarkSettingsResponse{
		ID:                s.ID,
		Enabled:           s.Enabled,
		WatermarkPosition: s.WatermarkPosition,
		BaseMediaAssetID:  s.BaseMediaAssetID,
		BaseMediaAsset:    baseAsset,
	}})
}

type updateWatermarkSettingsRequest struct {
	Enabled           *bool   `json:"enabled"`
	WatermarkPosition *string `json:"watermark_position"`
	BaseMediaAssetID  *uint   `json:"base_media_asset_id"`
}

// Admin: PUT /api/v1/admin/media/watermark/settings
func (wc *WatermarkController) UpdateSettings(c *gin.Context) {
	db := config.GetDB()
	s, err := services.GetOrCreateWatermarkSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
		return
	}

	var req updateWatermarkSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	updates := map[string]any{}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.WatermarkPosition != nil {
		pos := strings.TrimSpace(*req.WatermarkPosition)
		if pos == "" {
			pos = "bottom-right"
		}
		updates["watermark_position"] = pos
	}
	if req.BaseMediaAssetID != nil {
		if *req.BaseMediaAssetID == 0 {
			updates["base_media_asset_id"] = nil
		} else {
			// validate existence
			var a models.MediaAsset
			if e := db.First(&a, *req.BaseMediaAssetID).Error; e != nil {
				c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid base media asset", Error: e.Error()})
				return
			}
			updates["base_media_asset_id"] = *req.BaseMediaAssetID
		}
	}

	if len(updates) == 0 {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "No changes"})
		return
	}

	if e := db.Model(&models.WatermarkSetting{}).Where("id = ?", s.ID).Updates(updates).Error; e != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update settings", Error: e.Error()})
		return
	}

	wc.GetSettings(c)
}

type watermarkGenerateRequest struct {
	AssetID           uint   `json:"asset_id" binding:"required"`
	TextSource        string `json:"text_source"` // sku | custom
	SKU               string `json:"sku"`
	Text              string `json:"text"`
	WatermarkPosition string `json:"watermark_position"`
}

// Admin: POST /api/v1/admin/media/watermark
// Generates a new watermarked copy of a media asset.
func (wc *WatermarkController) GenerateFromMedia(c *gin.Context) {
	var req watermarkGenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	text := strings.TrimSpace(req.Text)
	if strings.ToLower(strings.TrimSpace(req.TextSource)) == "sku" {
		text = strings.TrimSpace(req.SKU)
	}
	if text == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing watermark text", Error: "empty_text"})
		return
	}

	db := config.GetDB()
	assetID := req.AssetID
	// Use custom position if provided; otherwise follow settings.
	pos := strings.TrimSpace(req.WatermarkPosition)
	if pos == "" {
		if s, e := services.GetOrCreateWatermarkSetting(db); e == nil {
			pos = s.WatermarkPosition
		}
	}
	res, err := services.GenerateWatermarkedMediaAsset(db, services.WatermarkRequest{BaseAssetID: &assetID, Text: text, Folder: "watermarked", Position: pos})
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to watermark", Error: err.Error()})
		return
	}
	resp := res.Asset.ToResponse()
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: resp})
}

// Public: GET /api/v1/public/products/default-image/:sku
// Returns a PNG for products with no images (watermarked with SKU if enabled).
func (wc *WatermarkController) DefaultProductImage(c *gin.Context) {
	sku := strings.TrimSpace(c.Param("sku"))
	if sku == "" {
		sku = strings.TrimSpace(c.Query("sku"))
	}
	// prevent path traversal / super long
	if len(sku) > 80 {
		sku = sku[:80]
	}
	if sku == "" {
		sku = "PRODUCT"
	}

	db := config.GetDB()
	s, err := services.GetOrCreateWatermarkSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
		return
	}

	var baseID *uint
	if s.Enabled {
		baseID = s.BaseMediaAssetID
	}
	wm, err := services.GenerateWatermarkedMediaAsset(db, services.WatermarkRequest{BaseAssetID: baseID, Text: sku, Folder: "watermarked-default", Position: s.WatermarkPosition})
	if err != nil {
		// If base image is not decodable (e.g., SVG), fallback to built-in base.
		if baseID != nil {
			wm, err = services.GenerateWatermarkedMediaAsset(db, services.WatermarkRequest{BaseAssetID: nil, Text: sku, Folder: "watermarked-default", Position: s.WatermarkPosition})
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to generate image", Error: err.Error()})
			return
		}
	}

	uploadRoot := os.Getenv("UPLOAD_PATH")
	if strings.TrimSpace(uploadRoot) == "" {
		uploadRoot = "./uploads"
	}
	full := filepath.Join(uploadRoot, filepath.FromSlash(wm.Asset.RelativePath))
	b, err := os.ReadFile(full)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to read image", Error: err.Error()})
		return
	}

	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("ETag", fmt.Sprintf("\"%s\"", wm.SHA256))
	c.Data(http.StatusOK, wm.Asset.MimeType, b)
}
