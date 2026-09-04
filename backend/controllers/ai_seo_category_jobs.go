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

const (
	aiSEOCategorySelectionMode = "category_optimization"
	aiSEOCategoryOptionsMarker = "[[VIBOCNC_CATEGORY_JOB_OPTIONS="
)

var categoryOptimizationJobCreationMu sync.Mutex

type aiSEOCategoryJobRequest struct {
	ProductIDs              []uint `json:"product_ids"`
	Limit                   int    `json:"limit"`
	CategoryID              uint   `json:"category_id"`
	IncludeDescendants      bool   `json:"include_descendants"`
	Brand                   string `json:"brand"`
	Search                  string `json:"search"`
	IncludeInactive         bool   `json:"include_inactive"`
	Status                  string `json:"status"`
	Featured                string `json:"featured"`
	AISEOStatus             string `json:"ai_seo_status"`
	UseWebSearch            *bool  `json:"use_web_search"`
	CreateMissingCategories *bool  `json:"create_missing_categories"`
	ActivateResolved        *bool  `json:"activate_resolved"`
	UseLLMFallback          *bool  `json:"use_llm_fallback"`
	RepairContent           *bool  `json:"repair_content"`
	// ReworkOnly replaces the filter selection with the classification audit:
	// only products that are misplaced, uncategorized, unresolved-inactive, or
	// AI-SEO-failed are queued.
	ReworkOnly bool `json:"rework_only"`
}

type aiSEOCategoryJobOptions struct {
	UseWebSearch            bool `json:"use_web_search"`
	CreateMissingCategories bool `json:"create_missing_categories"`
	ActivateResolved        bool `json:"activate_resolved"`
	UseLLMFallback          bool `json:"use_llm_fallback"`
	RepairContent           bool `json:"repair_content"`
}

// StartCategoryOptimizationJob creates a taxonomy task in the existing AI job
// queue. Ordinary category runs remain category-only; rework runs can opt into
// a second AI content-quality pass after the category is verified.
func (ac *AIAgentController) StartCategoryOptimizationJob(c *gin.Context) {
	var req aiSEOCategoryJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid category optimization request", Error: err.Error()})
		return
	}
	if !validAISEOJobLimit(req.Limit) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Category optimization limit must be between 1 and 30000"})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}
	opts := aiSEOCategoryJobOptions{
		UseWebSearch:            optionalBool(req.UseWebSearch, true),
		CreateMissingCategories: optionalBool(req.CreateMissingCategories, true),
		ActivateResolved:        optionalBool(req.ActivateResolved, true),
		UseLLMFallback:          optionalBool(req.UseLLMFallback, true),
		RepairContent:           optionalBool(req.RepairContent, req.ReworkOnly),
	}
	if opts.RepairContent {
		setting, _, apiKey, configErr := loadAIAgentConfigWithProfile()
		if configErr != nil || !setting.Enabled || apiKey == "" {
			message := "AI assistant must be configured and enabled before product descriptions can be repaired"
			if configErr != nil {
				message = "AI settings could not be read: " + configErr.Error()
			}
			c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: message})
			return
		}
	}

	products, err := findCategoryOptimizationCandidates(db, req, opts.RepairContent)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to select category optimization products", Error: err.Error()})
		return
	}
	if len(products) == 0 {
		message := "No products matched the requested category optimization scope"
		if req.ReworkOnly {
			message = "The classification audit found no products that need rework"
		}
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: message})
		return
	}

	prompt, err := encodeAISEOCategoryJobOptions(opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to prepare category optimization task", Error: err.Error()})
		return
	}
	job, err := createCategoryOptimizationJob(db, products, prompt, c.GetUint("user_id"))
	if err != nil {
		if errors.Is(err, errAISEOProductsPending) || errors.Is(err, errAISEOJobCapacity) {
			c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to create category optimization task", Error: err.Error()})
		return
	}
	go processAIAgentSEOJob(job.ID)
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "Category optimization task started", Data: job})
}

