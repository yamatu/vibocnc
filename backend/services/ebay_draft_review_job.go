package services

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Background runner for automated eBay draft review.
//
// One goroutine walks the job's items, a small worker pool calls the model, and
// every outcome is written to the item row as a log line. The job holds no
// state in memory that matters: a restart pauses it and resuming re-reads the
// queued items, so a long run survives a deploy.

const (
	// EbayReviewWorkers bounds concurrent model calls. The identification pass
	// is a large prompt and the provider rate-limits per key, so a wide pool
	// mostly produces 429s.
	EbayReviewWorkers = 2
	// EbayReviewItemTimeout bounds a single draft. A hung model call must not
	// stall the whole batch.
	EbayReviewItemTimeout = 120 * time.Second
	// EbayReviewMaxItems caps one job, keeping a mis-click from queueing the
	// entire backlog.
	EbayReviewMaxItems = 2000
)

var ebayReviewCancelMu sync.Mutex
var ebayReviewCancels = map[string]context.CancelFunc{}

// StartEbayDraftReviewJob creates a job for the given drafts and launches it.
//
// Drafts are re-checked here rather than trusted from the request, because the
// caller reads them from an earlier page load and rows move on.
func StartEbayDraftReviewJob(
	draftIDs []uint,
	createdByID uint,
	client IdentificationClient,
) (*models.EbayDraftReviewJob, error) {
	db := config.GetDB()
	if db == nil {
		return nil, fmt.Errorf("database is not configured")
	}
	if len(draftIDs) == 0 {
		return nil, fmt.Errorf("at least one draft is required")
	}
	if len(draftIDs) > EbayReviewMaxItems {
		draftIDs = draftIDs[:EbayReviewMaxItems]
	}

	// Only drafts that can actually be reviewed are queued, so an unusable row
	// does not consume a model call or a log line per retry.
	var drafts []models.EbayImportDraft
	if err := db.
		Select("id", "status", "normalized_title", "normalized_model", "normalized_part_number", "normalized_mpn", "title_raw").
		Where("id IN ?", draftIDs).
		Find(&drafts).Error; err != nil {
		return nil, err
	}
	reviewable := make([]models.EbayImportDraft, 0, len(drafts))
	for _, draft := range drafts {
		if _, ok := EbayDraftPreflight(draft); ok {
			reviewable = append(reviewable, draft)
		}
	}
	if len(reviewable) == 0 {
		return nil, fmt.Errorf("no reviewable drafts were selected")
	}

	job := &models.EbayDraftReviewJob{
		ID:          uuid.NewString(),
		Status:      "queued",
		Total:       len(reviewable),
		Stage:       "排队中 / queued",
		CreatedByID: createdByID,
	}
	items := make([]models.EbayDraftReviewJobItem, 0, len(reviewable))
	for _, draft := range reviewable {
		items = append(items, models.EbayDraftReviewJobItem{
			JobID:   job.ID,
			DraftID: draft.ID,
			Model:   firstNonEmptyString(draft.NormalizedModel, draft.NormalizedPartNumber, draft.NormalizedMPN),
			Title:   truncateRunesSafe(firstNonEmptyString(draft.NormalizedTitle, draft.TitleRaw), 200),
			Status:  "queued",
			Level:   "info",
			Message: "等待处理 / waiting",
		})
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(job).Error; err != nil {
			return err
		}
		if err := tx.CreateInBatches(&items, 500).Error; err != nil {
			return err
		}
		// Mark the drafts so the list view shows them as in-flight and a second
		// click cannot queue the same row twice.
		return tx.Model(&models.EbayImportDraft{}).
			Where("id IN ? AND status NOT IN ?", draftIDs, []string{EbayDraftStatusImported, EbayDraftStatusSkipped}).
			Update("ai_review_status", EbayAIReviewQueued).Error
	}); err != nil {
		return nil, err
	}

	go RunEbayDraftReviewJob(job.ID, client)
	return job, nil
}

