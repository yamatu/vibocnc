package controllers

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SocialLinksController struct{}

const maxSocialURLLength = 500

var socialPlatformDomains = map[string][]string{
	"x":         {"x.com", "twitter.com"},
	"facebook":  {"facebook.com", "fb.com"},
	"instagram": {"instagram.com"},
	"linkedin":  {"linkedin.com", "lnkd.in"},
}

func getOrCreateSocialLinkSetting(db *gorm.DB) (*models.SocialLinkSetting, error) {
	var setting models.SocialLinkSetting
	if err := db.First(&setting, 1).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}

		setting = models.SocialLinkSetting{
			ID:           1,
			ShowInFooter: true,
			XURL:         "https://twitter.com/vcocnc",
			LinkedInURL:  "https://www.linkedin.com/company/vcocnc",
			FacebookURL:  "",
			InstagramURL: "",
		}
		if err := db.Create(&setting).Error; err != nil {
			return nil, err
		}
	}

	return &setting, nil
}

func socialHostAllowed(host string, allowedDomains []string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	for _, domain := range allowedDomains {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

func normalizeSocialURL(platform, raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if len(value) > maxSocialURLLength {
		return "", fmt.Errorf("%s URL must be %d characters or fewer", platform, maxSocialURLLength)
	}

	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.Hostname() == "" {
		return "", fmt.Errorf("%s URL is invalid", platform)
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", fmt.Errorf("%s URL must use http or https", platform)
	}
	if parsed.User != nil || parsed.Port() != "" {
		return "", fmt.Errorf("%s URL contains unsupported credentials or port", platform)
	}

	allowedDomains, ok := socialPlatformDomains[platform]
	if !ok || !socialHostAllowed(parsed.Hostname(), allowedDomains) {
		return "", fmt.Errorf("%s URL must point to an official %s domain", platform, platform)
	}

	parsed.Scheme = scheme
	parsed.Host = strings.ToLower(parsed.Hostname())
	parsed.Fragment = ""
	return parsed.String(), nil
}

// Public: GET /api/v1/public/social-links
func (controller *SocialLinksController) GetPublicConfig(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	setting, err := getOrCreateSocialLinkSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load social links", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: setting.ToPublicConfig()})
}

// Admin: GET /api/v1/admin/social-links/settings
func (controller *SocialLinksController) GetSettings(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	setting, err := getOrCreateSocialLinkSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load social links", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: setting})
}

type updateSocialLinksRequest struct {
	ShowInFooter *bool   `json:"show_in_footer"`
	XURL         *string `json:"x_url"`
	FacebookURL  *string `json:"facebook_url"`
	InstagramURL *string `json:"instagram_url"`
	LinkedInURL  *string `json:"linkedin_url"`
}

// Admin: PUT /api/v1/admin/social-links/settings
func (controller *SocialLinksController) UpdateSettings(c *gin.Context) {
	var req updateSocialLinksRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	setting, err := getOrCreateSocialLinkSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load social links", Error: err.Error()})
		return
	}

	next := *setting
	if req.ShowInFooter != nil {
		next.ShowInFooter = *req.ShowInFooter
	}

	updates := []struct {
		platform string
		value    *string
		apply    func(string)
	}{
		{platform: "x", value: req.XURL, apply: func(value string) { next.XURL = value }},
		{platform: "facebook", value: req.FacebookURL, apply: func(value string) { next.FacebookURL = value }},
		{platform: "instagram", value: req.InstagramURL, apply: func(value string) { next.InstagramURL = value }},
		{platform: "linkedin", value: req.LinkedInURL, apply: func(value string) { next.LinkedInURL = value }},
	}

	for _, update := range updates {
		if update.value == nil {
			continue
		}
		normalized, err := normalizeSocialURL(update.platform, *update.value)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid social link", Error: err.Error()})
			return
		}
		update.apply(normalized)
	}

	if err := db.Save(&next).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save social links", Error: err.Error()})
		return
	}

	services.InvalidatePublicCaches(c.Request.Context(), "social-links:update", []string{"/", "/api/v1/public/social-links"})
	services.TriggerNextRevalidate(nil, []string{"/"}, false)
	services.TriggerNextRevalidateTags([]string{"social-links"})

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Saved", Data: &next})
}
