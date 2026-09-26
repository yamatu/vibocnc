package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	aiSEOIdentificationSelectionMode = "product_identification"
	defaultIdentificationJobLimit    = 100
	maxIdentificationJobLimit        = 1000
	maxIdentificationWorkers         = 2
	identificationItemTimeout        = 100 * time.Second
)

var identificationJobCreationMu sync.Mutex

type identificationJobStartRequest struct {
	// ProductIDs is optional. With no explicit selection, the task chooses active
	// products that have exact-model eBay evidence and no pending profile draft.
	ProductIDs []uint `json:"product_ids"`
	Limit      int    `json:"limit"`
}

// StartIdentificationJob queues evidence-backed product identification. The
// worker only creates ProductProfileDraft rows; it never publishes catalogue
// fields, categories, specifications or prices.
func (mc *EbayMarketController) StartIdentificationJob(c *gin.Context) {
	var req identificationJobStartRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, context.Canceled) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	req.ProductIDs = uniqueProductIDs(req.ProductIDs)
	if len(req.ProductIDs) > maxIdentificationJobLimit {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: fmt.Sprintf("Choose at most %d products", maxIdentificationJobLimit)})
		return
	}
	limit := req.Limit
	if limit <= 0 {
		limit = defaultIdentificationJobLimit
	}
	if limit > maxIdentificationJobLimit {
		limit = maxIdentificationJobLimit
	}
	if len(req.ProductIDs) > 0 {
		limit = len(req.ProductIDs)
	}

	db := config.GetDB()
	products, skipped, err := selectIdentificationJobProducts(db, req.ProductIDs, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to select products for identification", Error: utils.PublicError(err, "db_error")})
		return
	}
	if len(products) == 0 {
		c.JSON(http.StatusConflict, models.APIResponse{
			Success: false,
			Message: "No eligible product has exact-model eBay evidence; pending drafts and products already in an AI task are skipped",
			Data:    gin.H{"skipped": skipped},
		})
		return
	}

	job, err := createIdentificationJob(db, products, currentUserID(c))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errAISEOProductsPending) || errors.Is(err, errAISEOJobCapacity) {
			status = http.StatusConflict
		}
		c.JSON(status, models.APIResponse{Success: false, Message: "Failed to create identification task", Error: utils.PublicError(err, "job_create_failed")})
		return
	}
	dispatchQueuedAISEOJobsAsync()
	c.JSON(http.StatusAccepted, models.APIResponse{
		Success: true,
		Message: "Product identification task queued; all results require review",
		Data:    gin.H{"job": job, "selected": len(products), "skipped": skipped},
	})
}

// selectIdentificationJobProducts intersects catalogue products with exact
// market-quote matches. This deliberately uses MatchProductsForMarketQuotes so
// its model collision and brand-prefix rules cannot drift from the quote UI.
func selectIdentificationJobProducts(db *gorm.DB, requested []uint, limit int) ([]aiSEOProductRef, int, error) {
	if db == nil {
		return nil, 0, errors.New("database is not available")
	}
	var quotes []models.EbayMarketQuote
	if err := db.Order("scraped_at DESC, id DESC").Find(&quotes).Error; err != nil {
		return nil, 0, err
	}
	matches, err := services.MatchProductsForMarketQuotes(db, quotes)
	if err != nil {
		return nil, 0, err
	}

	var pendingDraftIDs []uint
	if err := db.Model(&models.ProductProfileDraft{}).
		Where("status = ? AND product_id > 0", "pending").
		Pluck("product_id", &pendingDraftIDs).Error; err != nil {
		return nil, 0, err
	}
	blocked := make(map[uint]bool, len(pendingDraftIDs))
	for _, id := range pendingDraftIDs {
		blocked[id] = true
	}
	var pendingJobIDs []uint
	if err := db.Model(&models.AIAgentSEOJobItem{}).
		Where("status IN ?", []string{"queued", "running"}).
		Pluck("product_id", &pendingJobIDs).Error; err != nil {
		return nil, 0, err
	}
	for _, id := range pendingJobIDs {
		blocked[id] = true
	}

	selected := selectIdentificationCandidates(quotes, matches, requested, blocked, limit)

	eligibleRequested := len(requested)
	if eligibleRequested == 0 {
		eligibleRequested = len(selected)
	}
	skipped := eligibleRequested - len(selected)
	if skipped < 0 {
		skipped = 0
	}
	return selected, skipped, nil
}

