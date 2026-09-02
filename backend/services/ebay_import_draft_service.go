package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

const (
	EbayDraftStatusPending       = "pending"
	EbayDraftStatusReviewed      = "reviewed"
	EbayDraftStatusConfirmed     = "confirmed"
	EbayDraftStatusImported      = "imported"
	EbayDraftStatusFailed        = "failed"
	EbayDraftStatusSkipped       = "skipped"
	EbayDraftStatusNeedsReview   = "needs_review"
	EbayDraftTaxonomyMatched     = "matched"
	EbayDraftTaxonomyNeedsReview = "needs_review"
	EbayDraftMatchNewUnique      = "new_unique"
	EbayDraftMatchPossibleDup    = "possible_duplicate"
	EbayDraftMatchExact          = "matched_exact"
)

type EbayImportDraftBuildResult struct {
	Draft               models.EbayImportDraft
	Errors              []string
	Inference           ProductCategoryInference `json:"-"`
	ClassificationModel string                   `json:"-"`
}

type EbayImportDraftListItem struct {
	ID                    uint       `json:"id"`
	SourceSite            string     `json:"source_site"`
	SourceURL             string     `json:"source_url"`
	TitleRaw              string     `json:"title_raw"`
	NormalizedTitle       string     `json:"normalized_title"`
	NormalizedBrand       string     `json:"normalized_brand"`
	NormalizedModel       string     `json:"normalized_model"`
	NormalizedPartNumber  string     `json:"normalized_part_number"`
	NormalizedMPN         string     `json:"normalized_mpn"`
	NormalizedPrice       float64    `json:"normalized_price"`
	SuggestedCategoryID   *uint      `json:"suggested_category_id"`
	SuggestedCategoryName string     `json:"suggested_category_name"`
	SuggestedPartType     string     `json:"suggested_part_type"`
	TaxonomyStatus        string     `json:"taxonomy_status"`
	MatchStatus           string     `json:"match_status"`
	MatchedProductID      *uint      `json:"matched_product_id"`
	MatchScore            float64    `json:"match_score"`
	MatchReason           string     `json:"match_reason"`
	DisableAutoSEO        bool       `json:"disable_auto_seo"`
	ImportAction          string     `json:"import_action"`
	Status                string     `json:"status"`
	FailureReason         string     `json:"failure_reason"`
	ImportedProductID     *uint      `json:"imported_product_id"`
	ConfirmedAt           *time.Time `json:"confirmed_at"`
	ImportedAt            *time.Time `json:"imported_at"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
	MatchedProduct        *struct {
		ID         uint   `json:"id"`
		SKU        string `json:"sku"`
		Name       string `json:"name"`
		Slug       string `json:"slug"`
		CategoryID uint   `json:"category_id"`
	} `json:"matched_product,omitempty"`
	SuggestedCategory *struct {
		ID   uint   `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
	} `json:"suggested_category,omitempty"`
}

type EbayImportDraftDetailResponse struct {
	ID                    uint                        `json:"id"`
	SourceType            string                      `json:"source_type"`
	SourceSite            string                      `json:"source_site"`
	SourceURL             string                      `json:"source_url"`
	EbayItemID            string                      `json:"ebay_item_id"`
	ListingID             string                      `json:"listing_id"`
	RawPayload            map[string]any              `json:"raw_payload"`
	TitleRaw              string                      `json:"title_raw"`
	DescriptionRaw        string                      `json:"description_raw"`
	PriceRaw              string                      `json:"price_raw"`
	CurrencyRaw           string                      `json:"currency_raw"`
	NormalizedTitle       string                      `json:"normalized_title"`
	NormalizedBrand       string                      `json:"normalized_brand"`
	NormalizedModel       string                      `json:"normalized_model"`
	NormalizedPartNumber  string                      `json:"normalized_part_number"`
	NormalizedMPN         string                      `json:"normalized_mpn"`
	NormalizedPrice       float64                     `json:"normalized_price"`
	SuggestedCategoryID   *uint                       `json:"suggested_category_id"`
	SuggestedCategoryName string                      `json:"suggested_category_name"`
	SuggestedPartType     string                      `json:"suggested_part_type"`
	TaxonomyStatus        string                      `json:"taxonomy_status"`
	MatchStatus           string                      `json:"match_status"`
	MatchedProductID      *uint                       `json:"matched_product_id"`
	MatchScore            float64                     `json:"match_score"`
	MatchReason           string                      `json:"match_reason"`
	MetaTitle             string                      `json:"meta_title"`
	MetaDescription       string                      `json:"meta_description"`
	MetaKeywords          string                      `json:"meta_keywords"`
	DisableAutoSEO        bool                        `json:"disable_auto_seo"`
	MainImageSourceURL    string                      `json:"main_image_source_url"`
	ImageSourceURLs       []string                    `json:"image_source_urls"`
	MediaAssetIDs         []uint                      `json:"media_asset_ids"`
	MediaAssets           []models.MediaAssetResponse `json:"media_assets"`
	ImportAction          string                      `json:"import_action"`
	Status                string                      `json:"status"`
	ReviewNote            string                      `json:"review_note"`
	FailureReason         string                      `json:"failure_reason"`
	ImportedProductID     *uint                       `json:"imported_product_id"`
	ConfirmedBy           *uint                       `json:"confirmed_by"`
	ConfirmedAt           *time.Time                  `json:"confirmed_at"`
	ImportedAt            *time.Time                  `json:"imported_at"`
	CreatedAt             time.Time                   `json:"created_at"`
	UpdatedAt             time.Time                   `json:"updated_at"`
	MatchedProduct        *models.Product             `json:"matched_product,omitempty"`
	SuggestedCategory     *models.Category            `json:"suggested_category,omitempty"`
}

type EbayImportDraftFilters struct {
	Page        int
	PageSize    int
	Search      string
	Status      string
	MatchStatus string
	Brand       string
}

func BuildEbayImportDraft(db *gorm.DB, raw map[string]any) EbayImportDraftBuildResult {
	return BuildEbayImportDraftWithContext(context.Background(), db, raw)
}

