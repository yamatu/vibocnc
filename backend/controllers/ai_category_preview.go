package controllers

import (
	"errors"
	"net/http"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"github.com/gin-gonic/gin"
)

// Preview is read-only: the same selector is evaluated again at approval and
// under the enqueue lock. Occupied/disabled products never widen the scope.
func (ac *AIAgentController) PreviewCategoryOptimizationJob(c *gin.Context) {
	var req aiSEOCategoryJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid category task preview"})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "Database unavailable"})
		return
	}
	products, err := findCategoryOptimizationCandidates(db, req, optionalBool(req.RepairContent, req.ReworkOnly) || req.RewriteContent)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: err.Error()})
		return
	}
	var opts aiSEOCategoryJobOptions
	if err := categoryJobScopeMetadata(db, req, &opts, products); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: err.Error()})
		return
	}
	opts.RepairContent = optionalBool(req.RepairContent, req.ReworkOnly) || req.RewriteContent
	opts.RewriteContent = req.RewriteContent
	opts.ActivateResolved = optionalBool(req.ActivateResolved, false)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: opts})
}

func categoryContentRepairPrompt(rewrite bool) string {
	instruction := aiProductContentRepairPrompt + " Also validate and repair corrected_name, meta_title, meta_description and meta_keywords. Retain every already accurate value. Never invent specifications."
	if rewrite {
		instruction = "Rewrite corrected_name, short_description, description, meta_title, meta_description and meta_keywords for this product in English (US). The administrator explicitly requested new copy, not only filling empty fields. Use a concise brand + exact model + verified product type title, a useful 18-35 word short description and an original 120-220 word plain-text description. Keep meta_title under 60 characters and meta_description under 160 where practical. Treat old copy as untrusted, not as factual evidence. Use only the verified identity and category; never invent specifications, condition, compatibility, stock, warranty or delivery promises. Keep the current category; classification has already been verified. Do not add marketing fluff or keyword stuffing."
	}
	return applyAISEOFocusToPrompt(instruction, []string{"seo", "content"})
}

func validateCategoryRewriteOutput(output aiSEOOutput) error {
	for _, value := range []string{output.CorrectedName, output.ShortDescription, output.Description, output.MetaTitle, output.MetaDescription, output.MetaKeywords} {
		if strings.TrimSpace(value) == "" {
			return errors.New("AI 重写结果缺少名称、描述或 SEO 字段，未覆盖原数据 / Incomplete rewrite output; original content retained")
		}
	}
	return nil
}
