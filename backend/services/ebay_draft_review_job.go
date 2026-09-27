package services

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"

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

// EbayReviewSkipReasons is the stable order of preflight *rejections*, so the
// same selection always produces the same sentence.
var EbayReviewSkipReasons = []string{"missing_identifier", "missing_title", "already_processed"}

// EbayReviewRecoveredReason is reported separately from a rejection: it counts
// drafts that were unusable until the title parser rescued their model, which is
// information rather than a failure.
const EbayReviewRecoveredReason = "recovered_from_title"

// EbayReviewSkipReasonText turns a preflight reason code into the reason an
// administrator can act on.
func EbayReviewSkipReasonText(reason string) string {
	switch reason {
	case "missing_identifier":
		return "no model or part number"
	case "missing_title":
		return "no title"
	case "already_processed":
		return "already imported or skipped"
	case EbayReviewRecoveredReason:
		return "model recovered from title"
	default:
		return reason
	}
}

// EbayReviewSkipCounts counts, per reason, the selected drafts that a review
// pass could not take.
type EbayReviewSkipCounts map[string]int

// Summary renders the counts as "<reason>: <count>, ..." in a stable order.
//
// Only refusals are summarised. A recovered count is progress, not a reason a
// batch was refused, so it is reported through RecoveredSummary instead.
func (c EbayReviewSkipCounts) Summary() string {
	parts := make([]string, 0, len(c))
	known := make(map[string]struct{}, len(EbayReviewSkipReasons))
	for _, reason := range EbayReviewSkipReasons {
		known[reason] = struct{}{}
		if count := c[reason]; count > 0 {
			parts = append(parts, fmt.Sprintf("%s: %d", EbayReviewSkipReasonText(reason), count))
		}
	}
	// A reason introduced elsewhere must still be reported rather than silently
	// dropped from the summary.
	extra := make([]string, 0, len(c))
	for reason, count := range c {
		if count <= 0 {
			continue
		}
		if _, ok := known[reason]; ok {
			continue
		}
		if reason == EbayReviewRecoveredReason {
			continue
		}
		extra = append(extra, fmt.Sprintf("%s: %d", EbayReviewSkipReasonText(reason), count))
	}
	sort.Strings(extra)
	return strings.Join(append(parts, extra...), ", ")
}

// RecoveredSummary reports how many drafts were rescued by the title parser, or
// an empty string when none were.
func (c EbayReviewSkipCounts) RecoveredSummary() string {
	if count := c[EbayReviewRecoveredReason]; count > 0 {
		return fmt.Sprintf("%s: %d", EbayReviewSkipReasonText(EbayReviewRecoveredReason), count)
	}
	return ""
}

// EbayNoReviewableDraftsError explains a selection in which every draft failed
// the preflight.
//
// The bare "no reviewable drafts were selected" it replaces was unactionable: a
// batch of scraped listings is usually missing the model the identifier check
// requires, and nothing in the old message said so.
type EbayNoReviewableDraftsError struct {
	Selected int
	Skipped  EbayReviewSkipCounts
	// Samples holds a few real titles per reason, so the message shows what was
	// actually in the rows rather than only that they were refused.
	Samples EbayReviewSkipSamples
}

func (e *EbayNoReviewableDraftsError) Error() string {
	summary := e.Skipped.Summary()
	if summary == "" {
		return fmt.Sprintf("none of the %d selected drafts can be reviewed", e.Selected)
	}
	message := fmt.Sprintf("none of the %d selected drafts can be reviewed (%s)", e.Selected, summary)
	if samples := e.Samples.SamplesBlock(); samples != "" {
		message += ". " + samples
	}
	return message
}

var ebayReviewCancelMu sync.Mutex
var ebayReviewCancels = map[string]context.CancelFunc{}

// EbayReviewSkipSampleLimit bounds how many unusable titles are echoed back in a
// rejection, so a 5000-row selection cannot produce a 5000-line error.
const EbayReviewSkipSampleLimit = 5

// EbayReviewSkipSamples collects a few real titles per skip reason.
//
// A count alone says a batch was refused; it does not say whether the titles are
// unparsed, missing, or simply absent from the payload. Five actual titles answer
// that in one round trip instead of another debugging cycle.
type EbayReviewSkipSamples map[string][]string