// RunEbayDraftReviewJob executes a queued or paused job.
func RunEbayDraftReviewJob(jobID string, client IdentificationClient) {
	db := config.GetDB()
	if db == nil {
		return
	}
	var job models.EbayDraftReviewJob
	if err := db.First(&job, "id = ?", jobID).Error; err != nil {
		return
	}
	if job.Status != "queued" && job.Status != "paused" {
		return
	}

	workerToken := uuid.NewString()
	now := time.Now().UTC()
	if err := db.Model(&models.EbayDraftReviewJob{}).
		Where("id = ? AND status IN ?", jobID, []string{"queued", "paused"}).
		Updates(map[string]interface{}{
			"status":       "running",
			"worker_token": workerToken,
			"started_at":   now,
			"stage":        "准备中 / starting",
		}).Error; err != nil {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	ebayReviewCancelMu.Lock()
	ebayReviewCancels[jobID] = cancel
	ebayReviewCancelMu.Unlock()
	defer func() {
		cancel()
		ebayReviewCancelMu.Lock()
		delete(ebayReviewCancels, jobID)
		ebayReviewCancelMu.Unlock()
	}()

	var work []models.EbayDraftReviewJobItem
	if err := db.Where("job_id = ? AND status = ?", jobID, "queued").
		Order("id ASC").Find(&work).Error; err != nil {
		finishEbayReviewJob(jobID, workerToken, "failed", "无法读取任务队列 / could not read the job queue: "+err.Error())
		return
	}

	itemCh := make(chan models.EbayDraftReviewJobItem)
	var wg sync.WaitGroup
	for i := 0; i < EbayReviewWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range itemCh {
				if !ebayReviewJobRunning(db, jobID, workerToken) {
					continue
				}
				processEbayReviewItem(ctx, jobID, workerToken, item, client)
			}
		}()
	}
	for _, item := range work {
		if !ebayReviewJobRunning(db, jobID, workerToken) {
			break
		}
		itemCh <- item
	}
	close(itemCh)
	wg.Wait()

	if !ebayReviewJobRunning(db, jobID, workerToken) {
		return
	}
	finalizeEbayReviewJob(db, jobID, workerToken)
}

func ebayReviewJobRunning(db *gorm.DB, jobID, workerToken string) bool {
	var count int64
	if err := db.Model(&models.EbayDraftReviewJob{}).
		Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
		Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}

func processEbayReviewItem(ctx context.Context, jobID, workerToken string, item models.EbayDraftReviewJobItem, client IdentificationClient) {
	db := config.GetDB()
	claim := db.Model(&models.EbayDraftReviewJobItem{}).
		Where("id = ? AND status = ?", item.ID, "queued").
		Updates(map[string]interface{}{"status": "running", "message": "AI 正在识别 / identifying", "level": "info"})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return
	}
	_ = db.Model(&models.EbayDraftReviewJob{}).Where("id = ?", jobID).
		Update("stage", fmt.Sprintf("处理 %s / reviewing %s", item.Model, item.Model)).Error

	var draft models.EbayImportDraft
	if err := db.First(&draft, item.DraftID).Error; err != nil {
		completeEbayReviewItem(jobID, workerToken, item.ID, "failed", "error", "", "草稿不存在 / draft no longer exists: "+err.Error())
		return
	}

	// eBay market quotes collected for this model are the strongest evidence
	// available: they carry item specifics and the marketplace category path,
	// which the listing title alone does not.
	var evidence []models.EbayMarketEvidenceItem
	if quote, err := LookupMarketQuote(db, draft.NormalizedBrand, firstNonEmptyString(draft.NormalizedModel, draftIdentifier(draft))); err == nil && quote != nil {
		evidence = MarketEvidenceItems(*quote)
	}

	// A previously confirmed product name gives the title builder a "before"
	// side so it can tell whether a rename is actually needed.
	productName := ""
	if draft.MatchedProductID != nil {
		var product models.Product
		if err := db.Select("name").First(&product, *draft.MatchedProductID).Error; err == nil {
			productName = product.Name
		}
	}

	itemCtx, cancel := context.WithTimeout(ctx, EbayReviewItemTimeout)
	defer cancel()
	reviewed, result, err := ReviewDraft(itemCtx, EbayDraftReviewInput{
		Draft:       draft,
		Evidence:    evidence,
		ProductName: productName,
	}, client)
	if err != nil {
		_ = MarkDraftReviewFailed(db, draft.ID, err.Error())
		completeEbayReviewItem(jobID, workerToken, item.ID, "failed", "error", "", err.Error())
		return
	}

	switch result.Status {
	case EbayAIReviewReady:
		if err := StoreDraftReview(db, reviewed); err != nil {
			_ = MarkDraftReviewFailed(db, draft.ID, err.Error())
			completeEbayReviewItem(jobID, workerToken, item.ID, "failed", "error", "", err.Error())
			return
		}
		message := "已生成待批准方案 / proposal ready"
		if result.CategoryCreated {
			message = "已新建分类 " + result.CategoryName + " 并生成方案 / created category " + result.CategoryName
		}
		completeEbayReviewItem(jobID, workerToken, item.ID, "ready", "success", message, "")
	case EbayAIReviewRejected:
		_ = RejectDraftReview(db, draft.ID, result.Reason)
		// A rejection is a normal outcome, not an error, so it is logged at warn
		// level with the reason rather than as a failure.
		completeEbayReviewItem(jobID, workerToken, item.ID, "rejected", "warn", "跳过："+result.Reason+" / skipped: "+result.Reason, "")
	default:
		_ = MarkDraftReviewFailed(db, draft.ID, result.Reason)
		completeEbayReviewItem(jobID, workerToken, item.ID, "failed", "error", "", result.Reason)
	}
}

