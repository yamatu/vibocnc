package controllers

import (
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SitePageController struct{}

var validSitePageKey = regexp.MustCompile(`^[a-z0-9-]+$`)
var editableSitePageKeys = map[string]struct{}{
	"privacy": {}, "terms": {}, "warranty": {}, "warranty-policy": {},
	"shipping-policy": {}, "returns": {}, "technical-support": {},
}

func normalizeSitePageKey(value string) string {
	return strings.Trim(strings.ToLower(strings.TrimSpace(value)), "-")
}

func isEditableSitePageKey(key string) bool {
	_, ok := editableSitePageKeys[key]
	return ok
}

func (pc *SitePageController) GetPublicPage(c *gin.Context) {
	key := normalizeSitePageKey(c.Param("pageKey"))
	if !validSitePageKey.MatchString(key) || !isEditableSitePageKey(key) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid page key"})
		return
	}

	var page models.SitePage
	if err := config.DB.Where("page_key = ?", key).First(&page).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Page not found"})
		return
	}
	if !page.IsPublished {
		c.JSON(http.StatusGone, models.APIResponse{Success: false, Message: "Page is not published"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: page})
}

func (pc *SitePageController) GetPages(c *gin.Context) {
	var pages []models.SitePage
	if err := config.DB.Order("page_key ASC").Find(&pages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to fetch pages"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: pages})
}

func (pc *SitePageController) GetPage(c *gin.Context) {
	key := normalizeSitePageKey(c.Param("pageKey"))
	var page models.SitePage
	if err := config.DB.Where("page_key = ?", key).First(&page).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Page not found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: page})
}

func (pc *SitePageController) UpsertPage(c *gin.Context) {
	key := normalizeSitePageKey(c.Param("pageKey"))
	if !validSitePageKey.MatchString(key) || !isEditableSitePageKey(key) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid page key"})
		return
	}

	var req models.SitePageUpsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	var page models.SitePage
	err := config.DB.Where("page_key = ?", key).First(&page).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load page"})
		return
	}

	page.PageKey = key
	page.Title = strings.TrimSpace(req.Title)
	page.Summary = strings.TrimSpace(req.Summary)
	page.Content = req.Content
	page.MetaTitle = strings.TrimSpace(req.MetaTitle)
	page.MetaDescription = strings.TrimSpace(req.MetaDescription)
	page.MetaKeywords = strings.TrimSpace(req.MetaKeywords)
	page.IsPublished = req.IsPublished

	if err == gorm.ErrRecordNotFound {
		if err := config.DB.Create(&page).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to create page", Error: err.Error()})
			return
		}
	} else if err := config.DB.Save(&page).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update page", Error: err.Error()})
		return
	}

	services.InvalidatePublicCaches(c.Request.Context(), "site-page:update", []string{"/" + key, "/sitemap-static.xml", "/sitemap.xml"})
	services.TriggerNextRevalidate(nil, []string{"/" + key}, false)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Page saved", Data: page})
}