func (s EbayReviewSkipSamples) note(reason, title string) {
	title = strings.TrimSpace(title)
	if title == "" || len(s[reason]) >= EbayReviewSkipSampleLimit {
		return
	}
	s[reason] = append(s[reason], title)
}

// SamplesBlock renders the collected titles for an error message.
func (s EbayReviewSkipSamples) SamplesBlock() string {
	if len(s) == 0 {
		return ""
	}
	reasons := make([]string, 0, len(s))
	for reason := range s {
		reasons = append(reasons, reason)
	}
	// Iterate the known order first so the message is stable.
	ordered := make([]string, 0, len(reasons))
	for _, reason := range EbayReviewSkipReasons {
		if _, ok := s[reason]; ok {
			ordered = append(ordered, reason)
		}
	}
	for _, reason := range reasons {
		if !knownSkipReason(reason) {
			ordered = append(ordered, reason)
		}
	}

	lines := make([]string, 0, len(ordered))
	for _, reason := range ordered {
		lines = append(lines, fmt.Sprintf("%s: %s", EbayReviewSkipReasonText(reason), strings.Join(s[reason], " | ")))
	}
	return strings.Join(lines, "; ")
}

func knownSkipReason(reason string) bool {
	for _, candidate := range EbayReviewSkipReasons {
		if candidate == reason {
			return true
		}
	}
	return false
}

// StartEbayDraftReviewJob creates a job for the given drafts and launches it.
//
// Drafts are re-checked here rather than trusted from the request, because the
// caller reads them from an earlier page load and rows move on.
func StartEbayDraftReviewJob(
	draftIDs []uint,
	createdByID uint,
	client IdentificationClient,
) (*models.EbayDraftReviewJob, EbayReviewSkipCounts, error) {
	return StartEbayDraftReviewJobWithOptions(draftIDs, createdByID, client, EbayDraftReviewJobOptions{})
}

// EbayDraftReviewJobOptions carries the choices that change what a run does.
type EbayDraftReviewJobOptions struct {
	// AutoPublish imports each draft whose proposal is ready, instead of leaving
	// it in the approval queue. It is an explicit opt-in on the request: the
	// review pass on its own never publishes.
	AutoPublish bool
	// Publisher performs the import. When AutoPublish is set and this is nil the
	// run still reviews but reports each ready draft as an import failure instead
	// of silently behaving like a normal run.
	Publisher EbayReviewPublisher
}

