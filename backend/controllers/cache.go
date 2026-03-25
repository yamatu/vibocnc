package controllers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// CacheController provides admin endpoints for cache purging.
//
// It supports:
// - Redis origin cache invalidation (for cached public GET API endpoints)
// - Cloudflare edge cache purging (Global API Key)
type CacheController struct{}

func (cc *CacheController) GetSettings(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}
	var s models.CloudflareCacheSetting
	if err := db.First(&s, 1).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			s = models.CloudflareCacheSetting{ID: 1, Enabled: false, AutoPurgeOnMutation: true, AutoClearRedisOnMutation: true}
			_ = db.Create(&s).Error

		} else {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: s.ToResponse()})
}

type updateSettingsRequest struct {
	Email                    *string `json:"email"`
	ApiKey                   *string `json:"api_key"`
	ZoneID                   *string `json:"zone_id"`
	Enabled                  *bool   `json:"enabled"`
	AutoPurgeOnMutation      *bool   `json:"auto_purge_on_mutation"`
	AutoClearRedisOnMutation *bool   `json:"auto_clear_redis_on_mutation"`
	AutoPurgeIntervalMinutes *int    `json:"auto_purge_interval_minutes"`
	PurgeEverything          *bool   `json:"purge_everything"`
}

func (cc *CacheController) UpdateSettings(c *gin.Context) {
	var req updateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var s models.CloudflareCacheSetting
	if err := db.First(&s, 1).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			s = models.CloudflareCacheSetting{ID: 1, Enabled: false, AutoPurgeOnMutation: true, AutoClearRedisOnMutation: true}
			if e := db.Create(&s).Error; e != nil {
				c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to init settings", Error: e.Error()})
				return
			}
		} else {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
			return
		}
	}

	if req.Email != nil {
		s.Email = strings.TrimSpace(*req.Email)
	}
	if req.ZoneID != nil {
		s.ZoneID = strings.TrimSpace(*req.ZoneID)
	}
	if req.Enabled != nil {
		s.Enabled = *req.Enabled
	}
	if req.AutoPurgeOnMutation != nil {
		s.AutoPurgeOnMutation = *req.AutoPurgeOnMutation
	}
	if req.AutoClearRedisOnMutation != nil {
		s.AutoClearRedisOnMutation = *req.AutoClearRedisOnMutation
	}
	if req.AutoPurgeIntervalMinutes != nil {
		if *req.AutoPurgeIntervalMinutes < 0 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid interval", Error: "auto_purge_interval_minutes must be >= 0"})
			return
		}
		s.AutoPurgeIntervalMinutes = *req.AutoPurgeIntervalMinutes
	}
	if req.PurgeEverything != nil {
		s.PurgeEverything = *req.PurgeEverything
	}

	if req.ApiKey != nil {
		apiKey := strings.TrimSpace(*req.ApiKey)
		// Allow empty to mean "keep existing".
		if apiKey != "" {
			enc, err := utils.EncryptSecret(apiKey)
			if err != nil {
				c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to encrypt api key", Error: err.Error()})
				return
			}
			s.ApiKeyEnc = enc
		}
	}

	if err := db.Save(&s).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save settings", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Saved", Data: s.ToResponse()})
}

type purgeRequest struct {
	PurgeEverything bool     `json:"purge_everything"`
	URLs            []string `json:"urls"`
	ClearRedis      bool     `json:"clear_redis"`
}

func (cc *CacheController) PurgeNow(c *gin.Context) {
	var req purgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// allow empty body
		req = purgeRequest{}
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var s models.CloudflareCacheSetting
	if err := db.First(&s, 1).Error; err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Cache settings not configured", Error: err.Error()})
		return
	}

	// Optionally clear Redis public cache
	if req.ClearRedis {
		_ = services.ClearRedisByPrefixes(
			c.Request.Context(),
			"cache:public:categories:",
			"cache:public:products:",
			"cache:public:product:",
			"cache:public:product_sku:",
			"cache:public:product_sku_query:",
			"cache:public:homepage:",
		)
	}

	// If Cloudflare is disabled, we still consider this a valid "manual refresh" when ClearRedis=true.
	if !s.Enabled {
		if req.ClearRedis {
			now := time.Now().UTC()
			_ = db.Model(&models.CloudflareCacheSetting{}).Where("id = ?", s.ID).Update("last_purge_at", &now).Error
			c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Redis cache cleared", Data: map[string]any{"purge_everything": false, "cleared_redis": true, "at": now}})
			return
		}
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Cloudflare purge is disabled", Error: "disabled"})
		return
	}

	if strings.TrimSpace(s.ApiKeyEnc) == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Cloudflare api key not set", Error: "missing_api_key"})
		return
	}
	apiKey, err := utils.DecryptSecret(s.ApiKeyEnc)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid api key encryption", Error: err.Error()})
		return
	}

	client := services.NewCloudflareClient()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()

	purgeEverything := req.PurgeEverything || s.PurgeEverything
	if purgeEverything {
		err = client.PurgeEverything(ctx, s.Email, apiKey, s.ZoneID)
	} else {
		urls := services.BuildPurgeURLsForAdmin(req.URLs)
		err = client.PurgeURLs(ctx, s.Email, apiKey, s.ZoneID, urls)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Purge failed", Error: err.Error()})
		return
	}

	now := time.Now().UTC()
	_ = db.Model(&models.CloudflareCacheSetting{}).Where("id = ?", s.ID).Update("last_purge_at", &now).Error

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Purged", Data: map[string]any{"purge_everything": purgeEverything, "cleared_redis": req.ClearRedis, "at": now}})
}

func (cc *CacheController) Test(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}
	var s models.CloudflareCacheSetting
	if err := db.First(&s, 1).Error; err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Cache settings not configured", Error: err.Error()})
		return
	}
	// Allow testing credentials even when the feature is disabled.
	// This avoids confusing UX where users must enable+save before they can validate credentials.
	if strings.TrimSpace(s.ApiKeyEnc) == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Cloudflare api key not set", Error: "missing_api_key"})
		return
	}
	apiKey, err := utils.DecryptSecret(s.ApiKeyEnc)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid api key encryption", Error: err.Error()})
		return
	}
	client := services.NewCloudflareClient()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	if err := client.TestZone(ctx, s.Email, apiKey, s.ZoneID); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Test failed", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Cloudflare credentials OK"})
}
