package controllers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
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

var listingJobCreationMu sync.Mutex

type aiListingJobRequest struct {
	ProductIDs         []uint `json:"product_ids"`
	Limit              int    `json:"limit"`
	CategoryID         uint   `json:"category_id"`
	IncludeDescendants bool   `json:"include_descendants"`
	Brand              string `json:"brand"`
	Search             string `json:"search"`
	Status             string `json:"status"`
	Featured           string `json:"featured"`
	AISEOStatus        string `json:"ai_seo_status"`
	FailedOnly         bool   `json:"failed_only"`
	Force              bool   `json:"force"`
	CreateCategories   *bool  `json:"create_categories"`
	UseWebSearch       *bool  `json:"use_web_search"`
	ActivateResolved   bool   `json:"activate_resolved"`
	Instruction        string `json:"instruction"`
}

type aiListingJobOptions struct {
	Force            bool   `json:"force"`
	CreateCategories bool   `json:"create_categories"`
	UseWebSearch     bool   `json:"use_web_search"`
	ActivateResolved bool   `json:"activate_resolved"`
	Instruction      string `json:"instruction,omitempty"`
}

// StartListingJob queues the unified AI optimization: every product is checked
// first and only incomplete or weak listings are researched and rewritten.
func (ac *AIAgentController) StartListingJob(c *gin.Context) {
	var req aiListingJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	if req.Limit < 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "数量不能为负数（0 表示全部）"})
		return
	}
	if _, _, ok := requireListingAIConfig(c); !ok {
		return
	}
	db := config.GetDB()
	products, err := findListingJobCandidates(db, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: err.Error()})
		return
	}
	if len(products) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "当前范围内没有可处理的产品（可能都在其他任务中排队）"})
		return
	}
	opts := aiListingJobOptions{
		Force:            req.Force,
		CreateCategories: optionalBool(req.CreateCategories, true),
		UseWebSearch:     optionalBool(req.UseWebSearch, true),
		ActivateResolved: req.ActivateResolved,
		Instruction:      truncateRunes(strings.TrimSpace(req.Instruction), 2000),
	}
	prompt, err := encodeAIListingJobOptions(opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to encode job options", Error: err.Error()})
		return
	}
	job, err := createListingJob(db, products, prompt, c.GetUint("user_id"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errAISEOProductsPending) || errors.Is(err, errAISEOJobCapacity) {
			status = http.StatusConflict
		}
		c.JSON(status, models.APIResponse{Success: false, Message: err.Error()})
		return
	}
	dispatchQueuedAISEOJobsAsync()
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "AI 智能优化任务已创建", Data: job})
}

func findListingJobCandidates(db *gorm.DB, req aiListingJobRequest) ([]aiSEOProductRef, error) {
	ids := uniqueProductIDs(req.ProductIDs)
	if len(ids) > maxAISEOCandidateProducts {
		return nil, errors.New("一次最多处理 30000 个产品")
	}
	query := db.Model(&models.Product{}).Select("products.id", "products.sku")
	if len(ids) > 0 {
		query = query.Where("products.id IN ?", ids)
	} else {
		query = applyCategoryOptimizationProductStatus(query, req.Status, true)
		switch strings.ToLower(strings.TrimSpace(req.Featured)) {
		case "true", "1":
			query = query.Where("products.is_featured = ?", true)
		case "false", "0":
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
			query = query.Where("products.sku LIKE ? OR products.name LIKE ? OR products.part_number LIKE ? OR products.model LIKE ?", like, like, like, like)
		}
		status := strings.ToLower(strings.TrimSpace(req.AISEOStatus))
		if req.FailedOnly {
			status = "failed"
		}
		switch status {
		case "optimized":
			query = query.Where("products.ai_seo_status = ?", "optimized")
		case "not_optimized":
			query = query.Where("products.ai_seo_status IS NULL OR products.ai_seo_status = ''")
		case "failed":
			query = query.Where("products.ai_seo_status = ?", "failed")
		}
	}
	pendingIDs := db.Model(&models.AIAgentSEOJobItem{}).Select("product_id").Where("status IN ?", []string{"queued", "running"})
	limit := req.Limit
	if limit == 0 {
		limit = -1
	}
	var products []aiSEOProductRef
	err := query.Where("products.id NOT IN (?)", pendingIDs).Order("products.id ASC").Limit(limit).Find(&products).Error
	return products, err
}

func encodeAIListingJobOptions(opts aiListingJobOptions) (string, error) {
	raw, err := json.Marshal(opts)
	if err != nil {
		return "", err
	}
	label := "AI 智能优化：质检 → 联网检索 → 按固定资料格式重写 → 品牌/类目/类型分类"
	if opts.Instruction != "" {
		label += "\n" + opts.Instruction
	}
	return label + "\n\n" + aiListingOptionsMarker + base64.RawURLEncoding.EncodeToString(raw) + "]]", nil
}