// selectIdentificationCandidates is the pure selection core, split out so the
// evidence/eligibility rules can be regression-tested without a live database.
// It walks the quotes in order, keeps the first occurrence of each eligible
// product, and applies the requested-id filter, the pending-draft/pending-job
// blocklist and the limit.
func selectIdentificationCandidates(
	quotes []models.EbayMarketQuote,
	matches map[uint]models.Product,
	requested []uint,
	blocked map[uint]bool,
	limit int,
) []aiSEOProductRef {
	wanted := make(map[uint]bool, len(requested))
	for _, id := range requested {
		wanted[id] = true
	}
	seen := make(map[uint]bool)
	selected := make([]aiSEOProductRef, 0, limit)
	for _, quote := range quotes {
		product, ok := matches[quote.ID]
		if !ok || product.ID == 0 || seen[product.ID] || !product.IsActive {
			continue
		}
		seen[product.ID] = true
		if len(wanted) > 0 && !wanted[product.ID] {
			continue
		}
		if blocked[product.ID] || strings.TrimSpace(services.ProductClassificationModelFor(product)) == "" {
			continue
		}
		selected = append(selected, aiSEOProductRef{ID: product.ID, SKU: product.SKU})
		if len(selected) >= limit {
			break
		}
	}
	return selected
}

