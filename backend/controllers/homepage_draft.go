package controllers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm/clause"
)

type HomepageDraftController struct{}

const (
	homepageDraftMaxBytes = 512 << 10
	homepageDraftTTL      = 24 * time.Hour
)

var homepageDraftKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{2,63}$`)

func homepageDraftUserID(c *gin.Context) (uint, bool) {
	v, ok := c.Get("user_id")
	if !ok {
		return 0, false
	}
	switch id := v.(type) {
	case uint:
		return id, id > 0
	case int:
		return uint(id), id > 0
	case float64:
		return uint(id), id > 0
	}
	return 0, false
}

type homepageDraftItem struct {
	SectionKey string          `json:"section_key"`
	Payload    json.RawMessage `json:"payload"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

// GET /api/v1/admin/homepage-content/drafts
func (hc *HomepageDraftController) ListDrafts(c *gin.Context) {
	userID, ok := homepageDraftUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.APIResponse{Success: false, Message: "Unauthorized"})
		return
	}
	var drafts []models.HomepageContentDraft
	if err := config.GetDB().
		Where("user_id = ? AND updated_at > ?", userID, time.Now().Add(-homepageDraftTTL)).
		Find(&drafts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load drafts"})
		return
	}
	items := make([]homepageDraftItem, 0, len(drafts))
	for _, d := range drafts {
		items = append(items, homepageDraftItem{SectionKey: d.SectionKey, Payload: json.RawMessage(d.Payload), UpdatedAt: d.UpdatedAt})
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: items})
}

// PUT /api/v1/admin/homepage-content/drafts/:section_key
func (hc *HomepageDraftController) SaveDraft(c *gin.Context) {
	userID, ok := homepageDraftUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.APIResponse{Success: false, Message: "Unauthorized"})
		return
	}
	key := c.Param("section_key")
	if !homepageDraftKeyPattern.MatchString(key) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid section key"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, homepageDraftMaxBytes+1))
	if err != nil || len(body) > homepageDraftMaxBytes {
		c.JSON(http.StatusRequestEntityTooLarge, models.APIResponse{Success: false, Message: "Draft is too large"})
		return
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(body, &probe); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Draft must be a JSON object"})
		return
	}
	draft := models.HomepageContentDraft{
		UserID:     userID,
		SectionKey: key,
		Payload:    datatypes.JSON(bytes.TrimSpace(body)),
	}
	if err := config.GetDB().Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "section_key"}},
		DoUpdates: clause.AssignmentColumns([]string{"payload", "updated_at"}),
	}).Create(&draft).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save draft"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft saved"})
}

// DELETE /api/v1/admin/homepage-content/drafts/:section_key
func (hc *HomepageDraftController) DeleteDraft(c *gin.Context) {
	userID, ok := homepageDraftUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.APIResponse{Success: false, Message: "Unauthorized"})
		return
	}
	config.GetDB().Where("user_id = ? AND section_key = ?", userID, c.Param("section_key")).Delete(&models.HomepageContentDraft{})
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft discarded"})
}

// DELETE /api/v1/admin/homepage-content/drafts
func (hc *HomepageDraftController) ClearDrafts(c *gin.Context) {
	userID, ok := homepageDraftUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.APIResponse{Success: false, Message: "Unauthorized"})
		return
	}
	db := config.GetDB()
	db.Where("user_id = ?", userID).Delete(&models.HomepageContentDraft{})
	db.Where("updated_at < ?", time.Now().Add(-homepageDraftTTL)).Delete(&models.HomepageContentDraft{})
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Drafts cleared"})
}
