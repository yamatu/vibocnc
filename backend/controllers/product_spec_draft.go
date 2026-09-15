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

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
)

// ProductSpecDraftController owns the model-number -> parameters review queue.
//
// The pipeline is deliberately review-first: research runs, the operator checks
// the cited sources in the admin UI, and only an explicit approval writes the
// parameters into Product.TechnicalSpecs. There is no automatic publish path, so
// an indexed product page can never change from an unattended web search.
type ProductSpecDraftController struct{}

const (
	specResearchMaxBatch    = 20
	specResearchDefaultAI   = true
	specDraftListMaxPerPage = 100
)

type specResearchRequest struct {
	ProductID uint   `json:"product_id"`
	Brand     string `json:"brand"`
	Model     string `json:"model"`
	SKU       string `json:"sku"`
	// UseAI enables the language-model extraction pass. The model may only
	// propose values; anything not found verbatim on a cited page is discarded.
	UseAI *bool `json:"use_ai"`
	// Force re-runs research even when a pending draft already exists.
	Force bool `json:"force"`
}

type specResearchBatchRequest struct {
	IDs []uint `json:"ids"`
	// Limit caps how many products one request may research, because every
	// lookup performs a real public search.
	Limit int   `json:"limit"`
	UseAI *bool `json:"use_ai"`
	Force bool  `json:"force"`
	// OnlyMissing skips products that already carry technical specifications.
	OnlyMissing *bool `json:"only_missing"`
}

type specDraftApproveRequest struct {
	// Candidates optionally overrides the stored proposal (the reviewer can
	// uncheck or edit values before approving).
	Candidates []services.SpecResearchCandidate `json:"candidates"`
	// Overwrite replaces an existing parameter with the researched value. The
	// default keeps whatever the catalogue already published.
	Overwrite bool `json:"overwrite"`
}

type specDraftRejectRequest struct {
	Reason string `json:"reason"`
}

// ResearchProduct runs the pipeline for a single product (or a bare model
// number) and stores the result as a pending draft.
func (sc *ProductSpecDraftController) ResearchProduct(c *gin.Context) {
	var req specResearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}

	db := config.GetDB()
	var product *models.Product
	if idParam := strings.TrimSpace(c.Param("id")); idParam != "" {
		id, err := strconv.ParseUint(idParam, 10, 64)
		if err != nil || id == 0 {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product id"})
			return
		}
		req.ProductID = uint(id)
	}
	if req.ProductID > 0 {
		var found models.Product
		if err := db.First(&found, req.ProductID).Error; err != nil {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product not found"})
			return
		}
		product = &found
	}

	brand := strings.TrimSpace(req.Brand)
	model := strings.TrimSpace(req.Model)
	sku := strings.TrimSpace(req.SKU)
	if product != nil {
		if brand == "" {
			brand = product.Brand
		}
		if model == "" {
			model = specFirstNonEmpty(product.Model, product.PartNumber, product.SKU)
		}
		if sku == "" {
			sku = product.SKU
		}
	}
	model = strings.TrimSpace(services.NormalizeProductModel(model))
	if model == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "A model number is required to research specifications"})
		return
	}

	draft, err := buildAndStoreSpecDraft(c.Request.Context(), specDraftInput{
		Product: product,
		Brand:   brand,
		Model:   model,
		SKU:     sku,
		UseAI:   req.UseAI,
		Force:   req.Force,
		UserID:  currentUserID(c),
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, models.APIResponse{Success: false, Message: "Specification research failed", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Specification draft created for review", Data: draft})
}

// ResearchBatch runs the pipeline for up to specResearchMaxBatch products.
func (sc *ProductSpecDraftController) ResearchBatch(c *gin.Context) {
	var req specResearchBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	if len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Select at least one product"})
		return
	}
	limit := req.Limit
	if limit <= 0 || limit > specResearchMaxBatch {
		limit = specResearchMaxBatch
	}

	db := config.GetDB()
	ids := req.IDs
	if len(ids) > limit {
		ids = ids[:limit]
	}
	var products []models.Product
	if err := db.Where("id IN ?", ids).Find(&products).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load products", Error: err.Error()})
		return
	}

	type batchOutcome struct {
		ProductID  uint   `json:"product_id"`
		SKU        string `json:"sku"`
		Model      string `json:"model"`
		DraftID    uint   `json:"draft_id,omitempty"`
		Candidates int    `json:"candidates"`
		Status     string `json:"status"`
		Message    string `json:"message,omitempty"`
	}
	outcomes := make([]batchOutcome, 0, len(products))

	for index := range products {
		if err := c.Request.Context().Err(); err != nil {
			break
		}
		product := products[index]
		outcome := batchOutcome{ProductID: product.ID, SKU: product.SKU}
		model := strings.TrimSpace(services.NormalizeProductModel(specFirstNonEmpty(product.Model, product.PartNumber, product.SKU)))
		outcome.Model = model
		if model == "" {
			outcome.Status = "skipped"
			outcome.Message = "no model number"
			outcomes = append(outcomes, outcome)
			continue
		}
		if req.OnlyMissing != nil && *req.OnlyMissing && strings.TrimSpace(product.TechnicalSpecs) != "" && strings.TrimSpace(product.TechnicalSpecs) != "{}" {
			outcome.Status = "skipped"
			outcome.Message = "already has specifications"
			outcomes = append(outcomes, outcome)
			continue
		}
		draft, err := buildAndStoreSpecDraft(c.Request.Context(), specDraftInput{
			Product: &product,
			Brand:   product.Brand,
			Model:   model,
			SKU:     product.SKU,
			UseAI:   req.UseAI,
			Force:   req.Force,
			UserID:  currentUserID(c),
		})
		if err != nil {
			outcome.Status = "failed"
			outcome.Message = err.Error()
			outcomes = append(outcomes, outcome)
			continue
		}
		payload := services.DecodeSpecDraftPayload(draft.CandidatesJSON)
		outcome.Status = "pending_review"
		outcome.DraftID = draft.ID
		outcome.Candidates = len(payload.Candidates)
		if len(payload.Candidates) == 0 {
			outcome.Message = "no verifiable parameter found"
		}
		outcomes = append(outcomes, outcome)
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{
		"requested": len(req.IDs),
		"processed": len(outcomes),
		"limit":     limit,
		"results":   outcomes,
	}})
}

