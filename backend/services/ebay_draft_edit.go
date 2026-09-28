package services

import (
	"errors"
	"strings"

	"fanuc-backend/models"
	"gorm.io/gorm"
)

// Project the proposal into editable/import fields, without publishing or
// changing the raw evidence. Also serves legacy ready rows written before this
// projection was persisted by StoreDraftReview.
func draftWithEditableReview(draft models.EbayImportDraft) models.EbayImportDraft {
	if draft.AIReviewStatus != EbayAIReviewReady && draft.AIReviewStatus != EbayAIReviewApproved {
		return draft
	}
	draft.NormalizedTitle = SanitizeListingTitle(firstNonEmptyString(draft.ProposedName, draft.NormalizedTitle))
	draft.NormalizedBrand = firstNonEmptyString(draft.ProposedBrand, draft.NormalizedBrand)
	draft.NormalizedModel = firstNonEmptyString(draft.ProposedModel, draft.NormalizedModel)
	draft.NormalizedDescription = SanitizeListingDescription(firstNonEmptyString(draft.ProposedDescription, draft.NormalizedDescription))
	draft.NormalizedShortDescription = SanitizeListingDescription(firstNonEmptyString(draft.ProposedShortDescription, draft.NormalizedShortDescription))
	draft.MetaTitle = SanitizeListingTitle(firstNonEmptyString(draft.ProposedMetaTitle, draft.MetaTitle))
	draft.MetaDescription = SanitizeListingTitle(firstNonEmptyString(draft.ProposedMetaDescription, draft.MetaDescription))
	draft.MetaKeywords = SanitizeListingTitle(firstNonEmptyString(draft.ProposedMetaKeywords, draft.MetaKeywords))
	if draft.ProposedCategoryID != nil && *draft.ProposedCategoryID > 0 {
		draft.SuggestedCategoryID = draft.ProposedCategoryID
		draft.SuggestedCategoryName = draft.ProposedCategoryName
		draft.SuggestedPartType = draft.ProposedPartType
		draft.TaxonomyStatus = EbayDraftTaxonomyMatched
		// Do not leave the old preloaded association alongside the new id.
		draft.SuggestedCategory = nil
	}
	return draft
}

func draftEditableReviewUpdates(draft models.EbayImportDraft) map[string]any {
	draft = draftWithEditableReview(draft)
	return map[string]any{
		"normalized_title":             draft.NormalizedTitle,
		"normalized_brand":             draft.NormalizedBrand,
		"normalized_model":             draft.NormalizedModel,
		"normalized_description":       draft.NormalizedDescription,
		"normalized_short_description": draft.NormalizedShortDescription,
		"suggested_category_id":        draft.SuggestedCategoryID,
		"suggested_category_name":      draft.SuggestedCategoryName,
		"suggested_part_type":          draft.SuggestedPartType,
		"taxonomy_status":              draft.TaxonomyStatus,
		"category_mode":                draft.CategoryMode,
		"meta_title":                   draft.MetaTitle,
		"meta_description":             draft.MetaDescription,
		"meta_keywords":                draft.MetaKeywords,
	}
}

