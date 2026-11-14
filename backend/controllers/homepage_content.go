package controllers

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// HomepageContentController handles homepage content operations
type HomepageContentController struct{}

// The homepage editor also edits the About and Contact pages (about_page and
// contact_page sections). Purging by path covers renders cached before the
// content was first fetched, which carry no "homepage-content" tag.
var homepageEditorPaths = []string{"/", "/about", "/contact"}

func invalidateHomepageCaches(ctx context.Context, reason string) {
	services.InvalidatePublicCaches(ctx, reason, homepageEditorPaths)
	services.TriggerNextRevalidate(nil, homepageEditorPaths, false)
	services.TriggerNextRevalidateTags([]string{"homepage-content"})
}

var homepageSectionKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{2,63}$`)

func normalizeHomepageSectionKey(value string) (string, bool) {
	sectionKey := strings.TrimSpace(value)
	return sectionKey, homepageSectionKeyPattern.MatchString(sectionKey)
}

func isPredefinedHomepageSectionKey(value string) bool {
	for _, section := range models.GetPredefinedSections() {
		if section.Key == value {
			return true
		}
	}
	return false
}

// GetHomepageContents retrieves all homepage content sections
func (hc *HomepageContentController) GetHomepageContents(c *gin.Context) {
	var contents []models.HomepageContent

	query := config.DB.Order("sort_order ASC, created_at ASC")

	// Public endpoint should only return active sections.
	// Admin can opt-in to include inactive sections via query param.
	includeInactive := c.Query("include_inactive")
	if includeInactive != "1" && includeInactive != "true" {
		query = query.Where("is_active = ?", true)
	}

	// Optional section filter
	if sectionKey := c.Query("section_key"); sectionKey != "" {
		query = query.Where("section_key = ?", sectionKey)
	}

	if err := query.Find(&contents).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch homepage contents"})
		return
	}

	c.JSON(http.StatusOK, contents)
}

// GetHomepageContentsAdmin returns homepage sections including inactive ones (no query param needed).
func (hc *HomepageContentController) GetHomepageContentsAdmin(c *gin.Context) {
	var contents []models.HomepageContent

	query := config.DB.Order("sort_order ASC, created_at ASC")
	if sectionKey := c.Query("section_key"); sectionKey != "" {
		query = query.Where("section_key = ?", sectionKey)
	}

	if err := query.Find(&contents).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch homepage contents"})
		return
	}

	c.JSON(http.StatusOK, contents)
}

// GetHomepageContent retrieves a single homepage content by ID
func (hc *HomepageContentController) GetHomepageContent(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid content ID"})
		return
	}

	var content models.HomepageContent
	if err := config.DB.First(&content, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Homepage content not found"})
		return
	}

	c.JSON(http.StatusOK, content)
}

// CreateHomepageContent creates a new homepage content section
func (hc *HomepageContentController) CreateHomepageContent(c *gin.Context) {
	var req models.HomepageContentCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sectionKey, valid := normalizeHomepageSectionKey(req.SectionKey)
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Section key must start with a letter and contain only lowercase letters, numbers, and underscores (3-64 characters)"})
		return
	}

	// Check if section_key already exists
	var existingContent models.HomepageContent
	if err := config.DB.Where("section_key = ?", sectionKey).First(&existingContent).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Section key already exists"})
		return
	}

	content := models.HomepageContent{
		SectionKey:  sectionKey,
		Title:       req.Title,
		Subtitle:    req.Subtitle,
		Description: req.Description,
		ImageURL:    req.ImageURL,
		ButtonText:  req.ButtonText,
		ButtonURL:   req.ButtonURL,
		Data:        req.Data,
		SortOrder:   req.SortOrder,
		IsActive:    req.IsActive,
	}

	if err := config.DB.Create(&content).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create homepage content"})
		return
	}

	invalidateHomepageCaches(c.Request.Context(), "homepage:create")
	c.JSON(http.StatusCreated, content)
}

// UpdateHomepageContent updates an existing homepage content section
func (hc *HomepageContentController) UpdateHomepageContent(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid content ID"})
		return
	}

	var content models.HomepageContent
	if err := config.DB.First(&content, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Homepage content not found"})
		return
	}

	var req models.HomepageContentUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update fields if provided
	if req.Title != nil {
		content.Title = *req.Title
	}
	if req.Subtitle != nil {
		content.Subtitle = *req.Subtitle
	}
	if req.Description != nil {
		content.Description = *req.Description
	}
	if req.ImageURL != nil {
		content.ImageURL = *req.ImageURL
	}
	if req.ButtonText != nil {
		content.ButtonText = *req.ButtonText
	}
	if req.ButtonURL != nil {
		content.ButtonURL = *req.ButtonURL
	}
	if req.Data != nil {
		content.Data = *req.Data
	}
	if req.SortOrder != nil {
		content.SortOrder = *req.SortOrder
	}
	if req.IsActive != nil {
		content.IsActive = *req.IsActive
	}

	if err := config.DB.Save(&content).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update homepage content"})
		return
	}

	invalidateHomepageCaches(c.Request.Context(), "homepage:update")
	c.JSON(http.StatusOK, content)
}

// GetHomepageContentBySectionAdmin retrieves homepage content by section key (including inactive).
func (hc *HomepageContentController) GetHomepageContentBySectionAdmin(c *gin.Context) {
	sectionKey := c.Param("section_key")
	if sectionKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Section key is required"})
		return
	}

	var content models.HomepageContent
	if err := config.DB.Where("section_key = ?", sectionKey).First(&content).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Homepage content not found"})
		return
	}

	c.JSON(http.StatusOK, content)
}

// UpsertHomepageContentBySection creates or updates a homepage content section by section_key.
func (hc *HomepageContentController) UpsertHomepageContentBySection(c *gin.Context) {
	sectionKey := strings.TrimSpace(c.Param("section_key"))
	if sectionKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Section key is required"})
		return
	}

	// Use the existing update request type (includes Data) to avoid duplicating JSON handling.
	var req models.HomepageContentUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var content models.HomepageContent
	err := config.DB.Where("section_key = ?", sectionKey).First(&content).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if _, valid := normalizeHomepageSectionKey(sectionKey); !valid {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid section key"})
				return
			}

			content = models.HomepageContent{
				SectionKey: sectionKey,
				IsActive:   true,
			}
			if req.Title != nil {
				content.Title = *req.Title
			}
			if req.Subtitle != nil {
				content.Subtitle = *req.Subtitle
			}
			if req.Description != nil {
				content.Description = *req.Description
			}
			if req.ImageURL != nil {
				content.ImageURL = *req.ImageURL
			}
			if req.ButtonText != nil {
				content.ButtonText = *req.ButtonText
			}
			if req.ButtonURL != nil {
				content.ButtonURL = *req.ButtonURL
			}
			if req.Data != nil {
				content.Data = *req.Data
			}
			if req.SortOrder != nil {
				content.SortOrder = *req.SortOrder
			}
			if req.IsActive != nil {
				content.IsActive = *req.IsActive
			}

			if err := config.DB.Create(&content).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create homepage content"})
				return
			}
			invalidateHomepageCaches(c.Request.Context(), "homepage:create")
			c.JSON(http.StatusCreated, content)

			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch homepage content"})
		return
	}

	// Update existing record using the same logic as UpdateHomepageContent
	if req.Title != nil {
		content.Title = *req.Title
	}
	if req.Subtitle != nil {
		content.Subtitle = *req.Subtitle
	}
	if req.Description != nil {
		content.Description = *req.Description
	}
	if req.ImageURL != nil {
		content.ImageURL = *req.ImageURL
	}
	if req.ButtonText != nil {
		content.ButtonText = *req.ButtonText
	}
	if req.ButtonURL != nil {
		content.ButtonURL = *req.ButtonURL
	}
	if req.Data != nil {
		content.Data = *req.Data
	}
	if req.SortOrder != nil {
		content.SortOrder = *req.SortOrder
	}
	if req.IsActive != nil {
		content.IsActive = *req.IsActive
	}

	if err := config.DB.Save(&content).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update homepage content"})
		return
	}

	invalidateHomepageCaches(c.Request.Context(), "homepage:update")
	c.JSON(http.StatusOK, content)
}

// DeleteHomepageContent deletes a homepage content section
func (hc *HomepageContentController) DeleteHomepageContent(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid content ID"})
		return
	}

	var content models.HomepageContent
	if err := config.DB.First(&content, uint(id)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Homepage content not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch homepage content"})
		return
	}
	if isPredefinedHomepageSectionKey(content.SectionKey) {
		c.JSON(http.StatusConflict, gin.H{"error": "Predefined homepage sections cannot be deleted; disable the section instead"})
		return
	}

	result := config.DB.Delete(&content)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete homepage content"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Homepage content not found"})
		return
	}

	invalidateHomepageCaches(c.Request.Context(), "homepage:delete")
	c.JSON(http.StatusOK, gin.H{"message": "Homepage content deleted successfully"})
}

// GetPredefinedSections returns the list of predefined homepage sections
func (hc *HomepageContentController) GetPredefinedSections(c *gin.Context) {
	sections := models.GetPredefinedSections()
	c.JSON(http.StatusOK, sections)
}

// GetHomepageContentBySection retrieves homepage content by section key
func (hc *HomepageContentController) GetHomepageContentBySection(c *gin.Context) {
	sectionKey := c.Param("section_key")
	if sectionKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Section key is required"})
		return
	}

	var content models.HomepageContent
	if err := config.DB.Where("section_key = ? AND is_active = ?", sectionKey, true).First(&content).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Homepage content not found"})
		return
	}

	c.JSON(http.StatusOK, content)
}
