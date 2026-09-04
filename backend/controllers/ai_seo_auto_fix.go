package controllers

import (
	"errors"
	"net/http"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
)

type aiSEOAutoFixRequest struct {
	Focus []string `json:"focus"`
	Limit int      `json:"limit"`
}

const aiSEOAutoFixPrompt = "Repair this product's SEO using its verified brand, model, and current category. " +
	"The previous metadata may have been generated while the product sat in a wrong or generic category: " +
	"rewrite the meta title so it leads with the brand and exact model, remove catch-all wording such as " +
	"\"Industrial Automation\" or \"Unidentified\", never mention a different manufacturer, and keep every claim supported by the product data."

// SEOAudit reports products whose public SEO metadata is missing, failed,
// stale, or written against an obsolete classification (for example a meta
// title still built from an old catch-all category name).
func (ac *AIAgentController) SEOAudit(c *gin.Context) {
	var req aiSEOAutoFixRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid SEO audit request", Error: err.Error()})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}
	result, err := services.AuditProductSEO(db, req.Limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "SEO audit failed", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "SEO audit completed", Data: result})
}

// StartSEOAutoFix runs the SEO audit and queues every flagged product into
// one background AI SEO job — the one-click repair path.
func (ac *AIAgentController) StartSEOAutoFix(c *gin.Context) {
	var req aiSEOAutoFixRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid SEO auto-fix request", Error: err.Error()})
		return
	}

	setting, _, apiKey, err := loadAIAgentConfigWithProfile()
	if err != nil || !setting.Enabled || apiKey == "" {
		message := "AI assistant is not configured. An administrator must configure and enable it first."
		if err != nil {
			message = "AI settings could not be read: " + err.Error()
		}
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: message})
		return
	}

	db := config.GetDB()
	limit := req.Limit
	if limit <= 0 || limit > maxAISEOCandidateProducts {
		limit = maxAISEOCandidateProducts
	}
	limit = minInt(limit, normalizedAISEOCandidateLimit(setting))
	audit, err := services.AuditProductSEO(db, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "SEO audit failed", Error: err.Error()})
		return
	}
	if len(audit.ProductIDs) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "The SEO audit found no products that need fixing"})
		return
	}

	products := make([]models.Product, 0, len(audit.ProductIDs))
	for start := 0; start < len(audit.ProductIDs); start += 1000 {
		end := minInt(start+1000, len(audit.ProductIDs))
		var batch []models.Product
		if err := db.Model(&models.Product{}).
			Select("products.id", "products.sku").
			Where("products.id IN ?", audit.ProductIDs[start:end]).
			Order("products.id ASC").
			Find(&batch).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load flagged products", Error: err.Error()})
			return
		}
		products = append(products, batch...)
	}

	focus := req.Focus
	if len(focus) == 0 {
		focus = []string{"seo"}
	}
	prompt := applyAISEOFocusToPrompt(aiSEOAutoFixPrompt, focus)
	job, err := createAIAgentSEOJob(db, products, prompt, "auto_candidates", c.GetUint("user_id"))
	if err != nil {
		if errors.Is(err, errAISEOProductsPending) || errors.Is(err, errAISEOJobCapacity) {
			c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to create one-click SEO job", Error: err.Error()})
		return
	}
	go processAIAgentSEOJob(job.ID)
	c.JSON(http.StatusAccepted, models.APIResponse{
		Success: true,
		Message: "One-click SEO fix started",
		Data: gin.H{
			"job":   job,
			"audit": audit,
		},
	})
}
