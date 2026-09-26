package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"gorm.io/gorm"
)

// This file is the automated review pass for eBay import drafts.
//
// It answers one question: "is this scraped listing good enough to become a
// product on the storefront, and if so, what should that product say?"
//
// The pass is deliberately split from publishing. ReviewDraft writes a complete
// proposal onto the draft row and stops. A separate, administrator-triggered
// approval turns that proposal into a product. That split is what lets a batch
// of a thousand drafts be triaged automatically without any of them reaching an
// indexed URL before a human has looked at the summary table.

// AI draft review states. These live on EbayImportDraft.AIReviewStatus.
const (
	// EbayAIReviewQueued means a job owns the row and will process it.
	EbayAIReviewQueued = "queued"
	// EbayAIReviewProcessing means a worker is currently calling the model.
	EbayAIReviewProcessing = "processing"
	// EbayAIReviewReady means a proposal exists and is waiting for approval.
	EbayAIReviewReady = "ready"
	// EbayAIReviewApproved means the proposal became a product. The draft is
	// also marked imported, so the two states cannot disagree.
	EbayAIReviewApproved = "approved"
	// EbayAIReviewRejected means an administrator discarded the proposal.
	EbayAIReviewRejected = "rejected"
	// EbayAIReviewFailed means the pass could not produce a proposal. The draft
	// is untouched and can be retried.
	EbayAIReviewFailed = "failed"
)

// EbayAIReviewResult is what a completed pass reports back to the reviewer.
type EbayAIReviewResult struct {
	Status string `json:"status"`
	// Reason explains a non-ready outcome in one line, for the log view.
	Reason string `json:"reason,omitempty"`
	// Notes are the per-check findings worth showing next to the row.
	Notes           []string `json:"notes,omitempty"`
	CategoryName    string   `json:"category_name,omitempty"`
	CategoryCreated bool     `json:"category_created,omitempty"`
	Title           string   `json:"title,omitempty"`
}

// EbayDraftReviewInput is everything the pass is allowed to look at. It is
// passed in explicitly rather than read from globals so the pass is testable
// without a database or a model.
type EbayDraftReviewInput struct {
	Draft    models.EbayImportDraft
	Evidence []models.EbayMarketEvidenceItem
	// ProductName is the current catalogue name when this draft matches an
	// existing product, used as the "before" side of the title decision.
	ProductName string
}

// ------------------------------------------------------------------ checks --

// draftIdentifier returns the best exact identifier the draft carries, in the
// order the rest of the importer uses. An empty result means the listing never
// named a part, and such a draft must not become a product: it would carry a
// guessed identity onto the storefront.
func draftIdentifier(draft models.EbayImportDraft) string {
	return firstNonEmptyString(
		draft.NormalizedPartNumber,
		draft.NormalizedMPN,
		draft.NormalizedModel,
	)
}

// EbayDraftPreflight reports whether a draft can be reviewed at all, and why
// not when it cannot. It is exported so the job layer can skip unusable rows
// before spending a model call on them.
func EbayDraftPreflight(draft models.EbayImportDraft) (string, bool) {
	switch draft.Status {
	case EbayDraftStatusImported, EbayDraftStatusSkipped:
		return "already_processed", false
	}
	if draftIdentifier(draft) == "" {
		return "missing_identifier", false
	}
	// A title is what the model reasons over. A listing with an identifier but
	// no title has nothing to classify from.
	if strings.TrimSpace(firstNonEmptyString(draft.TitleRaw, draft.NormalizedTitle)) == "" {
		return "missing_title", false
	}
	return "", true
}

// ---------------------------------------------------------------- category --

