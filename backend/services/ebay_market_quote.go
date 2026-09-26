package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// MarketQuoteMatchKey builds the upsert key for a market quote. It mirrors the
// crawler side (ebay_scraper.model_matcher.normalize_model) so a model that was
// matched while scraping resolves to the same row here.
func MarketQuoteMatchKey(brand, model string) string {
	brandKey := NormalizeBrandKey(brand)
	normalized := MarketModelKey(model)
	if brandKey == "" {
		return normalized
	}
	return brandKey + "|" + normalized
}

// MarketModelKey reduces a model number to the alphanumeric form used as the
// market-research key. It mirrors ebay_scraper.model_matcher.normalize_model
// exactly: uppercase, OEM marker removed, every non-alphanumeric character
// dropped. Both sides must agree or a scraped model never resolves to its row.
//
// It is deliberately not Product.ModelNormalized: that value is part of the
// storefront's SKU scheme and keeps separators, so it is not interchangeable.
func MarketModelKey(model string) string {
	upper := strings.ToUpper(strings.TrimSpace(model))
	if upper == "" {
		return ""
	}
	upper = strings.ReplaceAll(upper, "OEM", "")
	var builder strings.Builder
	builder.Grow(len(upper))
	for _, r := range upper {
		if (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

// IngestMarketQuotes upserts crawler output. It is idempotent per MatchKey: a
// re-run of the same model updates the row instead of creating a duplicate.
func IngestMarketQuotes(db *gorm.DB, req models.EbayMarketQuoteIngestRequest) (models.EbayMarketQuoteIngestResponse, error) {
	response := models.EbayMarketQuoteIngestResponse{}
	if db == nil {
		return response, errors.New("database is not available")
	}

	for _, item := range req.Quotes {
		model := strings.TrimSpace(item.Model)
		if model == "" {
			response.Skipped++
			response.Errors = append(response.Errors, "quote without a model number")
			continue
		}

		brand := CanonicalBrandName(item.BrandHint)
		brandKey := NormalizeBrandKey(brand)
		if brandKey == "" {
			// No brand hint: try to infer it from the model so the quote can
			// still be matched to a branded product later.
			if inferred := inferBrandKeyFromModel(model); inferred != "" && inferred != "unknown" {
				brandKey = inferred
				brand = CanonicalBrandName(inferred)
			}
		}

		matchKey := MarketQuoteMatchKey(brand, model)
		// Stored in the market key form (alphanumeric), matching the crawler,
		// so the brand-agnostic fallback lookup in LookupMarketQuote finds it.
		normalized := MarketModelKey(model)

		conditionMix, _ := json.Marshal(normalizeConditionMix(item.ConditionMix))
		evidence, _ := json.Marshal(sanitizeMarketEvidence(item.Evidence))

		scrapedAt := parseMarketScrapedAt(item.ScrapedAt)

		quote := models.EbayMarketQuote{
			MatchKey:        matchKey,
			Model:           model,
			ModelNormalized: normalized,
			BrandKey:        brandKey,
			Brand:           brand,
			Site:            defaultTrimmed(item.Site, "ebay"),
			MedianPrice:     derefFloat(item.MedianPrice),
			P25Price:        derefFloat(item.P25Price),
			P75Price:        derefFloat(item.P75Price),
			MinPrice:        derefFloat(item.MinPrice),
			MaxPrice:        derefFloat(item.MaxPrice),
			Currency:        defaultTrimmed(item.Currency, "USD"),
			SampleCount:     item.SampleCount,
			MatchedCount:    item.MatchedCount,
			ConditionMix:    string(conditionMix),
			Evidence:        string(evidence),
			SearchURL:       strings.TrimSpace(item.SearchURL),
			ScrapedAt:       scrapedAt,
		}

		var existing models.EbayMarketQuote
		err := db.Where("match_key = ?", matchKey).First(&existing).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			if createErr := db.Create(&quote).Error; createErr != nil {
				response.Skipped++
				response.Errors = append(response.Errors, fmt.Sprintf("%s: %v", model, createErr))
				continue
			}
			response.Created++
			response.Accepted++
		case err != nil:
			response.Skipped++
			response.Errors = append(response.Errors, fmt.Sprintf("%s: %v", model, err))
			continue
		default:
			quote.ID = existing.ID
			quote.CreatedAt = existing.CreatedAt
			if updateErr := db.Model(&models.EbayMarketQuote{}).
				Where("id = ?", existing.ID).
				Updates(map[string]any{
					"model":            quote.Model,
					"model_normalized": quote.ModelNormalized,
					"brand_key":        quote.BrandKey,
					"brand":            quote.Brand,
					"site":             quote.Site,
					"median_price":     quote.MedianPrice,
					"p25_price":        quote.P25Price,
					"p75_price":        quote.P75Price,
					"min_price":        quote.MinPrice,
					"max_price":        quote.MaxPrice,
					"currency":         quote.Currency,
					"sample_count":     quote.SampleCount,
					"matched_count":    quote.MatchedCount,
					"condition_mix":    quote.ConditionMix,
					"evidence":         quote.Evidence,
					"search_url":       quote.SearchURL,
					"scraped_at":       quote.ScrapedAt,
					"updated_at":       time.Now().UTC(),
				}).Error; updateErr != nil {
				response.Skipped++
				response.Errors = append(response.Errors, fmt.Sprintf("%s: %v", model, updateErr))
				continue
			}
			response.Updated++
			response.Accepted++
		}
	}

	return response, nil
}

// LookupMarketQuote resolves the best market quote for a brand/model pair.
// Exact MatchKey wins; otherwise it falls back to the normalized model alone so
// a product whose brand field is empty still finds its quote.
func LookupMarketQuote(db *gorm.DB, brand, model string) (*models.EbayMarketQuote, error) {
	if db == nil {
		return nil, errors.New("database is not available")
	}
	model = strings.TrimSpace(model)
	if model == "" {
		return nil, nil
	}

	var quote models.EbayMarketQuote
	matchKey := MarketQuoteMatchKey(brand, model)
	if err := db.Where("match_key = ?", matchKey).First(&quote).Error; err == nil {
		return &quote, nil
	}

	// Fall back to the bare model key so a quote whose brand was unknown at
	// scrape time is still found for the product that owns the model number.
	modelKey := MarketModelKey(model)
	if modelKey == "" {
		return nil, nil
	}
	if err := db.Where("model_normalized = ?", modelKey).
		Order("scraped_at DESC").
		First(&quote).Error; err == nil {
		return &quote, nil
	}
	return nil, nil
}

// MarketEvidenceItems decodes the stored evidence blob.
func MarketEvidenceItems(quote models.EbayMarketQuote) []models.EbayMarketEvidenceItem {
	if strings.TrimSpace(quote.Evidence) == "" {
		return nil
	}
	var items []models.EbayMarketEvidenceItem
	if err := json.Unmarshal([]byte(quote.Evidence), &items); err != nil {
		return nil
	}
	return items
}

// MarketQuoteAllowedConditions lists the listing conditions that may influence
// a price suggestion. "for parts" style listings are excluded everywhere.
var MarketQuoteAllowedConditions = map[string]bool{
	"new":         true,
	"new other":   true,
	"open box":    true,
	"refurbished": true,
	"used":        true,
	"":            true,
}

// IsMarketConditionPriceable reports whether a condition string may be priced.
func IsMarketConditionPriceable(condition string) bool {
	normalized := strings.ToLower(strings.TrimSpace(condition))
	if normalized == "" {
		return true
	}
	if strings.Contains(normalized, "parts") || strings.Contains(normalized, "not working") {
		return false
	}
	return true
}

// SuggestPriceFromQuote applies the commerce policy to a market quote. It
// returns nil when the quote is too thin or the policy disables suggestions, so
// callers can render "not enough data" instead of a wrong price.
func SuggestPriceFromQuote(db *gorm.DB, quote *models.EbayMarketQuote) *float64 {
	if quote == nil {
		return nil
	}
	policy := CurrentCommercePolicy()
	if !policy.PriceSyncEnabled {
		return nil
	}
	if quote.MatchedCount < policy.PriceSyncMinSamples {
		return nil
	}
	if quote.MedianPrice <= 0 {
		return nil
	}

	suggested := quote.MedianPrice * policy.PriceSyncFactor
	suggested = roundPriceToCents(suggested)
	if policy.PriceSyncRoundTo > 0 {
		suggested = math.Round(suggested/policy.PriceSyncRoundTo) * policy.PriceSyncRoundTo
		suggested = roundPriceToCents(suggested)
	}
	if suggested <= 0 {
		return nil
	}
	return &suggested
}

// PriceDeltaPercent reports how far the current price is from a suggestion.
func PriceDeltaPercent(current, suggested float64) float64 {
	if current <= 0 {
		return 0
	}
	return roundPriceToCents((suggested - current) / current * 100)
}

// PriceSuggestionStatus classifies a proposed change for the review UI.
func PriceSuggestionStatus(delta float64, policy models.CommercePolicySetting, matched int) string {
	if matched < policy.PriceSyncMinSamples {
		return "insufficient_samples"
	}
	if math.Abs(delta) > policy.PriceSyncMaxDeltaPct {
		return "needs_manual_review"
	}
	if math.Abs(delta) < 0.5 {
		return "unchanged"
	}
	return "ready"
}

// ---------------------------------------------------------------- helpers

func sanitizeMarketEvidence(items []map[string]any) []map[string]any {
	if len(items) == 0 {
		return []map[string]any{}
	}
	// Keep the payload bounded: the AI prompt only reads a handful of listings.
	const maxEvidence = 12
	out := make([]map[string]any, 0, len(items))
	for index, item := range items {
		if index >= maxEvidence {
			break
		}
		cleaned := map[string]any{}
		for key, value := range item {
			switch typed := value.(type) {
			case string:
				// Descriptions can be huge; the AI does not need all of it.
				cleaned[key] = truncateText(typed, 4000)
			default:
				cleaned[key] = value
			}
		}
		out = append(out, cleaned)
	}
	return out
}

func normalizeConditionMix(raw map[string]int) map[string]int {
	out := map[string]int{}
	for key, value := range raw {
		key = strings.ToLower(strings.TrimSpace(key))
		if key == "" || value <= 0 {
			continue
		}
		out[key] = value
	}
	return out
}

func parseMarketScrapedAt(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Now().UTC()
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.UTC()
		}
	}
	return time.Now().UTC()
}