// ListDrafts returns the review queue.
func (sc *ProductSpecDraftController) ListDrafts(c *gin.Context) {
	db := config.GetDB()
	query := db.Model(&models.ProductSpecDraft{})
	if status := strings.TrimSpace(c.Query("status")); status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + search + "%"
		query = query.Where("sku LIKE ? OR model LIKE ? OR brand LIKE ?", like, like, like)
	}
	if productID := strings.TrimSpace(c.Query("product_id")); productID != "" && productID != "0" {
		query = query.Where("product_id = ?", productID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to count drafts", Error: err.Error()})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageSize < 1 || pageSize > specDraftListMaxPerPage {
		pageSize = 20
	}

	var drafts []models.ProductSpecDraft
	if err := query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&drafts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load drafts", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{
		"data":        drafts,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (total + int64(pageSize) - 1) / int64(pageSize),
	}})
}

// GetDraft returns a draft including its per-value provenance.
func (sc *ProductSpecDraftController) GetDraft(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid draft id"})
		return
	}
	var draft models.ProductSpecDraft
	if err := config.GetDB().First(&draft, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Draft not found"})
		return
	}
	payload := services.DecodeSpecDraftPayload(draft.CandidatesJSON)
	evidence := []services.ProductWebEvidence{}
	if strings.TrimSpace(draft.EvidenceJSON) != "" {
		_ = json.Unmarshal([]byte(draft.EvidenceJSON), &evidence)
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{
		"draft":      draft,
		"candidates": payload.Candidates,
		"confidence": draft.Confidence,
		"notes":      draft.Notes,
		"evidence":   evidence,
	}})
}

