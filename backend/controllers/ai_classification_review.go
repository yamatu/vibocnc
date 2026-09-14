package controllers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Classification review queue.
//
// Every classification attempt that could not publish used to leave one
// truncated error sentence behind. The candidate the AI actually proposed, its
// confidence and the evidence it used were all discarded, so the only way to
// resolve such a product was to re-run the entire job and hope for a better
// answer.
//
// The payload below is what an administrator sees and approves. It is stored on
// the job item itself (classification_status / classification_rule /
// evidence_json), which keeps the review queue a query over existing rows
// instead of a second source of truth.

// Classification status values persisted on AIAgentSEOJobItem.
const (
	classificationStatusCompleted   = "completed"
	classificationStatusNeedsReview = "needs_review"
	classificationStatusConflict    = "conflict"
	classificationStatusUnresolved  = "unresolved"
	// Approved and dismissed are terminal review states: the queue only lists
	// entries that nobody has ruled on yet.
	classificationStatusApproved  = "approved"
	classificationStatusDismissed = "dismissed"
)

// classificationReviewStatuses lists the states an administrator still has to
// act on.
var classificationReviewStatuses = []string{classificationStatusNeedsReview, classificationStatusConflict, classificationStatusUnresolved}

// classificationReviewEvidenceLimit bounds how much search text is copied into
// the review payload. Evidence is for a human to judge, not to archive.
const classificationReviewEvidenceLimit = 8

// classificationReviewEvidenceRunes caps one snippet so one verbose search
// result cannot dominate the stored payload.
const classificationReviewEvidenceRunes = 300

type classificationReviewEvidence struct {
	Title         string `json:"title,omitempty"`
	URL           string `json:"url,omitempty"`
	Snippet       string `json:"snippet,omitempty"`
	SourceType    string `json:"source_type,omitempty"`
	EvidenceLevel string `json:"evidence_level,omitempty"`
}

// classificationReviewPayload is the stored, administrator-facing record of one
// classification attempt.
type classificationReviewPayload struct {
	Source       string                         `json:"source,omitempty"`
	Confirmed    bool                           `json:"confirmed"`
	Conflict     bool                           `json:"conflict,omitempty"`
	Confidence   float64                        `json:"confidence,omitempty"`
	Reason       string                         `json:"reason,omitempty"`
	Brand        string                         `json:"brand,omitempty"`
	BrandKey     string                         `json:"brand_key,omitempty"`
	PartType     string                         `json:"part_type,omitempty"`
	ModelFamily  string                         `json:"model_family,omitempty"`
	CategorySlug string                         `json:"category_slug,omitempty"`
	MatchRule    string                         `json:"match_rule,omitempty"`
	SearchError  string                         `json:"search_error,omitempty"`
	Evidence     []classificationReviewEvidence `json:"evidence,omitempty"`
}