// BuildEbayImportDraftWithContext keeps marketplace classification on the same
// bounded local-first/web-evidence path as spreadsheet imports. The context is
// supplied by the request so an upload can be cancelled without leaving a
// search request running in the background.
func BuildEbayImportDraftWithContext(ctx context.Context, db *gorm.DB, raw map[string]any) EbayImportDraftBuildResult {
	if ctx == nil {
		ctx = context.Background()
	}
	result := EbayImportDraftBuildResult{}
	if raw == nil {
		result.Errors = append(result.Errors, "empty item payload")
		return result
	}
	raw = NormalizeEbayImportDraftPayload(raw)

	rawJSON, _ := json.Marshal(raw)
	title := firstNonEmptyString(raw["product_title"], raw["title"])
	description := firstNonEmptyString(raw["description_full"], raw["description_html"], raw["description"])
	priceRaw := firstNonEmptyString(raw["current_price"], raw["price"])
	currencyRaw := detectCurrency(raw, priceRaw)
	brand := CanonicalBrandName(firstNonEmptyString(raw["brand"]))
	model := NormalizeProductModel(firstNonEmptyString(raw["model"]))
	mpn := NormalizeProductModel(firstNonEmptyString(raw["mpn"]))
	partNumber := NormalizeProductModel(firstNonEmptyString(raw["part_number"], raw["sku"], raw["part_number_candidate"]))
	if partNumber == "" {
		partNumber = mpn
	}
	if model == "" {
		model = partNumber
	}
	normalizedTitle := normalizeDraftTitle(title)
	priceValue := parsePriceFloat(priceRaw)
	mainImage := normalizeURLString(firstNonEmptyString(raw["main_image"], raw["image"]))
	imageURLs := collectImageURLs(raw)
	mediaAssetIDs := []uint{}
	if !isShopifyImportPayload(raw) {
		// eBay imports keep the historical local-media behavior. Shopify
		// collection imports can contain tens of thousands of images, so retain
		// their source URLs and let product confirmation use those URLs directly.
		var mediaErrors []string
		mediaAssetIDs, mediaErrors = importDraftImages(db, imageURLs)
		if len(mediaErrors) > 0 {
			result.Errors = append(result.Errors, mediaErrors...)
		}
	}
	if mainImage == "" && len(imageURLs) > 0 {
		mainImage = imageURLs[0]
	}

	classificationModel := firstNonEmptyString(model, mpn, partNumber)
	inference := InferProductCategory(brand, classificationModel)
	// Shopify collection uploads can contain thousands of items. Keep the
	// initial ingest local and leave optional web verification for an explicit
	// draft recheck/confirmation action.
	if classificationModel != "" && !IsConfirmedProductCategory(inference, classificationModel) && !isShopifyImportPayload(raw) {
		searchCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		inference, _, _ = ResolveProductCategoryWithWebEvidence(searchCtx, brand, classificationModel)
		cancel()
	}
	// Treat placeholder brands from marketplace payloads as missing. When the
	// model rules or web evidence verify a manufacturer, persist its canonical
	// name so an inferred category can never be published as brand "Unknown".
	if NormalizeBrandKey(brand) == "" && inference.BrandKey != "" && inference.BrandKey != "unknown" {
		brand = CanonicalBrandName(inference.BrandKey)
	}
	suggestedCategoryID, suggestedCategoryName, taxonomyStatus := resolveDraftSuggestedCategory(db, inference, raw, classificationModel)
	matchStatus, matchedProductID, matchScore, matchReason := matchDraftProduct(db, brand, model, partNumber, mpn, normalizedTitle)
	metaTitle, metaDescription, metaKeywords := buildDraftSEO(normalizedTitle, description, brand, model, partNumber, mpn, inference.PartType)

	imageURLsJSON, _ := json.Marshal(imageURLs)
	mediaIDsJSON, _ := json.Marshal(mediaAssetIDs)

	result.Draft = models.EbayImportDraft{
		SourceType:            defaultTrimmed(firstNonEmptyString(raw["source_type"]), "browser_extension"),
		SourceSite:            defaultTrimmed(firstNonEmptyString(raw["site"], raw["source_site"]), "ebay"),
		SourceURL:             firstNonEmptyString(raw["product_url"], raw["source_url"]),
		EbayItemID:            firstNonEmptyString(raw["product_id"], raw["ebay_item_id"]),
		ListingID:             firstNonEmptyString(raw["listing_id"]),
		RawPayload:            string(rawJSON),
		TitleRaw:              title,
		DescriptionRaw:        description,
		PriceRaw:              priceRaw,
		CurrencyRaw:           currencyRaw,
		NormalizedTitle:       normalizedTitle,
		NormalizedBrand:       brand,
		NormalizedModel:       model,
		NormalizedPartNumber:  partNumber,
		NormalizedMPN:         mpn,
		NormalizedPrice:       priceValue,
		SuggestedCategoryID:   suggestedCategoryID,
		SuggestedCategoryName: suggestedCategoryName,
		SuggestedPartType:     defaultTrimmed(inference.PartType, "Spare Part"),
		TaxonomyStatus:        taxonomyStatus,
		MatchStatus:           matchStatus,
		MatchedProductID:      matchedProductID,
		MatchScore:            matchScore,
		MatchReason:           matchReason,
		MetaTitle:             metaTitle,
		MetaDescription:       metaDescription,
		MetaKeywords:          metaKeywords,
		DisableAutoSEO:        false,
		MainImageSourceURL:    mainImage,
		ImageSourceURLs:       string(imageURLsJSON),
		MediaAssetIDs:         string(mediaIDsJSON),
		ImportAction:          defaultImportAction(matchStatus),
		Status:                deriveDraftStatus(matchStatus, taxonomyStatus),
	}
	result.Inference = inference
	result.ClassificationModel = classificationModel
	return result
}

// VerifyEbayImportDraftCategory is the final publication gate for marketplace
// drafts. Manual category choices are still allowed, but only when the selected
// category is an enabled leaf that matches the verified brand and product type.
func VerifyEbayImportDraftCategory(ctx context.Context, db *gorm.DB, draft models.EbayImportDraft) (ProductCategoryInference, string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	model := NormalizeProductModel(firstNonEmptyString(draft.NormalizedModel, draft.NormalizedPartNumber, draft.NormalizedMPN))
	if model == "" {
		return ProductCategoryInference{}, "", errors.New("draft requires a verified model or part number")
	}
	inference := InferProductCategory(draft.NormalizedBrand, model)
	if !IsConfirmedProductCategory(inference, model) {
		searchCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		inference, _, _ = ResolveProductCategoryWithWebEvidence(searchCtx, draft.NormalizedBrand, model)
		cancel()
	}
	path, err := verifyEbayImportDraftCategoryWithInference(db, draft, inference, model)
	if err != nil {
		return inference, "", err
	}
	return inference, path, nil
}

// ValidateEbayImportDraftCategoryWithInference validates a draft against an
// inference already produced by a preceding recheck, avoiding another web
// search during the confirmation request.
func ValidateEbayImportDraftCategoryWithInference(db *gorm.DB, draft models.EbayImportDraft, inference ProductCategoryInference) (string, error) {
	model := NormalizeProductModel(firstNonEmptyString(draft.NormalizedModel, draft.NormalizedPartNumber, draft.NormalizedMPN))
	return verifyEbayImportDraftCategoryWithInference(db, draft, inference, model)
}

func verifyEbayImportDraftCategoryWithInference(db *gorm.DB, draft models.EbayImportDraft, inference ProductCategoryInference, model string) (string, error) {
	if !IsConfirmedProductCategory(inference, model) {
		return "", fmt.Errorf("draft classification is unresolved for %s", model)
	}
	if draft.SuggestedCategoryID == nil || *draft.SuggestedCategoryID == 0 {
		return "", errors.New("draft category must be confirmed before import")
	}
	return ValidateExistingCategoryForInference(db, *draft.SuggestedCategoryID, inference)
}

