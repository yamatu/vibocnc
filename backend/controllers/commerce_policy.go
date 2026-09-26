package controllers

import (
	"net/http"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
)

// CommercePolicyController exposes the admin-editable shipping / warranty /
// return promise. The storage and normalisation live in `services` so content
// generators can read the same promise without importing a controller.
type CommercePolicyController struct{}

// GetSettings returns the raw record for the admin editor.
func (cc *CommercePolicyController) GetSettings(c *gin.Context) {
	setting, err := services.GetCommercePolicy(config.GetDB())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to load commerce policy",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: setting})
}

// UpdateSettings persists admin edits.
func (cc *CommercePolicyController) UpdateSettings(c *gin.Context) {
	var req models.CommercePolicySetting
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid commerce policy payload",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	current, err := services.GetCommercePolicy(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to load commerce policy",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	next := services.NormalizeCommercePolicy(req)
	next.ID = current.ID
	next.CreatedAt = current.CreatedAt

	if err := db.Model(&models.CommercePolicySetting{}).Where("id = ?", current.ID).Save(&next).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update commerce policy",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	services.InvalidateCommercePolicyCache()
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Commerce policy updated", Data: next})
}

// GetPublicSettings is consumed by the storefront (server side) to render the
// visible promise and the schema.org shipping / return data. Internal eBay
// pricing controls are excluded from this public response.
func (cc *CommercePolicyController) GetPublicSettings(c *gin.Context) {
	setting, err := services.GetCommercePolicy(config.GetDB())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to load commerce policy",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: setting.Public()})
}
