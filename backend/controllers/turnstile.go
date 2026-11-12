package controllers

import (
	"errors"
	"net/http"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
)

type TurnstileController struct{}

// Public: GET /api/v1/public/turnstile/config
func (tc *TurnstileController) GetPublicConfig(c *gin.Context) {
	s, err := services.GetOrCreateTurnstileSetting(config.GetDB())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: utils.PublicError(err, "internal_error")})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: s.ToPublicConfig()})
}

// Admin: GET /api/v1/admin/turnstile/settings
func (tc *TurnstileController) GetSettings(c *gin.Context) {
	s, err := services.GetOrCreateTurnstileSetting(config.GetDB())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: utils.PublicError(err, "internal_error")})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: s.ToAdminConfig()})
}

type updateTurnstileSettingsRequest struct {
	Enabled     *bool   `json:"enabled"`
	SiteKey     *string `json:"site_key"`
	SecretKey   *string `json:"secret_key"`
	ClearSecret bool    `json:"clear_secret"`
}

// Admin: PUT /api/v1/admin/turnstile/settings
func (tc *TurnstileController) UpdateSettings(c *gin.Context) {
	var req updateTurnstileSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	db := config.GetDB()
	s, err := services.GetOrCreateTurnstileSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: utils.PublicError(err, "internal_error")})
		return
	}

	if req.Enabled != nil {
		s.Enabled = *req.Enabled
	}
	if req.SiteKey != nil {
		s.SiteKey = strings.TrimSpace(*req.SiteKey)
	}
	if req.ClearSecret {
		s.SecretKeyEnc = ""
	}
	if req.SecretKey != nil && strings.TrimSpace(*req.SecretKey) != "" {
		encrypted, encErr := utils.EncryptSecret(strings.TrimSpace(*req.SecretKey))
		if encErr != nil {
			if respondSecretEncryptionFailure(c, "Turnstile Secret Key", encErr) {
				return
			}
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to encrypt Turnstile secret", Error: encErr.Error()})
			return
		}
		s.SecretKeyEnc = encrypted
	}
	if s.Enabled && (s.SiteKey == "" || s.SecretKeyEnc == "") {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "启用人机验证前请先填写 Site Key 和 Secret Key / Site Key and Secret Key are required before enabling Turnstile",
			Error:   "turnstile_keys_required",
		})
		return
	}

	if err := db.Save(s).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save settings", Error: utils.PublicError(err, "internal_error")})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Saved", Data: s.ToAdminConfig()})
}

// Admin: POST /api/v1/admin/turnstile/test
// Verifies a widget token against the stored secret so the administrator can
// confirm the key pair before enabling enforcement.
func (tc *TurnstileController) TestSettings(c *gin.Context) {
	var req struct {
		Token string `json:"token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	s, err := services.GetOrCreateTurnstileSetting(config.GetDB())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: utils.PublicError(err, "internal_error")})
		return
	}
	if s.SiteKey == "" || s.SecretKeyEnc == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "请先保存 Site Key 和 Secret Key / Save both keys first", Error: "turnstile_keys_required"})
		return
	}
	secret, err := utils.DecryptSecret(s.SecretKeyEnc)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to decrypt secret", Error: utils.PublicError(err, "internal_error")})
		return
	}
	if err := services.VerifyTurnstileToken(c.Request.Context(), secret, req.Token, c.ClientIP()); err != nil {
		msg := "验证失败，请检查 Secret Key 是否与 Site Key 匹配 / Verification failed, check that the secret matches the site key"
		if !errors.Is(err, services.ErrTurnstileRejected) && !errors.Is(err, services.ErrTurnstileMissingToken) {
			msg = "无法连接 Cloudflare 验证服务 / Could not reach Cloudflare siteverify"
		}
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: msg, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Turnstile 验证通过 / Verification passed"})
}
