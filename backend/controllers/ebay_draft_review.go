package controllers

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
)

// HTTP surface for the automated eBay draft review.
//
// The review pass is triggered from the drafts page, so these endpoints live
// under the ebay-import-drafts controller's territory but in their own file to
// keep the (already large) draft controller about CRUD.

// EbayDraftReviewController serves the automated review queue.
type EbayDraftReviewController struct{}

// NewEbayDraftReviewController builds the controller.
func NewEbayDraftReviewController() *EbayDraftReviewController {
	return &EbayDraftReviewController{}
}

// ebayDraftReviewClient builds the model client from the active AI profile.
//
// The API key is read here and captured in the closure; it is never stored on
// the job, so a job row cannot leak credentials.
func ebayDraftReviewClient() (services.IdentificationClient, string) {
	setting, _, apiKey, err := loadAIAgentConfigForProfile(nil)
	if err != nil || setting == nil || !setting.Enabled || apiKey == "" {
		return nil, "AI 配置不可用，请先在 AI Assistant 中启用并配置模型 / AI configuration is unavailable"
	}
	client := func(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
		return requestAIAgentCompletion(ctx, setting, apiKey, []aiChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		}, 4096)
	}
	return client, ""
}

// StartReview handles POST /admin/ebay-import-drafts/ai-review
//
// Body accepts either explicit draft ids or a filter, mirroring the bulk delete
// contract so "review everything on this page" and "review what I selected"
// both work without the client enumerating ids it cannot see.
func (rc *EbayDraftReviewController) StartReview(c *gin.Context) {
	var req models.EbayImportDraftAIReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}

	client, configError := ebayDraftReviewClient()
	if client == nil {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: configError, Error: "ai_unavailable"})
		return
	}

	ids := normalizeBulkDraftIDs(req.IDs)
	if len(ids) == 0 && req.AllFiltered {
		resolved, err := resolveReviewDraftIDs(req)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to resolve drafts", Error: err.Error()})
			return
		}
		ids = resolved
	}
	if len(ids) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No drafts to review", Error: "no_drafts"})
		return
	}

	createdBy := uint(0)
	if userID := currentAdminUserID(c); userID != nil {
		createdBy = *userID
	}
	job, err := services.StartEbayDraftReviewJob(ids, createdBy, client)
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to start AI review", Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "AI review started", Data: job})
}

// resolveReviewDraftIDs expands a filter into draft ids, bounded by the same
// selection cap the list endpoint uses.
func resolveReviewDraftIDs(req models.EbayImportDraftAIReviewRequest) ([]uint, error) {
	db := config.GetDB()
	query := db.Model(&models.EbayImportDraft{}).
		Where("status NOT IN ?", []string{services.EbayDraftStatusImported, services.EbayDraftStatusSkipped})

	// The default guard skips drafts that already hold or are awaiting a
	// proposal, so a second pass does not duplicate work. An explicit
	// ai_review_status filter states the intent directly and must not be
	// contradicted by that guard (filtering for `ready` rows would otherwise
	// always return nothing).
	reviewStatus := strings.TrimSpace(req.AIReviewStatus)
	if reviewStatus == "" {
		query = query.Where("ai_review_status NOT IN ?", []string{services.EbayAIReviewReady, services.EbayAIReviewQueued, services.EbayAIReviewProcessing})
	} else if clause, args, ok := services.EbayDraftReviewStatusClause(reviewStatus); ok {
		query = query.Where(clause, args...)
	}

	if status := strings.TrimSpace(req.Status); status != "" {
		query = query.Where("status = ?", status)
	}
	if matchStatus := strings.TrimSpace(req.MatchStatus); matchStatus != "" {
		query = query.Where("match_status = ?", matchStatus)
	}
	if brand := strings.TrimSpace(req.Brand); brand != "" {
		query = query.Where("normalized_brand = ?", brand)
	}
	if search := strings.TrimSpace(req.Search); search != "" {
		like := "%" + search + "%"
		query = query.Where(
			"title_raw LIKE ? OR normalized_title LIKE ? OR normalized_model LIKE ? OR normalized_part_number LIKE ? OR normalized_mpn LIKE ?",
			like, like, like, like, like,
		)
	}

	var ids []uint
	if err := query.Order("id ASC").Limit(services.EbayReviewMaxItems).Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// GetReviewJob handles GET /admin/ebay-import-drafts/ai-review/:jobId
//
// It returns the job summary and its log lines together so the page polls one
// endpoint instead of two.
func (rc *EbayDraftReviewController) GetReviewJob(c *gin.Context) {
	db := config.GetDB()
	jobID := strings.TrimSpace(c.Param("jobId"))
	job, err := services.GetEbayDraftReviewJob(db, jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Review job not found", Error: "not_found"})
		return
	}
	items, err := services.ListEbayDraftReviewJobItems(db, jobID, parseReviewLogLimit(c.Query("log_limit")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load review log", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Review job loaded",
		Data:    gin.H{"job": job, "items": items},
	})
}

func parseReviewLogLimit(raw string) int {
	if value, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
		return value
	}
	return 500
}

// GetLatestReviewJob handles GET /admin/ebay-import-drafts/ai-review/latest
//
// A page reload must be able to find a run already in flight; otherwise a long
// job looks like it vanished.
func (rc *EbayDraftReviewController) GetLatestReviewJob(c *gin.Context) {
	db := config.GetDB()
	job, err := services.GetLatestEbayDraftReviewJob(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load review job", Error: err.Error()})
		return
	}
	if job == nil {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "No review job", Data: nil})
		return
	}
	items, _ := services.ListEbayDraftReviewJobItems(db, job.ID, parseReviewLogLimit(c.Query("log_limit")))
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Latest review job loaded",
		Data:    gin.H{"job": job, "items": items},
	})
}