func decodeAIListingJobOptions(prompt string) (aiListingJobOptions, error) {
	start := strings.LastIndex(prompt, aiListingOptionsMarker)
	if start < 0 {
		return aiListingJobOptions{}, errors.New("listing job options are missing")
	}
	start += len(aiListingOptionsMarker)
	end := strings.Index(prompt[start:], "]]")
	if end < 0 {
		return aiListingJobOptions{}, errors.New("listing job options are malformed")
	}
	raw, err := base64.RawURLEncoding.DecodeString(prompt[start : start+end])
	if err != nil {
		return aiListingJobOptions{}, err
	}
	var opts aiListingJobOptions
	err = json.Unmarshal(raw, &opts)
	return opts, err
}

func createListingJob(db *gorm.DB, products []aiSEOProductRef, prompt string, createdByID uint) (*models.AIAgentSEOJob, error) {
	job := &models.AIAgentSEOJob{
		ID:            uuid.NewString(),
		Prompt:        prompt,
		SelectionMode: aiListingSelectionMode,
		Status:        "queued",
		Total:         len(products),
		CreatedByID:   createdByID,
	}
	items := make([]models.AIAgentSEOJobItem, 0, len(products))
	for _, product := range products {
		items = append(items, models.AIAgentSEOJobItem{JobID: job.ID, ProductID: product.ID, SKU: product.SKU, Status: "queued"})
	}
	listingJobCreationMu.Lock()
	defer listingJobCreationMu.Unlock()
	// The settings row lock only guards the capacity check. Inserting 100k+ items
	// under it would block saving or switching the AI model for the whole insert.
	err := db.Transaction(func(tx *gorm.DB) error {
		setting, err := getAIAgentSettingForUpdate(tx)
		if err != nil {
			return err
		}
		profile, err := getActiveAIAgentProfileForUpdate(tx, setting)
		if err != nil {
			return err
		}
		pinAIAgentSEOJobProfile(job, setting, profile)
		return ensureAISEOJobCapacity(tx, aiListingSelectionMode)
	})
	if err != nil {
		return nil, err
	}
	if err := ensureNoPendingAISEOProducts(db, products); err != nil {
		return nil, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(job).Error; err != nil {
			return err
		}
		return tx.CreateInBatches(&items, 1000).Error
	})
	if err != nil {
		return nil, err
	}
	return job, nil
}

func processListingOptimizationJob(jobID, workerToken, prompt string) {
	db := config.GetDB()
	opts, err := decodeAIListingJobOptions(prompt)
	if err != nil {
		failQueuedSpecResearchItems(jobID, err.Error())
		finishAIAgentSEOJob(jobID, workerToken, "failed", err.Error())
		return
	}
	profileID, err := loadAIAgentSEOJobProfileID(db, jobID)
	if err != nil {
		finishAIAgentSEOJob(jobID, workerToken, "paused", "AI 配置读取失败，修复后可继续 / AI profile could not be loaded")
		return
	}
	setting, _, apiKey, err := loadAIAgentConfigForProfile(profileID)
	if err != nil || !setting.Enabled || apiKey == "" {
		finishAIAgentSEOJob(jobID, workerToken, "paused", "AI 配置不可用，修复后可继续；已处理的产品不受影响 / AI configuration unavailable")
		return
	}
	configSource := newAIJobConfigSource(jobID, setting, apiKey)
	work := make(chan models.AIAgentSEOJobItem)
	var wg sync.WaitGroup
	for index := 0; index < normalizedAISEOJobConcurrency(setting); index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range work {
				currentSetting, currentKey := configSource.current(db)
				processListingItem(context.Background(), currentSetting, currentKey, jobID, workerToken, opts, item)
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
	if finished, err := finalizeListingJob(db, jobID, workerToken); err != nil {
		finishAIAgentSEOJob(jobID, workerToken, "failed", "Could not finalize listing task: "+err.Error())
	} else if finished {
		publishAIAgentSEOJobCompletion(jobID)
	}
}

func finalizeListingJob(db *gorm.DB, jobID, workerToken string) (bool, error) {
	finished := false
	err := db.Transaction(func(tx *gorm.DB) error {
		var job models.AIAgentSEOJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("status", "worker_token").First(&job, "id = ?", jobID).Error; err != nil {
			return err
		}
		if job.Status != "running" || job.WorkerToken != workerToken {
			return nil
		}
		if err := tx.Model(&models.AIAgentSEOJobItem{}).
			Where("job_id = ? AND status IN ?", jobID, []string{"queued", "running"}).
			Updates(map[string]any{"status": "failed", "error": "Item did not reach a terminal state"}).Error; err != nil {
			return err
		}
		count := func(statuses ...string) (int64, error) {
			var total int64
			err := tx.Model(&models.AIAgentSEOJobItem{}).Where("job_id = ? AND status IN ?", jobID, statuses).Count(&total).Error
			return total, err
		}
		succeeded, err := count("optimized", "skipped")
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
		if failed > 0 {
			status = "completed_with_errors"
		}
		completedAt := time.Now().UTC()
		result := tx.Model(&models.AIAgentSEOJob{}).
			Where("id = ? AND status = ? AND worker_token = ?", jobID, "running", workerToken).
			Updates(map[string]any{
				"status": status, "error": "", "processed": succeeded + failed + unresolved,
				"succeeded": succeeded, "failed": failed, "unresolved": unresolved, "completed_at": &completedAt,
			})
		finished = result.Error == nil && result.RowsAffected > 0
		return result.Error
	})
	return finished, err
}

func finishListingItem(db *gorm.DB, jobID, workerToken string, item models.AIAgentSEOJobItem, status, message string) {
	result := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", item.ID, "running").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status IN ? AND worker_token = ?)", jobID, []string{"running", "paused"}, workerToken).
		Updates(map[string]any{"status": status, "error": truncateRunes(message, 1000)})
	if result.Error == nil && result.RowsAffected > 0 {
		incrementAIAgentSEOJob(jobID, status != "failed")
	}
}