// ApproveDraft writes the reviewed parameters onto the product. Existing
// parameters are preserved unless the reviewer explicitly asks to overwrite.
func (sc *ProductSpecDraftController) ApproveDraft(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid draft id"})
		return
	}
	var req specDraftApproveRequest
	_ = c.ShouldBindJSON(&req)

	db := config.GetDB()
	var draft models.ProductSpecDraft
	if err := db.First(&draft, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Draft not found"})
		return
	}
	if draft.Status == "approved" {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft already applied", Data: draft})
		return
	}
	if draft.ProductID == 0 {
		// A draft created from a bare model number can still be applied when its
		// SKU identifies exactly one product; otherwise the reviewer must pick a
		// product deliberately.
		if sku := strings.TrimSpace(draft.SKU); sku != "" {
			var matched models.Product
			if err := db.Where("sku = ?", sku).First(&matched).Error; err == nil {
				draft.ProductID = matched.ID
			} else {
				c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: fmt.Sprintf("No product has the SKU %q. Open the product and start the research from there.", sku)})
				return
			}
		} else {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "This draft is not linked to a product. Create or select a product before applying parameters."})
			return
		}
	}

	candidates := req.Candidates
	if len(candidates) == 0 {
		candidates = services.DecodeSpecDraftPayload(draft.CandidatesJSON).Candidates
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.SourceURL) == "" {
			c.JSON(http.StatusBadRequest, models.APIResponse{
				Success: false,
				Message: fmt.Sprintf("Parameter %q has no cited source and cannot be published", candidate.Label),
			})
			return
		}
	}

	var product models.Product
	if err := db.First(&product, draft.ProductID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product not found"})
		return
	}

	existing := services.ParseTechnicalSpecs(product.TechnicalSpecs)
	researched := services.SpecCandidatesToMap(candidates)
	added := 0
	skipped := 0
	for label, value := range researched {
		if current, ok := existing[label]; ok && strings.TrimSpace(current) != "" && !req.Overwrite {
			skipped++
			continue
		}
		if existing[label] == value {
			skipped++
			continue
		}
		existing[label] = value
		added++
	}

	encoded := services.TechnicalSpecsJSON(existing)
	if err := db.Model(&models.Product{}).Where("id = ?", product.ID).Update("technical_specs", encoded).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save specifications", Error: err.Error()})
		return
	}

	now := time.Now()
	draft.Status = "approved"
	draft.ReviewedBy = currentUserID(c)
	draft.ReviewedAt = &now
	draft.AppliedAt = &now
	draft.CandidatesJSON = services.BuildSpecDraftPayload(services.SpecResearchResult{
		Candidates: candidates,
		Confidence: draft.Confidence,
		Notes:      draft.Notes,
	})
	draft.SpecsJSON = encoded
	if err := db.Save(&draft).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Specifications saved but the draft could not be updated", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: fmt.Sprintf("Applied %d parameter(s); %d left unchanged", added, skipped), Data: gin.H{
		"draft":           draft,
		"added":           added,
		"skipped":         skipped,
		"technical_specs": encoded,
	}})
}

// RejectDraft closes a draft without touching the product.
func (sc *ProductSpecDraftController) RejectDraft(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid draft id"})
		return
	}
	var req specDraftRejectRequest
	_ = c.ShouldBindJSON(&req)

	db := config.GetDB()
	var draft models.ProductSpecDraft
	if err := db.First(&draft, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Draft not found"})
		return
	}
	now := time.Now()
	draft.Status = "rejected"
	draft.ReviewedBy = currentUserID(c)
	draft.ReviewedAt = &now
	draft.RejectReason = strings.TrimSpace(req.Reason)
	if err := db.Save(&draft).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to reject draft", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft rejected", Data: draft})
}

// specFirstNonEmpty returns the first non-empty trimmed value.
func specFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// currentUserID reads the authenticated admin id for the audit trail.
func currentUserID(c *gin.Context) uint {
	if id := currentAdminUserID(c); id != nil {
		return *id
	}
	return 0
}

type specDraftInput struct {
	Product *models.Product
	Brand   string
	Model   string
	SKU     string
	UseAI   *bool
	Force   bool
	UserID  uint
}

