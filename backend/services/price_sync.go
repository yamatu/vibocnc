package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// ProductClassificationModelFor exposes the model-number resolution used by the
// classification pipeline to callers outside this package.
func ProductClassificationModelFor(product models.Product) string {
	return productClassificationModel(product)
}

const (
	// DefaultPriceSyncPreviewLimit bounds how many products one preview examines.
	DefaultPriceSyncPreviewLimit = 300
	maxPriceSyncPreviewLimit     = 2000
)

// Price sync statuses surfaced to the admin.
const (
	PriceSyncStatusReady        = "ready"
	PriceSyncStatusManualReview = "needs_manual_review"
	PriceSyncStatusThin         = "insufficient_samples"
	PriceSyncStatusUnchanged    = "unchanged"
	PriceSyncStatusNoQuote      = "no_quote"
	PriceSyncStatusLocked       = "price_locked"
	PriceSyncStatusDisabled     = "price_sync_disabled"
)

// BuildPriceSyncSuggestions matches catalogue products against market quotes and
// produces a suggestion per product. It reads only; nothing is written.
//
// Guards applied here (and re-checked on apply):
//   - a product with no market quote is reported as no_quote,
//   - a quote thinner than PriceSyncMinSamples yields no suggestion,
//   - a delta larger than PriceSyncMaxDeltaPct is flagged for manual review but
//     is still shown, so the administrator can see what the market says,
//   - a zero/absent current price never produces a percentage.
func BuildPriceSyncSuggestions(db *gorm.DB, req models.PriceSyncPreviewRequest) ([]models.PriceSyncSuggestion, error) {
	if db == nil {
		return nil, errors.New("database is not available")
	}

	limit := req.Limit
	if limit <= 0 {
		limit = DefaultPriceSyncPreviewLimit
	}
	if limit > maxPriceSyncPreviewLimit {
		limit = maxPriceSyncPreviewLimit
	}

	policy := CurrentCommercePolicy()
	query := db.Model(&models.Product{}).Order("products.id ASC").Limit(limit)
	if len(req.ProductIDs) > 0 {
		query = query.Where("products.id IN ?", req.ProductIDs)
	}
	if brand := strings.TrimSpace(req.Brand); brand != "" {
		query = query.Where("products.brand = ?", brand)
	}
	if req.CategoryID != nil && *req.CategoryID > 0 {
		categoryIDs := []uint{*req.CategoryID}
		if req.IncludeDescendants {
			if descendants, err := descendantCategoryIDsForPriceSync(db, *req.CategoryID); err == nil && len(descendants) > 0 {
				categoryIDs = descendants
			}
		}
		query = query.Where("products.category_id IN ?", categoryIDs)
	}

	var products []models.Product
	if err := query.Find(&products).Error; err != nil {
		return nil, err
	}

	suggestions := make([]models.PriceSyncSuggestion, 0, len(products))
	for _, product := range products {
		model := ProductClassificationModelFor(product)
		suggestion := models.PriceSyncSuggestion{
			ProductID:    product.ID,
			SKU:          product.SKU,
			Name:         product.Name,
			Brand:        product.Brand,
			Model:        model,
			CurrentPrice: product.Price,
			PriceLocked:  product.PriceLocked,
			Status:       PriceSyncStatusNoQuote,
		}

		if product.PriceLocked {
			suggestion.Status = PriceSyncStatusLocked
			suggestion.StatusReason = "product price is locked"
			suggestions = append(suggestions, suggestion)
			continue
		}
		if !policy.PriceSyncEnabled {
			suggestion.Status = PriceSyncStatusDisabled
			suggestion.StatusReason = "price suggestions are disabled in the commerce policy"
			suggestions = append(suggestions, suggestion)
			continue
		}

		if model == "" {
			suggestion.StatusReason = "product has no model or part number"
			suggestions = append(suggestions, suggestion)
			continue
		}

		quote, err := LookupMarketQuote(db, product.Brand, model)
		if err != nil {
			return nil, err
		}
		if quote == nil || quote.MedianPrice <= 0 || quote.MatchedCount == 0 {
			if req.OnlyWithQuote {
				continue
			}
			suggestion.StatusReason = "no eBay research for this model yet"
			suggestions = append(suggestions, suggestion)
			continue
		}

		suggestion.QuoteID = quote.ID
		suggestion.MedianPrice = quote.MedianPrice
		suggestion.MatchedCount = quote.MatchedCount
		suggestion.Currency = quote.Currency

		if quote.MatchedCount < policy.PriceSyncMinSamples {
			suggestion.Status = PriceSyncStatusThin
			suggestion.StatusReason = fmt.Sprintf(
				"only %d matching eBay listings (minimum %d)",
				quote.MatchedCount, policy.PriceSyncMinSamples,
			)
			suggestions = append(suggestions, suggestion)
			continue
		}

		suggested := *quote // copy: SuggestPriceFromQuote reads the policy
		price := SuggestPriceFromQuote(db, &suggested)
		if price == nil {
			suggestion.Status = PriceSyncStatusThin
			suggestion.StatusReason = "no price suggested for this quote"
			suggestions = append(suggestions, suggestion)
			continue
		}

		suggestion.SuggestedPrice = *price
		if product.Price > 0 {
			suggestion.DeltaPercent = PriceDeltaPercent(product.Price, *price)
		}

		switch {
		case product.Price > 0 && absFloat(suggestion.DeltaPercent) > policy.PriceSyncMaxDeltaPct:
			suggestion.Status = PriceSyncStatusManualReview
			suggestion.StatusReason = fmt.Sprintf(
				"change of %.1f%% exceeds the %.0f%% review threshold",
				suggestion.DeltaPercent, policy.PriceSyncMaxDeltaPct,
			)
		case product.Price > 0 && absFloat(suggestion.DeltaPercent) < 0.5:
			suggestion.Status = PriceSyncStatusUnchanged
			suggestion.StatusReason = "current price already matches the market"
		default:
			suggestion.Status = PriceSyncStatusReady
		}

		suggestions = append(suggestions, suggestion)
	}

	return suggestions, nil
}