func ListEbayImportDrafts(db *gorm.DB, filters EbayImportDraftFilters) (models.EbayImportDraftListResponse, error) {
	if filters.Page <= 0 {
		filters.Page = 1
	}
	if filters.PageSize <= 0 {
		filters.PageSize = 20
	}

	query := db.Model(&models.EbayImportDraft{}).
		Preload("MatchedProduct", func(tx *gorm.DB) *gorm.DB {
			return tx.Select("id", "sku", "name", "slug", "category_id")
		}).
		Preload("SuggestedCategory", func(tx *gorm.DB) *gorm.DB {
			return tx.Select("id", "name", "slug")
		})

	applyEbayImportDraftFilters(&query, filters)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return models.EbayImportDraftListResponse{}, err
	}

	var drafts []models.EbayImportDraft
	offset := (filters.Page - 1) * filters.PageSize
	if err := query.Order("created_at DESC").Offset(offset).Limit(filters.PageSize).Find(&drafts).Error; err != nil {
		return models.EbayImportDraftListResponse{}, err
	}

	items := make([]interface{}, 0, len(drafts))
	for _, draft := range drafts {
		items = append(items, summarizeDraft(draft))
	}

	return models.EbayImportDraftListResponse{
		Items:      items,
		Page:       filters.Page,
		PageSize:   filters.PageSize,
		Total:      total,
		TotalPages: int(math.Ceil(float64(total) / float64(filters.PageSize))),
	}, nil
}