// ClassificationReviewPayloadJSON renders the payload for persistence. A
// marshalling failure yields an empty string: losing the review detail must
// never abort the job item that carries the actual outcome.
func ClassificationReviewPayloadJSON(proposal services.ClassificationProposal) string {
	if strings.TrimSpace(proposal.Model) == "" && strings.TrimSpace(proposal.Source) == "" {
		return ""
	}
	// The payload is only written when there is something a human can judge.
	// An empty one would replace a previously stored candidate with nothing.
	if strings.TrimSpace(proposal.Inference.PartType) == "" &&
		strings.TrimSpace(proposal.Inference.BrandKey) == "" &&
		strings.TrimSpace(proposal.Reason) == "" &&
		strings.TrimSpace(proposal.SearchError) == "" &&
		!proposal.Conflict && proposal.Confidence == 0 && len(proposal.Evidence) == 0 {
		return ""
	}
	payload := classificationReviewPayload{
		Source:       proposal.Source,
		Confirmed:    proposal.Confirmed,
		Conflict:     proposal.Conflict,
		Confidence:   proposal.Confidence,
		Reason:       truncateRunes(proposal.Reason, 1000),
		Brand:        proposal.Inference.BrandName,
		BrandKey:     proposal.Inference.BrandKey,
		PartType:     proposal.Inference.PartType,
		ModelFamily:  proposal.Inference.ModelFamily,
		CategorySlug: proposal.Inference.CategorySlug,
		MatchRule:    truncateRunes(proposal.Inference.MatchRule, 160),
		SearchError:  truncateRunes(proposal.SearchError, 400),
	}
	for index, item := range proposal.Evidence {
		if index >= classificationReviewEvidenceLimit {
			break
		}
		payload.Evidence = append(payload.Evidence, classificationReviewEvidence{
			Title:         truncateRunes(item.Title, classificationReviewEvidenceRunes),
			URL:           item.URL,
			Snippet:       truncateRunes(item.Snippet, classificationReviewEvidenceRunes),
			SourceType:    item.SourceType,
			EvidenceLevel: item.EvidenceLevel,
		})
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// classificationStatusForProposal maps a decision onto the persisted review
// state. "conflict" is kept separate from "needs_review" because the two need
// different handling: a conflict means two verified sources disagree, so the
// administrator has to pick a side, while a needs_review entry is a candidate
// to accept or discard.
func classificationStatusForProposal(proposal services.ClassificationProposal) string {
	switch {
	case proposal.Confirmed:
		return classificationStatusCompleted
	case proposal.Conflict:
		return classificationStatusConflict
	case strings.TrimSpace(proposal.Source) == "" || proposal.Source == services.ClassificationSourceUnresolved:
		// Nothing was decided. Filing these under review would fill the queue
		// with rows an administrator cannot act on.
		return classificationStatusUnresolved
	default:
		return classificationStatusNeedsReview
	}
}

// applyClassificationProposalUpdates records a classification decision on a job
// item update map. It is a no-op for a zero proposal, which keeps the call
// sites that have no classification detail unchanged.
func applyClassificationProposalUpdates(updates map[string]interface{}, proposal services.ClassificationProposal) {
	if updates == nil {
		return
	}
	if strings.TrimSpace(proposal.Model) == "" && strings.TrimSpace(proposal.Source) == "" {
		return
	}
	updates["classification_status"] = classificationStatusForProposal(proposal)
	if rule := truncateRunes(proposal.Inference.MatchRule, 160); strings.TrimSpace(rule) != "" {
		updates["classification_rule"] = rule
	}
	if payload := ClassificationReviewPayloadJSON(proposal); payload != "" {
		updates["evidence_json"] = payload
	}
}

// reviewCandidate is one row of the classification review queue: the stored
// attempt joined with enough product context to judge it without a second
// lookup.
type reviewCandidate struct {
	ItemID               uint            `json:"item_id"`
	JobID                string          `json:"job_id"`
	ProductID            uint            `json:"product_id"`
	SKU                  string          `json:"sku"`
	ProductName          string          `json:"product_name"`
	Brand                string          `json:"brand"`
	Model                string          `json:"model"`
	CategoryID           uint            `json:"category_id"`
	CategoryPath         string          `json:"category_path"`
	IsActive             bool            `json:"is_active"`
	ClassificationStatus string          `json:"classification_status"`
	ClassificationRule   string          `json:"classification_rule"`
	Review               json.RawMessage `json:"review,omitempty"`
	Error                string          `json:"error,omitempty"`
	UpdatedAt            time.Time       `json:"updated_at"`
}

// ListClassificationReview returns the classification attempts that still need
// an administrator's decision. The candidate brand/type/confidence the AI
// proposed is included, which is the whole point: a rejected answer stays
// reviewable instead of having to be regenerated.
func (ac *AIAgentController) ListClassificationReview(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}

	query := db.Model(&models.AIAgentSEOJobItem{}).Where("classification_status IN ?", classificationReviewStatuses)
	if status := strings.ToLower(strings.TrimSpace(c.Query("status"))); status != "" {
		query = query.Where("classification_status = ?", status)
	}
	if jobID := strings.TrimSpace(c.Query("job_id")); jobID != "" {
		query = query.Where("job_id = ?", jobID)
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + search + "%"
		query = query.Where("sku LIKE ? OR product_id IN (SELECT id FROM products WHERE model LIKE ? OR name LIKE ? OR brand LIKE ?)", like, like, like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to count review items", Error: utils.PublicError(err, "db_error")})
		return
	}
	var items []models.AIAgentSEOJobItem
	if err := query.Order("id DESC").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load review items", Error: utils.PublicError(err, "db_error")})
		return
	}

	candidates := make([]reviewCandidate, 0, len(items))
	if len(items) > 0 {
		productIDs := make([]uint, 0, len(items))
		for _, item := range items {
			productIDs = append(productIDs, item.ProductID)
		}
		var products []models.Product
		if err := db.Preload("Category").Where("id IN ?", productIDs).Find(&products).Error; err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load reviewed products", Error: utils.PublicError(err, "db_error")})
			return
		}
		byID := make(map[uint]models.Product, len(products))
		for _, product := range products {
			byID[product.ID] = product
		}
		for _, item := range items {
			candidate := reviewCandidate{
				ItemID:               item.ID,
				JobID:                item.JobID,
				ProductID:            item.ProductID,
				SKU:                  item.SKU,
				ClassificationStatus: item.ClassificationStatus,
				ClassificationRule:   item.ClassificationRule,
				Error:                item.Error,
				UpdatedAt:            item.UpdatedAt,
			}
			if strings.TrimSpace(item.EvidenceJSON) != "" {
				candidate.Review = json.RawMessage(item.EvidenceJSON)
			}
			if product, found := byID[item.ProductID]; found {
				candidate.ProductName = product.Name
				candidate.Brand = product.Brand
				candidate.Model = services.ClassificationModel(product)
				candidate.CategoryID = product.CategoryID
				candidate.IsActive = product.IsActive
				candidate.CategoryPath = product.Category.Name
			}
			candidates = append(candidates, candidate)
		}
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{"items": candidates, "total": total, "limit": limit, "offset": offset}})
}

