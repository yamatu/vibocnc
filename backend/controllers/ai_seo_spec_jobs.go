package controllers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Model-number specification research runs as a normal AI job.
//
// The first version of this feature called the search provider inside the HTTP
// handler: a batch of twenty products was researched serially, the request timed
// out, the browser showed no progress, and a restart lost everything. Running on
// the existing AI job queue instead gives the same durability every other AI
// task has: item-level claims, progress text, pause/resume/end, restart
// recovery, and a single overlap gate shared with content optimization.
//
// The job never publishes anything. Each item produces a review draft, and only
// an explicit approval writes Product.TechnicalSpecs.
const (
	aiSEOSpecSelectionMode      = "spec_research"
	aiSEOSpecOptionsMarker      = "[[VIBOCNC_SPEC_JOB_OPTIONS="
	maxSpecResearchWorkers      = 3
	defaultSpecResearchJobLimit = 50
	maxSpecResearchJobLimit     = 500
	// One item performs a cached search, up to three page fetches and one model
	// call, so the budget has to be far larger than the old 45 second handler
	// timeout that used to abort research mid-flight.
	specResearchItemTimeout = 150 * time.Second
)

var specResearchJobCreationMu sync.Mutex

// aiSEOSpecJobRequest is the shared scope description for every specification
// research entry point (scope filter, explicit product IDs, single product).
type aiSEOSpecJobRequest struct {
	ProductIDs         []uint `json:"product_ids"`
	Limit              int    `json:"limit"`
	CategoryID         uint   `json:"category_id"`
	IncludeDescendants bool   `json:"include_descendants"`
	Brand              string `json:"brand"`
	Search             string `json:"search"`
	IncludeInactive    bool   `json:"include_inactive"`
	// OnlyMissing skips products that already publish a specification table, so
	// an indexed page is never re-researched by accident.
	OnlyMissing *bool `json:"only_missing"`
	// UseAI adds the language-model extraction pass on top of the deterministic
	// pattern extraction. Model-proposed values still have to appear verbatim in
	// a cited page.
	UseAI *bool `json:"use_ai"`
	// Force re-runs research even when a pending draft already exists.
	Force bool `json:"force"`
}

type aiSEOSpecJobOptions struct {
	OnlyMissing bool `json:"only_missing"`
	UseAI       bool `json:"use_ai"`
	Force       bool `json:"force"`
}

// parsePositiveUintParam reads a positive numeric route parameter.
func parsePositiveUintParam(value string) (uint, error) {
	parsed, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0, err
	}
	if parsed == 0 {
		return 0, fmt.Errorf("%q is not a positive identifier", value)
	}
	return uint(parsed), nil
}

// specResearchScopeRow is the projection used to select work. technical_specs is
// read as text and parsed in Go so the "already has specifications" filter does
// not depend on comparing a JSON column in SQL.
type specResearchScopeRow struct {
	ID             uint
	SKU            string
	Model          string
	PartNumber     string
	TechnicalSpecs string
}

// StartSpecResearchJob queues research for a filtered product scope.
func (ac *AIAgentController) StartSpecResearchJob(c *gin.Context) {
	var req aiSEOSpecJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid specification research request", Error: err.Error()})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}
	job, warning, err := startSpecResearchJob(db, req, optionalBool(req.OnlyMissing, true), c.GetUint("user_id"))
	if err != nil {
		writeSpecResearchStartError(c, err)
		return
	}
	dispatchQueuedAISEOJobsAsync()
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: specResearchStartMessage(warning), Data: job})
}

// StartBatchSpecResearchJob queues research for explicitly selected products.
// It backs the "Research specs" action on the product list.
func (sc *ProductSpecDraftController) StartBatchSpecResearchJob(c *gin.Context) {
	var req aiSEOSpecJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	if len(req.ProductIDs) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Select at least one product"})
		return
	}
	db := config.GetDB()
	job, warning, err := startSpecResearchJob(db, req, optionalBool(req.OnlyMissing, false), currentUserID(c))
	if err != nil {
		writeSpecResearchStartError(c, err)
		return
	}
	dispatchQueuedAISEOJobsAsync()
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: specResearchStartMessage(warning), Data: job})
}