// ListEbayImportDraftIDs returns every draft ID matching the supplied filters.
// It is used by the admin "select all" action so selection is not limited to
// the currently visible page.
func ListEbayImportDraftIDs(db *gorm.DB, filters EbayImportDraftFilters, eligibleOnly bool) ([]uint, error) {
	query := db.Model(&models.EbayImportDraft{})
	applyEbayImportDraftFilters(&query, filters)
	if eligibleOnly {
		query = query.Where("status NOT IN ?", []string{EbayDraftStatusImported, EbayDraftStatusSkipped}).
			Where("taxonomy_status = ?", EbayDraftTaxonomyMatched).
			Where("suggested_category_id IS NOT NULL AND suggested_category_id > 0").
			Where("match_status IN ?", []string{EbayDraftMatchNewUnique, EbayDraftMatchExact}).
			Where("COALESCE(NULLIF(normalized_model, ''), NULLIF(normalized_part_number, ''), NULLIF(normalized_mpn, '')) IS NOT NULL")
	}
	var ids []uint
	if err := query.Order("id ASC").Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func GetEbayImportDraftDetail(db *gorm.DB, id uint) (*EbayImportDraftDetailResponse, error) {
	var draft models.EbayImportDraft
	if err := db.Preload("MatchedProduct").Preload("SuggestedCategory").First(&draft, id).Error; err != nil {
		return nil, err
	}

	rawPayload := decodeRawPayload(draft.RawPayload)
	mediaIDs := decodeUintSlice(draft.MediaAssetIDs)
	mediaAssets, _ := LoadMediaAssetResponses(db, mediaIDs)

	return &EbayImportDraftDetailResponse{
		ID:                    draft.ID,
		SourceType:            draft.SourceType,
		SourceSite:            draft.SourceSite,
		SourceURL:             draft.SourceURL,
		EbayItemID:            draft.EbayItemID,
		ListingID:             draft.ListingID,
		RawPayload:            rawPayload,
		TitleRaw:              draft.TitleRaw,
		DescriptionRaw:        draft.DescriptionRaw,
		PriceRaw:              draft.PriceRaw,
		CurrencyRaw:           draft.CurrencyRaw,
		NormalizedTitle:       draft.NormalizedTitle,
		NormalizedBrand:       draft.NormalizedBrand,
		NormalizedModel:       draft.NormalizedModel,
		NormalizedPartNumber:  draft.NormalizedPartNumber,
		NormalizedMPN:         draft.NormalizedMPN,
		NormalizedPrice:       draft.NormalizedPrice,
		SuggestedCategoryID:   draft.SuggestedCategoryID,
		SuggestedCategoryName: draft.SuggestedCategoryName,
		SuggestedPartType:     draft.SuggestedPartType,
		TaxonomyStatus:        draft.TaxonomyStatus,
		MatchStatus:           draft.MatchStatus,
		MatchedProductID:      draft.MatchedProductID,
		MatchScore:            draft.MatchScore,
		MatchReason:           draft.MatchReason,
		MetaTitle:             draft.MetaTitle,
		MetaDescription:       draft.MetaDescription,
		MetaKeywords:          draft.MetaKeywords,
		DisableAutoSEO:        draft.DisableAutoSEO,
		MainImageSourceURL:    draft.MainImageSourceURL,
		ImageSourceURLs:       decodeStringSlice(draft.ImageSourceURLs),
		MediaAssetIDs:         mediaIDs,
		MediaAssets:           mediaAssets,
		ImportAction:          draft.ImportAction,
		Status:                draft.Status,
		ReviewNote:            draft.ReviewNote,
		FailureReason:         draft.FailureReason,
		ImportedProductID:     draft.ImportedProductID,
		ConfirmedBy:           draft.ConfirmedBy,
		ConfirmedAt:           draft.ConfirmedAt,
		ImportedAt:            draft.ImportedAt,
		CreatedAt:             draft.CreatedAt,
		UpdatedAt:             draft.UpdatedAt,
		MatchedProduct:        draft.MatchedProduct,
		SuggestedCategory:     draft.SuggestedCategory,
	}, nil
}

func RecheckEbayImportDraft(db *gorm.DB, draft *models.EbayImportDraft) error {
	return RecheckEbayImportDraftWithContext(context.Background(), db, draft)
}

func RecheckEbayImportDraftWithContext(ctx context.Context, db *gorm.DB, draft *models.EbayImportDraft) error {
	_, err := RecheckEbayImportDraftAndClassifyWithContext(ctx, db, draft)
	return err
}

// RecheckEbayImportDraftAndClassifyWithContext returns the exact inference used
// for the recheck so confirmation can revalidate the selected category without
// repeating the same public search.
func RecheckEbayImportDraftAndClassifyWithContext(ctx context.Context, db *gorm.DB, draft *models.EbayImportDraft) (ProductCategoryInference, error) {
	if draft == nil {
		return ProductCategoryInference{}, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	raw := decodeRawPayload(draft.RawPayload)
	result := BuildEbayImportDraftWithContext(ctx, db, raw)
	normalizedTitle := fallbackTrimmed(draft.NormalizedTitle, result.Draft.NormalizedTitle)
	normalizedBrand := fallbackTrimmed(draft.NormalizedBrand, result.Draft.NormalizedBrand)
	if NormalizeBrandKey(normalizedBrand) == "" && strings.TrimSpace(result.Draft.NormalizedBrand) != "" {
		normalizedBrand = result.Draft.NormalizedBrand
	}
	normalizedModel := fallbackTrimmed(draft.NormalizedModel, result.Draft.NormalizedModel)
	normalizedPartNumber := fallbackTrimmed(draft.NormalizedPartNumber, result.Draft.NormalizedPartNumber)
	normalizedMPN := fallbackTrimmed(draft.NormalizedMPN, result.Draft.NormalizedMPN)
	suggestedCategoryID := chooseUintPtr(draft.SuggestedCategoryID, result.Draft.SuggestedCategoryID)
	taxonomyStatus := result.Draft.TaxonomyStatus
	classificationModel := NormalizeProductModel(firstNonEmptyString(normalizedModel, normalizedPartNumber, normalizedMPN))
	inference := result.Inference
	if classificationModel != result.ClassificationModel || NormalizeBrandKey(normalizedBrand) != NormalizeBrandKey(result.Draft.NormalizedBrand) {
		inference = InferProductCategory(normalizedBrand, classificationModel)
	}
	// Recheck is an explicit admin action, so it may perform web verification
	// even for a Shopify draft that was ingested with local-only classification.
	if classificationModel != "" && !IsConfirmedProductCategory(inference, classificationModel) {
		searchCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		inference, _, _ = ResolveProductCategoryWithWebEvidence(searchCtx, normalizedBrand, classificationModel)
		cancel()
	}
	if suggestedCategoryID == nil || *suggestedCategoryID == 0 {
		if categoryID, err := ResolveExistingCategoryForInference(db, inference, result.Draft.SuggestedCategoryName); err == nil && categoryID > 0 {
			suggestedCategoryID = &categoryID
		}
	}
	classificationDraft := *draft
	classificationDraft.NormalizedTitle = normalizedTitle
	classificationDraft.NormalizedBrand = normalizedBrand
	classificationDraft.NormalizedModel = normalizedModel
	classificationDraft.NormalizedPartNumber = normalizedPartNumber
	classificationDraft.NormalizedMPN = normalizedMPN
	classificationDraft.SuggestedCategoryID = suggestedCategoryID
	if suggestedCategoryID != nil && *suggestedCategoryID > 0 {
		if _, err := verifyEbayImportDraftCategoryWithInference(db, classificationDraft, inference, classificationModel); err != nil {
			taxonomyStatus = EbayDraftTaxonomyNeedsReview
		} else {
			taxonomyStatus = EbayDraftTaxonomyMatched
		}
	} else {
		taxonomyStatus = EbayDraftTaxonomyNeedsReview
	}
	updates := map[string]any{
		"normalized_title":        normalizedTitle,
		"normalized_brand":        normalizedBrand,
		"normalized_model":        normalizedModel,
		"normalized_part_number":  normalizedPartNumber,
		"normalized_mpn":          normalizedMPN,
		"normalized_price":        nonZeroFloat(draft.NormalizedPrice, result.Draft.NormalizedPrice),
		"suggested_category_id":   suggestedCategoryID,
		"suggested_category_name": fallbackTrimmed(draft.SuggestedCategoryName, result.Draft.SuggestedCategoryName),
		"suggested_part_type":     fallbackTrimmed(draft.SuggestedPartType, result.Draft.SuggestedPartType),
		"taxonomy_status":         taxonomyStatus,
		"match_status":            result.Draft.MatchStatus,
		"matched_product_id":      result.Draft.MatchedProductID,
		"match_score":             result.Draft.MatchScore,
		"match_reason":            result.Draft.MatchReason,
	}
	if strings.TrimSpace(draft.MetaTitle) == "" {
		updates["meta_title"] = result.Draft.MetaTitle
	}
	if strings.TrimSpace(draft.MetaDescription) == "" {
		updates["meta_description"] = result.Draft.MetaDescription
	}
	if strings.TrimSpace(draft.MetaKeywords) == "" {
		updates["meta_keywords"] = result.Draft.MetaKeywords
	}
	if strings.TrimSpace(draft.ImportAction) == "" {
		updates["import_action"] = result.Draft.ImportAction
	}
	if draft.Status == EbayDraftStatusPending || draft.Status == EbayDraftStatusNeedsReview || draft.Status == EbayDraftStatusReviewed {
		updates["status"] = deriveDraftStatus(result.Draft.MatchStatus, taxonomyStatus)
	}
	if len(result.Errors) > 0 {
		updates["failure_reason"] = strings.Join(result.Errors, "; ")
	}
	if err := db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(updates).Error; err != nil {
		return inference, err
	}
	return inference, nil
}

func BuildProductRequestFromDraft(db *gorm.DB, draft models.EbayImportDraft) models.ProductCreateRequest {
	mediaIDs := decodeUintSlice(draft.MediaAssetIDs)
	mediaAssets, _ := LoadMediaAssetResponses(db, mediaIDs)
	images := make([]models.ImageReq, 0, len(mediaAssets))
	for index, asset := range mediaAssets {
		images = append(images, models.ImageReq{URL: asset.URL, IsPrimary: index == 0, SortOrder: index})
	}
	if len(images) == 0 {
		for index, imageURL := range decodeStringSlice(draft.ImageSourceURLs) {
			if strings.TrimSpace(imageURL) == "" {
				continue
			}
			images = append(images, models.ImageReq{URL: imageURL, IsPrimary: index == 0, SortOrder: index})
		}
	}
	attributes := buildDraftAttributes(draft)
	raw := decodeRawPayload(draft.RawPayload)
	stockQuantity := int(parsePriceFloat(firstNonEmptyString(raw["stock_quantity"], raw["inventory_quantity"])))
	if stockQuantity <= 0 {
		stockQuantity = 1
	}
	var comparePrice *float64
	if parsedComparePrice := parsePriceFloat(firstNonEmptyString(raw["compare_price"], raw["compare_at_price"])); parsedComparePrice > 0 {
		comparePrice = &parsedComparePrice
	}
	return models.ProductCreateRequest{
		SKU:              firstNonEmptyString(draft.NormalizedPartNumber, draft.NormalizedMPN, draft.NormalizedModel, draft.EbayItemID),
		Name:             defaultTrimmed(draft.NormalizedTitle, draft.TitleRaw),
		ShortDescription: truncateText(cleanDraftDescription(draft.DescriptionRaw), 320),
		Description:      cleanDraftDescription(draft.DescriptionRaw),
		Price:            draft.NormalizedPrice,
		ComparePrice:     comparePrice,
		StockQuantity:    stockQuantity,
		Brand:            draft.NormalizedBrand,
		Model:            draft.NormalizedModel,
		PartNumber:       firstNonEmptyString(draft.NormalizedPartNumber, draft.NormalizedMPN),
		WarrantyPeriod:   "12 months",
		LeadTime:         "3-7 days",
		CategoryID:       derefUint(draft.SuggestedCategoryID),
		IsActive:         true,
		IsFeatured:       false,
		MetaTitle:        draft.MetaTitle,
		MetaDescription:  draft.MetaDescription,
		MetaKeywords:     draft.MetaKeywords,
		DisableAutoSEO:   draft.DisableAutoSEO,
		Images:           images,
		Attributes:       attributes,
	}
}

func LoadMediaAssetResponses(db *gorm.DB, ids []uint) ([]models.MediaAssetResponse, error) {
	if db == nil || len(ids) == 0 {
		return []models.MediaAssetResponse{}, nil
	}
	var assets []models.MediaAsset
	if err := db.Where("id IN ?", ids).Find(&assets).Error; err != nil {
		return nil, err
	}
	assetMap := make(map[uint]models.MediaAsset, len(assets))
	for _, asset := range assets {
		assetMap[asset.ID] = asset
	}
	out := make([]models.MediaAssetResponse, 0, len(ids))
	for _, id := range ids {
		if asset, ok := assetMap[id]; ok {
			out = append(out, asset.ToResponse())
		}
	}
	return out, nil
}

func summarizeDraft(draft models.EbayImportDraft) EbayImportDraftListItem {
	item := EbayImportDraftListItem{
		ID:                    draft.ID,
		SourceSite:            draft.SourceSite,
		SourceURL:             draft.SourceURL,
		TitleRaw:              draft.TitleRaw,
		NormalizedTitle:       draft.NormalizedTitle,
		NormalizedBrand:       draft.NormalizedBrand,
		NormalizedModel:       draft.NormalizedModel,
		NormalizedPartNumber:  draft.NormalizedPartNumber,
		NormalizedMPN:         draft.NormalizedMPN,
		NormalizedPrice:       draft.NormalizedPrice,
		SuggestedCategoryID:   draft.SuggestedCategoryID,
		SuggestedCategoryName: draft.SuggestedCategoryName,
		SuggestedPartType:     draft.SuggestedPartType,
		TaxonomyStatus:        draft.TaxonomyStatus,
		MatchStatus:           draft.MatchStatus,
		MatchedProductID:      draft.MatchedProductID,
		MatchScore:            draft.MatchScore,
		MatchReason:           draft.MatchReason,
		DisableAutoSEO:        draft.DisableAutoSEO,
		ImportAction:          draft.ImportAction,
		Status:                draft.Status,
		FailureReason:         draft.FailureReason,
		ImportedProductID:     draft.ImportedProductID,
		ConfirmedAt:           draft.ConfirmedAt,
		ImportedAt:            draft.ImportedAt,
		CreatedAt:             draft.CreatedAt,
		UpdatedAt:             draft.UpdatedAt,
	}
	if draft.MatchedProduct != nil {
		item.MatchedProduct = &struct {
			ID         uint   `json:"id"`
			SKU        string `json:"sku"`
			Name       string `json:"name"`
			Slug       string `json:"slug"`
			CategoryID uint   `json:"category_id"`
		}{
			ID:         draft.MatchedProduct.ID,
			SKU:        draft.MatchedProduct.SKU,
			Name:       draft.MatchedProduct.Name,
			Slug:       draft.MatchedProduct.Slug,
			CategoryID: draft.MatchedProduct.CategoryID,
		}
	}
	if draft.SuggestedCategory != nil {
		item.SuggestedCategory = &struct {
			ID   uint   `json:"id"`
			Name string `json:"name"`
			Slug string `json:"slug"`
		}{
			ID:   draft.SuggestedCategory.ID,
			Name: draft.SuggestedCategory.Name,
			Slug: draft.SuggestedCategory.Slug,
		}
	}
	return item
}

func importDraftImages(db *gorm.DB, urls []string) ([]uint, []string) {
	ids := make([]uint, 0, len(urls))
	errs := make([]string, 0)
	seen := map[uint]bool{}
	for _, imageURL := range urls {
		res, err := ImportRemoteMedia(db, imageURL, "ebay-import-drafts", "ebay,draft-import")
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", imageURL, err))
			continue
		}
		if res == nil || res.Asset.ID == 0 {
			continue
		}
		if !seen[res.Asset.ID] {
			seen[res.Asset.ID] = true
			ids = append(ids, res.Asset.ID)
		}
	}
	return ids, errs
}

func resolveDraftSuggestedCategory(db *gorm.DB, inference ProductCategoryInference, raw map[string]any, model string) (*uint, string, string) {
	hint := firstNonEmptyString(raw["category_leaf"], raw["product_type"], raw["category_breadcrumb"])
	if !IsConfirmedProductCategory(inference, model) {
		return nil, firstNonEmptyString(hint, inference.CategorySlug), EbayDraftTaxonomyNeedsReview
	}
	categoryID, err := ResolveExistingCategoryForInference(db, inference, hint)
	if err == nil && categoryID > 0 {
		var category models.Category
		if queryErr := db.Select("id", "name").First(&category, categoryID).Error; queryErr == nil {
			return &category.ID, category.Name, EbayDraftTaxonomyMatched
		}
	}
	return nil, firstNonEmptyString(hint, inference.CategorySlug), EbayDraftTaxonomyNeedsReview
}

func matchDraftProduct(db *gorm.DB, brand string, model string, partNumber string, mpn string, title string) (string, *uint, float64, string) {
	if db == nil {
		return EbayDraftMatchNewUnique, nil, 0, ""
	}
	candidates := uniqueNonEmptyStrings(partNumber, mpn, model)
	for _, candidate := range candidates {
		var product models.Product
		if err := db.Select("id", "sku", "part_number", "model", "name", "brand").Where(
			"UPPER(sku) = ? OR UPPER(part_number) = ? OR UPPER(model) = ?", candidate, candidate, candidate,
		).First(&product).Error; err == nil {
			return EbayDraftMatchExact, &product.ID, 100, fmt.Sprintf("Exact SKU/part/model match for %s", candidate)
		}
	}
	if strings.TrimSpace(brand) != "" {
		for _, candidate := range candidates {
			var product models.Product
			if err := db.Select("id", "sku", "part_number", "model", "name", "brand").Where(
				"LOWER(brand) = LOWER(?) AND (UPPER(model) = ? OR UPPER(part_number) = ?)", brand, candidate, candidate,
			).First(&product).Error; err == nil {
				return EbayDraftMatchExact, &product.ID, 98, fmt.Sprintf("Brand + model/part match for %s", candidate)
			}
		}
	}
	if strings.TrimSpace(title) != "" {
		words := strings.Fields(strings.ToLower(title))
		if len(words) > 0 {
			likeTerms := make([]string, 0, minDraftInt(3, len(words)))
			for _, word := range words {
				if len(word) >= 4 {
					likeTerms = append(likeTerms, "%"+word+"%")
				}
				if len(likeTerms) == 3 {
					break
				}
			}
			if len(likeTerms) > 0 {
				query := db.Select("id", "sku", "name")
				for _, term := range likeTerms {
					query = query.Where("LOWER(name) LIKE ?", term)
				}
				var product models.Product
				if err := query.First(&product).Error; err == nil {
					return EbayDraftMatchPossibleDup, &product.ID, 65, fmt.Sprintf("Title similarity match: %s", product.Name)
				}
			}
		}
	}
	return EbayDraftMatchNewUnique, nil, 0, ""
}

func buildDraftSEO(title string, description string, brand string, model string, partNumber string, mpn string, partType string) (string, string, string) {
	metaTitle := truncateText(firstNonEmptyString(title, strings.Join(uniqueNonEmptyStrings(brand, model, partNumber, mpn, partType), " ")), 255)
	metaDescription := truncateText(firstNonEmptyString(description, title), 320)
	keywords := strings.Join(uniqueNonEmptyStrings(brand, model, partNumber, mpn, partType, "ebay import"), ", ")
	return metaTitle, metaDescription, keywords
}

func buildDraftAttributes(draft models.EbayImportDraft) []models.ProductAttributeReq {
	raw := decodeRawPayload(draft.RawPayload)
	attrs := []models.ProductAttributeReq{}
	seen := map[string]bool{}
	add := func(name string, value string) {
		name = strings.TrimSpace(name)
		value = strings.TrimSpace(value)
		if name == "" || value == "" {
			return
		}
		key := strings.ToLower(name) + "\x00" + strings.ToLower(value)
		if seen[key] {
			return
		}
		seen[key] = true
		attrs = append(attrs, models.ProductAttributeReq{AttributeName: name, AttributeValue: value, SortOrder: len(attrs) + 1})
	}
	add("Brand", draft.NormalizedBrand)
	add("Vendor", firstNonEmptyString(raw["vendor"]))
	add("Model", draft.NormalizedModel)
	add("Part Number", draft.NormalizedPartNumber)
	add("MPN", draft.NormalizedMPN)
	add("SKU", firstNonEmptyString(raw["sku"]))
	add("Product Type", firstNonEmptyString(raw["product_type"]))
	add("Condition", firstNonEmptyString(raw["condition"], raw["condition_full"]))
	add("Country of Origin", firstNonEmptyString(raw["country_of_origin"]))
	add("UPC", firstNonEmptyString(raw["upc"]))
	add("EAN", firstNonEmptyString(raw["ean"]))
	add("Tags", firstLegacyText(raw["tags"]))
	add("Collection", firstNonEmptyString(raw["collection_name"], raw["collection_handle"]))
	add("Product ID", firstNonEmptyString(raw["product_id"], raw["shopify_product_id"]))
	if variants := compactDraftJSON(raw["variants"]); variants != "" {
		add("Variants", variants)
	}
	if options := compactDraftJSON(raw["options"]); options != "" {
		add("Options", options)
	}
	for _, pair := range collectLegacyAttributePairs(raw["item_specifics"], 0) {
		if strings.EqualFold(strings.TrimSpace(pair[0]), "tags") && firstLegacyText(raw["tags"]) != "" {
			continue
		}
		add(pair[0], pair[1])
	}
	add("Source", draft.SourceURL)
	return attrs
}

func compactDraftJSON(value any) string {
	if value == nil {
		return ""
	}
	encoded, err := json.Marshal(value)
	if err != nil || string(encoded) == "null" || string(encoded) == "[]" || string(encoded) == "{}" {
		return ""
	}
	return string(encoded)
}

func applyEbayImportDraftFilters(query **gorm.DB, filters EbayImportDraftFilters) {
	if query == nil || *query == nil {
		return
	}
	if strings.TrimSpace(filters.Search) != "" {
		like := "%" + strings.TrimSpace(filters.Search) + "%"
		*query = (*query).Where("title_raw LIKE ? OR normalized_title LIKE ? OR normalized_model LIKE ? OR normalized_part_number LIKE ? OR normalized_mpn LIKE ?", like, like, like, like, like)
	}
	if strings.TrimSpace(filters.Status) != "" {
		*query = (*query).Where("status = ?", strings.TrimSpace(filters.Status))
	}
	if strings.TrimSpace(filters.MatchStatus) != "" {
		*query = (*query).Where("match_status = ?", strings.TrimSpace(filters.MatchStatus))
	}
	if strings.TrimSpace(filters.Brand) != "" {
		*query = (*query).Where("LOWER(normalized_brand) = LOWER(?)", strings.TrimSpace(filters.Brand))
	}
}

func decodeRawPayload(raw string) map[string]any {
	payload := map[string]any{}
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &payload)
	}
	return payload
}