func derefFloat(value *float64) float64 {
	if value == nil {
		return 0
	}
	return roundPriceToCents(*value)
}

func roundPriceToCents(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return math.Round(value*100) / 100
}

// MarketQuoteSortForOrders is a small helper used by tests to keep a stable
// ordering when comparing quote lists.
func MarketQuoteSortForOrders(quotes []models.EbayMarketQuote) []models.EbayMarketQuote {
	sort.SliceStable(quotes, func(i, j int) bool {
		return quotes[i].MatchKey < quotes[j].MatchKey
	})
	return quotes
}

// MatchProductsForMarketQuotes resolves a page of market quotes to catalogue
// products with the same cross-language model key used by the crawler.
//
// Product does not have a model_normalized database column, so this work must
// not be expressed as `WHERE model_normalized = ?`. Load the small identity
// projection once, index it in memory, and match every quote in O(products +
// quotes). A bare-model collision is deliberately left unmatched unless the
// quote's brand disambiguates it.
func MatchProductsForMarketQuotes(db *gorm.DB, quotes []models.EbayMarketQuote) (map[uint]models.Product, error) {
	matches := make(map[uint]models.Product)
	if db == nil || len(quotes) == 0 {
		return matches, nil
	}

	var products []models.Product
	if err := db.Select(
		"id", "sku", "name", "price", "brand", "model", "part_number", "price_locked", "is_active",
	).Find(&products).Error; err != nil {
		return nil, err
	}

	return matchProductsForMarketQuotes(products, quotes), nil
}