// StartProductSpecResearchJob queues research for one product. It backs the
// button next to the model field on the product form.
func (sc *ProductSpecDraftController) StartProductSpecResearchJob(c *gin.Context) {
	var req aiSEOSpecJobRequest
	_ = c.ShouldBindJSON(&req)
	productID, err := parsePositiveUintParam(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product id"})
		return
	}
	req.ProductIDs = []uint{productID}
	req.Limit = 1
	db := config.GetDB()
	job, warning, err := startSpecResearchJob(db, req, optionalBool(req.OnlyMissing, false), currentUserID(c))
	if err != nil {
		writeSpecResearchStartError(c, err)
		return
	}
	dispatchQueuedAISEOJobsAsync()
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: specResearchStartMessage(warning), Data: job})
}

// startSpecResearchJob resolves the scope, checks that AI research is possible,
// and creates the queued job. The returned warning is non-empty when the caller
// asked for the AI pass but no provider is configured.
func startSpecResearchJob(db *gorm.DB, req aiSEOSpecJobRequest, onlyMissing bool, userID uint) (*models.AIAgentSEOJob, string, error) {
	if db == nil {
		return nil, "", errors.New("database connection failed")
	}
	if !validAISEOJobLimit(req.Limit) || req.Limit > maxSpecResearchJobLimit {
		return nil, "", fmt.Errorf("limit must be between 0 and %d (0 = all)", maxSpecResearchJobLimit)
	}
	opts := aiSEOSpecJobOptions{
		OnlyMissing: onlyMissing,
		UseAI:       optionalBool(req.UseAI, specResearchDefaultAI),
		Force:       req.Force,
	}
	warning := ""
	if opts.UseAI {
		// Resolve provider availability up front: the worker never pauses for a
		// missing AI configuration, it just falls back to deterministic
		// extraction, and the operator is told at start time.
		setting, _, apiKey, err := loadAIAgentConfigWithProfile()
		if err != nil || setting == nil || !setting.Enabled || strings.TrimSpace(apiKey) == "" {
			opts.UseAI = false
			warning = "AI 未配置，任务仅使用可核实的抓取结果 / AI is not configured; deterministic extraction only"
		}
	}

	products, skippedNoModel, err := findSpecResearchCandidates(db, req, opts.OnlyMissing)
	if err != nil {
		return nil, "", err
	}
	if skippedNoModel > 0 {
		// Skipping is friendlier than refusing the whole batch, but it must not
		// be silent: the operator selected those rows.
		note := fmt.Sprintf(
			"%d 个已选产品未填写型号，已跳过 / %d selected product(s) have no model number and were skipped",
			skippedNoModel, skippedNoModel,
		)
		if warning == "" {
			warning = note
		} else {
			warning += " · " + note
		}
	}
	if len(products) == 0 {
		message := "No product with a model number matched the request"
		if opts.OnlyMissing {
			message = "Every matching product already has specifications; nothing left to research"
		}
		return nil, "", errors.New(message)
	}
	prompt, err := encodeAISEOSpecJobOptions(opts)
	if err != nil {
		return nil, "", err
	}
	job, err := createSpecResearchJob(db, products, prompt, userID)
	if err != nil {
		return nil, "", err
	}
	return job, warning, nil
}

func specResearchStartMessage(warning string) string {
	message := "Specification research task started"
	if strings.TrimSpace(warning) != "" {
		message += " · " + warning
	}
	return message
}

func writeSpecResearchStartError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errAISEOProductsPending), errors.Is(err, errAISEOJobCapacity):
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: err.Error()})
	default:
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: err.Error()})
	}
}

