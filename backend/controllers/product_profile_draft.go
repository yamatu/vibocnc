package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ProductProfileDraftController is the human-review boundary for AI product
// identification. Identification writes drafts; only Approve changes a product.
type ProductProfileDraftController struct{}

type productProfileDraftResponse struct {
	models.ProductProfileDraft
	Profile       services.ProductProfile         `json:"profile"`
	Content       services.ProfileContent         `json:"content"`
	Evidence      []models.EbayMarketEvidenceItem `json:"evidence"`
	AppliedFields []string                        `json:"applied_fields,omitempty"`
	Product       *productProfileDraftProduct     `json:"product,omitempty"`
}

type productProfileDraftProduct struct {
	ID               uint   `json:"id"`
	SKU              string `json:"sku"`
	Name             string `json:"name"`
	Brand            string `json:"brand"`
	Model            string `json:"model"`
	CategoryID       uint   `json:"category_id"`
	CategoryName     string `json:"category_name"`
	ShortDescription string `json:"short_description"`
	Description      string `json:"description"`
	MetaTitle        string `json:"meta_title"`
	MetaDescription  string `json:"meta_description"`
	MetaKeywords     string `json:"meta_keywords"`
}

type profileDraftListResponse struct {
	Drafts []productProfileDraftResponse `json:"drafts"`
	Total  int64                         `json:"total"`
	Page   int                           `json:"page"`
	Limit  int                           `json:"limit"`
}

