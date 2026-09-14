package controllers

import (
	"net/http"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PayPalController struct{}

func getOrCreatePayPalSetting(db *gorm.DB) (*models.PayPalSetting, error) {
	var s models.PayPalSetting
	if err := db.First(&s, 1).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			s = models.PayPalSetting{ID: 1, Enabled: false, Mode: "sandbox", Currency: "USD"}
			if e := db.Create(&s).Error; e != nil {
				return nil, e
			}
		} else {
			return nil, err
		}
	}
	return &s, nil
}

// Public: GET /api/v1/public/paypal/config
func (pc *PayPalController) GetPublicConfig(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	s, err := getOrCreatePayPalSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: utils.PublicError(err, "internal_error")})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: s.ToPublicConfig()})
}

// Admin: GET /api/v1/admin/paypal/settings
func (pc *PayPalController) GetSettings(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	s, err := getOrCreatePayPalSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: utils.PublicError(err, "internal_error")})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: s.ToAdminConfig()})
}

type updatePayPalSettingsRequest struct {
	Enabled             *bool   `json:"enabled"`
	Mode                *string `json:"mode"`
	ClientIDSandbox     *string `json:"client_id_sandbox"`
	ClientIDLive        *string `json:"client_id_live"`
	ClientSecretSandbox *string `json:"client_secret_sandbox"`
	ClientSecretLive    *string `json:"client_secret_live"`
	WebhookID           *string `json:"webhook_id"`
	Currency            *string `json:"currency"`
}

// Admin: PUT /api/v1/admin/paypal/settings
func (pc *PayPalController) UpdateSettings(c *gin.Context) {
	var req updatePayPalSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	s, err := getOrCreatePayPalSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: utils.PublicError(err, "internal_error")})
		return
	}

	if req.Enabled != nil {
		s.Enabled = *req.Enabled
	}
	if req.Mode != nil {
		m := strings.ToLower(strings.TrimSpace(*req.Mode))
		if m != "sandbox" && m != "live" {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid mode", Error: "mode must be sandbox or live"})
			return
		}
		s.Mode = m
	}
	if req.ClientIDSandbox != nil {
		s.ClientIDSandbox = strings.TrimSpace(*req.ClientIDSandbox)
	}
	if req.ClientIDLive != nil {
		s.ClientIDLive = strings.TrimSpace(*req.ClientIDLive)
	}
	if req.ClientSecretSandbox != nil && strings.TrimSpace(*req.ClientSecretSandbox) != "" {
		encrypted, encryptErr := utils.EncryptSecret(strings.TrimSpace(*req.ClientSecretSandbox))
		if encryptErr != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to encrypt PayPal sandbox secret", Error: encryptErr.Error()})
			return
		}
		s.ClientSecretSandboxEnc = encrypted
	}
	if req.ClientSecretLive != nil && strings.TrimSpace(*req.ClientSecretLive) != "" {
		encrypted, encryptErr := utils.EncryptSecret(strings.TrimSpace(*req.ClientSecretLive))
		if encryptErr != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to encrypt PayPal live secret", Error: encryptErr.Error()})
			return
		}
		s.ClientSecretLiveEnc = encrypted
	}
	if req.WebhookID != nil {
		s.WebhookID = strings.TrimSpace(*req.WebhookID)
	}
	if req.Currency != nil {
		cur := strings.ToUpper(strings.TrimSpace(*req.Currency))
		if cur == "" {
			cur = "USD"
		}
		if len(cur) > 10 {
			cur = cur[:10]
		}
		s.Currency = cur
	}

	if err := db.Save(s).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save settings", Error: utils.PublicError(err, "internal_error")})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Saved", Data: s.ToAdminConfig()})
}