// findSpecResearchCandidates selects products that a research job may examine.
// Products without a model or part number are skipped (and counted, so the
// caller can tell the operator) because the whole pipeline is model-number
// driven: there is nothing to look up otherwise.
func findSpecResearchCandidates(db *gorm.DB, req aiSEOSpecJobRequest, onlyMissing bool) ([]aiSEOProductRef, int, error) {
	uniqueIDs := uniqueProductIDs(req.ProductIDs)
	if len(uniqueIDs) > maxAISEOCandidateProducts {
		return nil, 0, fmt.Errorf("choose at most %d unique products", maxAISEOCandidateProducts)
	}
	ids := sortedLimitedProductIDs(uniqueIDs, req.Limit)
	limit := req.Limit
	if limit == 0 {
		limit = -1
	}
	if len(ids) > 0 {
		if limit > len(ids) {
			limit = len(ids)
		}
	}

	// disable_auto_seo is deliberately ignored: it protects generated content,
	// and this task only produces review drafts.
	query := db.Model(&models.Product{}).
		Select("products.id", "products.sku", "products.model", "products.part_number", "products.technical_specs")
	if len(ids) > 0 {
		query = query.Where("products.id IN ?", ids)
	}
	if !req.IncludeInactive {
		query = query.Where("products.is_active = ?", true)
	}
	if req.CategoryID > 0 {
		categoryIDs := []uint{req.CategoryID}
		if req.IncludeDescendants {
			descendants, err := getDescendantCategoryIDs(db, req.CategoryID)
			if err != nil {
				return nil, 0, err
			}
			if len(descendants) > 0 {
				categoryIDs = descendants
			}
		}
		query = query.Where("products.category_id IN ?", categoryIDs)
	}
	if brand := truncateRunes(strings.TrimSpace(req.Brand), 100); brand != "" {
		query = query.Where("LOWER(products.brand) = LOWER(?)", brand)
	}
	if search := truncateRunes(strings.TrimSpace(req.Search), 120); search != "" {
		like := "%" + search + "%"
		query = query.Where("products.sku LIKE ? OR products.name LIKE ? OR products.part_number LIKE ? OR products.model LIKE ?", like, like, like, like)
	}
	pendingIDs := db.Model(&models.AIAgentSEOJobItem{}).
		Select("product_id").
		Where("status IN ?", []string{"queued", "running"})
	query = query.Where("products.id NOT IN (?)", pendingIDs).Order("products.id ASC").Limit(limit)

	var rows []specResearchScopeRow
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	if len(ids) > 0 && len(rows) != len(ids) {
		return nil, 0, errors.New("one or more selected products are missing, inactive, or already belong to another running task")
	}

	products := make([]aiSEOProductRef, 0, len(rows))
	withoutModel := 0
	for _, row := range rows {
		if strings.TrimSpace(row.Model) == "" && strings.TrimSpace(row.PartNumber) == "" {
			withoutModel++
			continue
		}
		if onlyMissing && len(services.ParseTechnicalSpecs(row.TechnicalSpecs)) > 0 {
			continue
		}
		products = append(products, aiSEOProductRef{ID: row.ID, SKU: row.SKU})
	}
	return products, withoutModel, nil
}

func encodeAISEOSpecJobOptions(opts aiSEOSpecJobOptions) (string, error) {
	raw, err := json.Marshal(opts)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	return "Research technical specifications from the model number and queue them for review.\n\n" + aiSEOSpecOptionsMarker + encoded + "]]", nil
}

func decodeAISEOSpecJobOptions(prompt string) (aiSEOSpecJobOptions, error) {
	start := strings.LastIndex(prompt, aiSEOSpecOptionsMarker)
	if start < 0 {
		return aiSEOSpecJobOptions{}, errors.New("specification research options are missing")
	}
	start += len(aiSEOSpecOptionsMarker)
	end := strings.Index(prompt[start:], "]]")
	if end < 0 {
		return aiSEOSpecJobOptions{}, errors.New("specification research options are malformed")
	}
	raw, err := base64.RawURLEncoding.DecodeString(prompt[start : start+end])
	if err != nil {
		return aiSEOSpecJobOptions{}, err
	}
	var opts aiSEOSpecJobOptions
	if err := json.Unmarshal(raw, &opts); err != nil {
		return aiSEOSpecJobOptions{}, err
	}
	return opts, nil
}