// matchProductsForMarketQuotes is the pure matching core, split out so model
// collisions and brand-prefixed SKUs can be regression-tested without a live
// database.
func matchProductsForMarketQuotes(products []models.Product, quotes []models.EbayMarketQuote) map[uint]models.Product {
	matches := make(map[uint]models.Product)
	brandIndex := make(map[string]models.Product)
	brandAmbiguous := make(map[string]bool)
	bareIndex := make(map[string]models.Product)
	bareAmbiguous := make(map[string]bool)

	for _, product := range products {
		identity := ProductClassificationModelFor(product)
		if stripped, ok := StripKnownBrandPrefix(identity); ok {
			identity = stripped
		}
		modelKey := MarketModelKey(identity)
		if modelKey == "" {
			continue
		}
		brandKey := NormalizeBrandKey(product.Brand)
		if brandKey != "" {
			key := brandKey + "|" + modelKey
			if existing, found := brandIndex[key]; found && existing.ID != product.ID {
				brandAmbiguous[key] = true
			} else {
				brandIndex[key] = product
			}
		}
		if existing, found := bareIndex[modelKey]; found && existing.ID != product.ID {
			bareAmbiguous[modelKey] = true
		} else {
			bareIndex[modelKey] = product
		}
	}

	for _, quote := range quotes {
		modelKey := quote.ModelNormalized
		if modelKey == "" {
			modelKey = MarketModelKey(quote.Model)
		}
		if modelKey == "" {
			continue
		}

		if quote.BrandKey != "" {
			key := quote.BrandKey + "|" + modelKey
			if product, found := brandIndex[key]; found && !brandAmbiguous[key] {
				matches[quote.ID] = product
				continue
			}
		}
		if product, found := bareIndex[modelKey]; found && !bareAmbiguous[modelKey] {
			matches[quote.ID] = product
		}
	}
	return matches
}

// LookupProductByMarketModel is the single-model form used by product
// identification. A nil result means no unique catalogue product owns the
// model; callers must not guess among collisions.
func LookupProductByMarketModel(db *gorm.DB, brand, model string) (*models.Product, error) {
	quote := models.EbayMarketQuote{
		ID:              1,
		BrandKey:        NormalizeBrandKey(brand),
		Brand:           brand,
		Model:           model,
		ModelNormalized: MarketModelKey(model),
	}
	matches, err := MatchProductsForMarketQuotes(db, []models.EbayMarketQuote{quote})
	if err != nil {
		return nil, err
	}
	product, ok := matches[quote.ID]
	if !ok {
		return nil, nil
	}
	return &product, nil
}