// List returns the profile review queue.
func (pc *ProductProfileDraftController) List(c *gin.Context) {
	db := config.GetDB()
	status := strings.TrimSpace(strings.ToLower(c.DefaultQuery("status", "pending")))
	search := strings.TrimSpace(c.Query("search"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	query := db.Model(&models.ProductProfileDraft{})
	if status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	if search != "" {
		like := "%" + search + "%"
		query = query.Where("sku LIKE ? OR model LIKE ? OR brand LIKE ? OR proposed_title LIKE ?", like, like, like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to count profile drafts", Error: utils.PublicError(err, "db_error")})
		return
	}
	var drafts []models.ProductProfileDraft
	if err := query.Order("id DESC").Offset((page - 1) * limit).Limit(limit).Find(&drafts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load profile drafts", Error: utils.PublicError(err, "db_error")})
		return
	}

	responses := make([]productProfileDraftResponse, 0, len(drafts))
	for _, draft := range drafts {
		response, err := profileDraftResponseOf(db, draft)
		if err != nil {
			continue
		}
		responses = append(responses, response)
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: profileDraftListResponse{Drafts: responses, Total: total, Page: page, Limit: limit}})
}

// Get returns one complete draft and its evidence.
func (pc *ProductProfileDraftController) Get(c *gin.Context) {
	id, ok := profileDraftID(c)
	if !ok {
		return
	}
	db := config.GetDB()
	var draft models.ProductProfileDraft
	if err := db.First(&draft, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Profile draft not found"})
		return
	}
	response, err := profileDraftResponseOf(db, draft)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Profile draft payload is invalid", Error: utils.PublicError(err, "invalid_draft")})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: response})
}

type profileDraftApproveRequest struct {
	ApplyTitle           *bool  `json:"apply_title"`
	ApplyContent         *bool  `json:"apply_content"`
	OverwriteExisting    bool   `json:"overwrite_existing"`
	AllowNewProductTypes bool   `json:"allow_new_product_types"`
	ActivateProduct      *bool  `json:"activate_product"`
	ForceStale           bool   `json:"force_stale"`
	Note                 string `json:"note"`
}

// Approve applies identity/category/copy to one explicitly reviewed product.
// Cited specifications become a pending ProductSpecDraft; they are never
// written directly to technical_specs.
func (pc *ProductProfileDraftController) Approve(c *gin.Context) {
	id, ok := profileDraftID(c)
	if !ok {
		return
	}
	var req profileDraftApproveRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid approval request", Error: err.Error()})
			return
		}
	}

	db := config.GetDB()
	var draft models.ProductProfileDraft
	if err := db.First(&draft, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Profile draft not found"})
		return
	}
	if draft.Status != "pending" {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Profile draft was already decided"})
		return
	}
	if draft.ProductID == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Profile draft is not linked to a catalogue product"})
		return
	}

	payload, err := services.DecodeProductProfileDraft(draft)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, models.APIResponse{Success: false, Message: "Profile draft payload is invalid", Error: utils.PublicError(err, "invalid_draft")})
		return
	}
	profile := services.SanitizeProductProfileForStorefront(payload.Profile)
	inference, err := services.InferenceFromAIClassification(profile.Brand, profile.PartType, profile.ModelFamily)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, models.APIResponse{Success: false, Message: "Profile classification cannot be applied", Error: err.Error()})
		return
	}

	var product models.Product
	if err := db.Preload("Category").First(&product, draft.ProductID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Linked product no longer exists"})
		return
	}
	if draft.ProductUpdatedAt != nil && product.UpdatedAt.After(draft.ProductUpdatedAt.Add(time.Second)) && !req.ForceStale {
		c.JSON(http.StatusConflict, models.APIResponse{
			Success: false,
			Message: "Product changed after this profile was generated; review again or approve with force_stale",
			Error:   "stale_profile_draft",
		})
		return
	}

	categoryID, _, err := services.ResolveOrCreateCategoryForAdministrator(db, inference, req.AllowNewProductTypes)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, models.APIResponse{Success: false, Message: "No safe category could be resolved", Error: err.Error()})
		return
	}

	applyTitle := req.ApplyTitle == nil || *req.ApplyTitle
	applyContent := req.ApplyContent == nil || *req.ApplyContent
	var appliedFields []string
	var specDraftID *uint
	reviewerID := currentUserID(c)
	now := time.Now().UTC()
	transactionErr := db.Transaction(func(tx *gorm.DB) error {
		var locked models.ProductProfileDraft
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, draft.ID).Error; err != nil {
			return err
		}
		if locked.Status != "pending" {
			return errors.New("profile draft was already decided")
		}

		// Re-read and lock the product at the actual write boundary. The earlier
		// stale check gives a friendly response; this one closes the race between
		// category resolution and the transaction.
		var lockedProduct models.Product
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&lockedProduct, product.ID).Error; err != nil {
			return err
		}
		if locked.ProductUpdatedAt != nil && lockedProduct.UpdatedAt.After(locked.ProductUpdatedAt.Add(time.Second)) && !req.ForceStale {
			return errors.New("stale_profile_draft: product changed after identification")
		}
		updates, fields := profileProductUpdates(lockedProduct, locked, payload.Content, inference, categoryID, applyTitle, applyContent, req.OverwriteExisting, optionalBool(req.ActivateProduct, false))
		if len(updates) == 0 {
			return errors.New("approval produced no product changes")
		}
		appliedFields = fields
		if err := tx.Model(&models.Product{}).Where("id = ?", product.ID).Updates(updates).Error; err != nil {
			return err
		}

		createdSpecID, err := createSpecDraftFromProfile(tx, draft, profile, reviewerID)
		if err != nil {
			return err
		}
		if createdSpecID > 0 {
			specDraftID = &createdSpecID
		}

		encodedFields, _ := json.Marshal(appliedFields)
		draftUpdates := map[string]any{
			"status":              "approved",
			"reviewed_by":         reviewerID,
			"reviewed_at":         now,
			"applied_at":          now,
			"applied_fields_json": string(encodedFields),
			"spec_draft_id":       specDraftID,
		}
		return tx.Model(&models.ProductProfileDraft{}).Where("id = ?", draft.ID).Updates(draftUpdates).Error
	})
	if transactionErr != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to apply profile draft", Error: utils.PublicError(transactionErr, "apply_failed")})
		return
	}

	// Keep the classification audit and SEO score in sync with the product write.
	_ = services.RecordClassificationAudit(db, product, inference, profile.Model, nil, "approved", "Approved product profile: "+strings.TrimSpace(req.Note), "profile-draft-"+strconv.FormatUint(uint64(draft.ID), 10))
	var optimized models.Product
	if err := db.First(&optimized, product.ID).Error; err == nil {
		score := (&ProductOptimizationController{}).calculateSEOScore(&optimized)
		_ = db.Model(&models.Product{}).Where("id = ?", optimized.ID).Updates(map[string]any{"seo_score": score, "last_optimized_at": now}).Error
	}
	go services.InvalidatePublicCaches(context.Background(), "product:profile-approved", nil)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Product profile approved",
		Data: gin.H{
			"draft_id":        draft.ID,
			"product_id":      product.ID,
			"category_id":     categoryID,
			"applied_fields":  appliedFields,
			"spec_draft_id":   specDraftID,
			"specs_published": false,
		},
	})
}