func decodeStringSlice(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	return out
}

func decodeUintSlice(raw string) []uint {
	if strings.TrimSpace(raw) == "" {
		return []uint{}
	}
	var out []uint
	if err := json.Unmarshal([]byte(raw), &out); err == nil {
		return out
	}
	var ints []int
	if err := json.Unmarshal([]byte(raw), &ints); err == nil {
		out = make([]uint, 0, len(ints))
		for _, item := range ints {
			if item > 0 {
				out = append(out, uint(item))
			}
		}
	}
	return out
}

// NormalizeEbayImportDraftPayload accepts both the website's canonical upload
// contract and the nested record format stored by the GYCharm eBay v3 plugin.
// The returned map keeps every original field while filling canonical aliases.
func NormalizeEbayImportDraftPayload(raw map[string]any) map[string]any {
	normalized := make(map[string]any, len(raw)+20)
	for key, value := range raw {
		normalized[key] = value
	}
	if isShopifyImportPayload(raw) {
		normalizeShopifyImportPayload(normalized, raw)
	}

	productData := legacyMap(raw["_product_data"])
	additionData := legacyMap(raw["_addition_data"])
	itemSpecifics := firstLegacyValue(productData["_shangjia_goodsProperty"], productData["item_specifics"], raw["item_specifics"])

	setCanonicalString(normalized, "source_type", "gycharm_ebay_extension")
	setCanonicalString(normalized, "source_site", firstLegacyString(raw["site"], raw["source_site"], "ebay"))
	setCanonicalString(normalized, "plugin_schema", firstLegacyString(raw["plugin_schema"], "gycharm-ebay-v3"))
	setCanonicalString(normalized, "product_url", firstLegacyString(
		raw["product_url"], raw["source_url"], productData["_product_url"], raw["_product_url"], additionData["_product_url"],
	))
	setCanonicalString(normalized, "product_title", firstLegacyString(
		raw["product_title"], raw["title"], productData["_shangjia_goodsName"], additionData["_name"],
	))
	setCanonicalString(normalized, "description_full", firstLegacyText(
		raw["description_full"], raw["description_html"], raw["description"],
		productData["_shangjia_desc"], productData["_shangjia_desc_text"], productData["_product_about_this_item"],
	))
	setCanonicalString(normalized, "current_price", firstLegacyString(
		raw["current_price"], raw["price"], productData["_shangjia_minOnSalePriceStr"], productData["_shangjia_price"], additionData["_price"],
	))
	setCanonicalString(normalized, "brand", firstLegacyString(
		raw["brand"], productData["_product_brand"], findLegacySpecificValue(itemSpecifics, []string{"brand", "brand name", "manufacturer"}, 0),
	))
	setCanonicalString(normalized, "model", firstLegacyString(
		raw["model"], findLegacySpecificValue(itemSpecifics, []string{"model", "model number", "model no"}, 0),
	))
	setCanonicalString(normalized, "mpn", firstLegacyString(
		raw["mpn"], findLegacySpecificValue(itemSpecifics, []string{"mpn", "manufacturer part number"}, 0),
	))
	setCanonicalString(normalized, "part_number", firstLegacyString(
		raw["part_number"], raw["sku"], findLegacySpecificValue(itemSpecifics, []string{"part number", "part no", "manufacturer part number"}, 0),
	))
	setCanonicalString(normalized, "category_breadcrumb", firstLegacyText(
		raw["category_breadcrumb"], raw["category_leaf"], productData["_shangjia_category"],
	))
	setCanonicalString(normalized, "condition", firstLegacyString(
		raw["condition"], raw["condition_full"], productData["_shangjia_condition"],
	))

	productURL := firstLegacyString(normalized["product_url"])
	setCanonicalString(normalized, "product_id", firstLegacyString(
		raw["product_id"], raw["ebay_item_id"], productData["_shangjia_goodsId"], extractLegacyEbayItemID(productURL),
	))
	setCanonicalString(normalized, "listing_id", firstLegacyString(raw["listing_id"], normalized["product_id"]))
	setCanonicalString(normalized, "currency", firstLegacyString(
		raw["currency"], raw["currency_raw"], detectLegacyCurrency(firstLegacyString(normalized["current_price"]), productURL),
	))

	images := make([]string, 0)
	seenImages := map[string]bool{}
	for _, value := range []any{
		raw["main_image"], raw["image"], raw["image_urls"],
		productData["_shangjia_hdThumbUrl"], productData["_shangjia_gallery"], productData["_shangjia_desc_imgs"],
		productData["_shangjia_productDetailFlatList"], productData["_shangjia_variants_skus"], additionData["_url"],
	} {
		appendLegacyURLs(&images, seenImages, value, 0)
	}
	if firstLegacyString(normalized["main_image"]) == "" && len(images) > 0 {
		normalized["main_image"] = images[0]
	}
	if _, exists := normalized["image_urls"]; !exists || len(collectLegacyURLValues(normalized["image_urls"])) == 0 {
		normalized["image_urls"] = images
	}
	if itemSpecifics != nil {
		normalized["item_specifics"] = itemSpecifics
	}
	if variants := productData["_shangjia_variants_skus"]; variants != nil {
		if _, exists := normalized["variants"]; !exists {
			normalized["variants"] = variants
		}
	}

	return normalized
}

