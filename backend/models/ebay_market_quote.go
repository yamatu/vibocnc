package models

import "time"

// EbayMarketQuote stores the aggregated eBay price research for one model
// number. It is the price signal the storefront prices against, and it also
// carries the evidence (representative listings) that the AI identification
// step reads in order to understand what the part actually is.
//
// Rows are keyed by MatchKey (normalized brand + model) so re-running the
// crawler updates a quote instead of piling up duplicates.
type EbayMarketQuote struct {
	ID uint `json:"id" gorm:"primaryKey"`

	// MatchKey is the upsert key: MarketQuoteMatchKey(brand, model),
	// i.e. NormalizeBrandKey(brand) + "|" + MarketModelKey(model).
	MatchKey string `json:"match_key" gorm:"size:255;uniqueIndex"`
	Model    string `json:"model" gorm:"size:160;index"`
	// ModelNormalized is the separator-free form used for fallback lookups.
	ModelNormalized string `json:"model_normalized" gorm:"size:160;index"`
	BrandKey        string `json:"brand_key" gorm:"size:120;index"`
	Brand           string `json:"brand" gorm:"size:120"`
	Site            string `json:"site" gorm:"size:50;default:'ebay'"`

	// Price statistics. MedianPrice is what the suggestion engine reads.
	MedianPrice float64 `json:"median_price" gorm:"type:decimal(12,2);default:0.00"`
	P25Price    float64 `json:"p25_price" gorm:"type:decimal(12,2);default:0.00"`
	P75Price    float64 `json:"p75_price" gorm:"type:decimal(12,2);default:0.00"`
	MinPrice    float64 `json:"min_price" gorm:"type:decimal(12,2);default:0.00"`
	MaxPrice    float64 `json:"max_price" gorm:"type:decimal(12,2);default:0.00"`
	Currency    string  `json:"currency" gorm:"size:10;default:'USD'"`

	SampleCount  int `json:"sample_count" gorm:"default:0"`
	MatchedCount int `json:"matched_count" gorm:"default:0"`

	// ConditionMix is {"new": 12, "used": 9}.
	ConditionMix string `json:"condition_mix" gorm:"type:json"`
	// Evidence holds the representative listings (title, url, price, item
	// specifics, category path, description) used by the AI identification step.
	Evidence  string `json:"evidence" gorm:"type:longtext"`
	SearchURL string `json:"search_url" gorm:"type:text"`

	ScrapedAt time.Time `json:"scraped_at" gorm:"index"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// EbayMarketQuoteRequest is one quote in an ingest payload.
type EbayMarketQuoteRequest struct {
	Model        string           `json:"model" binding:"required"`
	BrandHint    string           `json:"brand_hint"`
	Site         string           `json:"site"`
	MedianPrice  *float64         `json:"median_price"`
	P25Price     *float64         `json:"p25_price"`
	P75Price     *float64         `json:"p75_price"`
	MinPrice     *float64         `json:"min_price"`
	MaxPrice     *float64         `json:"max_price"`
	Currency     string           `json:"currency"`
	SampleCount  int              `json:"sample_count"`
	MatchedCount int              `json:"matched_count"`
	ConditionMix map[string]int   `json:"condition_mix"`
	SearchURL    string           `json:"search_url"`
	ScrapedAt    string           `json:"scraped_at"`
	Evidence     []map[string]any `json:"evidence"`
}

// EbayMarketQuoteIngestRequest is the body of POST /admin/ebay-market/ingest.
type EbayMarketQuoteIngestRequest struct {
	Quotes []EbayMarketQuoteRequest `json:"quotes" binding:"required,min=1"`
}

// EbayMarketQuoteIngestResponse summarises an ingest run.
type EbayMarketQuoteIngestResponse struct {
	Accepted int      `json:"accepted"`
	Created  int      `json:"created"`
	Updated  int      `json:"updated"`
	Skipped  int      `json:"skipped"`
	Errors   []string `json:"errors,omitempty"`
}

// EbayMarketQuoteResponse is a quote enriched with the local product it maps to,
// so the admin list can show the price delta in one request.
type EbayMarketQuoteResponse struct {
	EbayMarketQuote
	MatchedProductID   *uint    `json:"matched_product_id"`
	MatchedProductSKU  string   `json:"matched_product_sku"`
	MatchedProductName string   `json:"matched_product_name"`
	CurrentPrice       *float64 `json:"current_price"`
	SuggestedPrice     *float64 `json:"suggested_price"`
	DeltaPercent       *float64 `json:"delta_percent"`
	// SuggestionStatus explains why a price is or is not offered:
	// ready | needs_manual_review | unchanged | insufficient_samples |
	// no_matching_product | price_sync_disabled.
	SuggestionStatus string `json:"suggestion_status"`
}

// EbayMarketQuoteListResponse is the paginated admin list payload.
type EbayMarketQuoteListResponse struct {
	Quotes []EbayMarketQuoteResponse `json:"quotes"`
	Total  int64                     `json:"total"`
	Page   int                       `json:"page"`
	Limit  int                       `json:"limit"`
}

// EbayMarketEvidenceItem is the shape of one entry inside Evidence, decoded for
// the AI identification prompt.
type EbayMarketEvidenceItem struct {
	Title           string         `json:"title"`
	URL             string         `json:"url"`
	PriceValue      float64        `json:"price_value"`
	PriceRaw        string         `json:"price_raw"`
	Condition       string         `json:"condition"`
	ImageURL        string         `json:"image_url"`
	ItemSpecifics   map[string]any `json:"item_specifics"`
	Description     string         `json:"description"`
	CategoryPath    string         `json:"category_path"`
	Model           string         `json:"model"`
	Brand           string         `json:"brand"`
	MatchConfidence float64        `json:"match_confidence"`
}

// PriceSyncPreviewRequest scopes a suggestion preview.
type PriceSyncPreviewRequest struct {
	// ProductIDs limits the preview to specific products.
	ProductIDs []uint `json:"product_ids"`
	// Brand limits to one manufacturer.
	Brand string `json:"brand"`
	// CategoryID (with IncludeDescendants) limits to a category subtree.
	CategoryID         *uint `json:"category_id"`
	IncludeDescendants bool  `json:"include_descendants"`
	// OnlyWithQuote skips products that have no market research yet.
	OnlyWithQuote bool `json:"only_with_quote"`
	// Limit bounds how many products are examined in one preview.
	Limit int `json:"limit"`
}

// PriceSyncSuggestion is one proposed price change.
type PriceSyncSuggestion struct {
	ProductID      uint    `json:"product_id"`
	SKU            string  `json:"sku"`
	Name           string  `json:"name"`
	Brand          string  `json:"brand"`
	Model          string  `json:"model"`
	CurrentPrice   float64 `json:"current_price"`
	MedianPrice    float64 `json:"median_price"`
	SuggestedPrice float64 `json:"suggested_price"`
	DeltaPercent   float64 `json:"delta_percent"`
	MatchedCount   int     `json:"matched_count"`
	Currency       string  `json:"currency"`
	Status         string  `json:"status"` // ready | needs_manual_review | insufficient_samples | unchanged | no_quote
	StatusReason   string  `json:"status_reason,omitempty"`
	QuoteID        uint    `json:"quote_id"`
	PriceLocked    bool    `json:"price_locked"`
}

// PriceSyncApplyRequest applies explicitly approved suggestions.
type PriceSyncApplyRequest struct {
	// ProductIDs are the products whose price should be changed.
	ProductIDs []uint `json:"product_ids" binding:"required,min=1"`
	// ForceProductIDs is an explicit per-product acknowledgement that a delta
	// exceeds PriceSyncMaxDeltaPct. It cannot bypass price_locked, missing quotes
	// or the minimum sample count.
	ForceProductIDs []uint `json:"force_product_ids,omitempty"`
	// Reason is stored in the response and audit trail.
	Reason string `json:"reason"`
}

// PriceSyncApplyResult summarises an apply run.
type PriceSyncApplyResult struct {
	Updated int                    `json:"updated"`
	Skipped int                    `json:"skipped"`
	Items   []PriceSyncAppliedItem `json:"items"`
	Errors  []string               `json:"errors,omitempty"`
}

// PriceSyncAppliedItem is one changed product.
type PriceSyncAppliedItem struct {
	ProductID    uint    `json:"product_id"`
	SKU          string  `json:"sku"`
	OldPrice     float64 `json:"old_price"`
	NewPrice     float64 `json:"new_price"`
	DeltaPercent float64 `json:"delta_percent"`
	MedianPrice  float64 `json:"median_price"`
	QuoteID      uint    `json:"quote_id"`
}