func createSpecResearchJob(db *gorm.DB, products []aiSEOProductRef, prompt string, createdByID uint) (*models.AIAgentSEOJob, error) {
	if len(products) == 0 {
		return nil, errors.New("specification research tasks must contain at least one product")
	}
	job := &models.AIAgentSEOJob{
		ID:            uuid.NewString(),
		Prompt:        prompt,
		SelectionMode: aiSEOSpecSelectionMode,
		Status:        "queued",
		Total:         len(products),
		CreatedByID:   createdByID,
	}
	items := make([]models.AIAgentSEOJobItem, 0, len(products))
	for _, product := range products {
		items = append(items, models.AIAgentSEOJobItem{JobID: job.ID, ProductID: product.ID, SKU: product.SKU, Status: "queued"})
	}
	specResearchJobCreationMu.Lock()
	defer specResearchJobCreationMu.Unlock()
	if err := db.Transaction(func(tx *gorm.DB) error {
		setting, err := getAIAgentSettingForUpdate(tx)
		if err != nil {
			return err
		}
		profile, err := getActiveAIAgentProfileForUpdate(tx, setting)
		if err != nil {
			return err
		}
		pinAIAgentSEOJobProfile(job, setting, profile)
		if err := ensureAISEOJobCapacity(tx, aiSEOSpecSelectionMode); err != nil {
			return err
		}
		if err := ensureNoPendingAISEOProducts(tx, products); err != nil {
			return err
		}
		if err := tx.Create(job).Error; err != nil {
			return err
		}
		return tx.CreateInBatches(&items, 500).Error
	}); err != nil {
		return nil, err
	}
	return job, nil
}

func processSpecResearchJob(jobID, workerToken, prompt string) {
	db := config.GetDB()
	opts, err := decodeAISEOSpecJobOptions(prompt)
	if err != nil {
		failQueuedSpecResearchItems(jobID, err.Error())
		finishAIAgentSEOJob(jobID, workerToken, "failed", err.Error())
		return
	}
	// The language-model pass is optional; deterministic extraction always runs.
	var llmSetting *models.AIAgentSetting
	llmAPIKey := ""
	profileID, profileErr := loadAIAgentSEOJobProfileID(db, jobID)
	if profileErr == nil {
		if setting, _, apiKey, configErr := loadAIAgentConfigForProfile(profileID); configErr == nil && setting.Enabled && apiKey != "" {
			llmSetting = setting
			llmAPIKey = apiKey
		}
	}
	var job models.AIAgentSEOJob
	createdByID := uint(0)
	if err := db.Select("created_by_id").First(&job, "id = ?", jobID).Error; err == nil {
		createdByID = job.CreatedByID
	}

	work := make(chan models.AIAgentSEOJobItem)
	var wg sync.WaitGroup
	for index := 0; index < maxSpecResearchWorkers; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range work {
				processSpecResearchItem(context.Background(), jobID, workerToken, item, opts, llmSetting, llmAPIKey, createdByID)
			}
		}()
	}
	streamErr := streamAISEOItems(db, jobID, workerToken, work)
	close(work)
	wg.Wait()
	if streamErr != nil {
		finishAIAgentSEOJob(jobID, workerToken, "paused", "Queue read failed; resume after checking database")
		return
	}
	if !isAISEOJobRunning(db, jobID, workerToken) {
		return
	}
	// Drafts are private: there is no public cache to invalidate and no URL to
	// submit. finalizeDraftJob moves the job to its terminal status and the admin
	// UI refreshes the review queue.
	if _, err := finalizeDraftJob(db, jobID, workerToken, nil, "Specification research item did not reach a terminal state"); err != nil {
		finishAIAgentSEOJob(jobID, workerToken, "failed", "Could not finalize specification research task: "+err.Error())
	}
}