// PauseReviewJob handles POST /admin/ebay-import-drafts/ai-review/:jobId/pause
func (rc *EbayDraftReviewController) PauseReviewJob(c *gin.Context) {
	job, err := services.PauseEbayDraftReviewJob(strings.TrimSpace(c.Param("jobId")))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to pause review job", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Review job pause requested", Data: job})
}

// ResumeReviewJob handles POST /admin/ebay-import-drafts/ai-review/:jobId/resume
func (rc *EbayDraftReviewController) ResumeReviewJob(c *gin.Context) {
	client, configError := ebayDraftReviewClient()
	if client == nil {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: configError, Error: "ai_unavailable"})
		return
	}
	job, err := services.ResumeEbayDraftReviewJob(strings.TrimSpace(c.Param("jobId")), client)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to resume review job", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Review job resumed", Data: job})
}

// CancelReviewJob handles POST /admin/ebay-import-drafts/ai-review/:jobId/cancel
func (rc *EbayDraftReviewController) CancelReviewJob(c *gin.Context) {
	job, err := services.CancelEbayDraftReviewJob(strings.TrimSpace(c.Param("jobId")))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to cancel review job", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Review job cancelled", Data: job})
}

// ------------------------------------------------------------------ approve --

// ApproveReview handles POST /admin/ebay-import-drafts/ai-review/approve
//
// This is the step that publishes. It is deliberately one explicit call over an
// explicit id list: the review pass never publishes on its own, so nothing
// reaches an indexed URL without this request.
func (ec *EbayImportDraftController) ApproveReview(c *gin.Context) {
	var req models.EbayImportDraftAIApproveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	ids := normalizeBulkDraftIDs(req.IDs)
	if len(ids) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No drafts selected", Error: "no_drafts"})
		return
	}

	userID := currentAdminUserID(c)
	confirmFn := func(id uint, action string, uid *uint) (int, string, error) {
		return ec.confirmReviewedDraft(context.Background(), id, action, uid)
	}
	snapshot, err := services.StartEbayBulkConfirmTask(ids, req.Action, userID, confirmFn)
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to start approval task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "Approval task started", Data: snapshot})
}

// confirmReviewedDraft applies a stored proposal and then imports it.
//
// Importing reuses confirmDraftImport so an approved draft goes through exactly
// the same validation, duplicate handling and product upsert as a manually
// confirmed one.
func (ec *EbayImportDraftController) confirmReviewedDraft(ctx context.Context, id uint, action string, userID *uint) (int, string, error) {
	db := config.GetDB()
	var draft models.EbayImportDraft
	if err := db.First(&draft, id).Error; err != nil {
		return http.StatusNotFound, "", err
	}
	if draft.Status == services.EbayDraftStatusImported || draft.Status == services.EbayDraftStatusSkipped {
		return http.StatusOK, "already_processed", nil
	}
	if draft.AIReviewStatus != services.EbayAIReviewReady {
		// Without a proposal there is nothing approved to publish. Such a draft
		// stays for a human, matching the review pass's own refusal to publish.
		return http.StatusOK, "not_ready", nil
	}
	if err := services.ApplyDraftReviewToDraft(db, &draft); err != nil {
		return http.StatusInternalServerError, "", err
	}
	result, statusCode, err := ec.confirmDraftImport(ctx, id, action, userID)
	return statusCode, draftConfirmSkipReason(result), err
}

// RejectReview handles POST /admin/ebay-import-drafts/ai-review/reject
//
// Rejecting discards the proposal and leaves the listing in the queue, so a
// rejected item is never lost.
func (rc *EbayDraftReviewController) RejectReview(c *gin.Context) {
	var req models.EbayImportDraftAIRejectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	ids := normalizeBulkDraftIDs(req.IDs)
	if len(ids) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No drafts selected", Error: "no_drafts"})
		return
	}
	db := config.GetDB()
	rejected := 0
	for _, id := range ids {
		if err := services.RejectDraftReview(db, id, req.Reason); err == nil {
			rejected++
		}
	}
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Review proposals rejected",
		Data:    gin.H{"rejected": rejected},
	})
}

// ------------------------------------------------------------------ summary --

// ReviewQueueSummary handles GET /admin/ebay-import-drafts/ai-review/summary
//
// The counts drive the review page's header so an administrator can see how much
// work a pass produced without loading the whole list.
func (rc *EbayDraftReviewController) ReviewQueueSummary(c *gin.Context) {
	db := config.GetDB()
	type row struct {
		AIReviewStatus string
		Total          int64
	}
	var rows []row
	if err := db.Model(&models.EbayImportDraft{}).
		Select("ai_review_status, COUNT(*) AS total").
		Where("status NOT IN ?", []string{services.EbayDraftStatusImported, services.EbayDraftStatusSkipped}).
		Group("ai_review_status").
		Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load review summary", Error: err.Error()})
		return
	}
	counts := map[string]int64{}
	for _, item := range rows {
		key := item.AIReviewStatus
		if key == "" {
			key = "unreviewed"
		}
		counts[key] = item.Total
	}
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Review summary loaded",
		Data:    gin.H{"counts": counts, "total": len(counts)},
	})
}
