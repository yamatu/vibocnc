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

	NormalizedDescription      string `json:"normalized_description" gorm:"type:longtext"`
	NormalizedShortDescription string `json:"normalized_short_description" gorm:"type:text"`
	ExcludeSourceImages        bool   `json:"exclude_source_images" gorm:"not null;default:false"`

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
	// CategoryMode records whether the AI proposal used source taxonomy or the mixed brand/type taxonomy.
	CategoryMode string `json:"category_mode" gorm:"size:20;default:'source';index"`

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

	// ---------------------------------------------------------- AI review --
	AIReviewStatus string     `json:"ai_review_status" gorm:"size:32;default:'';index"`
	AIReviewedAt   *time.Time `json:"ai_reviewed_at"`
	AIReviewError  string     `json:"ai_review_error" gorm:"type:text"`

	ProposedName             string `json:"proposed_name" gorm:"type:text"`
	ProposedShortDescription string `json:"proposed_short_description" gorm:"type:text"`
	ProposedDescription      string `json:"proposed_description" gorm:"type:longtext"`
	ProposedCategoryID       *uint  `json:"proposed_category_id" gorm:"index"`
	ProposedCategoryName     string `json:"proposed_category_name" gorm:"size:255"`
	ProposedCategoryCreated  bool   `json:"proposed_category_created" gorm:"default:false"`
	ProposedBrand            string `json:"proposed_brand" gorm:"size:120"`
	ProposedModel            string `json:"proposed_model" gorm:"size:160"`
	ProposedPartType         string `json:"proposed_part_type" gorm:"size:120"`
	ProposedMetaTitle        string `json:"proposed_meta_title" gorm:"size:255"`
	ProposedMetaDescription  string `json:"proposed_meta_description" gorm:"type:text"`
	ProposedMetaKeywords     string `json:"proposed_meta_keywords" gorm:"type:text"`
	ProposedImages           string `json:"proposed_images" gorm:"type:json"`
	AIReviewNotes            string `json:"ai_review_notes" gorm:"type:text"`

	ConfirmedBy *uint      `json:"confirmed_by" gorm:"index"`
	ConfirmedAt *time.Time `json:"confirmed_at"`
	ImportedAt  *time.Time `json:"imported_at"`
	CreatedAt   time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type EbayImportDraftUploadRequest struct {
	Items         []map[string]interface{} `json:"items" binding:"required,min=1"`
	IncludeImages *bool                    `json:"include_images"`
}

func (r EbayImportDraftUploadRequest) WantsImages() bool {
	return r.IncludeImages == nil || *r.IncludeImages
}

type EbayImportDraftUpdateRequest struct {
	NormalizedDescription      *string  `json:"normalized_description"`
	NormalizedShortDescription *string  `json:"normalized_short_description"`
	IncludeImages              *bool    `json:"include_images"`
	NormalizedTitle            *string  `json:"normalized_title"`
	NormalizedBrand            *string  `json:"normalized_brand"`
	NormalizedModel            *string  `json:"normalized_model"`
	NormalizedPartNumber       *string  `json:"normalized_part_number"`
	NormalizedMPN              *string  `json:"normalized_mpn"`
	NormalizedPrice            *float64 `json:"normalized_price"`
	SuggestedCategoryID        *uint    `json:"suggested_category_id"`
	EbayCategory               *string  `json:"ebay_category"`
	BasCategory                *string  `json:"bas_category"`
	ImportAction               *string  `json:"import_action"`
	MetaTitle                  *string  `json:"meta_title"`
	MetaDescription            *string  `json:"meta_description"`
	MetaKeywords               *string  `json:"meta_keywords"`
	DisableAutoSEO             *bool    `json:"disable_auto_seo"`
	ReviewNote                 *string  `json:"review_note"`
	Status                     *string  `json:"status"`
}

type EbayImportDraftConfirmRequest struct {
	IncludeImages *bool  `json:"include_images"`
	Action        string `json:"action"`
}
type EbayImportDraftBulkConfirmRequest struct {
	IncludeImages *bool  `json:"include_images"`
	IDs           []uint `json:"ids" binding:"required,min=1"`
	Action        string `json:"action"`
}

type EbayImportDraftBulkDeleteRequest struct {
	IDs                 []uint   `json:"ids"`
	DeleteAllAsSelected bool     `json:"delete_all_selected"`
	Search              string   `json:"search"`
	Status              string   `json:"status"`
	MatchStatus         string   `json:"match_status"`
	Brand               string   `json:"brand"`
	SourceSite          string   `json:"source_site"`
	AIReviewStatus      string   `json:"ai_review_status"`
	Statuses            []string `json:"statuses"`
}

type EbayImportDraftSelectionRequest struct {
	Search         string `json:"search"`
	Status         string `json:"status"`
	MatchStatus    string `json:"match_status"`
	Brand          string `json:"brand"`
	SourceSite     string `json:"source_site"`
	AIReviewStatus string `json:"ai_review_status"`
	EligibleOnly   bool   `json:"eligible_only"`
}

type EbayImportDraftSelectionResponse struct {
	IDs       []uint `json:"ids"`
	Total     int64  `json:"total"`
	Truncated bool   `json:"truncated"`
	Limit     int    `json:"limit"`
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

type EbayImportDraftAIReviewRequest struct {
	IDs            []uint `json:"ids"`
	AllFiltered    bool   `json:"all_filtered"`
	Search         string `json:"search"`
	Status         string `json:"status"`
	MatchStatus    string `json:"match_status"`
	Brand          string `json:"brand"`
	SourceSite     string `json:"source_site"`
	AIReviewStatus string `json:"ai_review_status"`
	CategoryMode   string `json:"category_mode"`
	AutoPublish    bool   `json:"auto_publish"`
}

type EbayImportDraftAIApproveRequest struct {
	IncludeImages     *bool  `json:"include_images"`
	IDs               []uint `json:"ids"`
	Action            string `json:"action"`
	AllReadyNewUnique bool   `json:"all_ready_new_unique"`
	SourceSite        string `json:"source_site"`
	CategoryMode      string `json:"category_mode"`
}
type EbayImportDraftAIRejectRequest struct {
	IDs    []uint `json:"ids" binding:"required,min=1"`
	Reason string `json:"reason"`
}