// StartEbayDraftReviewJobWithOptions creates a review job and launches it.
func StartEbayDraftReviewJobWithOptions(
	draftIDs []uint,
	createdByID uint,
	client IdentificationClient,
	options EbayDraftReviewJobOptions,
) (*models.EbayDraftReviewJob, EbayReviewSkipCounts, error) {
	db := config.GetDB()
	if db == nil {
		return nil, nil, fmt.Errorf("database is not configured")
	}
	if len(draftIDs) == 0 {
		return nil, nil, fmt.Errorf("at least one draft is required")
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
		return nil, nil, err
	}
	reviewable := make([]models.EbayImportDraft, 0, len(drafts))
	skipped := EbayReviewSkipCounts{}
	samples := EbayReviewSkipSamples{}
	// Drafts scraped before the title parser existed hold no model even though
	// their title names the part. Rescuing them here means a backlog collected
	// months ago becomes reviewable without a re-scrape, and a row that is
	// genuinely without an identifier is no longer indistinguishable from one
	// that was simply stored before the parser existed.
	recovered := 0
	for _, draft := range drafts {
		reason, ok := EbayDraftPreflight(draft)
		if ok {
			reviewable = append(reviewable, draft)
			continue
		}
		if reason == "missing_identifier" {
			if parsed := utils.ExtractModelFromText(firstNonEmptyString(draft.NormalizedTitle, draft.TitleRaw)); parsed != "" {
				draft.NormalizedModel = NormalizeProductModel(parsed)
				recovered++
				reviewable = append(reviewable, draft)
				continue
			}
		}
		skipped[reason]++
		samples.note(reason, firstNonEmptyString(draft.NormalizedTitle, draft.TitleRaw))
	}
	if len(reviewable) == 0 {
		return nil, nil, &EbayNoReviewableDraftsError{Selected: len(draftIDs), Skipped: skipped, Samples: samples}
	}

	job := &models.EbayDraftReviewJob{
		ID:          uuid.NewString(),
		Status:      "queued",
		Total:       len(reviewable),
		Stage:       "排队中 / queued",
		CreatedByID: createdByID,
		AutoPublish: options.AutoPublish,
	}
	items := make([]models.EbayDraftReviewJobItem, 0, len(reviewable))
	reviewableIDs := make([]uint, 0, len(reviewable))
	for _, draft := range reviewable {
		reviewableIDs = append(reviewableIDs, draft.ID)
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
		// Persist a model recovered from the title, so the product built on
		// approval carries the identity the review actually read.
		for _, draft := range reviewable {
			if draft.NormalizedModel == "" {
				continue
			}
			if err := tx.Model(&models.EbayImportDraft{}).
				Where("id = ? AND COALESCE(NULLIF(normalized_model, ''), '') = ''", draft.ID).
				Update("normalized_model", draft.NormalizedModel).Error; err != nil {
				return err
			}
		}
		// Mark the drafts so the list view shows them as in-flight and a second
		// click cannot queue the same row twice. Only the drafts that actually got
		// an item are marked: a skipped draft has nothing to process, so flagging
		// it as queued would strand it in the review state forever.
		return tx.Model(&models.EbayImportDraft{}).
			Where("id IN ? AND status NOT IN ?", reviewableIDs, []string{EbayDraftStatusImported, EbayDraftStatusSkipped}).
			Update("ai_review_status", EbayAIReviewQueued).Error
	}); err != nil {
		return nil, nil, err
	}

	if recovered > 0 {
		skipped[EbayReviewRecoveredReason] = recovered
	}
	if options.AutoPublish {
		setEbayReviewPublisher(job.ID, options.Publisher)
	}
	go RunEbayDraftReviewJob(job.ID, client)
	return job, skipped, nil
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
	// The publisher is a function and cannot be persisted, so a run that opted
	// into publishing re-registers it here. Without this a job resumed after a
	// restart would have auto_publish set but no way to publish, and would
	// report every ready draft as an import failure.
	if job.AutoPublish {
		setEbayReviewPublisher(jobID, PublishReadyDraft)
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
		// Another worker owns the job now; still release this run's publisher,
		// which holds a closure over the controller.
		setEbayReviewPublisher(jobID, nil)
		return
	}
	finalizeEbayReviewJob(db, jobID, workerToken)
	setEbayReviewPublisher(jobID, nil)
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

	// eBay market quotes collected for this model are strong evidence: they carry
	// item specifics and the marketplace category path. But a freshly scraped
	// queue usually has no quote yet, and relying on one alone meant the review
	// saw an empty payload and had to classify the part from its model number.
	// The draft's own listing is evidence too, so it is always included, with the
	// market quote taking precedence because it aggregates several listings.
	var evidence []models.EbayMarketEvidenceItem
	if quote, err := LookupMarketQuote(db, draft.NormalizedBrand, firstNonEmptyString(draft.NormalizedModel, draftIdentifier(draft))); err == nil && quote != nil {
		evidence = MarketEvidenceItems(*quote)
	}
	if draftEvidence := DraftEvidenceFromDraft(draft); !isBlankEvidenceListing(draftEvidence) {
		evidence = append(evidence, draftEvidence)
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
		// Publishing reuses the manual approval path below rather than importing
		// here, so an auto-published product passes the same validation, duplicate
		// handling and upsert as one a human approved. When the job was not asked
		// to publish, this is where it stops.
		if publishes, importMessage := ebayReviewAutoPublish(jobID, draft.ID); publishes {
			if importMessage == "" {
				completeEbayReviewItem(jobID, workerToken, item.ID, "imported", "success", message+"；已上架 / published", "")
			} else {
				completeEbayReviewItem(jobID, workerToken, item.ID, "import_failed", "error", message, importMessage)
			}
			return
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

// EbayReviewPublisher imports a draft whose proposal is ready, returning a
// message when the import could not complete.
//
// It is injected rather than called directly so this package does not depend on
// the controller that owns import validation and product upsert: one publish
// path exists, and both the manual button and an auto-publishing run use it.
type EbayReviewPublisher func(ctx context.Context, draftID uint) (string, error)

// ebayReviewPublishers holds the publisher per running job.
//
// Keyed by job id so a run started without auto-publish cannot begin publishing
// because another run enabled it.
var ebayReviewPublisherMu sync.Mutex
var ebayReviewPublishers = map[string]EbayReviewPublisher{}

func setEbayReviewPublisher(jobID string, publisher EbayReviewPublisher) {
	ebayReviewPublisherMu.Lock()
	defer ebayReviewPublisherMu.Unlock()
	if publisher == nil {
		delete(ebayReviewPublishers, jobID)
		return
	}
	ebayReviewPublishers[jobID] = publisher
}

func ebayReviewPublisherFor(jobID string) EbayReviewPublisher {
	ebayReviewPublisherMu.Lock()
	defer ebayReviewPublisherMu.Unlock()
	return ebayReviewPublishers[jobID]
}

// PublishReadyDraft is the publisher an auto-publishing review run uses.
//
// It is exported so the review controller can hand it to the job without
// duplicating the import rules in this package.
func PublishReadyDraft(ctx context.Context, draftID uint) (string, error) {
	return publishReadyDraft(ctx, draftID)
}

// ebayReviewAutoPublish publishes a ready draft when the job was created with
// auto-publish. It reports whether it attempted a publish, and an error message
// when the attempt failed.
//
// The flag is read from the job row rather than carried in memory, so a run that
// resumed after a restart still publishes only if it was asked to.
func ebayReviewAutoPublish(jobID string, draftID uint) (bool, string) {
	db := config.GetDB()
	var job models.EbayDraftReviewJob
	if err := db.Select("auto_publish").First(&job, "id = ?", jobID).Error; err != nil || !job.AutoPublish {
		return false, ""
	}
	publisher := ebayReviewPublisherFor(jobID)
	if publisher == nil {
		return true, "no publisher is registered for this run"
	}
	ctx, cancel := context.WithTimeout(context.Background(), EbayReviewPublishTimeout)
	defer cancel()
	if message, err := publisher(ctx, draftID); err != nil {
		return true, firstNonEmptyString(message, err.Error())
	} else if message != "" {
		return true, message
	}
	return true, ""
}

// EbayReviewPublishTimeout bounds one import. Publishing runs the full product
// upsert, so it is slower than the model call that produced the proposal.
const EbayReviewPublishTimeout = 4 * time.Minute

// ConfirmDraftImportFunc imports one draft whose proposal is ready.
//
// The import controller owns validation, duplicate handling and the product
// upsert, so it registers its function here at startup rather than the review
// controller reaching into it. That keeps a single publish path: whatever the
// manual approve button runs is what an auto-publishing run runs.
type ConfirmDraftImportFunc func(ctx context.Context, draftID uint) (int, string, error)

var defaultConfirmDraftImport atomic.Value // ConfirmDraftImportFunc

// RegisterConfirmDraftImport installs the import entry point used by
// auto-publishing review runs.
func RegisterConfirmDraftImport(fn ConfirmDraftImportFunc) {
	if fn != nil {
		defaultConfirmDraftImport.Store(fn)
	}
}

// publishReadyDraft imports a draft on behalf of an auto-publishing run.
func publishReadyDraft(ctx context.Context, draftID uint) (string, error) {
	loaded := defaultConfirmDraftImport.Load()
	if loaded == nil {
		return "", fmt.Errorf("no import entry point is registered; cannot publish")
	}
	confirm := loaded.(ConfirmDraftImportFunc)
	statusCode, reason, err := confirm(ctx, draftID)
	if err != nil {
		return "", fmt.Errorf("导入失败 / import failed: %w", err)
	}
	switch {
	case statusCode >= 500:
		return "服务器错误 / server error", nil
	case reason == "already_processed":
		// Not an error: the row was already imported, which is the end state we
		// wanted anyway.
		return "", nil
	case reason != "":
		// A skip reason means the import consciously declined the row (no proposal,
		// duplicate, invalid data). Reporting it keeps the operator informed rather
		// than counting it as published.
		return "未上架：" + reason + " / not published: " + reason, nil
	}
	return "", nil
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
			"ready":         "ready",
			"rejected":      "rejected",
			"failed":        "failed",
			"imported":      "imported",
			"import_failed": "import_failed",
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
	if job.AutoPublish {
		// An auto-publishing run reports what it published, not what is waiting for
		// approval: the two are different outcomes and must not share wording.
		message = fmt.Sprintf("完成：%d 条已上架，%d 条跳过 / done: %d published, %d skipped", job.Imported, job.Rejected, job.Imported, job.Rejected)
		if job.ImportFailed > 0 {
			message = fmt.Sprintf("完成：%d 条已上架，%d 条上架失败，%d 条跳过 / done: %d published, %d failed to publish, %d skipped",
				job.Imported, job.ImportFailed, job.Rejected, job.Imported, job.ImportFailed, job.Rejected)
			status = "completed_with_errors"
		}
	}
	if job.Failed > 0 {
		status = "completed_with_errors"
		if job.AutoPublish {
			// Keep the published/pending distinction: an auto-publishing run did not
			// leave anything "ready", so reusing that wording would misreport it.
			message = fmt.Sprintf("完成（部分失败）：%d 条已上架，%d 条上架失败，%d 条识别失败，%d 条跳过 / done with errors: %d published, %d failed to publish, %d review failed, %d skipped",
				job.Imported, job.ImportFailed, job.Failed, job.Rejected,
				job.Imported, job.ImportFailed, job.Failed, job.Rejected)
		} else {
			message = fmt.Sprintf("完成（部分失败）：%d 条待批准，%d 条跳过，%d 条失败 / done with errors: %d ready, %d skipped, %d failed",
				job.Ready, job.Rejected, job.Failed, job.Ready, job.Rejected, job.Failed)
		}
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
	// RunEbayDraftReviewJob re-registers the publisher for an auto-publishing
	// run, because the publisher is a function and cannot be persisted.
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
//
// The cap exists because a run over tens of thousands of drafts produces that
// many log lines, and the aggregate counters on the job row already tell the
// whole story. Items are returned newest-first so the tail of a live run is what
// an operator sees, rather than only the first few hundred rows of a very large
// queue.
func ListEbayDraftReviewJobItems(db *gorm.DB, jobID string, limit int) ([]models.EbayDraftReviewJobItem, error) {
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	var items []models.EbayDraftReviewJobItem
	// Fetch the newest rows, then present them oldest-first so the log still reads
	// top to bottom.
	err := db.Where("job_id = ?", jobID).Order("id DESC").Limit(limit).Find(&items).Error
	if err != nil {
		return items, err
	}
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
	return items, nil
}

// EbayReviewItemPage is one page of a job's items, filtered by status.
//
// The approval list needs the `ready` rows specifically. A page over the log
// would bury them: a run that rejects most of its input puts every ready row
// past the log cap, which is exactly the case where an operator has proposals to
// act on and the UI showed an empty list.
type EbayReviewItemPage struct {
	Items    []models.EbayDraftReviewJobItem `json:"items"`
	Total    int64                           `json:"total"`
	Page     int                             `json:"page"`
	PageSize int                             `json:"page_size"`
	Status   string                          `json:"status"`
}

// EbayReviewItemPageSizeMax bounds a page. It matches the drafts list cap so the
// two selectors stay in step.
const EbayReviewItemPageSizeMax = 200

// EbayReviewItemPageSizeDefault is the page size a caller gets without asking.
const EbayReviewItemPageSizeDefault = 100

// ListEbayDraftReviewJobItemsPaged returns one page of a job's items.
//
// status filters on the item's own outcome; "" returns every status. The total is
// the count *before* pagination, so the UI can tell an operator how many proposals
// exist instead of only how many are on the current page.
func ListEbayDraftReviewJobItemsPaged(db *gorm.DB, jobID string, status string, page int, pageSize int) (EbayReviewItemPage, error) {
	result := EbayReviewItemPage{Status: strings.TrimSpace(status), Page: 1, PageSize: 50}
	if db == nil {
		return result, errors.New("database is nil")
	}
	if page > 0 {
		result.Page = page
	}
	if pageSize > 0 {
		result.PageSize = pageSize
	}
	if result.PageSize > EbayReviewItemPageSizeMax {
		result.PageSize = EbayReviewItemPageSizeMax
	}

	query := db.Model(&models.EbayDraftReviewJobItem{}).Where("job_id = ?", jobID)
	if result.Status != "" {
		query = query.Where("status = ?", result.Status)
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return result, err
	}

	offset := (result.Page - 1) * result.PageSize
	items := []models.EbayDraftReviewJobItem{}
	// Ordered by draft id so paging is stable: a live run appending rows must not
	// shift a row from one page to the next.
	err := query.Order("draft_id ASC").Offset(offset).Limit(result.PageSize).Find(&items).Error
	if err != nil {
		return result, err
	}
	result.Items = items
	return result, nil
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
