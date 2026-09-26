package controllers

import (
	"context"
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

// EbayMarketController exposes the crawler-produced market research and the
// price suggestion workflow.
//
// It never writes a product price on its own. The admin list shows a suggestion
// per quote; applying it is a separate, explicit call for an explicit set of
// product ids, so a bad crawl can never silently reprice the catalogue.
type EbayMarketController struct{}

const (
	defaultMarketQuoteLimit = 50
	maxMarketQuoteLimit     = 500
	maxPriceApplyBatch      = 200
)

// Ingest receives aggregated market quotes from the crawler.
// POST /api/v1/admin/ebay-market/ingest
func (mc *EbayMarketController) Ingest(c *gin.Context) {
	var req models.EbayMarketQuoteIngestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid market quote payload",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	result, err := services.IngestMarketQuotes(db, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to ingest market quotes",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Market quotes ingested",
		Data:    result,
	})
}

type marketQuoteListQuery struct {
	Search       string `form:"search"`
	Brand        string `form:"brand"`
	OnlyWithGaps string `form:"only_with_gaps"`
	Sort         string `form:"sort"`
	Page         int    `form:"page"`
	Limit        int    `form:"limit"`
}

// List returns market quotes enriched with the product each one maps to, so the
// admin can see the price delta without a second request.
// GET /api/v1/admin/ebay-market/quotes
func (mc *EbayMarketController) List(c *gin.Context) {
	var query marketQuoteListQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid query",
			Error:   err.Error(),
		})
		return
	}

	limit := query.Limit
	if limit <= 0 {
		limit = defaultMarketQuoteLimit
	}
	if limit > maxMarketQuoteLimit {
		limit = maxMarketQuoteLimit
	}
	page := query.Page
	if page <= 0 {
		page = 1
	}

	db := config.GetDB()
	statement := db.Model(&models.EbayMarketQuote{})
	if search := strings.TrimSpace(query.Search); search != "" {
		like := "%" + search + "%"
		statement = statement.Where("model LIKE ? OR brand LIKE ?", like, like)
	}
	if brand := strings.TrimSpace(query.Brand); brand != "" {
		statement = statement.Where("brand_key = ?", services.NormalizeBrandKey(brand))
	}

	var total int64
	if err := statement.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to count market quotes",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	var quotes []models.EbayMarketQuote
	if err := statement.Order("scraped_at DESC, id DESC").
		Offset((page - 1) * limit).
		Limit(limit).
		Find(&quotes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to load market quotes",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	responses := decorateMarketQuotes(db, quotes)

	if strings.EqualFold(strings.TrimSpace(query.OnlyWithGaps), "true") {
		filtered := make([]models.EbayMarketQuoteResponse, 0, len(responses))
		for _, item := range responses {
			if item.MatchedProductID != nil && item.SuggestedPrice != nil &&
				(item.DeltaPercent == nil || *item.DeltaPercent != 0) {
				filtered = append(filtered, item)
			}
		}
		responses = filtered
	}

	sortMarketQuoteResponses(responses, query.Sort)

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data: models.EbayMarketQuoteListResponse{
			Quotes: responses,
			Total:  total,
			Page:   page,
			Limit:  limit,
		},
	})
}

// Get returns one quote with its evidence listings.
// GET /api/v1/admin/ebay-market/quotes/:id
func (mc *EbayMarketController) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}

	db := config.GetDB()
	var quote models.EbayMarketQuote
	if err := db.First(&quote, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Market quote not found"})
		return
	}

	responses := decorateMarketQuotes(db, []models.EbayMarketQuote{quote})
	detail := gin.H{"quote": responses[0]}
	detail["evidence"] = services.MarketEvidenceItems(quote)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: detail})
}

// Delete removes one quote.
// DELETE /api/v1/admin/ebay-market/quotes/:id
func (mc *EbayMarketController) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}
	if err := config.GetDB().Delete(&models.EbayMarketQuote{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete market quote",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Market quote deleted"})
}

// DeleteAll clears the whole research table, for a clean re-crawl.
// POST /api/v1/admin/ebay-market/quotes/clear
func (mc *EbayMarketController) Clear(c *gin.Context) {
	db := config.GetDB()
	if err := db.Where("1 = 1").Delete(&models.EbayMarketQuote{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to clear market quotes",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Market quotes cleared"})
}