// ResolveDraftReviewCategory picks the category the reviewed draft should be
// published under.
//
// Order of preference:
//
//  1. A category that already exists for this brand and component type. Reusing
//     the taxonomy is what keeps the storefront navigable; creating a near
//     duplicate of an existing branch is worse than a slightly generic match.
//  2. A freshly created "<Brand> > <Component type>" branch, which is the shape
//     the catalogue uses.
//  3. Nothing, which marks the draft as needing a human decision.
//
// The second step only runs for a confirmed inference. An unconfirmed guess
// would create a category named after a misread part number, and those are
// expensive to clean up once products point at them.
func ResolveDraftReviewCategory(db *gorm.DB, draft models.EbayImportDraft, profile ProductProfile) (uint, string, bool, error) {
	brand := firstNonEmptyString(profile.Brand, draft.NormalizedBrand)
	model := firstNonEmptyString(profile.Model, draft.NormalizedModel, draftIdentifier(draft))
	partType := strings.TrimSpace(profile.PartType)

	// A suggested category already validated against the taxonomy wins: an
	// administrator or the earlier classification pass has confirmed it.
	if draft.SuggestedCategoryID != nil && *draft.SuggestedCategoryID > 0 {
		if draft.TaxonomyStatus == EbayDraftTaxonomyMatched {
			var category models.Category
			if err := db.Select("id", "name").First(&category, *draft.SuggestedCategoryID).Error; err == nil {
				return category.ID, category.Name, false, nil
			}
		}
	}

	inference := InferProductCategory(brand, model)
	if strings.TrimSpace(inference.PartType) == "" {
		inference.PartType = partType
	}
	if inference.BrandKey == "" {
		inference.BrandKey = NormalizeBrandKey(brand)
	}

	// Reuse first. ResolveExistingCategoryForInference only returns a category
	// whose path actually corroborates the inference, so a generic "Drives"
	// branch is not offered for a PCB.
	if existing, err := ResolveExistingCategoryForInference(db, inference, ""); err == nil && existing > 0 {
		var category models.Category
		if err := db.Select("id", "name").First(&category, existing).Error; err == nil {
			return category.ID, category.Name, false, nil
		}
	}

	// Creating a branch is only safe on a confirmed inference: the brand must be
	// one the taxonomy recognises and the type must be specific rather than a
	// generic fallback.
	if !IsConfirmedProductCategory(inference, model) || IsGenericProductType(inference.PartType) {
		return 0, "", false, nil
	}
	created, isNew, err := ResolveOrCreateCategoryForAdministrator(db, inference, true)
	if err != nil {
		return 0, "", false, err
	}
	if created == 0 {
		return 0, "", false, nil
	}
	var category models.Category
	if err := db.Select("id", "name").First(&category, created).Error; err != nil {
		return created, "", isNew, nil
	}
	return category.ID, category.Name, isNew, nil
}

// --------------------------------------------------------------- the pass --

// ReviewDraft runs the automated review for one draft and returns the proposal
// to store. It performs no writes; the caller decides whether to persist, which
// keeps the pass usable for a dry run.
func ReviewDraft(
	ctx context.Context,
	input EbayDraftReviewInput,
	client IdentificationClient,
) (models.EbayImportDraft, EbayAIReviewResult, error) {
	draft := input.Draft
	if reason, ok := EbayDraftPreflight(draft); !ok {
		return draft, EbayAIReviewResult{Status: EbayAIReviewRejected, Reason: reason}, nil
	}

	evidence := ProductIdentificationEvidence{
		BrandHint:        draft.NormalizedBrand,
		Model:            firstNonEmptyString(draft.NormalizedModel, draftIdentifier(draft)),
		ProductName:      firstNonEmptyString(input.ProductName, draft.NormalizedTitle, draft.TitleRaw),
		SKU:              firstNonEmptyString(draft.NormalizedPartNumber, draft.NormalizedMPN),
		PartNumber:       firstNonEmptyString(draft.NormalizedPartNumber, draft.NormalizedMPN),
		Listings:         input.Evidence,
		EbayCategoryPath: DominantEbayCategory(input.Evidence),
	}

	profile, err := IdentifyProduct(ctx, evidence, client)
	if err != nil {
		return draft, EbayAIReviewResult{Status: EbayAIReviewFailed, Reason: err.Error()}, err
	}

	notes := []string{}

	// The profile must agree with the listing about what part this is. A model
	// that reads a different part number than the draft's identifier has
	// misread the listing, and publishing its copy would mislabel the product.
	if profile.Model != "" && !SameMarketModel(profile.Model, draftIdentifier(draft)) {
		notes = append(notes, "AI 读取到的型号与草稿型号不一致 / proposed model disagrees with the draft identifier")
		return draft, EbayAIReviewResult{
			Status: EbayAIReviewRejected,
			Reason: "model_mismatch",
			Notes:  notes,
		}, nil
	}

	title := BuildProfileProductTitle(profile, firstNonEmptyString(input.ProductName, draft.NormalizedTitle, draft.TitleRaw))
	// "skipped" means the catalogue name already equals the canonical title. That
	// is a successful review, not a rejection: the copy still needs generating.
	switch title.Status {
	case "ready":
		draft.ProposedName = title.NewName
	case "skipped":
		draft.ProposedName = firstNonEmptyString(input.ProductName, title.OldName, draft.NormalizedTitle, draft.TitleRaw)
	default:
		// A generic or low-confidence profile is not publishable. Keeping the
		// draft unapproved lets an administrator classify it by hand instead of
		// shipping a vague product page.
		reason := firstNonEmptyString(title.Message, title.Status, "profile_not_confident")
		return draft, EbayAIReviewResult{Status: EbayAIReviewRejected, Reason: reason, Notes: notes}, nil
	}

	db := config.GetDB()
	categoryID, categoryName, categoryCreated, err := ResolveDraftReviewCategory(db, draft, profile)
	if err != nil {
		return draft, EbayAIReviewResult{Status: EbayAIReviewFailed, Reason: err.Error()}, err
	}
	if categoryID == 0 {
		return draft, EbayAIReviewResult{
			Status: EbayAIReviewRejected,
			Reason: "no_category_match",
			Notes:  append(notes, "无法匹配合适分类，需要人工分类 / no category could be confirmed"),
		}, nil
	}
	if categoryCreated {
		notes = append(notes, "已新建分类 "+categoryName+" / created category "+categoryName)
	}

	content := BuildProfileContent(profile, ProfileContentCatalog{
		SKU:          firstNonEmptyString(draft.NormalizedPartNumber, draft.NormalizedMPN, draft.NormalizedModel),
		Manufacturer: profile.Brand,
	})

	// The listing's own description is cleaner source material than generated
	// prose when it is substantial, but it also carries the seller's branding
	// and shipping boilerplate. Generated copy wins by default; the raw text is
	// kept on the draft so nothing is lost.
	description := firstNonEmptyString(content.Description, cleanDraftDescription(draft.DescriptionRaw))

	draft.ProposedShortDescription = firstNonEmptyString(content.ShortDescription, truncateText(cleanDraftDescription(draft.DescriptionRaw), 320))
	draft.ProposedDescription = description
	draft.ProposedCategoryID = &categoryID
	draft.ProposedCategoryName = categoryName
	draft.ProposedCategoryCreated = categoryCreated
	draft.ProposedBrand = firstNonEmptyString(profile.Brand, draft.NormalizedBrand)
	draft.ProposedModel = firstNonEmptyString(profile.Model, draft.NormalizedModel)
	draft.ProposedPartType = firstNonEmptyString(profile.PartType, draft.SuggestedPartType)
	draft.ProposedMetaTitle = firstNonEmptyString(content.MetaTitle, draft.ProposedName)
	draft.ProposedMetaDescription = content.MetaDescription
	draft.ProposedMetaKeywords = content.MetaKeywords
	draft.ProposedImages = draft.ImageSourceURLs
	draft.AIReviewStatus = EbayAIReviewReady
	draft.AIReviewError = ""
	draft.AIReviewNotes = strings.Join(notes, "\n")

	// Meta title length is a real SEO failure mode, so it is reported rather
	// than silently truncated here; the reviewer can shorten it.
	if len([]rune(draft.ProposedMetaTitle)) > 60 {
		notes = append(notes, "Meta 标题偏长，建议手动精简 / meta title is longer than 60 characters")
		draft.AIReviewNotes = strings.Join(notes, "\n")
	}

	// Warranty and lead time follow the admin-editable commerce policy rather
	// than anything the listing claimed.
	return draft, EbayAIReviewResult{
		Status:          EbayAIReviewReady,
		Notes:           notes,
		CategoryName:    categoryName,
		CategoryCreated: categoryCreated,
		Title:           draft.ProposedName,
	}, nil
}