type profileDraftRejectRequest struct {
	Reason string `json:"reason"`
}

// Reject closes a profile proposal without touching the product.
func (pc *ProductProfileDraftController) Reject(c *gin.Context) {
	id, ok := profileDraftID(c)
	if !ok {
		return
	}
	var req profileDraftRejectRequest
	_ = c.ShouldBindJSON(&req)
	now := time.Now().UTC()
	result := config.GetDB().Model(&models.ProductProfileDraft{}).
		Where("id = ? AND status = ?", id, "pending").
		Updates(map[string]any{
			"status":        "rejected",
			"reviewed_by":   currentUserID(c),
			"reviewed_at":   now,
			"reject_reason": strings.TrimSpace(req.Reason),
		})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to reject profile draft", Error: utils.PublicError(result.Error, "db_error")})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Profile draft was already decided or does not exist"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Profile draft rejected"})
}

func profileDraftID(c *gin.Context) (uint, bool) {
	value, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || value == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid profile draft id"})
		return 0, false
	}
	return uint(value), true
}

func profileDraftResponseOf(db *gorm.DB, draft models.ProductProfileDraft) (productProfileDraftResponse, error) {
	payload, err := services.DecodeProductProfileDraft(draft)
	if err != nil {
		return productProfileDraftResponse{}, err
	}
	response := productProfileDraftResponse{
		ProductProfileDraft: draft,
		Profile:             payload.Profile,
		Content:             payload.Content,
		Evidence:            payload.Evidence,
	}
	if strings.TrimSpace(draft.AppliedFieldsJSON) != "" {
		_ = json.Unmarshal([]byte(draft.AppliedFieldsJSON), &response.AppliedFields)
	}
	if draft.ProductID > 0 {
		var product models.Product
		if err := db.Preload("Category").First(&product, draft.ProductID).Error; err == nil {
			response.Product = &productProfileDraftProduct{
				ID:               product.ID,
				SKU:              product.SKU,
				Name:             product.Name,
				Brand:            product.Brand,
				Model:            product.Model,
				CategoryID:       product.CategoryID,
				CategoryName:     product.Category.Name,
				ShortDescription: product.ShortDescription,
				Description:      product.Description,
				MetaTitle:        product.MetaTitle,
				MetaDescription:  product.MetaDescription,
				MetaKeywords:     product.MetaKeywords,
			}
		}
	}
	return response, nil
}