// Summary reports coverage so the admin can see how much of the catalogue has
// been researched.
// GET /api/v1/admin/ebay-market/summary
func (mc *EbayMarketController) Summary(c *gin.Context) {
	db := config.GetDB()

	var totalQuotes int64
	db.Model(&models.EbayMarketQuote{}).Count(&totalQuotes)

	var withPrice int64
	db.Model(&models.EbayMarketQuote{}).Where("median_price > 0 AND matched_count > 0").Count(&withPrice)

	var totalProducts int64
	db.Model(&models.Product{}).Count(&totalProducts)

	policy := services.CurrentCommercePolicy()

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data: gin.H{
			"total_quotes":      totalQuotes,
			"quotes_with_price": withPrice,
			"total_products":    totalProducts,
			"last_scraped_at":   latestMarketScrapeTime(db),
			"policy": gin.H{
				"enabled":       policy.PriceSyncEnabled,
				"factor":        policy.PriceSyncFactor,
				"min_samples":   policy.PriceSyncMinSamples,
				"max_delta_pct": policy.PriceSyncMaxDeltaPct,
				"round_to":      policy.PriceSyncRoundTo,
			},
		},
	})
}

// ------------------------------------------------------------- price workflow

// PreviewPrices returns suggested price changes without writing anything.
// POST /api/v1/admin/ebay-market/price-sync/preview
func (mc *EbayMarketController) PreviewPrices(c *gin.Context) {
	var req models.PriceSyncPreviewRequest
	_ = c.ShouldBindJSON(&req)

	db := config.GetDB()
	suggestions, err := services.BuildPriceSyncSuggestions(db, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to build price suggestions",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	ready := 0
	for _, item := range suggestions {
		if item.Status == "ready" {
			ready++
		}
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data: gin.H{
			"suggestions": suggestions,
			"total":       len(suggestions),
			"ready":       ready,
		},
	})
}

// ApplyPrices writes the explicitly approved price changes.
// POST /api/v1/admin/ebay-market/price-sync/apply
func (mc *EbayMarketController) ApplyPrices(c *gin.Context) {
	var req models.PriceSyncApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request",
			Error:   err.Error(),
		})
		return
	}
	if len(req.ProductIDs) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Select at least one product to update",
		})
		return
	}
	if len(req.ProductIDs) > maxPriceApplyBatch {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Too many products in one request",
			Error:   "limit_exceeded",
		})
		return
	}
	selected := make(map[uint]bool, len(req.ProductIDs))
	for _, productID := range req.ProductIDs {
		selected[productID] = true
	}
	for _, productID := range req.ForceProductIDs {
		if productID == 0 || !selected[productID] {
			c.JSON(http.StatusBadRequest, models.APIResponse{
				Success: false,
				Message: "Every force_product_id must also be selected in product_ids",
				Error:   "invalid_force_product_ids",
			})
			return
		}
	}

	db := config.GetDB()
	userID := currentUserID(c)
	result, err := services.ApplyPriceSync(db, req, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to apply price updates",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Price updates applied",
		Data:    result,
	})
}

// ---------------------------------------------------------------- identification

type identificationRequest struct {
	ProductID uint   `json:"product_id"`
	Model     string `json:"model"`
	Brand     string `json:"brand"`
	// SaveDraft defaults to true. Callers may request a transient preview, but
	// the admin UI persists by default so every AI answer remains reviewable.
	SaveDraft *bool `json:"save_draft"`
}

// IdentifyProduct asks the AI to identify a product from eBay evidence and
// stores a review draft by default. It never changes the catalogue product.
// POST /api/v1/admin/ebay-market/identify
func (mc *EbayMarketController) IdentifyProduct(c *gin.Context) {
	var req identificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	evidence := services.ProductIdentificationEvidence{
		BrandHint: strings.TrimSpace(req.Brand),
		Model:     strings.TrimSpace(req.Model),
	}
	var product *models.Product
	if req.ProductID > 0 {
		var found models.Product
		if err := db.Preload("Category").First(&found, req.ProductID).Error; err != nil {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Product not found"})
			return
		}
		product = &found
	}

	if product != nil && evidence.Model == "" {
		evidence.Model = services.ProductClassificationModelFor(*product)
	}
	if strings.TrimSpace(evidence.Model) == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "A model or part number is required",
		})
		return
	}

	// When the caller only supplied a model, link it to a unique catalogue
	// product automatically. Ambiguous models deliberately remain unlinked.
	if product == nil {
		matched, matchErr := services.LookupProductByMarketModel(db, evidence.BrandHint, evidence.Model)
		if matchErr != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to match model to product", Error: utils.PublicError(matchErr, "db_error")})
			return
		}
		if matched != nil {
			var full models.Product
			if err := db.Preload("Category").First(&full, matched.ID).Error; err == nil {
				product = &full
			}
		}
	}

	if product != nil {
		evidence.ProductName = product.Name
		evidence.SKU = product.SKU
		evidence.PartNumber = product.PartNumber
		if evidence.BrandHint == "" {
			evidence.BrandHint = product.Brand
		}
	}

	quote, err := services.LookupMarketQuote(db, evidence.BrandHint, evidence.Model)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load market evidence", Error: utils.PublicError(err, "db_error")})
		return
	}
	if quote != nil {
		evidence.Listings = services.MarketEvidenceItems(*quote)
		evidence.EbayCategoryPath = services.DominantEbayCategory(evidence.Listings)
	}

	client, err := identificationClient()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "AI provider is not configured",
			Error:   utils.PublicError(err, "ai_not_configured"),
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()

	profile, err := services.IdentifyProduct(ctx, evidence, client)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.APIResponse{
			Success: false,
			Message: "AI identification failed",
			Error:   utils.PublicError(err, "ai_error"),
		})
		return
	}

	draft, payload, draftErr := services.BuildProductProfileDraft(product, quote, profile, currentUserID(c))
	saveDraft := req.SaveDraft == nil || *req.SaveDraft
	draftSaved := false
	if draftErr == nil && saveDraft {
		if err := services.StoreProductProfileDraft(db, &draft); err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Identification succeeded but the review draft could not be saved", Error: utils.PublicError(err, "db_error")})
			return
		}
		draftSaved = true
	}

	data := gin.H{
		"profile":            profile,
		"evidence":           evidence.Listings,
		"has_quote":          quote != nil,
		"matched_product_id": uint(0),
		"draft_saved":        draftSaved,
	}
	if product != nil {
		data["matched_product_id"] = product.ID
	}
	if draftErr == nil {
		data["draft"] = draft
		data["content"] = payload.Content
		data["proposed_title"] = draft.ProposedTitle
	} else {
		data["draft_error"] = draftErr.Error()
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: data})
}