// ------------------------------------------------------------------ store --

// StoreDraftReview persists a proposal produced by ReviewDraft.
//
// Only the proposal and review-status columns are written, and only while the
// draft is still in a reviewable state. That guard is what stops a slow worker
// from overwriting a proposal an administrator has since approved or a draft
// they have since deleted.
func StoreDraftReview(db *gorm.DB, draft models.EbayImportDraft) error {
	if draft.ID == 0 {
		return errors.New("draft id is required")
	}
	updates := map[string]interface{}{
		"ai_review_status":           draft.AIReviewStatus,
		"ai_review_error":            draft.AIReviewError,
		"ai_review_notes":            draft.AIReviewNotes,
		"proposed_name":              draft.ProposedName,
		"proposed_short_description": draft.ProposedShortDescription,
		"proposed_description":       draft.ProposedDescription,
		"proposed_category_id":       draft.ProposedCategoryID,
		"proposed_category_name":     draft.ProposedCategoryName,
		"proposed_category_created":  draft.ProposedCategoryCreated,
		"proposed_brand":             draft.ProposedBrand,
		"proposed_model":             draft.ProposedModel,
		"proposed_part_type":         draft.ProposedPartType,
		"proposed_meta_title":        draft.ProposedMetaTitle,
		"proposed_meta_description":  draft.ProposedMetaDescription,
		"proposed_meta_keywords":     draft.ProposedMetaKeywords,
		"proposed_images":            draft.ProposedImages,
	}
	if draft.AIReviewStatus == EbayAIReviewReady {
		updates["ai_reviewed_at"] = gorm.Expr("NOW()")
	}
	result := db.Model(&models.EbayImportDraft{}).
		Where("id = ? AND status NOT IN ?", draft.ID, []string{EbayDraftStatusImported, EbayDraftStatusSkipped}).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("draft %d is no longer reviewable", draft.ID)
	}
	return nil
}