type classificationReviewDecisionRequest struct {
	// AllowNewProductTypes lets an administrator accept a product type the
	// taxonomy has never used. It is explicit here because approving an AI
	// candidate must not silently mint a public category.
	AllowNewProductTypes *bool  `json:"allow_new_product_types"`
	ActivateProduct      *bool  `json:"activate_product"`
	Note                 string `json:"note"`
}

// ApproveClassificationReview applies a stored candidate. The write goes
// through the same resolution path as an automatic job, then records the
// approval as a verified audit row so the decision becomes a learned rule and
// the same model is classified the same way next time.
func (ac *AIAgentController) ApproveClassificationReview(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}
	var req classificationReviewDecisionRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid review decision", Error: err.Error()})
			return
		}
	}
	item, reviewer, ok := loadReviewItem(c, db)
	if !ok {
		return
	}

	var product models.Product
	if err := db.Preload("Category").First(&product, item.ProductID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Reviewed product no longer exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load reviewed product", Error: utils.PublicError(err, "db_error")})
		return
	}

	payload := decodeClassificationReviewPayload(item.EvidenceJSON)
	brandKey := payload.BrandKey
	partType := payload.PartType
	if brandKey == "" {
		brandKey = services.NormalizeBrandKey(payload.Brand)
	}
	if brandKey == "" && strings.TrimSpace(product.Brand) != "" {
		brandKey = services.NormalizeBrandKey(product.Brand)
	}
	inference, err := services.InferenceFromAIClassification(payload.Brand, partType, payload.ModelFamily)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Stored candidate cannot be applied: " + err.Error()})
		return
	}
	if brandKey != "" && brandKey != inference.BrandKey {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Stored candidate brand does not match its brand key"})
		return
	}

	ctx := c.Request.Context()
	result := services.ApplyProductCategoryInference(ctx, db, product, inference, services.ProductCategoryOptimizationOptions{
		CreateMissingCategories: true,
		AllowNewProductTypes:    optionalBool(req.AllowNewProductTypes, false),
		ActivateResolved:        optionalBool(req.ActivateProduct, true),
		AuditJobID:              item.JobID,
	})
	if result.Status != "completed" {
		c.JSON(http.StatusUnprocessableEntity, models.APIResponse{Success: false, Message: "Candidate could not be applied", Error: result.Message})
		return
	}

	// A verified decision must be visible to the next classification immediately
	// instead of after the cache TTL.
	services.InvalidateLearnedClassificationRules()

	updates := map[string]interface{}{
		"classification_status": classificationStatusApproved,
		"error":                 truncateRunes("Approved by "+reviewer+": "+result.Message, 1000),
	}
	if err := db.Model(&models.AIAgentSEOJobItem{}).Where("id = ?", item.ID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Candidate was applied but the review entry could not be updated", Error: utils.PublicError(err, "db_error")})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Classification approved", Data: gin.H{"item_id": item.ID, "product_id": product.ID, "category_id": result.CategoryID, "category_path": result.CategoryPath, "status": result.Status, "note": strings.TrimSpace(req.Note)}})
}