func legacyMap(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func firstLegacyValue(values ...any) any {
	for _, value := range values {
		switch typed := value.(type) {
		case nil:
			continue
		case string:
			if strings.TrimSpace(typed) == "" {
				continue
			}
		case []any:
			if len(typed) == 0 {
				continue
			}
		case []string:
			if len(typed) == 0 {
				continue
			}
		case map[string]any:
			if len(typed) == 0 {
				continue
			}
		}
		return value
	}
	return nil
}

func firstLegacyString(values ...any) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				return trimmed
			}
		case float64:
			if typed != 0 {
				return strconv.FormatFloat(typed, 'f', -1, 64)
			}
		case float32:
			if typed != 0 {
				return strconv.FormatFloat(float64(typed), 'f', -1, 32)
			}
		case int:
			if typed != 0 {
				return strconv.Itoa(typed)
			}
		case int64:
			if typed != 0 {
				return strconv.FormatInt(typed, 10)
			}
		case uint:
			if typed != 0 {
				return strconv.FormatUint(uint64(typed), 10)
			}
		case json.Number:
			if trimmed := strings.TrimSpace(typed.String()); trimmed != "" && trimmed != "0" {
				return trimmed
			}
		}
	}
	return ""
}

func firstLegacyText(values ...any) string {
	for _, value := range values {
		if text := legacyText(value); text != "" {
			return text
		}
	}
	return ""
}