// completeEbayReviewItem records the outcome and advances the job counters in
// one transaction, so the summary never disagrees with the log.
func completeEbayReviewItem(jobID, workerToken string, itemID uint, status, level, message, errMessage string) {
	db := config.GetDB()
	_ = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.EbayDraftReviewJobItem{}).
			Where("id = ?", itemID).
			Updates(map[string]interface{}{
				"status":  status,
				"level":   level,
				"message": message,
				"error":   truncateRunesSafe(errMessage, 1000),
			}).Error; err != nil {
			return err
		}
		column := map[string]string{
			"ready":    "ready",
			"rejected": "rejected",
			"failed":   "failed",
		}[status]
		updates := map[string]interface{}{
			"processed":  gorm.Expr("processed + 1"),
			"updated_at": time.Now().UTC(),
		}
		if column != "" {
			updates[column] = gorm.Expr(column + " + 1")
		}
		return tx.Model(&models.EbayDraftReviewJob{}).
			Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
			Updates(updates).Error
	})
}

// finalizeEbayReviewJob closes out a run, reporting partial success honestly.
func finalizeEbayReviewJob(db *gorm.DB, jobID, workerToken string) {
	var job models.EbayDraftReviewJob
	if err := db.Where("id = ? AND worker_token = ?", jobID, workerToken).First(&job).Error; err != nil {
		return
	}
	status := "completed"
	message := fmt.Sprintf("完成：%d 条待批准，%d 条跳过 / done: %d ready, %d skipped", job.Ready, job.Rejected, job.Ready, job.Rejected)
	if job.Failed > 0 {
		status = "completed_with_errors"
		message = fmt.Sprintf("完成（部分失败）：%d 条待批准，%d 条跳过，%d 条失败 / done with errors: %d ready, %d skipped, %d failed",
			job.Ready, job.Rejected, job.Failed, job.Ready, job.Rejected, job.Failed)
	}
	now := time.Now().UTC()
	_ = db.Model(&models.EbayDraftReviewJob{}).
		Where("id = ? AND worker_token = ?", jobID, workerToken).
		Updates(map[string]interface{}{
			"status":      status,
			"stage":       "已完成 / finished",
			"message":     message,
			"finished_at": now,
			"updated_at":  now,
		}).Error
}

func finishEbayReviewJob(jobID, workerToken, status, message string) {
	db := config.GetDB()
	if db == nil {
		return
	}
	now := time.Now().UTC()
	_ = db.Model(&models.EbayDraftReviewJob{}).
		Where("id = ? AND worker_token = ?", jobID, workerToken).
		Updates(map[string]interface{}{
			"status":      status,
			"message":     message,
			"error":       message,
			"stage":       "已停止 / stopped",
			"finished_at": now,
			"updated_at":  now,
		}).Error
}

// PauseEbayDraftReviewJob stops a running job at the next item boundary. Items
// already processed keep their proposals.
func PauseEbayDraftReviewJob(jobID string) (*models.EbayDraftReviewJob, error) {
	db := config.GetDB()
	if err := db.Model(&models.EbayDraftReviewJob{}).
		Where("id = ? AND status = ?", jobID, "running").
		Updates(map[string]interface{}{
			"status":     "paused",
			"stage":      "已暂停 / paused",
			"updated_at": time.Now().UTC(),
		}).Error; err != nil {
		return nil, err
	}
	ebayReviewCancelMu.Lock()
	if cancel, ok := ebayReviewCancels[jobID]; ok {
		cancel()
	}
	ebayReviewCancelMu.Unlock()
	// Drafts still queued in this job return to an unclaimed state so a resume
	// (or a fresh job) can pick them up.
	if err := requeueEbayReviewDrafts(db, jobID); err != nil {
		return nil, err
	}
	return GetEbayDraftReviewJob(db, jobID)
}