// processSpecResearchItem researches one product and stores the review draft.
func processSpecResearchItem(ctx context.Context, jobID, workerToken string, item models.AIAgentSEOJobItem, opts aiSEOSpecJobOptions, llmSetting *models.AIAgentSetting, llmAPIKey string, userID uint) {
	db := config.GetDB()
	if !isAISEOJobRunning(db, jobID, workerToken) {
		return
	}
	claim := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", item.ID, "queued").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status = ? AND worker_token = ?)", jobID, "running", workerToken).
		Update("status", "running")
	if claim.Error != nil || claim.RowsAffected == 0 {
		return
	}

	var product models.Product
	if err := db.First(&product, item.ProductID).Error; err != nil {
		failSpecResearchItem(jobID, workerToken, item, err)
		return
	}
	setAISEOItemProgress(db, item.ID, "按型号检索参数 / researching specifications")

	researchCtx, cancel := context.WithTimeout(ctx, specResearchItemTimeout)
	defer cancel()
	draft, reused, err := buildAndStoreSpecDraft(researchCtx, specDraftInput{
		Product:   &product,
		Brand:     product.Brand,
		Model:     specFirstNonEmpty(product.Model, product.PartNumber, product.SKU),
		SKU:       product.SKU,
		UseAI:     &opts.UseAI,
		Force:     opts.Force,
		UserID:    userID,
		JobID:     jobID,
		AISetting: llmSetting,
		AIAPIKey:  llmAPIKey,
	})
	if err != nil {
		failSpecResearchItem(jobID, workerToken, item, err)
		return
	}

	payload := services.DecodeSpecDraftPayload(draft.CandidatesJSON)
	conflicts := 0
	for _, candidate := range payload.Candidates {
		if candidate.Conflict {
			conflicts++
		}
	}
	evidence := specResearchItemPayload{
		DraftID:    draft.ID,
		Candidates: len(payload.Candidates),
		Confidence: draft.Confidence,
		Conflicts:  conflicts,
		Reused:     reused,
	}
	encoded, marshalErr := json.Marshal(evidence)
	if marshalErr != nil {
		encoded = []byte("{}")
	}

	if len(payload.Candidates) == 0 {
		// A reachable page that names the model but lists no parameter is a real
		// (and useful) outcome: the operator types the values in by hand instead
		// of the pipeline inventing them.
		dbResult := db.Model(&models.AIAgentSEOJobItem{}).
			Where("id = ? AND status = ?", item.ID, "running").
			Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status IN ? AND worker_token = ?)", jobID, []string{"running", "paused"}, workerToken).
			Updates(map[string]any{
				"status":        "unresolved",
				"error":         "未找到可核实参数 / no verifiable parameter found in the reachable pages",
				"evidence_json": string(encoded),
			})
		if dbResult.Error == nil && dbResult.RowsAffected > 0 {
			db.Model(&models.AIAgentSEOJob{}).Where("id = ?", jobID).
				Updates(map[string]any{"processed": gorm.Expr("processed + 1"), "unresolved": gorm.Expr("unresolved + 1")})
		}
		return
	}

	summary := fmt.Sprintf("%d 参数待审核 / %d parameter(s) pending review (%s)", len(payload.Candidates), len(payload.Candidates), specFirstNonEmpty(draft.Confidence, "low"))
	if reused {
		summary += " · 已复用待审核草稿 / existing pending draft reused"
	}
	if conflicts > 0 {
		summary += fmt.Sprintf(" · %d 处来源冲突待人工确认 / %d conflicting value(s) need a decision", conflicts, conflicts)
	}
	dbResult := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", item.ID, "running").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status IN ? AND worker_token = ?)", jobID, []string{"running", "paused"}, workerToken).
		Updates(map[string]any{
			"status":        "optimized",
			"error":         truncateRunes(summary, 1000),
			"evidence_json": string(encoded),
		})
	if dbResult.Error == nil && dbResult.RowsAffected > 0 {
		incrementAIAgentSEOJob(jobID, true)
	}
}

// specResearchItemPayload is what the job item detail shows for a completed
// product: which draft to open and how much review it needs.
type specResearchItemPayload struct {
	DraftID    uint   `json:"draft_id"`
	Candidates int    `json:"candidates"`
	Confidence string `json:"confidence,omitempty"`
	Conflicts  int    `json:"conflicts,omitempty"`
	Reused     bool   `json:"reused,omitempty"`
}