func createIdentificationJob(db *gorm.DB, products []aiSEOProductRef, createdByID uint) (*models.AIAgentSEOJob, error) {
	if len(products) == 0 {
		return nil, errors.New("identification tasks must contain at least one product")
	}
	job := &models.AIAgentSEOJob{
		ID:            uuid.NewString(),
		Prompt:        "Identify products from exact-model eBay evidence and create review drafts only.",
		SelectionMode: aiSEOIdentificationSelectionMode,
		Status:        "queued",
		Total:         len(products),
		CreatedByID:   createdByID,
	}
	items := make([]models.AIAgentSEOJobItem, 0, len(products))
	for _, product := range products {
		items = append(items, models.AIAgentSEOJobItem{JobID: job.ID, ProductID: product.ID, SKU: product.SKU, Status: "queued"})
	}

	identificationJobCreationMu.Lock()
	defer identificationJobCreationMu.Unlock()
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
		if err := ensureAISEOJobCapacity(tx, aiSEOIdentificationSelectionMode); err != nil {
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

func processIdentificationJob(jobID, workerToken string) {
	db := config.GetDB()
	profileID, err := loadAIAgentSEOJobProfileID(db, jobID)
	if err != nil {
		finishAIAgentSEOJob(jobID, workerToken, "paused", "Saved AI profile could not be loaded; repair it and resume")
		return
	}
	setting, _, apiKey, err := loadAIAgentConfigForProfile(profileID)
	if err != nil || setting == nil || !setting.Enabled || apiKey == "" {
		finishAIAgentSEOJob(jobID, workerToken, "paused", "AI configuration is unavailable; repair it and resume")
		return
	}
	client := func(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
		return requestAIAgentCompletion(ctx, setting, apiKey, []aiChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		}, 2048)
	}

	var job models.AIAgentSEOJob
	_ = db.Select("created_by_id").First(&job, "id = ?", jobID).Error
	work := make(chan models.AIAgentSEOJobItem)
	var wg sync.WaitGroup
	for index := 0; index < maxIdentificationWorkers; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range work {
				processIdentificationJobItem(context.Background(), jobID, workerToken, item, job.CreatedByID, client)
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
	if _, err := finalizeDraftJob(db, jobID, workerToken, nil, "Product identification item did not reach a terminal state"); err != nil {
		finishAIAgentSEOJob(jobID, workerToken, "failed", "Could not finalize identification task: "+err.Error())
	}
}

func processIdentificationJobItem(ctx context.Context, jobID, workerToken string, item models.AIAgentSEOJobItem, requestedBy uint, client services.IdentificationClient) {
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
	if err := db.Preload("Category").First(&product, item.ProductID).Error; err != nil {
		failIdentificationJobItem(jobID, workerToken, item.ID, err)
		return
	}
	model := services.ProductClassificationModelFor(product)
	setAISEOItemProgress(db, item.ID, "读取精确型号 eBay 证据 / reading exact-model eBay evidence")
	quote, err := services.LookupMarketQuote(db, product.Brand, model)
	if err != nil {
		failIdentificationJobItem(jobID, workerToken, item.ID, err)
		return
	}
	if quote == nil || len(services.MarketEvidenceItems(*quote)) == 0 {
		markIdentificationUnresolved(jobID, workerToken, item.ID, "No exact-model eBay evidence is available")
		return
	}

	evidence := services.ProductIdentificationEvidence{
		BrandHint:        product.Brand,
		Model:            model,
		ProductName:      product.Name,
		SKU:              product.SKU,
		PartNumber:       product.PartNumber,
		Listings:         services.MarketEvidenceItems(*quote),
		EbayCategoryPath: services.DominantEbayCategory(services.MarketEvidenceItems(*quote)),
	}
	setAISEOItemProgress(db, item.ID, "AI 正在识别产品 / AI is identifying the product")
	itemCtx, cancel := context.WithTimeout(ctx, identificationItemTimeout)
	defer cancel()
	profile, err := services.IdentifyProduct(itemCtx, evidence, client)
	if err != nil {
		failIdentificationJobItem(jobID, workerToken, item.ID, err)
		return
	}
	draft, _, err := services.BuildProductProfileDraft(&product, quote, profile, requestedBy)
	if err != nil {
		markIdentificationUnresolved(jobID, workerToken, item.ID, err.Error())
		return
	}
	draft.JobID = jobID
	if err := services.StoreProductProfileDraft(db, &draft); err != nil {
		failIdentificationJobItem(jobID, workerToken, item.ID, err)
		return
	}

	resultPayload, _ := json.Marshal(map[string]any{
		"draft_id":       draft.ID,
		"confidence":     profile.Confidence,
		"part_type":      profile.PartType,
		"evidence_count": profile.EvidenceCount,
	})
	result := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", item.ID, "running").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status IN ? AND worker_token = ?)", jobID, []string{"running", "paused"}, workerToken).
		Updates(map[string]any{
			"status":        "optimized",
			"error":         fmt.Sprintf("产品画像草稿 #%d 待审核 / profile draft #%d pending review", draft.ID, draft.ID),
			"evidence_json": string(resultPayload),
		})
	if result.Error == nil && result.RowsAffected > 0 {
		incrementAIAgentSEOJob(jobID, true)
	}
}

func failIdentificationJobItem(jobID, workerToken string, itemID uint, itemErr error) {
	message := truncateRunes(itemErr.Error(), 1000)
	db := config.GetDB()
	result := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", itemID, "running").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status IN ? AND worker_token = ?)", jobID, []string{"running", "paused"}, workerToken).
		Updates(map[string]any{"status": "failed", "error": message})
	if result.Error == nil && result.RowsAffected > 0 {
		incrementAIAgentSEOJob(jobID, false)
	}
}

func markIdentificationUnresolved(jobID, workerToken string, itemID uint, message string) {
	db := config.GetDB()
	result := db.Model(&models.AIAgentSEOJobItem{}).
		Where("id = ? AND status = ?", itemID, "running").
		Where("EXISTS (SELECT 1 FROM ai_agent_seo_jobs WHERE id = ? AND status IN ? AND worker_token = ?)", jobID, []string{"running", "paused"}, workerToken).
		Updates(map[string]any{"status": "unresolved", "error": truncateRunes(message, 1000)})
	if result.Error == nil && result.RowsAffected > 0 {
		_ = db.Model(&models.AIAgentSEOJob{}).Where("id = ?", jobID).
			Updates(map[string]any{"processed": gorm.Expr("processed + 1"), "unresolved": gorm.Expr("unresolved + 1")}).Error
	}
}
