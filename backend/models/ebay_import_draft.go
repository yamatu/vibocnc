package models

import "time"

// EbayImportDraft stores scraped marketplace items before they are confirmed into products.
type EbayImportDraft struct {
	ID uint `json:"id" gorm:"primaryKey"`

	SourceType string `json:"source_type" gorm:"size:50;not null;default:'browser_extension';index"`
	SourceSite string `json:"source_site" gorm:"size:100;not null;default:'ebay';index"`
	SourceURL  string `json:"source_url" gorm:"type:text"`
	EbayItemID string `json:"ebay_item_id" gorm:"size:100;index"`
	ListingID  string `json:"listing_id" gorm:"size:100;index"`

	RawPayload     string `json:"raw_payload" gorm:"type:longtext"`
	TitleRaw       string `json:"title_raw" gorm:"type:text"`
	DescriptionRaw string `json:"description_raw" gorm:"type:longtext"`
	PriceRaw       string `json:"price_raw" gorm:"size:100"`
	CurrencyRaw    string `json:"currency_raw" gorm:"size:20"`

	NormalizedTitle      string  `json:"normalized_title" gorm:"type:text"`
	NormalizedBrand      string  `json:"normalized_brand" gorm:"size:120;index"`
	NormalizedModel      string  `json:"normalized_model" gorm:"size:160;index"`
	NormalizedPartNumber string  `json:"normalized_part_number" gorm:"size:160;index"`
	NormalizedMPN        string  `json:"normalized_mpn" gorm:"size:160;index"`
	NormalizedPrice      float64 `json:"normalized_price" gorm:"type:decimal(10,2);default:0.00"`

	SuggestedCategoryID   *uint     `json:"suggested_category_id" gorm:"index"`
	SuggestedCategory     *Category `json:"suggested_category,omitempty" gorm:"foreignKey:SuggestedCategoryID"`
	SuggestedCategoryName string    `json:"suggested_category_name" gorm:"size:255"`
	SuggestedPartType     string    `json:"suggested_part_type" gorm:"size:120"`
	TaxonomyStatus        string    `json:"taxonomy_status" gorm:"size:50;default:'needs_review';index"`

	MatchStatus      string   `json:"match_status" gorm:"size:50;default:'new_unique';index"`
	MatchedProductID *uint    `json:"matched_product_id" gorm:"index"`
	MatchedProduct   *Product `json:"matched_product,omitempty" gorm:"foreignKey:MatchedProductID"`
	MatchScore       float64  `json:"match_score" gorm:"type:decimal(5,2);default:0.00"`
	MatchReason      string   `json:"match_reason" gorm:"type:text"`

	MetaTitle       string `json:"meta_title" gorm:"size:255"`
	MetaDescription string `json:"meta_description" gorm:"type:text"`
	MetaKeywords    string `json:"meta_keywords" gorm:"type:text"`
	DisableAutoSEO  bool   `json:"disable_auto_seo" gorm:"default:false;index"`

	MainImageSourceURL string `json:"main_image_source_url" gorm:"type:text"`
	ImageSourceURLs    string `json:"image_source_urls" gorm:"type:json"`
	MediaAssetIDs      string `json:"media_asset_ids" gorm:"type:json"`

	ImportAction      string `json:"import_action" gorm:"size:50;default:''"`
	Status            string `json:"status" gorm:"size:50;default:'pending';index"`
	ReviewNote        string `json:"review_note" gorm:"type:text"`
	FailureReason     string `json:"failure_reason" gorm:"type:text"`
	ImportedProductID *uint  `json:"imported_product_id" gorm:"index"`

	ConfirmedBy *uint      `json:"confirmed_by" gorm:"index"`
	ConfirmedAt *time.Time `json:"confirmed_at"`
	ImportedAt  *time.Time `json:"imported_at"`
	CreatedAt   time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type EbayImportDraftUploadRequest struct {
	Items []map[string]interface{} `json:"items" binding:"required,min=1"`
}

type EbayImportDraftUpdateRequest struct {
	NormalizedTitle      *string  `json:"normalized_title"`
	NormalizedBrand      *string  `json:"normalized_brand"`
	NormalizedModel      *string  `json:"normalized_model"`
	NormalizedPartNumber *string  `json:"normalized_part_number"`
	NormalizedMPN        *string  `json:"normalized_mpn"`
	NormalizedPrice      *float64 `json:"normalized_price"`
	SuggestedCategoryID  *uint    `json:"suggested_category_id"`
	ImportAction         *string  `json:"import_action"`
	MetaTitle            *string  `json:"meta_title"`
	MetaDescription      *string  `json:"meta_description"`
	MetaKeywords         *string  `json:"meta_keywords"`
	DisableAutoSEO       *bool    `json:"disable_auto_seo"`
	ReviewNote           *string  `json:"review_note"`
	Status               *string  `json:"status"`
}

type EbayImportDraftConfirmRequest struct {
	Action string `json:"action"`
}

type EbayImportDraftBulkConfirmRequest struct {
	IDs    []uint `json:"ids" binding:"required,min=1"`
	Action string `json:"action"`
}

type EbayImportDraftBulkDeleteRequest struct {
	IDs []uint `json:"ids" binding:"required,min=1"`
}

type EbayImportDraftBulkRecheckRequest struct {
	IDs []uint `json:"ids" binding:"required,min=1"`
}

type EbayImportDraftListResponse struct {
	Items      []interface{} `json:"items"`
	Page       int           `json:"page"`
	PageSize   int           `json:"page_size"`
	Total      int64         `json:"total"`
	TotalPages int           `json:"total_pages"`
}
