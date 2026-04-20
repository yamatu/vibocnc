package services

import (
	"encoding/json"
	"fmt"
	"math"
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
	Draft  models.EbayImportDraft
	Errors []string
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
	result := EbayImportDraftBuildResult{}
	if raw == nil {
		result.Errors = append(result.Errors, "empty item payload")
		return result
	}

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
	mediaAssetIDs, mediaErrors := importDraftImages(db, imageURLs)
	if len(mediaErrors) > 0 {
		result.Errors = append(result.Errors, mediaErrors...)
	}
	if mainImage == "" && len(imageURLs) > 0 {
		mainImage = imageURLs[0]
	}

	inference := InferProductCategory(brand, firstNonEmptyString(model, mpn, partNumber, title))
	suggestedCategoryID, suggestedCategoryName, taxonomyStatus := resolveDraftSuggestedCategory(db, inference.CategorySlug, raw)
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
	return result
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
	if draft == nil {
		return nil
	}
	result := BuildEbayImportDraft(db, decodeRawPayload(draft.RawPayload))
	updates := map[string]any{
		"normalized_title":        fallbackTrimmed(draft.NormalizedTitle, result.Draft.NormalizedTitle),
		"normalized_brand":        fallbackTrimmed(draft.NormalizedBrand, result.Draft.NormalizedBrand),
		"normalized_model":        fallbackTrimmed(draft.NormalizedModel, result.Draft.NormalizedModel),
		"normalized_part_number":  fallbackTrimmed(draft.NormalizedPartNumber, result.Draft.NormalizedPartNumber),
		"normalized_mpn":          fallbackTrimmed(draft.NormalizedMPN, result.Draft.NormalizedMPN),
		"normalized_price":        nonZeroFloat(draft.NormalizedPrice, result.Draft.NormalizedPrice),
		"suggested_category_id":   chooseUintPtr(draft.SuggestedCategoryID, result.Draft.SuggestedCategoryID),
		"suggested_category_name": fallbackTrimmed(draft.SuggestedCategoryName, result.Draft.SuggestedCategoryName),
		"suggested_part_type":     fallbackTrimmed(draft.SuggestedPartType, result.Draft.SuggestedPartType),
		"taxonomy_status":         result.Draft.TaxonomyStatus,
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
		updates["status"] = deriveDraftStatus(result.Draft.MatchStatus, result.Draft.TaxonomyStatus)
	}
	if len(result.Errors) > 0 {
		updates["failure_reason"] = strings.Join(result.Errors, "; ")
	}
	return db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(updates).Error
}

func BuildProductRequestFromDraft(db *gorm.DB, draft models.EbayImportDraft) models.ProductCreateRequest {
	mediaIDs := decodeUintSlice(draft.MediaAssetIDs)
	mediaAssets, _ := LoadMediaAssetResponses(db, mediaIDs)
	images := make([]models.ImageReq, 0, len(mediaAssets))
	for index, asset := range mediaAssets {
		images = append(images, models.ImageReq{URL: asset.URL, IsPrimary: index == 0, SortOrder: index})
	}
	attributes := buildDraftAttributes(draft)
	return models.ProductCreateRequest{
		SKU:              firstNonEmptyString(draft.NormalizedPartNumber, draft.NormalizedMPN, draft.NormalizedModel, draft.EbayItemID),
		Name:             defaultTrimmed(draft.NormalizedTitle, draft.TitleRaw),
		ShortDescription: truncateText(cleanDraftDescription(draft.DescriptionRaw), 320),
		Description:      cleanDraftDescription(draft.DescriptionRaw),
		Price:            draft.NormalizedPrice,
		StockQuantity:    1,
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

func resolveDraftSuggestedCategory(db *gorm.DB, slug string, raw map[string]any) (*uint, string, string) {
	if db == nil {
		return nil, strings.TrimSpace(slug), EbayDraftTaxonomyNeedsReview
	}
	var category models.Category
	if strings.TrimSpace(slug) != "" {
		if err := db.Where("slug = ?", strings.TrimSpace(slug)).First(&category).Error; err == nil {
			return &category.ID, category.Name, EbayDraftTaxonomyMatched
		}
	}
	candidateNames := []string{
		firstNonEmptyString(raw["category_leaf"]),
		firstNonEmptyString(raw["product_type"]),
		firstNonEmptyString(raw["category_breadcrumb"]),
	}
	var cats []models.Category
	if err := db.Where("is_active = ?", true).Find(&cats).Error; err == nil {
		for _, candidate := range candidateNames {
			candidate = strings.TrimSpace(candidate)
			if candidate == "" {
				continue
			}
			lower := strings.ToLower(candidate)
			for _, cat := range cats {
				if strings.EqualFold(cat.Name, candidate) || strings.EqualFold(cat.Slug, candidate) || strings.Contains(lower, strings.ToLower(cat.Name)) {
					return &cat.ID, cat.Name, EbayDraftTaxonomyMatched
				}
			}
		}
	}
	return nil, firstNonEmptyString(candidateNames[0], candidateNames[1], candidateNames[2], slug), EbayDraftTaxonomyNeedsReview
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
	add := func(name string, value string) {
		name = strings.TrimSpace(name)
		value = strings.TrimSpace(value)
		if name == "" || value == "" {
			return
		}
		attrs = append(attrs, models.ProductAttributeReq{AttributeName: name, AttributeValue: value, SortOrder: len(attrs) + 1})
	}
	add("Brand", draft.NormalizedBrand)
	add("Model", draft.NormalizedModel)
	add("Part Number", draft.NormalizedPartNumber)
	add("MPN", draft.NormalizedMPN)
	add("Condition", firstNonEmptyString(raw["condition"], raw["condition_full"]))
	add("Country of Origin", firstNonEmptyString(raw["country_of_origin"]))
	add("UPC", firstNonEmptyString(raw["upc"]))
	add("EAN", firstNonEmptyString(raw["ean"]))
	add("Source", draft.SourceURL)
	return attrs
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