// buildAndStoreSpecDraft runs the research pipeline and persists the review row.
func buildAndStoreSpecDraft(ctx context.Context, in specDraftInput) (*models.ProductSpecDraft, error) {
	db := config.GetDB()

	if !in.Force && in.Product != nil {
		var existing models.ProductSpecDraft
		err := db.Where("product_id = ? AND model = ? AND status = ?", in.Product.ID, in.Model, "pending").
			Order("id DESC").First(&existing).Error
		if err == nil {
			return &existing, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	researchCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	result, err := services.ResearchProductSpecs(researchCtx, in.Brand, in.Model, productName(in.Product))
	if err != nil {
		return nil, err
	}

	useAI := specResearchDefaultAI
	if in.UseAI != nil {
		useAI = *in.UseAI
	}
	if useAI {
		if aiCandidates, aiErr := proposeSpecsWithAI(researchCtx, in.Brand, in.Model, result.Evidence); aiErr == nil && len(aiCandidates) > 0 {
			verified := services.FilterSpecCandidatesByVerbatimEvidence(in.Model, aiCandidates, result.Evidence)
			result.Candidates = services.MergeSpecCandidateLists(result.Candidates, verified)
			if len(verified) > 0 && result.Confidence == "low" {
				result.Confidence = "medium"
			}
		}
	}

	draft := &models.ProductSpecDraft{
		Brand:          result.Brand,
		Model:          result.Model,
		SKU:            in.SKU,
		Status:         "pending",
		Confidence:     result.Confidence,
		CandidatesJSON: services.BuildSpecDraftPayload(result),
		EvidenceJSON:   services.SpecEvidenceJSON(result.Evidence),
		Notes:          result.Notes,
		RequestedBy:    in.UserID,
	}
	if in.Product != nil {
		draft.ProductID = in.Product.ID
		if draft.SKU == "" {
			draft.SKU = in.Product.SKU
		}
		if draft.Brand == "" {
			draft.Brand = in.Product.Brand
		}
	}
	draft.SpecsJSON = services.TechnicalSpecsJSON(services.SpecCandidatesToMap(result.Candidates))

	if err := db.Create(draft).Error; err != nil {
		return nil, err
	}
	return draft, nil
}

func productName(product *models.Product) string {
	if product == nil {
		return ""
	}
	return strings.TrimSpace(product.Name)
}

// proposeSpecsWithAI asks the configured provider to read the collected evidence
// and list only the parameters it can see there. The reply is untrusted: every
// value must pass the verbatim evidence check before it reaches a draft.
func proposeSpecsWithAI(ctx context.Context, brand, model string, evidence []services.ProductWebEvidence) ([]services.SpecResearchCandidate, error) {
	if len(evidence) == 0 {
		return nil, nil
	}
	setting, _, apiKey, err := loadAIAgentConfigWithProfile()
	if err != nil || setting == nil || !setting.Enabled || strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("AI provider is not configured")
	}

	var sourceText strings.Builder
	for index, item := range evidence {
		if item.SourceType == "search-result" || item.EvidenceLevel == "search-result" {
			continue
		}
		sourceText.WriteString(fmt.Sprintf("[%d] %s (%s)\n%s\n\n", index+1, item.Title, item.URL, item.Snippet))
		if sourceText.Len() > 12000 {
			break
		}
	}
	if strings.TrimSpace(sourceText.String()) == "" {
		return nil, errors.New("no citable source text available")
	}

	messages := []aiChatMessage{
		{
			Role: "system",
			Content: "You extract technical parameters from supplied source text. You must not use outside knowledge, must not guess, and must not convert units. " +
				"Only list a parameter when its exact value appears in the source text. If a value is missing, omit it. " +
				"Allowed labels: Input voltage, Rated current, Rated power, Frequency, Weight, Dimensions, Max speed, Encoder resolution, Operating temperature, Protection class, Insulation class, Cooling method, Mounting type, Interface, Certifications. " +
				"Reply with JSON only: {\"parameters\":[{\"label\":\"...\",\"value\":\"...\"}]}. Copy the value text exactly as written in the source.",
		},
		{
			Role: "user",
			Content: fmt.Sprintf(
				"Product model (型号): %s\nBrand: %s\n\nSOURCE TEXT\n%s\nReturn the parameters for %s only.",
				model, strings.TrimSpace(brand), sourceText.String(), model,
			),
		},
	}

	raw, err := requestAIAgentCompletion(ctx, setting, apiKey, messages, 1200)
	if err != nil {
		return nil, err
	}
	return parseAISpecCandidates(raw), nil
}

// parseAISpecCandidates tolerantly reads the provider reply. Providers wrap JSON
// in prose or fences often enough that a strict decode is not viable.
func parseAISpecCandidates(raw string) []services.SpecResearchCandidate {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	type looseCandidate struct {
		Label string `json:"label"`
		Name  string `json:"name"`
		Key   string `json:"key"`
		Value string `json:"value"`
	}

	normalize := func(items []looseCandidate) []services.SpecResearchCandidate {
		out := make([]services.SpecResearchCandidate, 0, len(items))
		for _, item := range items {
			label := strings.TrimSpace(specFirstNonEmpty(item.Label, item.Name, item.Key))
			value := strings.TrimSpace(item.Value)
			if label == "" || value == "" {
				continue
			}
			out = append(out, services.SpecResearchCandidate{Label: label, Value: value, Origin: "ai"})
		}
		return out
	}

	// Object form: {"parameters":[...]}
	for start := 0; start < len(trimmed); start++ {
		if trimmed[start] != '{' {
			continue
		}
		var object map[string]json.RawMessage
		if err := json.Unmarshal([]byte(trimmed[start:]), &object); err != nil {
			continue
		}
		for _, key := range []string{"parameters", "specs", "specifications", "technical_specs", "data"} {
			value, ok := object[key]
			if !ok {
				continue
			}
			var items []looseCandidate
			if err := json.Unmarshal(value, &items); err == nil && len(items) > 0 {
				return normalize(items)
			}
		}
	}

	// Array form: [...]
	for start := 0; start < len(trimmed); start++ {
		if trimmed[start] != '[' {
			continue
		}
		var items []looseCandidate
		if err := json.Unmarshal([]byte(trimmed[start:]), &items); err == nil && len(items) > 0 {
			return normalize(items)
		}
	}
	return nil
}