func processListingItem(ctx context.Context, setting *models.AIAgentSetting, apiKey, jobID, workerToken string, opts aiListingJobOptions, item models.AIAgentSEOJobItem) {
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
	setAISEOItemProgress(db, item.ID, "质检产品资料 / Checking listing quality")
	var product models.Product
	if err := db.First(&product, item.ProductID).Error; err != nil {
		finishListingItem(db, jobID, workerToken, item, "failed", err.Error())
		return
	}
	if product.DisableAutoSEO && !opts.Force {
		finishListingItem(db, jobID, workerToken, item, "skipped", "该产品已关闭自动 SEO 覆盖，已跳过（勾选“强制重写”可处理）")
		return
	}
	issues := services.EvaluateListingQuality(product)
	if len(issues) == 0 && !opts.Force {
		if strings.TrimSpace(product.AISEOStatus) == "" {
			db.Model(&models.Product{}).Where("id = ?", product.ID).Update("ai_seo_status", "optimized")
		}
		finishListingItem(db, jobID, workerToken, item, "skipped", "资料完整且 SEO 合格，未修改")
		return
	}

	var evidence []services.ProductWebEvidence
	if opts.UseWebSearch {
		setAISEOItemProgress(db, item.ID, "联网检索型号资料 / Researching the part number online")
		evidence = collectListingEvidence(ctx, product)
	}
	setAISEOItemProgress(db, item.ID, "AI 按固定格式生成资料 / Writing the fixed-format listing")
	aiSEOProviderSlots <- struct{}{}
	output, err := generateAIListing(ctx, db, setting, apiKey, product, opts.Instruction, evidence)
	<-aiSEOProviderSlots
	if err != nil {
		db.Model(&models.Product{}).Where("id = ?", product.ID).Update("ai_seo_status", "failed")
		finishListingItem(db, jobID, workerToken, item, "failed", "AI 优化失败："+err.Error())
		return
	}
	if isAISEOJobCancelled(db, jobID) {
		return
	}

	setAISEOItemProgress(db, item.ID, "匹配/创建分类并保存 / Resolving category and saving")
	resolution, categoryErr := resolveListingCategory(db, output.CategoryPath, output.ExistingCategoryID, opts.CreateCategories)
	updates := listingProductUpdates(db, product, output.Record)
	categoryNote := ""
	switch {
	case categoryErr != nil:
		categoryNote = "；分类未变更：" + categoryErr.Error()
	case resolution.CategoryID == 0:
		categoryNote = "；分类未变更：需要新建 " + strings.Join(resolution.Missing, " > ")
	case resolution.CategoryID != product.CategoryID:
		updates["category_id"] = resolution.CategoryID
	}
	if opts.ActivateResolved && !product.IsActive && (product.CategoryID != 0 || updates["category_id"] != nil) {
		updates["is_active"] = true
	}
	now := time.Now().UTC()
	updates["ai_seo_status"] = "optimized"
	updates["ai_seo_optimized_at"] = &now
	updates["ai_seo_optimization_job_id"] = jobID
	updates["last_optimized_at"] = &now

	summaryResolution := &resolution
	if _, changed := updates["category_id"]; !changed {
		summaryResolution = nil
	}
	summary := listingChangeSummary(product, updates, summaryResolution) + categoryNote
	if len(issues) > 0 {
		summary += "；原问题：" + services.ListingQualitySummary(issues)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		var currentJob models.AIAgentSEOJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("status", "worker_token").First(&currentJob, "id = ?", jobID).Error; err != nil {
			return err
		}
		if currentJob.WorkerToken != workerToken || (currentJob.Status != "running" && currentJob.Status != "paused") {
			return errors.New("AI listing job was ended")
		}
		return tx.Model(&models.Product{}).Where("id = ?", product.ID).Updates(updates).Error
	})
	if err != nil {
		finishListingItem(db, jobID, workerToken, item, "failed", err.Error())
		return
	}
	finishListingItem(db, jobID, workerToken, item, "optimized", summary)
}