func optionalBool(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func findCategoryOptimizationCandidates(db *gorm.DB, req aiSEOCategoryJobRequest, repairContent bool) ([]models.Product, error) {
	if req.ReworkOnly {
		return findCategoryReworkCandidates(db, req.Limit, repairContent)
	}
	uniqueIDs := uniqueProductIDs(req.ProductIDs)
	if len(uniqueIDs) > maxAISEOCandidateProducts {
		return nil, errors.New("choose at most 30000 unique products")
	}
	ids := sortedLimitedProductIDs(uniqueIDs, req.Limit)
	limit := req.Limit
	if len(ids) > 0 {
		if limit > len(ids) {
			limit = len(ids)
		}
	}

	query := db.Model(&models.Product{}).Select("products.id", "products.sku")
	if len(ids) > 0 {
		query = query.Where("products.id IN ?", ids)
	}
	query = applyCategoryOptimizationProductStatus(query, req.Status, req.IncludeInactive)
	switch strings.ToLower(strings.TrimSpace(req.Featured)) {
	case "true", "1", "featured":
		query = query.Where("products.is_featured = ?", true)
	case "false", "0", "not_featured":
		query = query.Where("products.is_featured = ?", false)
	}
	if req.CategoryID > 0 {
		categoryIDs := []uint{req.CategoryID}
		if req.IncludeDescendants {
			descendants, err := getDescendantCategoryIDs(db, req.CategoryID)
			if err != nil {
				return nil, err
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
		query = query.Where("products.sku LIKE ? OR products.name LIKE ? OR products.description LIKE ? OR products.part_number LIKE ? OR products.model LIKE ?", like, like, like, like, like)
	}
	switch strings.ToLower(strings.TrimSpace(req.AISEOStatus)) {
	case "optimized":
		query = query.Where("products.ai_seo_status = ?", "optimized")
	case "not_optimized":
		query = query.Where("products.ai_seo_status IS NULL OR products.ai_seo_status = ''")
	case "running":
		query = query.Where("products.ai_seo_status = ?", "running")
	case "failed":
		query = query.Where("products.ai_seo_status = ?", "failed")
	}
	pendingIDs := db.Model(&models.AIAgentSEOJobItem{}).
		Select("product_id").
		Where("status IN ?", []string{"queued", "running"})
	query = query.Where("products.id NOT IN (?)", pendingIDs).
		Order("products.id ASC").
		Limit(limit)

	var products []models.Product
	if err := query.Find(&products).Error; err != nil {
		return nil, err
	}
	if len(ids) > 0 && len(products) != len(ids) {
		return nil, errors.New("one or more selected products are inactive, missing, or already belong to another running task")
	}
	return products, nil
}

// findCategoryReworkCandidates turns the classification audit into a job
// selection. The audit already skips products held by queued or running job
// items, so the returned list can always be enqueued.
func findCategoryReworkCandidates(db *gorm.DB, limit int, repairContent bool) ([]models.Product, error) {
	var audit *services.ProductClassificationAuditResult
	var err error
	if repairContent {
		audit, err = services.AuditProductRework(db, limit)
	} else {
		audit, err = services.AuditProductClassifications(db, limit)
	}
	if err != nil {
		return nil, err
	}
	if len(audit.ProductIDs) == 0 {
		return nil, nil
	}
	products := make([]models.Product, 0, len(audit.ProductIDs))
	for start := 0; start < len(audit.ProductIDs); start += 1000 {
		end := start + 1000
		if end > len(audit.ProductIDs) {
			end = len(audit.ProductIDs)
		}
		var batch []models.Product
		if err := db.Model(&models.Product{}).
			Select("products.id", "products.sku").
			Where("products.id IN ?", audit.ProductIDs[start:end]).
			Order("products.id ASC").
			Find(&batch).Error; err != nil {
			return nil, err
		}
		products = append(products, batch...)
	}
	return products, nil
}

func applyCategoryOptimizationProductStatus(query *gorm.DB, status string, includeInactive bool) *gorm.DB {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active":
		return query.Where("products.is_active = ?", true)
	case "inactive":
		return query.Where("products.is_active = ?", false)
	case "all":
		return query
	default:
		if !includeInactive {
			return query.Where("products.is_active = ?", true)
		}
		return query
	}
}

func encodeAISEOCategoryJobOptions(opts aiSEOCategoryJobOptions) (string, error) {
	raw, err := json.Marshal(opts)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	return "Automatically verify and optimize product categories by brand and product type.\n\n" + aiSEOCategoryOptionsMarker + encoded + "]]", nil
}

func decodeAISEOCategoryJobOptions(prompt string) (aiSEOCategoryJobOptions, error) {
	start := strings.LastIndex(prompt, aiSEOCategoryOptionsMarker)
	if start < 0 {
		return aiSEOCategoryJobOptions{}, errors.New("category optimization options are missing")
	}
	start += len(aiSEOCategoryOptionsMarker)
	end := strings.Index(prompt[start:], "]]")
	if end < 0 {
		return aiSEOCategoryJobOptions{}, errors.New("category optimization options are malformed")
	}
	raw, err := base64.RawURLEncoding.DecodeString(prompt[start : start+end])
	if err != nil {
		return aiSEOCategoryJobOptions{}, err
	}
	var opts aiSEOCategoryJobOptions
	if err := json.Unmarshal(raw, &opts); err != nil {
		return aiSEOCategoryJobOptions{}, err
	}
	return opts, nil
}

func createCategoryOptimizationJob(db *gorm.DB, products []models.Product, prompt string, createdByID uint) (*models.AIAgentSEOJob, error) {
	if len(products) == 0 || len(products) > maxAISEOCandidateProducts {
		return nil, errors.New("category optimization jobs must contain between 1 and 30000 products")
	}
	job := &models.AIAgentSEOJob{
		ID:            uuid.NewString(),
		Prompt:        prompt,
		SelectionMode: aiSEOCategorySelectionMode,
		Status:        "queued",
		Total:         len(products),
		CreatedByID:   createdByID,
	}
	items := make([]models.AIAgentSEOJobItem, 0, len(products))
	for _, product := range products {
		items = append(items, models.AIAgentSEOJobItem{JobID: job.ID, ProductID: product.ID, SKU: product.SKU, Status: "queued"})
	}
	categoryOptimizationJobCreationMu.Lock()
	defer categoryOptimizationJobCreationMu.Unlock()
	if err := db.Transaction(func(tx *gorm.DB) error {
		// Lock the same singleton database row used by ordinary AI SEO job
		// creation so overlap checks are serialized across server processes.
		setting, err := getAIAgentSettingForUpdate(tx)
		if err != nil {
			return err
		}
		// Pin the profile chosen at creation so the LLM fallback keeps using
		// the same provider even if the administrator switches later.
		job.AIProfileID = setting.ActiveProfileID
		if err := ensureAISEOJobCapacity(tx, aiSEOCategorySelectionMode); err != nil {
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

func processCategoryOptimizationJob(jobID, workerToken, prompt string) {
	db := config.GetDB()
	opts, err := decodeAISEOCategoryJobOptions(prompt)
	if err != nil {
		failQueuedCategoryOptimizationItems(jobID, err.Error())
		finishAIAgentSEOJob(jobID, workerToken, "failed", err.Error())
		return
	}
	// The LLM fallback is optional: category jobs still run rules + web
	// verification when no AI profile is configured or the assistant is off.
	var llmSetting *models.AIAgentSetting
	llmAPIKey := ""
	if opts.UseLLMFallback || opts.RepairContent {
		profileID, profileErr := loadAIAgentSEOJobProfileID(db, jobID)
		if profileErr == nil {
			if setting, _, apiKey, configErr := loadAIAgentConfigForProfile(profileID); configErr == nil && setting.Enabled && apiKey != "" {
				llmSetting = setting
				llmAPIKey = apiKey
			}
		}
	}
	var items []models.AIAgentSEOJobItem
	if err := db.Where("job_id = ? AND status = ?", jobID, "queued").Order("id ASC").Find(&items).Error; err != nil {
		finishAIAgentSEOJob(jobID, workerToken, "failed", err.Error())
		return
	}
	workers := minInt(maxAutoCategoryOptimizationWorkers, len(items))
	workerErrors := make(chan error, workers)
	if workers > 0 {
		work := make(chan models.AIAgentSEOJobItem)
		var wg sync.WaitGroup
		for index := 0; index < workers; index++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for item := range work {
					if err := processCategoryOptimizationItem(context.Background(), jobID, workerToken, item, opts, llmSetting, llmAPIKey); err != nil {
						select {
						case workerErrors <- err:
						default:
						}
					}
				}
			}()
		}
		for index, item := range items {
			if index%aiSEOPauseCheckInterval == 0 && !isAISEOJobRunning(db, jobID, workerToken) {
				break
			}
			work <- item
		}
		close(work)
		wg.Wait()
	}
	close(workerErrors)
	if !isAISEOJobRunning(db, jobID, workerToken) {
		return
	}
	errorMessages := make([]string, 0, workers)
	for workerErr := range workerErrors {
		errorMessages = append(errorMessages, workerErr.Error())
	}
	finished, err := finalizeCategoryOptimizationJob(db, jobID, workerToken, errorMessages)
	if err != nil {
		finishAIAgentSEOJob(jobID, workerToken, "failed", "Could not finalize category task: "+err.Error())
		return
	}
	if finished {
		publishAIAgentSEOJobCompletion(jobID)
	}
}

func processCategoryOptimizationItem(ctx context.Context, jobID, workerToken string, item models.AIAgentSEOJobItem, opts aiSEOCategoryJobOptions, llmSetting *models.AIAgentSetting, llmAPIKey string) error {
	db := config.GetDB()
	if !isAISEOJobRunning(db, jobID, workerToken) {
		return nil
	}
	claim := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", item.ID, "queued").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status = ? AND worker_token = ?)", jobID, "running", workerToken).
		Update("status", "running")
	if claim.Error != nil {
		return fmt.Errorf("failed to claim category task item %d: %w", item.ID, claim.Error)
	}
	if claim.RowsAffected == 0 {
		return nil
	}
	var product models.Product
	if err := db.Preload("Category").First(&product, item.ProductID).Error; err != nil {
		failCategoryOptimizationItem(jobID, workerToken, item, err)
		return nil
	}
	serviceOpts := services.ProductCategoryOptimizationOptions{
		UseWebSearch:            opts.UseWebSearch,
		CreateMissingCategories: opts.CreateMissingCategories,
		ActivateResolved:        opts.ActivateResolved,
		BeforeWrite: func(tx *gorm.DB) error {
			var job models.AIAgentSEOJob
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("status", "worker_token").First(&job, "id = ?", jobID).Error; err != nil {
				return err
			}
			if job.WorkerToken != workerToken || (job.Status != "running" && job.Status != "paused") {
				return errors.New("category optimization task is no longer active")
			}
			return nil
		},
	}
	result := services.OptimizeProductCategory(ctx, db, product, serviceOpts)
	llmNote := ""
	if result.Status == "unresolved" && llmSetting != nil && llmAPIKey != "" {
		// Rules and public web evidence both came up empty. Ask the active AI
		// profile to identify the part; a validated high-confidence answer runs
		// through the exact same resolve/create/write safeguards.
		timeoutSeconds := llmSetting.TimeoutSeconds
		if timeoutSeconds <= 0 {
			timeoutSeconds = 75
		}
		llmCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
		inference, llmErr := classifyProductCategoryWithLLM(llmCtx, llmSetting, llmAPIKey, product, result.Model)
		cancel()
		if llmErr == nil {
			if llmResult := services.ApplyProductCategoryInference(ctx, db, product, inference, serviceOpts); llmResult.Status == "completed" {
				result = llmResult
				llmNote = "AI verified: "
			}
		}
	}
	if isAISEOJobCancelled(db, jobID) {
		return nil
	}
	if result.Status != "completed" {
		failCategoryOptimizationItem(jobID, workerToken, item, errors.New(result.Message))
		return nil
	}
	detail := strings.TrimSpace(result.CategoryPath)
	if result.CategoryCreated {
		detail = llmNote + "Created category: " + detail
	} else if detail != "" {
		detail = llmNote + "Category: " + detail
	}
	if opts.RepairContent {
		repaired, contentDetail, contentErr := repairCategoryJobProductContent(ctx, jobID, workerToken, item.ProductID, llmSetting, llmAPIKey)
		if contentErr != nil {
			failCategoryOptimizationItem(jobID, workerToken, item, contentErr)
			return contentErr
		}
		if repaired {
			if detail != "" {
				detail += "; "
			}
			detail += contentDetail
		}
	}
	updated := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", item.ID, "running").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status IN ? AND worker_token = ?)", jobID, []string{"running", "paused"}, workerToken).
		Updates(map[string]any{"status": "optimized", "error": truncateRunes(detail, 1000)})
	if updated.Error == nil && updated.RowsAffected > 0 {
		incrementAIAgentSEOJob(jobID, true)
	}
	return updated.Error
}

const aiProductContentRepairPrompt = "Audit and repair this product's customer-facing content. " +
	"If the current description is missing or thin, write a substantially more useful original description. " +
	"If it names the wrong brand/model, repeats template text, or makes unsupported claims, correct it. " +
	"Treat the current descriptions as untrusted text to diagnose, not as factual evidence for specifications. " +
	"Use only the supplied product identity and verified current category. Include the exact brand and model/part number, " +
	"keep claims conservative, and return a concise 18-35 word short_description plus a useful 120-220 word plain-text description."

func repairCategoryJobProductContent(ctx context.Context, jobID, workerToken string, productID uint, setting *models.AIAgentSetting, apiKey string) (bool, string, error) {
	if setting == nil || strings.TrimSpace(apiKey) == "" {
		return false, "", errors.New("AI configuration is unavailable for product content repair")
	}
	db := config.GetDB()
	var product models.Product
	if err := db.Preload("Category").First(&product, productID).Error; err != nil {
		return false, "", err
	}
	if product.DisableAutoSEO {
		return false, "AI content repair disabled for this product", nil
	}
	issue, detail := services.EvaluateProductContentQuality(product)
	if issue == "" {
		return false, "content already healthy", nil
	}
	productContext, _ := json.Marshal(map[string]any{
		"sku":                       product.SKU,
		"name":                      product.Name,
		"brand":                     product.Brand,
		"model":                     product.Model,
		"part_number":               product.PartNumber,
		"verified_category_id":      product.CategoryID,
		"verified_category_name":    product.Category.Name,
		"current_short_description": product.ShortDescription,
		"current_description":       truncateRunes(product.Description, 6000),
		"content_quality_issue":     issue,
		"content_quality_detail":    detail,
	})
	prompt := applyAISEOFocusToPrompt(aiProductContentRepairPrompt, []string{"content"})
	messages := []aiChatMessage{
		{Role: "system", Content: aiSEOSystemPrompt},
		{Role: "user", Content: "ADMINISTRATOR_SEO_INSTRUCTION:\n" + prompt + "\n\nPRODUCT_REFERENCE:\n" + string(productContext)},
	}
	aiSEOProviderSlots <- struct{}{}
	output, err := requestAIAgentSEOOutput(ctx, setting, apiKey, messages, 2200)
	<-aiSEOProviderSlots
	if err != nil {
		return false, "", err
	}
	output = completeAISEOOutput(output, product)
	proposed := product
	proposed.ShortDescription = output.ShortDescription
	proposed.Description = output.Description
	if remainingIssue, remainingDetail := services.EvaluateProductContentQuality(proposed); remainingIssue != "" {
		return false, "", fmt.Errorf("AI content still fails quality check (%s): %s", remainingIssue, remainingDetail)
	}
	now := time.Now().UTC()
	err = db.Transaction(func(tx *gorm.DB) error {
		var job models.AIAgentSEOJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("status", "worker_token").First(&job, "id = ?", jobID).Error; err != nil {
			return err
		}
		if job.WorkerToken != workerToken || (job.Status != "running" && job.Status != "paused") {
			return errors.New("category optimization task is no longer active")
		}
		return tx.Model(&models.Product{}).Where("id = ?", productID).Updates(map[string]any{
			"short_description": output.ShortDescription,
			"description":       output.Description,
			"last_optimized_at": &now,
			"updated_at":        &now,
		}).Error
	})
	if err != nil {
		return false, "", err
	}
	return true, "product description repaired (" + issue + ")", nil
}

// finalizeCategoryOptimizationJob atomically releases every residual item and
// closes the job. A claim/update failure therefore remains auditable but can
// never leave queued/running product IDs permanently excluded from later jobs.
func finalizeCategoryOptimizationJob(db *gorm.DB, jobID, workerToken string, workerErrors []string) (bool, error) {
	finished := false
	err := db.Transaction(func(tx *gorm.DB) error {
		var job models.AIAgentSEOJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("status", "worker_token").First(&job, "id = ?", jobID).Error; err != nil {
			return err
		}
		if job.Status != "running" || job.WorkerToken != workerToken {
			return nil
		}

		summary := "Category task item did not reach a terminal state"
		if len(workerErrors) > 0 {
			summary = truncateRunes(strings.Join(workerErrors, "; "), 1000)
		}
		sweep := tx.Model(&models.AIAgentSEOJobItem{}).
			Where("job_id = ? AND status IN ?", jobID, []string{"queued", "running"}).
			Updates(map[string]any{"status": "failed", "error": summary})
		if sweep.Error != nil {
			return sweep.Error
		}

		var succeeded int64
		if err := tx.Model(&models.AIAgentSEOJobItem{}).Where("job_id = ? AND status = ?", jobID, "optimized").Count(&succeeded).Error; err != nil {
			return err
		}
		var failed int64
		if err := tx.Model(&models.AIAgentSEOJobItem{}).Where("job_id = ? AND status = ?", jobID, "failed").Count(&failed).Error; err != nil {
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
				"processed":    succeeded + failed,
				"succeeded":    succeeded,
				"failed":       failed,
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

func failCategoryOptimizationItem(jobID, workerToken string, item models.AIAgentSEOJobItem, err error) {
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

func failQueuedCategoryOptimizationItems(jobID, message string) {
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

func authorizeCategoryJobControl(c *gin.Context, db *gorm.DB, jobID string) bool {
	var job models.AIAgentSEOJob
	if err := db.Select("id", "selection_mode").First(&job, "id = ?", jobID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "AI SEO job not found"})
		return false
	}
	if job.SelectionMode == aiSEOCategorySelectionMode && !isAdminRequest(c) {
		c.JSON(http.StatusForbidden, models.APIResponse{Success: false, Message: "Only administrators can control category optimization tasks"})
		return false
	}
	return true
}

func isCategoryOptimizationJob(db *gorm.DB, jobID string) (bool, error) {
	var job models.AIAgentSEOJob
	if err := db.Select("selection_mode").First(&job, "id = ?", jobID).Error; err != nil {
		return false, err
	}
	return job.SelectionMode == aiSEOCategorySelectionMode, nil
}

// ListSEOJobItems pages large task details without loading up to 30,000 item
// records into one response. The existing job detail endpoint returns only the
// first bounded page for backwards compatibility.
func (ac *AIAgentController) ListSEOJobItems(c *gin.Context) {
	db := config.GetDB()
	jobID := c.Param("id")
	var job models.AIAgentSEOJob
	if err := db.Select("id", "selection_mode").First(&job, "id = ?", jobID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "AI SEO job not found"})
		return
	}
	if job.SelectionMode == aiSEOCategorySelectionMode && !isAdminRequest(c) {
		c.JSON(http.StatusForbidden, models.APIResponse{Success: false, Message: "Only administrators can view category optimization task items"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	if limit < 1 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}
	query := db.Model(&models.AIAgentSEOJobItem{}).Where("job_id = ?", jobID)
	if status := strings.ToLower(strings.TrimSpace(c.Query("status"))); status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to count task items", Error: err.Error()})
		return
	}
	var items []models.AIAgentSEOJobItem
	if err := query.Order("id ASC").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load task items", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{"items": items, "total": total, "limit": limit, "offset": offset}})
}

func isAdminRequest(c *gin.Context) bool {
	role, exists := c.Get("role")
	return exists && role == "admin"
}
