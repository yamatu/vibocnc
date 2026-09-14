package controllers

import (
	"net/http"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
)

type categoryCleanupRequest struct {
	MergeDuplicates   *bool `json:"merge_duplicates"`
	DeleteEmpty       *bool `json:"delete_empty"`
	DeleteEmptyActive *bool `json:"delete_empty_active"`
}

func (req categoryCleanupRequest) toOptions() services.CategoryCleanupOptions {
	return services.CategoryCleanupOptions{
		MergeDuplicates:   optionalBool(req.MergeDuplicates, true),
		DeleteEmpty:       optionalBool(req.DeleteEmpty, true),
		DeleteEmptyActive: optionalBool(req.DeleteEmptyActive, false),
	}
}

// PreviewCategoryCleanup computes the merge/delete plan without writing
// anything, so administrators can review exactly which duplicate and empty
// categories the cleanup would touch.
func (cc *CategoryController) PreviewCategoryCleanup(c *gin.Context) {
	var req categoryCleanupRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid cleanup request", Error: err.Error()})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}
	plan, err := services.BuildCategoryCleanupPlan(db, req.toOptions())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to analyze categories", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Category cleanup plan computed", Data: plan})
}

// ApplyCategoryCleanup executes the cleanup transactionally. The plan is
// recomputed server-side under row locks, so the preview a browser displayed
// earlier is advisory rather than authoritative.
func (cc *CategoryController) ApplyCategoryCleanup(c *gin.Context) {
	var req categoryCleanupRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid cleanup request", Error: err.Error()})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}
	result, err := services.ApplyCategoryCleanup(db, req.toOptions())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Category cleanup failed", Error: err.Error()})
		return
	}
	if result.MergedCount > 0 || result.DeletedCount > 0 {
		services.InvalidatePublicCaches(c.Request.Context(), "category:cleanup", []string{"/categories", "/products", "/"})
		services.TriggerNextRevalidate(nil, []string{"/categories", "/products", "/"}, true)
		invalidateAISEOCategoryReferences()
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Category cleanup completed", Data: result})
}