// identificationClient adapts the active AI profile to the services interface.
func identificationClient() (services.IdentificationClient, error) {
	setting, _, apiKey, err := loadAIAgentConfigWithProfile()
	if err != nil {
		return nil, err
	}
	return func(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
		return requestAIAgentCompletion(ctx, setting, apiKey, []aiChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		}, 2048)
	}, nil
}

// ------------------------------------------------------------------ helpers

func decorateMarketQuotes(db *gorm.DB, quotes []models.EbayMarketQuote) []models.EbayMarketQuoteResponse {
	if len(quotes) == 0 {
		return []models.EbayMarketQuoteResponse{}
	}

	policy := services.CurrentCommercePolicy()
	out := make([]models.EbayMarketQuoteResponse, 0, len(quotes))
	// One product projection query for the entire quote page. Product has no
	// model_normalized column; matching uses the shared crawler/backend key.
	matchedProducts, _ := services.MatchProductsForMarketQuotes(db, quotes)

	for _, quote := range quotes {
		item := models.EbayMarketQuoteResponse{EbayMarketQuote: quote}
		suggested := services.SuggestPriceFromQuote(db, &quote)

		if product, found := matchedProducts[quote.ID]; found {
			item.MatchedProductID = &product.ID
			item.MatchedProductSKU = product.SKU
			item.MatchedProductName = product.Name
			current := product.Price
			item.CurrentPrice = &current
		}

		if suggested != nil {
			item.SuggestedPrice = suggested
			if item.CurrentPrice != nil {
				delta := services.PriceDeltaPercent(*item.CurrentPrice, *suggested)
				item.DeltaPercent = &delta
				item.SuggestionStatus = services.PriceSuggestionStatus(delta, policy, quote.MatchedCount)
			} else {
				item.SuggestionStatus = "no_matching_product"
			}
		} else if quote.MatchedCount < policy.PriceSyncMinSamples {
			item.SuggestionStatus = "insufficient_samples"
		} else if !policy.PriceSyncEnabled {
			item.SuggestionStatus = "price_sync_disabled"
		}

		out = append(out, item)
	}
	return out
}

func sortMarketQuoteResponses(items []models.EbayMarketQuoteResponse, sortBy string) {
	switch strings.TrimSpace(sortBy) {
	case "delta_desc":
		sortByAbsDelta(items, true)
	case "delta_asc":
		sortByAbsDelta(items, false)
	case "scraped_desc":
		// already ordered by the query
	}
}

func sortByAbsDelta(items []models.EbayMarketQuoteResponse, descending bool) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0; j-- {
			left := absDelta(items[j-1])
			right := absDelta(items[j])
			swap := left < right
			if descending {
				swap = left > right
			}
			if !swap {
				break
			}
			items[j-1], items[j] = items[j], items[j-1]
		}
	}
}

func absDelta(item models.EbayMarketQuoteResponse) float64 {
	if item.DeltaPercent == nil {
		return -1
	}
	if *item.DeltaPercent < 0 {
		return -*item.DeltaPercent
	}
	return *item.DeltaPercent
}

func latestMarketScrapeTime(db *gorm.DB) *time.Time {
	var quote models.EbayMarketQuote
	if err := db.Order("scraped_at DESC").First(&quote).Error; err != nil {
		return nil
	}
	return &quote.ScrapedAt
}