// SameMarketModel reports whether two model strings name the same part, using
// the shared market key so "A06B-6077-H106" and "a06b6077h106" agree.
func SameMarketModel(a, b string) bool {
	keyA, keyB := MarketModelKey(a), MarketModelKey(b)
	if keyA == "" || keyB == "" {
		return false
	}
	return keyA == keyB
}

// -------------------------------------------------------------- approval --

// ApplyDraftReviewToDraft copies an approved proposal onto the draft fields the
// importer actually reads.
//
// The importer has one well-tested path that builds a product from the
// Normalized* columns and validates the category against the taxonomy. Rather
// than fork that logic for reviewed drafts, approval moves the proposal into
// those columns so both paths share every safeguard. The proposal columns are
// left untouched as a record of what was approved.
func ApplyDraftReviewToDraft(db *gorm.DB, draft *models.EbayImportDraft) error {
	if draft.AIReviewStatus != EbayAIReviewReady {
		return fmt.Errorf("draft %d is not awaiting approval (status %q)", draft.ID, draft.AIReviewStatus)
	}
	if draft.ProposedCategoryID == nil || *draft.ProposedCategoryID == 0 {
		return fmt.Errorf("draft %d has no proposed category", draft.ID)
	}

	updates := map[string]interface{}{
		"normalized_title":      firstNonEmptyString(draft.ProposedName, draft.NormalizedTitle, draft.TitleRaw),
		"normalized_price":      draft.NormalizedPrice,
		"suggested_category_id": *draft.ProposedCategoryID,
		"taxonomy_status":       EbayDraftTaxonomyMatched,
		"meta_title":            draft.ProposedMetaTitle,
		"meta_description":      draft.ProposedMetaDescription,
		"meta_keywords":         draft.ProposedMetaKeywords,
		"ai_review_status":      EbayAIReviewApproved,
	}
	// The reviewed brand/model/type are the AI's reading of the listing and are
	// only applied when it actually produced one; otherwise the existing
	// normalized values (from the deterministic parser) stand.
	if value := strings.TrimSpace(draft.ProposedBrand); value != "" {
		updates["normalized_brand"] = value
	}
	if value := strings.TrimSpace(draft.ProposedModel); value != "" {
		updates["normalized_model"] = value
	}
	if value := strings.TrimSpace(draft.ProposedPartType); value != "" {
		updates["suggested_part_type"] = value
	}
	if value := strings.TrimSpace(draft.ProposedCategoryName); value != "" {
		updates["suggested_category_name"] = value
	}

	if err := db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(updates).Error; err != nil {
		return err
	}
	// Reflect the approved values back so the caller imports what it approved
	// rather than the pre-approval row it holds in memory.
	draft.NormalizedTitle = updates["normalized_title"].(string)
	draft.SuggestedCategoryID = draft.ProposedCategoryID
	draft.TaxonomyStatus = EbayDraftTaxonomyMatched
	draft.MetaTitle = draft.ProposedMetaTitle
	draft.MetaDescription = draft.ProposedMetaDescription
	draft.MetaKeywords = draft.ProposedMetaKeywords
	draft.AIReviewStatus = EbayAIReviewApproved
	if value, ok := updates["normalized_brand"]; ok {
		draft.NormalizedBrand = value.(string)
	}
	if value, ok := updates["normalized_model"]; ok {
		draft.NormalizedModel = value.(string)
	}
	if value, ok := updates["suggested_part_type"]; ok {
		draft.SuggestedPartType = value.(string)
	}
	if value, ok := updates["suggested_category_name"]; ok {
		draft.SuggestedCategoryName = value.(string)
	}
	return nil
}

// RejectDraftReview discards a proposal without touching the draft's content,
// so a rejected listing stays in the queue for a human to handle.
func RejectDraftReview(db *gorm.DB, id uint, reason string) error {
	updates := map[string]interface{}{
		"ai_review_status": EbayAIReviewRejected,
		"ai_review_error":  strings.TrimSpace(reason),
	}
	return db.Model(&models.EbayImportDraft{}).
		Where("id = ? AND status NOT IN ?", id, []string{EbayDraftStatusImported, EbayDraftStatusSkipped}).
		Updates(updates).Error
}

// MarkDraftReviewFailed records a failed pass. The draft keeps its content and
// can be retried, so a transient model outage does not lose the listing.
func MarkDraftReviewFailed(db *gorm.DB, id uint, reason string) error {
	return db.Model(&models.EbayImportDraft{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"ai_review_status": EbayAIReviewFailed,
			"ai_review_error":  truncateRunesSafe(strings.TrimSpace(reason), 1000),
		}).Error
}