func legacyText(value any) string {
	if text := firstLegacyString(value); text != "" {
		return text
	}
	switch typed := value.(type) {
	case []string:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if trimmed := strings.TrimSpace(item); trimmed != "" {
				parts = append(parts, trimmed)
			}
		}
		return strings.Join(parts, "\n")
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := legacyText(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		if text := firstLegacyString(typed["name"], typed["title"], typed["label"], typed["value"], typed["text"], typed["path"]); text != "" {
			return text
		}
		encoded, _ := json.Marshal(typed)
		return strings.TrimSpace(string(encoded))
	default:
		return ""
	}
}

func setCanonicalString(target map[string]any, key string, value string) {
	if firstLegacyString(target[key]) != "" || strings.TrimSpace(value) == "" {
		return
	}
	target[key] = strings.TrimSpace(value)
}

func normalizeLegacyKey(value string) string {
	var builder strings.Builder
	for _, char := range strings.ToLower(strings.TrimSpace(value)) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func findLegacySpecificValue(value any, aliases []string, depth int) string {
	if value == nil || depth > 6 {
		return ""
	}
	aliasSet := map[string]bool{}
	for _, alias := range aliases {
		aliasSet[normalizeLegacyKey(alias)] = true
	}
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if found := findLegacySpecificValue(item, aliases, depth+1); found != "" {
				return found
			}
		}
	case map[string]any:
		name := firstLegacyString(typed["name"], typed["label"], typed["key"], typed["attribute_name"], typed["specs_name"])
		itemValue := firstLegacyString(typed["value"], typed["text"], typed["attribute_value"], typed["specs_value"])
		if aliasSet[normalizeLegacyKey(name)] && itemValue != "" {
			return itemValue
		}
		for key, item := range typed {
			if aliasSet[normalizeLegacyKey(key)] {
				if direct := firstLegacyString(item); direct != "" {
					return direct
				}
			}
		}
		for _, item := range typed {
			if found := findLegacySpecificValue(item, aliases, depth+1); found != "" {
				return found
			}
		}
	}
	return ""
}

func appendLegacyURLs(out *[]string, seen map[string]bool, value any, depth int) {
	if value == nil || depth > 6 {
		return
	}
	add := func(candidate string) {
		candidate = normalizeURLString(candidate)
		if candidate == "" || seen[candidate] || !(strings.HasPrefix(candidate, "http://") || strings.HasPrefix(candidate, "https://")) {
			return
		}
		seen[candidate] = true
		*out = append(*out, candidate)
	}
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if strings.HasPrefix(trimmed, "[") {
			var decoded []any
			if json.Unmarshal([]byte(trimmed), &decoded) == nil {
				appendLegacyURLs(out, seen, decoded, depth+1)
				return
			}
		}
		for _, item := range strings.Split(trimmed, ",") {
			add(strings.TrimSpace(item))
		}
	case []string:
		for _, item := range typed {
			add(item)
		}
	case []any:
		for _, item := range typed {
			appendLegacyURLs(out, seen, item, depth+1)
		}
	case map[string]any:
		for key, item := range typed {
			lower := strings.ToLower(key)
			if strings.Contains(lower, "image") || strings.Contains(lower, "img") || strings.Contains(lower, "gallery") || strings.Contains(lower, "photo") || strings.Contains(lower, "picture") || strings.Contains(lower, "url") {
				appendLegacyURLs(out, seen, item, depth+1)
			}
		}
	default:
		add(firstLegacyString(typed))
	}
}

func collectLegacyURLValues(value any) []string {
	out := []string{}
	seen := map[string]bool{}
	appendLegacyURLs(&out, seen, value, 0)
	return out
}

func extractLegacyEbayItemID(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	for _, key := range []string{"item", "itemid"} {
		if candidate := strings.TrimSpace(parsed.Query().Get(key)); isLegacyNumericID(candidate) {
			return candidate
		}
	}
	parts := strings.FieldsFunc(parsed.Path, func(r rune) bool { return r == '/' || r == '-' || r == '_' })
	for index := len(parts) - 1; index >= 0; index-- {
		if isLegacyNumericID(parts[index]) {
			return parts[index]
		}
	}
	return ""
}