// DismissClassificationReview closes a review entry without changing the
// product. The audit trail keeps the rejection so the same candidate is not
// offered again.
func (ac *AIAgentController) DismissClassificationReview(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}
	var req classificationReviewDecisionRequest
	if c.Request.ContentLength > 0 {
		_ = c.ShouldBindJSON(&req)
	}
	item, reviewer, ok := loadReviewItem(c, db)
	if !ok {
		return
	}
	var product models.Product
	model := ""
	if err := db.First(&product, item.ProductID).Error; err == nil {
		model = services.ClassificationModel(product)
		_ = services.RecordClassificationAudit(db, product, services.ProductCategoryInference{}, model, nil, "rejected", truncateRunes("Dismissed by "+reviewer+": "+strings.TrimSpace(req.Note), 500), item.JobID)
	}
	if err := db.Model(&models.AIAgentSEOJobItem{}).Where("id = ?", item.ID).Update("classification_status", classificationStatusDismissed).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to dismiss review item", Error: utils.PublicError(err, "db_error")})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Classification candidate dismissed", Data: gin.H{"item_id": item.ID, "product_id": item.ProductID}})
}

// loadReviewItem resolves the reviewed job item and refuses a decision on one
// that was already closed, so a stale browser tab cannot re-apply an approval.
func loadReviewItem(c *gin.Context, db *gorm.DB) (models.AIAgentSEOJobItem, string, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid review item id"})
		return models.AIAgentSEOJobItem{}, "", false
	}
	var item models.AIAgentSEOJobItem
	if err := db.First(&item, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Review item not found"})
		return models.AIAgentSEOJobItem{}, "", false
	}
	switch item.ClassificationStatus {
	case classificationStatusNeedsReview, classificationStatusConflict, classificationStatusUnresolved:
	default:
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Review item was already decided"})
		return models.AIAgentSEOJobItem{}, "", false
	}
	role, _ := c.Get("role")
	name, _ := c.Get("username")
	reviewer := strings.TrimSpace(strings.Join([]string{stringifyContextValue(role), stringifyContextValue(name)}, "/"))
	if reviewer == "/" {
		reviewer = "admin"
	}
	return item, reviewer, true
}

func stringifyContextValue(value interface{}) string {
	text, _ := value.(string)
	return text
}

// decodeClassificationReviewPayload tolerates both the structured review
// payload and the older raw evidence array, so entries written before this
// queue existed remain actionable.
func decodeClassificationReviewPayload(raw string) classificationReviewPayload {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return classificationReviewPayload{}
	}
	var payload classificationReviewPayload
	if err := json.Unmarshal([]byte(raw), &payload); err == nil && (payload.PartType != "" || payload.Brand != "") {
		return payload
	}
	var evidence []services.ProductWebEvidence
	if err := json.Unmarshal([]byte(raw), &evidence); err != nil {
		return classificationReviewPayload{}
	}
	// Legacy rows stored only search evidence; the type has to be re-derived
	// from it, which is exactly what a deterministic re-run would do.
	converted := make([]classificationReviewEvidence, 0, len(evidence))
	for index, item := range evidence {
		if index >= classificationReviewEvidenceLimit {
			break
		}
		converted = append(converted, classificationReviewEvidence{
			Title:         truncateRunes(item.Title, classificationReviewEvidenceRunes),
			URL:           item.URL,
			Snippet:       truncateRunes(item.Snippet, classificationReviewEvidenceRunes),
			SourceType:    item.SourceType,
			EvidenceLevel: item.EvidenceLevel,
		})
	}
	return classificationReviewPayload{Evidence: converted}
}