// Copy edits are not identity edits. Saving a price, title, description or SEO
// correction must not discard a completed AI reading or restore seller HTML.
func DraftEditableUpdates(db *gorm.DB, draft models.EbayImportDraft, req models.EbayImportDraftUpdateRequest) (map[string]any, error) {
	if draft.Status == EbayDraftStatusImported || draft.Status == EbayDraftStatusSkipped {
		return nil, errors.New("草稿已处理，请在产品管理中编辑 / draft already processed")
	}
	if draft.AIReviewStatus == EbayAIReviewQueued || draft.AIReviewStatus == EbayAIReviewProcessing {
		return nil, errors.New("AI 正在优化，请完成后再编辑 / review running")
	}
	hasReview := draft.AIReviewStatus == EbayAIReviewReady || draft.AIReviewStatus == EbayAIReviewApproved
	effective := draftWithEditableReview(draft)
	updates := map[string]any{}
	if hasReview {
		updates = draftEditableReviewUpdates(draft)
	}
	identityChanged := false
	for _, field := range []struct {
		key, old  string
		value     *string
		normalize func(string) string
	}{
		{"normalized_brand", effective.NormalizedBrand, req.NormalizedBrand, CanonicalBrandName},
		{"normalized_model", effective.NormalizedModel, req.NormalizedModel, NormalizeProductModel},
		{"normalized_part_number", effective.NormalizedPartNumber, req.NormalizedPartNumber, NormalizeProductModel},
		{"normalized_mpn", effective.NormalizedMPN, req.NormalizedMPN, NormalizeProductModel},
	} {
		if field.value != nil {
			value := field.normalize(*field.value)
			updates[field.key] = value
			identityChanged = identityChanged || value != field.normalize(field.old)
		}
	}
	for _, field := range []struct {
		key, proposed string
		value         *string
		clean         func(string) string
	}{
		{"normalized_title", "proposed_name", req.NormalizedTitle, SanitizeListingTitle},
		{"normalized_description", "proposed_description", req.NormalizedDescription, SanitizeListingDescription},
		{"normalized_short_description", "proposed_short_description", req.NormalizedShortDescription, SanitizeListingDescription},
		{"meta_title", "proposed_meta_title", req.MetaTitle, SanitizeListingTitle},
		{"meta_description", "proposed_meta_description", req.MetaDescription, SanitizeListingTitle},
		{"meta_keywords", "proposed_meta_keywords", req.MetaKeywords, SanitizeListingTitle},
	} {
		if field.value != nil {
			value := field.clean(*field.value)
			if hasReview && value == "" && field.key != "meta_keywords" {
				return nil, errors.New("优化后的标题、描述和 SEO 不能为空 / optimized copy cannot be empty")
			}
			updates[field.key] = value
			if hasReview {
				updates[field.proposed] = value
			}
		}
	}
	if req.SuggestedCategoryID != nil {
		var category models.Category
		if db == nil || db.Select("id", "name", "is_active").First(&category, *req.SuggestedCategoryID).Error != nil || !category.IsActive {
			return nil, errors.New("分类不存在或已禁用 / invalid category")
		}
		updates["suggested_category_id"] = category.ID
		updates["suggested_category_name"] = category.Name
		identityChanged = identityChanged || effective.SuggestedCategoryID == nil || *effective.SuggestedCategoryID != category.ID
	}
	if identityChanged {
		updates["ai_review_status"] = ""
		updates["ai_review_error"] = "商品身份或分类已修改，请重新运行 AI 优化"
		updates["taxonomy_status"] = EbayDraftTaxonomyNeedsReview
	}
	if req.NormalizedPrice != nil {
		if *req.NormalizedPrice < 0 {
			return nil, errors.New("price cannot be negative")
		}
		updates["normalized_price"] = *req.NormalizedPrice
	}
	if req.IncludeImages != nil {
		updates["exclude_source_images"] = !*req.IncludeImages
	}
	if req.ImportAction != nil {
		updates["import_action"] = strings.TrimSpace(*req.ImportAction)
	}
	if req.DisableAutoSEO != nil {
		updates["disable_auto_seo"] = *req.DisableAutoSEO
	}
	if req.ReviewNote != nil {
		updates["review_note"] = strings.TrimSpace(*req.ReviewNote)
	}
	return updates, nil
}

// Persist the publishing preference, not a deletion of the source archive.
func SetEbayDraftImagePreference(db *gorm.DB, id uint, include *bool) error {
	if include == nil {
		return nil
	}
	return db.Model(&models.EbayImportDraft{}).
		Where("id = ? AND status NOT IN ?", id, []string{EbayDraftStatusImported, EbayDraftStatusSkipped}).
		Update("exclude_source_images", !*include).Error
}

// Skipping scraped pictures must not delete an existing product's own images.
func PreserveExistingProductImages(req *models.ProductCreateRequest, product models.Product) {
	req.Images = []models.ImageReq{}
	for i, url := range decodeStringSlice(product.ImageURLs) {
		req.Images = append(req.Images, models.ImageReq{URL: url, IsPrimary: i == 0, SortOrder: i})
	}
}