// ApplyPriceSync writes approved price changes for the supplied product ids.
//
// The price is recomputed here rather than trusted from the request, so a stale
// or tampered preview cannot set an arbitrary price. Only products whose
// recomputed status is "ready" are written; everything else is skipped with a
// reason, including products whose price is locked.
func ApplyPriceSync(db *gorm.DB, req models.PriceSyncApplyRequest, userID uint) (models.PriceSyncApplyResult, error) {
	result := models.PriceSyncApplyResult{Items: []models.PriceSyncAppliedItem{}}
	if db == nil {
		return result, errors.New("database is not available")
	}

	policy := CurrentCommercePolicy()
	if !policy.PriceSyncEnabled {
		return result, errors.New("price sync is disabled in the commerce policy")
	}
	force := make(map[uint]bool, len(req.ForceProductIDs))
	for _, productID := range req.ForceProductIDs {
		if productID > 0 {
			force[productID] = true
		}
	}

	for _, productID := range req.ProductIDs {
		if productID == 0 {
			result.Skipped++
			continue
		}

		var product models.Product
		if err := db.First(&product, productID).Error; err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("product %d not found", productID))
			continue
		}

		if product.PriceLocked {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: price is locked", product.SKU))
			continue
		}

		model := ProductClassificationModelFor(product)
		quote, err := LookupMarketQuote(db, product.Brand, model)
		if err != nil || quote == nil {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: no market quote", product.SKU))
			continue
		}
		if quote.MatchedCount < policy.PriceSyncMinSamples {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf(
				"%s: only %d matching listings (minimum %d)",
				product.SKU, quote.MatchedCount, policy.PriceSyncMinSamples,
			))
			continue
		}

		price := SuggestPriceFromQuote(db, quote)
		if price == nil || *price <= 0 {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: no price suggested", product.SKU))
			continue
		}

		delta := 0.0
		if product.Price > 0 {
			delta = PriceDeltaPercent(product.Price, *price)
		}
		if absFloat(delta) > policy.PriceSyncMaxDeltaPct && product.Price > 0 && !force[product.ID] {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf(
				"%s: change of %.1f%% exceeds the %.0f%% review threshold; explicit force_product_ids acknowledgement required",
				product.SKU, delta, policy.PriceSyncMaxDeltaPct,
			))
			continue
		}

		oldPrice := product.Price
		if absFloat(*price-oldPrice) < 0.005 {
			result.Skipped++
			continue
		}

		if err := db.Model(&models.Product{}).
			Where("id = ?", product.ID).
			Update("price", *price).Error; err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", product.SKU, err))
			continue
		}

		auditReason := strings.TrimSpace(req.Reason)
		if force[product.ID] && product.Price > 0 && absFloat(delta) > policy.PriceSyncMaxDeltaPct {
			auditReason = strings.TrimSpace(auditReason + " [large delta explicitly approved]")
		}
		recordPriceSyncChange(db, product, oldPrice, *price, quote, policy, auditReason, userID)

		result.Updated++
		result.Items = append(result.Items, models.PriceSyncAppliedItem{
			ProductID:    product.ID,
			SKU:          product.SKU,
			OldPrice:     oldPrice,
			NewPrice:     *price,
			DeltaPercent: delta,
			MedianPrice:  quote.MedianPrice,
			QuoteID:      quote.ID,
		})
	}

	if result.Updated > 0 {
		InvalidatePublicCaches(context.Background(), "product_price_sync", nil)
	}

	return result, nil
}

// recordPriceSyncChange keeps an audit trail. The table is created by
// automigration alongside the other market tables; a failure here never blocks
// the price update itself, because the update is the point of the operation.
func recordPriceSyncChange(db *gorm.DB, product models.Product, oldPrice, newPrice float64, quote *models.EbayMarketQuote, policy models.CommercePolicySetting, reason string, userID uint) {
	entry := models.PriceSyncChange{
		ProductID:    product.ID,
		SKU:          product.SKU,
		Model:        ProductClassificationModelFor(product),
		OldPrice:     oldPrice,
		NewPrice:     newPrice,
		DeltaPercent: PriceDeltaPercent(oldPrice, newPrice),
		QuoteID:      quote.ID,
		MedianPrice:  quote.MedianPrice,
		MatchedCount: quote.MatchedCount,
		Factor:       policy.PriceSyncFactor,
		Reason:       truncateText(reason, 255),
		AppliedBy:    userID,
		AppliedAt:    time.Now().UTC(),
	}
	_ = db.Create(&entry).Error
}

func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

// descendantCategoryIDsForPriceSync walks the category tree breadth-first.
func descendantCategoryIDsForPriceSync(db *gorm.DB, rootID uint) ([]uint, error) {
	ids := []uint{rootID}
	frontier := []uint{rootID}
	for depth := 0; depth < 8 && len(frontier) > 0; depth++ {
		var children []models.Category
		if err := db.Where("parent_id IN ?", frontier).Find(&children).Error; err != nil {
			return ids, err
		}
		frontier = frontier[:0]
		for _, child := range children {
			ids = append(ids, child.ID)
			frontier = append(frontier, child.ID)
		}
	}
	return ids, nil
}