func requeueEbayReviewDrafts(db *gorm.DB, jobID string) error {
	var draftIDs []uint
	if err := db.Model(&models.EbayDraftReviewJobItem{}).
		Where("job_id = ? AND status = ?", jobID, "queued").
		Pluck("draft_id", &draftIDs).Error; err != nil {
		return err
	}
	if len(draftIDs) == 0 {
		return nil
	}
	return db.Model(&models.EbayImportDraft{}).
		Where("id IN ? AND ai_review_status = ?", draftIDs, EbayAIReviewQueued).
		Update("ai_review_status", "").Error
}

// ResumeEbayDraftReviewJob restarts a paused job from its queued items.
func ResumeEbayDraftReviewJob(jobID string, client IdentificationClient) (*models.EbayDraftReviewJob, error) {
	db := config.GetDB()
	var job models.EbayDraftReviewJob
	if err := db.First(&job, "id = ?", jobID).Error; err != nil {
		return nil, err
	}
	if job.Status != "paused" {
		return nil, fmt.Errorf("job is not paused")
	}
	go RunEbayDraftReviewJob(jobID, client)
	return GetEbayDraftReviewJob(db, jobID)
}

// CancelEbayDraftReviewJob stops a run and marks the remaining work cancelled.
func CancelEbayDraftReviewJob(jobID string) (*models.EbayDraftReviewJob, error) {
	db := config.GetDB()
	now := time.Now().UTC()
	if err := db.Model(&models.EbayDraftReviewJob{}).
		Where("id = ? AND status IN ?", jobID, []string{"queued", "running", "paused"}).
		Updates(map[string]interface{}{
			"status":      "cancelled",
			"stage":       "已取消 / cancelled",
			"finished_at": now,
			"updated_at":  now,
		}).Error; err != nil {
		return nil, err
	}
	ebayReviewCancelMu.Lock()
	if cancel, ok := ebayReviewCancels[jobID]; ok {
		cancel()
	}
	ebayReviewCancelMu.Unlock()
	if err := requeueEbayReviewDrafts(db, jobID); err != nil {
		return nil, err
	}
	return GetEbayDraftReviewJob(db, jobID)
}

// GetEbayDraftReviewJob loads a job with its log lines, newest activity last so
// the page can render it as a terminal log.
func GetEbayDraftReviewJob(db *gorm.DB, jobID string) (*models.EbayDraftReviewJob, error) {
	var job models.EbayDraftReviewJob
	if err := db.First(&job, "id = ?", jobID).Error; err != nil {
		return nil, err
	}
	return &job, nil
}

// ListEbayDraftReviewJobItems returns the log lines for a job.
func ListEbayDraftReviewJobItems(db *gorm.DB, jobID string, limit int) ([]models.EbayDraftReviewJobItem, error) {
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	var items []models.EbayDraftReviewJobItem
	err := db.Where("job_id = ?", jobID).Order("id ASC").Limit(limit).Find(&items).Error
	return items, err
}

// GetLatestEbayDraftReviewJob returns the most recent job so the page can
// reconnect to a run after a refresh.
func GetLatestEbayDraftReviewJob(db *gorm.DB) (*models.EbayDraftReviewJob, error) {
	var job models.EbayDraftReviewJob
	err := db.Order("created_at DESC").First(&job).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &job, nil
}

// EbayReviewJobLogLine renders one item as a log line for the UI.
func EbayReviewJobLogLine(item models.EbayDraftReviewJobItem) string {
	parts := []string{}
	if strings.TrimSpace(item.Model) != "" {
		parts = append(parts, item.Model)
	}
	if strings.TrimSpace(item.Message) != "" {
		parts = append(parts, item.Message)
	}
	if strings.TrimSpace(item.Error) != "" {
		parts = append(parts, item.Error)
	}
	return strings.Join(parts, " — ")
}