func failSpecResearchItem(jobID, workerToken string, item models.AIAgentSEOJobItem, err error) {
	if isAISEOJobCancelled(config.GetDB(), jobID) {
		return
	}
	message := truncateRunes(err.Error(), 1000)
	db := config.GetDB()
	result := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", item.ID, "running").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status IN ? AND worker_token = ?)", jobID, []string{"running", "paused"}, workerToken).
		Updates(map[string]any{"status": "failed", "error": message})
	if result.Error == nil && result.RowsAffected > 0 {
		incrementAIAgentSEOJob(jobID, false)
	}
}

func failQueuedSpecResearchItems(jobID, message string) {
	db := config.GetDB()
	message = truncateRunes(message, 1000)
	var count int64
	if err := db.Model(&models.AIAgentSEOJobItem{}).
		Where("job_id = ? AND status = ?", jobID, "queued").Count(&count).Error; err != nil || count == 0 {
		return
	}
	if err := db.Model(&models.AIAgentSEOJobItem{}).
		Where("job_id = ? AND status = ?", jobID, "queued").
		Updates(map[string]any{"status": "failed", "error": message}).Error; err != nil {
		return
	}
	_ = db.Model(&models.AIAgentSEOJob{}).Where("id = ?", jobID).
		Updates(map[string]any{"processed": gorm.Expr("processed + ?", count), "failed": gorm.Expr("failed + ?", count)}).Error
}

// jobRequeuesRunningItemsOnResume reports whether a job type owns work that an
// in-flight worker may still be finishing when the job is paused and resumed.
// Content jobs own product fields and are never requeued; draft-writing jobs
// (category optimization, specification research, product identification) can
// safely redo an item whose result was never applied.
func jobRequeuesRunningItemsOnResume(db *gorm.DB, jobID string) (bool, error) {
	var job models.AIAgentSEOJob
	if err := db.Select("selection_mode").First(&job, "id = ?", jobID).Error; err != nil {
		return false, err
	}
	return job.SelectionMode == aiSEOCategorySelectionMode ||
		job.SelectionMode == aiSEOSpecSelectionMode ||
		job.SelectionMode == aiSEOIdentificationSelectionMode, nil
}

// finalizeDraftJob atomically releases residual items and closes a job that only
// ever wrote review rows. Category optimization, specification research and
// product identification differ only in the residual item summary.
func finalizeDraftJob(db *gorm.DB, jobID, workerToken string, workerErrors []string, leftoverSummary string) (bool, error) {
	finished := false
	err := db.Transaction(func(tx *gorm.DB) error {
		var job models.AIAgentSEOJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("status", "worker_token").First(&job, "id = ?", jobID).Error; err != nil {
			return err
		}
		if job.Status != "running" || job.WorkerToken != workerToken {
			return nil
		}

		summary := leftoverSummary
		if len(workerErrors) > 0 {
			summary = truncateRunes(strings.Join(workerErrors, "; "), 1000)
		}
		sweep := tx.Model(&models.AIAgentSEOJobItem{}).
			Where("job_id = ? AND status IN ?", jobID, []string{"queued", "running"}).
			Updates(map[string]any{"status": "failed", "error": summary})
		if sweep.Error != nil {
			return sweep.Error
		}

		count := func(status string) (int64, error) {
			var total int64
			err := tx.Model(&models.AIAgentSEOJobItem{}).Where("job_id = ? AND status = ?", jobID, status).Count(&total).Error
			return total, err
		}
		succeeded, err := count("optimized")
		if err != nil {
			return err
		}
		failed, err := count("failed")
		if err != nil {
			return err
		}
		unresolved, err := count("unresolved")
		if err != nil {
			return err
		}
		status := "completed"
		jobError := ""
		if failed > 0 {
			status = "completed_with_errors"
			if len(workerErrors) > 0 || sweep.RowsAffected > 0 {
				jobError = summary
			}
		}
		completedAt := time.Now().UTC()
		result := tx.Model(&models.AIAgentSEOJob{}).
			Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
			Updates(map[string]any{
				"status":       status,
				"error":        jobError,
				"processed":    succeeded + failed + unresolved,
				"succeeded":    succeeded,
				"failed":       failed,
				"unresolved":   unresolved,
				"completed_at": &completedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		finished = result.RowsAffected > 0
		return nil
	})
	return finished, err
}