func profileProductUpdates(product models.Product, draft models.ProductProfileDraft, content services.ProfileContent, inference services.ProductCategoryInference, categoryID uint, applyTitle, applyContent, overwrite, activate bool) (map[string]any, []string) {
	updates := map[string]any{
		"category_id": categoryID,
		"brand":       inference.BrandName,
		"updated_at":  time.Now().UTC(),
	}
	fields := []string{"category_id", "brand"}
	if strings.TrimSpace(product.Manufacturer) == "" || overwrite {
		updates["manufacturer"] = inference.BrandName
		fields = append(fields, "manufacturer")
	}
	if applyTitle && strings.TrimSpace(draft.ProposedTitle) != "" && !strings.EqualFold(strings.TrimSpace(product.Name), strings.TrimSpace(draft.ProposedTitle)) {
		updates["name"] = draft.ProposedTitle
		fields = append(fields, "name")
	}
	if applyContent {
		addProfileTextUpdate(updates, &fields, "short_description", product.ShortDescription, content.ShortDescription, 60, overwrite)
		addProfileTextUpdate(updates, &fields, "description", product.Description, content.Description, 200, overwrite)
		addProfileTextUpdate(updates, &fields, "meta_title", product.MetaTitle, content.MetaTitle, 20, overwrite)
		addProfileTextUpdate(updates, &fields, "meta_description", product.MetaDescription, content.MetaDescription, 60, overwrite)
		addProfileTextUpdate(updates, &fields, "meta_keywords", product.MetaKeywords, content.MetaKeywords, 1, overwrite)
		addProfileTextUpdate(updates, &fields, "compatibility_info", product.CompatibilityInfo, content.CompatibilityInfo, 1, overwrite)
	}
	if activate && !product.IsActive {
		updates["is_active"] = true
		fields = append(fields, "is_active")
	}
	return updates, fields
}

func addProfileTextUpdate(updates map[string]any, fields *[]string, column, current, proposed string, shortThreshold int, overwrite bool) {
	proposed = strings.TrimSpace(proposed)
	if proposed == "" || (!overwrite && utf8.RuneCountInString(strings.TrimSpace(current)) >= shortThreshold) {
		return
	}
	if strings.TrimSpace(current) == proposed {
		return
	}
	updates[column] = proposed
	*fields = append(*fields, column)
}

func createSpecDraftFromProfile(tx *gorm.DB, profileDraft models.ProductProfileDraft, profile services.ProductProfile, requestedBy uint) (uint, error) {
	candidates := services.ProductProfileSpecCandidates(profile)
	if len(candidates) == 0 {
		return 0, nil
	}
	result := services.SpecResearchResult{
		Brand:      profile.Brand,
		Model:      profile.Model,
		Candidates: candidates,
		Confidence: services.ProfileConfidenceLabel(profile.Confidence),
		Notes:      fmt.Sprintf("Created from approved product profile draft %d. Review every cited value before publication.", profileDraft.ID),
	}
	for _, sourceURL := range profile.SourceURLs {
		result.Evidence = append(result.Evidence, services.ProductWebEvidence{URL: sourceURL, Title: "eBay listing evidence", SourceType: "marketplace", EvidenceLevel: "listing"})
	}
	draft := models.ProductSpecDraft{
		ProductID:      profileDraft.ProductID,
		SKU:            profileDraft.SKU,
		Brand:          profile.Brand,
		Model:          profile.Model,
		Status:         "pending",
		Confidence:     result.Confidence,
		CandidatesJSON: services.BuildSpecDraftPayload(result),
		EvidenceJSON:   services.SpecEvidenceJSON(result.Evidence),
		SpecsJSON:      services.TechnicalSpecsJSON(services.SpecCandidatesToMap(candidates)),
		Notes:          result.Notes,
		RequestedBy:    requestedBy,
		JobID:          "profile-draft-" + strconv.FormatUint(uint64(profileDraft.ID), 10),
	}
	if err := tx.Create(&draft).Error; err != nil {
		return 0, err
	}
	if err := tx.Model(&models.ProductSpecDraft{}).
		Where("id <> ? AND product_id = ? AND model = ? AND status = ?", draft.ID, draft.ProductID, draft.Model, "pending").
		Update("status", "superseded").Error; err != nil {
		return 0, err
	}
	return draft.ID, nil
}