func isLegacyNumericID(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 9 || len(value) > 15 {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func detectLegacyCurrency(priceRaw string, productURL string) string {
	upper := strings.ToUpper(strings.TrimSpace(priceRaw))
	switch {
	case strings.Contains(upper, "GBP") || strings.Contains(upper, "£"):
		return "GBP"
	case strings.Contains(upper, "EUR") || strings.Contains(upper, "€"):
		return "EUR"
	case strings.Contains(upper, "AUD") || strings.Contains(upper, "AU$"):
		return "AUD"
	case strings.Contains(upper, "CAD") || strings.Contains(upper, "CA$") || strings.Contains(upper, "C$"):
		return "CAD"
	case strings.Contains(upper, "USD") || strings.Contains(upper, "US$") || strings.Contains(upper, "$"):
		return "USD"
	}
	host := ""
	if parsed, err := url.Parse(strings.TrimSpace(productURL)); err == nil {
		host = strings.ToLower(parsed.Hostname())
	}
	switch {
	case strings.HasSuffix(host, "ebay.co.uk"):
		return "GBP"
	case strings.HasSuffix(host, "ebay.com.au"):
		return "AUD"
	case strings.HasSuffix(host, "ebay.ca"):
		return "CAD"
	case strings.HasSuffix(host, "ebay.de"), strings.HasSuffix(host, "ebay.fr"), strings.HasSuffix(host, "ebay.it"), strings.HasSuffix(host, "ebay.es"), strings.HasSuffix(host, "ebay.at"), strings.HasSuffix(host, "ebay.be"), strings.HasSuffix(host, "ebay.nl"), strings.HasSuffix(host, "ebay.ie"):
		return "EUR"
	default:
		return "USD"
	}
}

func collectLegacyAttributePairs(value any, depth int) [][2]string {
	if value == nil || depth > 5 {
		return nil
	}
	pairs := make([][2]string, 0)
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			pairs = append(pairs, collectLegacyAttributePairs(item, depth+1)...)
		}
	case map[string]any:
		name := firstLegacyString(typed["name"], typed["label"], typed["key"], typed["attribute_name"], typed["specs_name"])
		itemValue := firstLegacyString(typed["value"], typed["text"], typed["attribute_value"], typed["specs_value"])
		if name != "" && itemValue != "" {
			return append(pairs, [2]string{name, itemValue})
		}
		for key, item := range typed {
			if direct := firstLegacyString(item); direct != "" {
				pairs = append(pairs, [2]string{key, direct})
				continue
			}
			pairs = append(pairs, collectLegacyAttributePairs(item, depth+1)...)
		}
	}
	if len(pairs) > 50 {
		return pairs[:50]
	}
	return pairs
}

func collectImageURLs(raw map[string]any) []string {
	seen := map[string]bool{}
	out := make([]string, 0)
	add := func(value string) {
		value = normalizeURLString(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}
	add(firstNonEmptyString(raw["main_image"]))
	for _, key := range []string{"detail_image_1", "detail_image_2", "detail_image_3", "detail_image_4", "detail_image_5"} {
		add(firstNonEmptyString(raw[key]))
	}
	if val, ok := raw["image_urls"]; ok {
		switch v := val.(type) {
		case []string:
			for _, item := range v {
				add(item)
			}
		case []any:
			for _, item := range v {
				add(firstNonEmptyString(item))
			}
		case string:
			trimmed := strings.TrimSpace(v)
			if strings.HasPrefix(trimmed, "[") {
				var items []string
				if err := json.Unmarshal([]byte(trimmed), &items); err == nil {
					for _, item := range items {
						add(item)
					}
				} else {
					for _, item := range strings.Split(trimmed, ",") {
						add(item)
					}
				}
			} else {
				for _, item := range strings.Split(trimmed, ",") {
					add(item)
				}
			}
		}
	}
	return out
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		switch v := value.(type) {
		case nil:
			continue
		case string:
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				return trimmed
			}
		case fmt.Stringer:
			if trimmed := strings.TrimSpace(v.String()); trimmed != "" {
				return trimmed
			}
		case float64:
			if v != 0 {
				return strconv.FormatFloat(v, 'f', -1, 64)
			}
		case int:
			if v != 0 {
				return strconv.Itoa(v)
			}
		case int64:
			if v != 0 {
				return strconv.FormatInt(v, 10)
			}
		case json.Number:
			return v.String()
		default:
			trimmed := strings.TrimSpace(fmt.Sprint(v))
			if trimmed != "" && trimmed != "<nil>" {
				return trimmed
			}
		}
	}
	return ""
}

func parsePriceFloat(raw string) float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	replacer := strings.NewReplacer(",", "", "$", "", "USD", "", "US", "", "EUR", "", "GBP", "", "CNY", "", "RMB", "", "HK$", "", "AU$", "")
	clean := strings.TrimSpace(replacer.Replace(strings.ToUpper(raw)))
	fields := strings.Fields(clean)
	if len(fields) > 0 {
		clean = fields[len(fields)-1]
	}
	value, err := strconv.ParseFloat(clean, 64)
	if err != nil {
		return 0
	}
	return value
}

func detectCurrency(raw map[string]any, priceRaw string) string {
	if currency := firstNonEmptyString(raw["currency"], raw["currency_raw"]); currency != "" {
		return strings.ToUpper(currency)
	}
	upper := strings.ToUpper(strings.TrimSpace(priceRaw))
	switch {
	case strings.Contains(upper, "$"):
		return "USD"
	case strings.Contains(upper, "EUR") || strings.Contains(upper, "€"):
		return "EUR"
	case strings.Contains(upper, "GBP") || strings.Contains(upper, "£"):
		return "GBP"
	default:
		return ""
	}
}

func normalizeDraftTitle(title string) string {
	title = strings.Join(strings.Fields(strings.TrimSpace(title)), " ")
	return strings.TrimSpace(title)
}

func normalizeURLString(raw string) string {
	return strings.TrimSpace(raw)
}

func cleanDraftDescription(value string) string {
	return strings.TrimSpace(value)
}

func defaultTrimmed(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return strings.TrimSpace(fallback)
	}
	return strings.TrimSpace(value)
}

func fallbackTrimmed(current string, fallback string) string {
	if strings.TrimSpace(current) != "" {
		return strings.TrimSpace(current)
	}
	return strings.TrimSpace(fallback)
}

func nonZeroFloat(current float64, fallback float64) float64 {
	if current > 0 {
		return current
	}
	return fallback
}

func chooseUintPtr(current *uint, fallback *uint) *uint {
	if current != nil && *current != 0 {
		return current
	}
	return fallback
}

func defaultImportAction(matchStatus string) string {
	switch strings.TrimSpace(matchStatus) {
	case EbayDraftMatchExact:
		return "update_existing"
	case EbayDraftMatchPossibleDup:
		return "needs_review"
	default:
		return "create_new"
	}
}

func deriveDraftStatus(matchStatus string, taxonomyStatus string) string {
	if strings.TrimSpace(taxonomyStatus) == EbayDraftTaxonomyNeedsReview || strings.TrimSpace(matchStatus) == EbayDraftMatchPossibleDup {
		return EbayDraftStatusNeedsReview
	}
	return EbayDraftStatusPending
}

func truncateText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return strings.TrimSpace(value[:limit])
}

func derefUint(value *uint) uint {
	if value == nil {
		return 0
	}
	return *value
}

func uniqueNonEmptyStrings(values ...string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		upper := strings.ToUpper(trimmed)
		if seen[upper] {
			continue
		}
		seen[upper] = true
		out = append(out, upper)
	}
	return out
}

func minDraftInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
