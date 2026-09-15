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
	specResearchDefaultAI   = true
	specDraftListMaxPerPage = 100
)

// specResearchRequest researches a bare model number that has no product row
// yet. Catalogue products are researched through the AI job queue instead
// (see ai_seo_spec_jobs.go), because a batch lookup is far too slow for a
// request/response cycle.
type specResearchRequest struct {
	Brand string `json:"brand"`
	Model string `json:"model"`
	SKU   string `json:"sku"`
	// UseAI enables the language-model extraction pass. The model may only
	// propose values; anything not found verbatim on a cited page is discarded.
	UseAI *bool `json:"use_ai"`
	// Force re-runs research even when a pending draft already exists.
	Force bool `json:"force"`
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

// ResearchModel researches a bare model number and stores the result as a
// pending draft. It is intentionally synchronous: there is no product row to
// attach a job item to, and a single lookup is fast. Researching catalogue
// products goes through StartProductSpecResearchJob / StartBatchSpecResearchJob,
// which run on the AI job queue with progress, pause/resume and restart
// recovery.
func (sc *ProductSpecDraftController) ResearchModel(c *gin.Context) {
	var req specResearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	db := config.GetDB()
	model := strings.TrimSpace(services.NormalizeProductModel(req.Model))
	if model == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "A model number is required to research specifications"})
		return
	}
	sku := strings.TrimSpace(req.SKU)
	var product *models.Product
	if sku != "" {
		// A draft started from a bare model number can still be applied later
		// when one product already carries that SKU.
		var matched models.Product
		if err := db.Where("sku = ?", sku).First(&matched).Error; err == nil {
			product = &matched
		}
	}

	draft, _, err := buildAndStoreSpecDraft(c.Request.Context(), specDraftInput{
		Product: product,
		Brand:   strings.TrimSpace(req.Brand),
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
	// JobID links the draft to the AI job item that produced it.
	JobID string
	// AISetting/AIAPIKey pin the provider of a running job, so the research keeps
	// the profile the job was created with even if the administrator switches it
	// mid-run.
	AISetting *models.AIAgentSetting
	AIAPIKey  string
}

// buildAndStoreSpecDraft runs the research pipeline and persists the review row.
// The boolean result reports that an existing pending draft was reused instead of
// a new one being created.
func buildAndStoreSpecDraft(ctx context.Context, in specDraftInput) (*models.ProductSpecDraft, bool, error) {
	db := config.GetDB()
	if db == nil {
		return nil, false, errors.New("database connection failed")
	}

	if !in.Force && in.Product != nil {
		var existing models.ProductSpecDraft
		err := db.Where("product_id = ? AND model = ? AND status = ?", in.Product.ID, in.Model, "pending").
			Order("id DESC").First(&existing).Error
		if err == nil {
			return &existing, true, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, err
		}
	}

	researchCtx, cancel := context.WithTimeout(ctx, specResearchItemTimeout)
	defer cancel()

	result, err := services.ResearchProductSpecs(researchCtx, in.Brand, in.Model, productName(in.Product))
	if err != nil {
		return nil, false, err
	}

	useAI := specResearchDefaultAI
	if in.UseAI != nil {
		useAI = *in.UseAI
	}
	if useAI {
		if aiCandidates, aiErr := proposeSpecsWithAI(researchCtx, in.Brand, in.Model, result.Evidence, in.AISetting, in.AIAPIKey); aiErr == nil && len(aiCandidates) > 0 {
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
		JobID:          in.JobID,
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

	// A new draft replaces the older pending proposals for the same product and
	// model. Without this, re-running research with Force piled up identical
	// pending rows and the reviewer could not tell which one was current.
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(draft).Error; err != nil {
			return err
		}
		supersede := tx.Model(&models.ProductSpecDraft{}).
			Where("id <> ? AND status = ? AND model = ?", draft.ID, "pending", draft.Model)
		if draft.ProductID > 0 {
			supersede = supersede.Where("product_id = ?", draft.ProductID)
		} else if strings.TrimSpace(draft.SKU) != "" {
			supersede = supersede.Where("product_id = 0 AND sku = ?", draft.SKU)
		} else {
			return nil
		}
		return supersede.Update("status", "superseded").Error
	})
	if err != nil {
		return nil, false, err
	}
	return draft, false, nil
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
func proposeSpecsWithAI(ctx context.Context, brand, model string, evidence []services.ProductWebEvidence, pinned *models.AIAgentSetting, pinnedAPIKey string) ([]services.SpecResearchCandidate, error) {
	if len(evidence) == 0 {
		return nil, nil
	}
	setting := pinned
	apiKey := pinnedAPIKey
	if setting == nil || strings.TrimSpace(apiKey) == "" {
		resolved, _, resolvedKey, err := loadAIAgentConfigWithProfile()
		if err != nil || resolved == nil || !resolved.Enabled || strings.TrimSpace(resolvedKey) == "" {
			return nil, errors.New("AI provider is not configured")
		}
		setting = resolved
		apiKey = resolvedKey
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
				"Use one of these labels whenever it fits, so the same parameter is never split into two rows: Input voltage, Rated current, Rated power, Frequency, Weight, Dimensions, Max speed, Encoder resolution, Operating temperature, Protection class, Insulation class, Cooling method, Mounting type, Interface, Certifications. " +
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
