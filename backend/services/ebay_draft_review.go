package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"

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
	// TitleCandidate is an unconfirmed model the caller recovered from the
	// listing title because the draft carries no identifier of its own. It is a
	// hint rather than an identity: it makes a draft reviewable, and the model's
	// own reading of the listing is allowed to overrule it (see ReviewDraft).
	TitleCandidate string
	// CategoryMode selects the source taxonomy or the mixed brand/type taxonomy.
	CategoryMode string
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
	return EbayDraftPreflightWithIdentifier(draft, draftIdentifier(draft))
}

// EbayDraftReviewIdentifier returns the identifier a review should work from:
// the draft's own columns when it has one, otherwise the caller's title
// candidate.
//
// speculative reports that the identifier is a guess recovered from the title
// rather than something the listing recorded as a field, which is not a detail:
// a recorded identifier that disagrees with the model's reading means the model
// misread the listing, while a guess that disagrees means the parser met a
// part-number family it had never seen (see modelDisagreement).
func EbayDraftReviewIdentifier(draft models.EbayImportDraft, titleCandidate string) (identifier string, speculative bool) {
	if identifier := draftIdentifier(draft); identifier != "" {
		return identifier, false
	}
	candidate := strings.TrimSpace(titleCandidate)
	if candidate == "" {
		return "", false
	}
	return NormalizeProductModel(candidate), true
}

// EbayDraftPreflightWithIdentifier is EbayDraftPreflight with the identifier
// supplied by the caller instead of read out of the draft's columns.
//
// A candidate recovered from the title is deliberately never written onto the
// draft - a guess must not become the listing's recorded identity - so the pass
// has to be told about it explicitly.
func EbayDraftPreflightWithIdentifier(draft models.EbayImportDraft, identifier string) (string, bool) {
	switch draft.Status {
	case EbayDraftStatusImported, EbayDraftStatusSkipped:
		return "already_processed", false
	}
	if strings.TrimSpace(identifier) == "" {
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
	return ResolveDraftReviewCategoryWithMode(db, draft, profile, DraftCategoryModeMixed)
}

func ResolveDraftReviewCategoryWithMode(db *gorm.DB, draft models.EbayImportDraft, profile ProductProfile, categoryMode string) (uint, string, bool, error) {
	model := firstNonEmptyString(profile.Model, draft.NormalizedModel, draftIdentifier(draft))
	mode := NormalizeDraftCategoryMode(categoryMode)
	if mode == DraftCategoryModeSource {
		sourcePath := draftReviewSourceCategory(draft.SourceSite, decodeRawPayload(draft.RawPayload))
		if strings.TrimSpace(sourcePath) != "" {
			categoryID, path, created, err := ResolveOrCreateDraftSourceCategory(db, draft.SourceSite, sourcePath)
			if err == nil && categoryID > 0 {
				return categoryID, path, created, nil
			}
		}
		// A missing source breadcrumb is not a reason to discard a product. The
		// AI type then becomes the mixed-taxonomy fallback and can create a node.
		mode = DraftCategoryModeMixed
	}

	if db == nil {
		return 0, "", false, errors.New("database is not configured")
	}
	inference := inferReviewCategory(profile, draft, model)
	// A previous deterministic match is not stronger than the listing the AI
	// just read. Reuse it only if it also matches the new brand/type evidence.
	if draft.SuggestedCategoryID != nil && *draft.SuggestedCategoryID > 0 {
		if _, err := ValidateExistingCategoryForInference(db, *draft.SuggestedCategoryID, inference); err == nil {
			var category models.Category
			if err := db.Select("id", "name").First(&category, *draft.SuggestedCategoryID).Error; err == nil {
				return category.ID, category.Name, false, nil
			}
		}
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

	// The AI's own category wording is a second chance at a match when the part
	// type alone did not corroborate a branch. It is only used as a matching hint
	// against existing categories, never to name a new one, so a vague AI label
	// cannot mint a vague branch.
	if hint := strings.TrimSpace(profile.ProductCategory); hint != "" && !IsGenericProductType(hint) {
		if existing, err := ResolveExistingCategoryForInference(db, inference, hint); err == nil && existing > 0 {
			var category models.Category
			if err := db.Select("id", "name").First(&category, existing).Error; err == nil {
				return category.ID, category.Name, false, nil
			}
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

// inferReviewCategory combines the AI's reading of a listing with the keyword
// inference the plain classification pass uses.
//
// InferProductCategory only pattern-matches a model number, so it cannot tell a
// servo amplifier from a spindle motor when both share a part-number family. The
// AI read the listing's title, item specifics and marketplace category, so a
// specific type from the AI replaces the guess. A generic label never does: it
// would land the product on a vague taxonomy node, and those are expensive to
// clean up once products point at them.
func inferReviewCategory(profile ProductProfile, draft models.EbayImportDraft, model string) ProductCategoryInference {
	brand := firstNonEmptyString(profile.Brand, draft.NormalizedBrand)
	inference := InferProductCategory(brand, model)

	// The model read the listing itself - title, item specifics and the
	// marketplace category - while InferProductCategory only pattern-matches the
	// model number. When that reading names a specific component type for a
	// concrete manufacturer, it is the better evidence, and it is what lets the
	// draft get a category (created when the taxonomy has none) instead of being
	// discarded as unclassifiable: the deterministic table simply has no row for
	// most part-number families, and throwing the listing away loses a part the
	// model had already identified.
	//
	// The "llm:" rule prefix is the flag the classification gate understands as
	// "verified outside the deterministic rules", so it may only be set for a
	// type worth publishing: a placeholder or a misread part number must never
	// become a public node.
	partType := CanonicalizeProductTypeFromText(profile.PartType)
	brandKey := NormalizeBrandKey(brand)
	if brandKey != "" && !strings.EqualFold(brandKey, "unknown") && IsPublishableProductType(partType) {
		inference.PartType = partType
		inference.ModelFamily = "" // A model-family hint must not override the specific listing type.
		inference.CategorySlug = utils.GenerateSlug(partType)
		inference.BrandKey = brandKey
		if name := CanonicalBrandName(brandKey); name != "" {
			inference.BrandName = name
		}
		inference.MatchRule = verifiedListingRule(partType)
	} else if strings.TrimSpace(inference.PartType) == "" {
		inference.PartType = partType
	}
	if inference.BrandKey == "" {
		inference.BrandKey = brandKey
	}
	return inference
}

// draftApprovedReadingInference reconstructs the classification an approved AI
// reading recorded on a draft.
//
// The import re-validates a draft's category against the taxonomy, and that
// validation used to re-derive the component type from the model number alone -
// the very table that could not classify the part, so an approved row whose
// part-number family the table has no row for was sent back to the queue as
// unresolved however good the proposal was. The approved reading is the evidence
// the administrator accepted, so it is offered first.
//
// Only an approval counts: a pending proposal has not been through the step the
// import is validating.
func draftApprovedReadingInference(draft models.EbayImportDraft) ProductCategoryInference {
	if draft.AIReviewStatus != EbayAIReviewApproved {
		return ProductCategoryInference{}
	}
	partType := CanonicalizeProductTypeFromText(draft.SuggestedPartType)
	brandName := strings.TrimSpace(draft.NormalizedBrand)
	brandKey := NormalizeBrandKey(brandName)
	if brandKey == "" || strings.EqualFold(brandKey, "unknown") || !IsPublishableProductType(partType) {
		return ProductCategoryInference{}
	}
	if canonical := CanonicalBrandName(brandKey); canonical != "" {
		brandName = canonical
	}
	return ProductCategoryInference{
		BrandKey:     brandKey,
		BrandName:    brandName,
		PartType:     partType,
		CategorySlug: utils.GenerateSlug(partType),
		MatchRule:    verifiedListingRule(partType),
	}
}

// verifiedListingRule names the rule that records "the model read this listing
// and reported this component type". The "llm:" prefix makes
// IsVerifiedClassificationRule accept it, which in turn lets a manufacturer
// outside the deterministic brand registry classify cleanly.
func verifiedListingRule(partType string) string {
	slug := utils.GenerateSlug(partType)
	if slug == "" {
		slug = "product-type"
	}
	return "llm:listing:" + slug
}

// modelDisagreement decides what an identifier/AI-reading disagreement means.
//
// The two identifiers are not equally authoritative. A model that disagrees with
// a part number the listing *recorded* has misread the listing, and publishing its
// copy would mislabel the product, so the draft is rejected. A disagreement with
// an unconfirmed title candidate means the opposite: the parser met a
// part-number family it had never seen and guessed badly, while the model read
// the listing itself - title, item specifics, marketplace category - so the
// model's reading is the better one and the disagreement is recorded instead of
// throwing the listing away. Rejecting there is what turned one queue of unknown
// families into a batch that could not be reviewed at all, even though the model
// had identified every part in it.
func modelDisagreement(identifier string, speculative bool) (reject bool, note string) {
	if !speculative {
		return true, "AI 读取到的型号与草稿型号不一致 / proposed model disagrees with the draft identifier"
	}
	return false, "草稿型号由标题推断（未确认）：" + identifier + "，以 AI 读取为准 / unconfirmed title candidate " + identifier + " is overruled by the AI reading"
}

// --------------------------------------------------------------- the pass --

// ReviewDraft runs the automated review for one draft and returns the proposal
// to store. It may create missing taxonomy nodes, but never publishes a product.
// The proposal itself is persisted separately by StoreDraftReview.
func ReviewDraft(
	ctx context.Context,
	input EbayDraftReviewInput,
	client IdentificationClient,
) (models.EbayImportDraft, EbayAIReviewResult, error) {
	return reviewDraftWithDB(ctx, config.GetDB(), input, client)
}

// Explicit DB dependency lets the entire review/store/approval chain run against
// an isolated test database without changing production configuration.
func reviewDraftWithDB(ctx context.Context, db *gorm.DB, input EbayDraftReviewInput, client IdentificationClient) (models.EbayImportDraft, EbayAIReviewResult, error) {
	draft := input.Draft
	// The identifier this pass works from: the draft's own columns when it has one,
	// otherwise the candidate the job layer recovered from the title. A candidate
	// is never written onto the draft, so it has to be handed in and tracked
	// separately.
	identifier, identifierSpeculative := EbayDraftReviewIdentifier(draft, input.TitleCandidate)
	if reason, ok := EbayDraftPreflightWithIdentifier(draft, identifier); !ok {
		return draft, EbayAIReviewResult{Status: EbayAIReviewRejected, Reason: reason}, nil
	}

	evidence := buildDraftReviewEvidence(input, identifier)

	profile, err := IdentifyProduct(ctx, evidence, client)
	if err != nil {
		return draft, EbayAIReviewResult{Status: EbayAIReviewFailed, Reason: err.Error()}, err
	}
	// A sparse eBay description or a broad marketplace breadcrumb can make a
	// provider return an empty/generic type. The listing title, structured
	// specifics and eBay path are still usable evidence; fill only missing
	// profile fields before the normal title/category pipeline runs.
	enrichEbayReviewProfile(&profile, draft, identifier)

	notes := []string{}

	// The profile must agree with the listing about what part this is. A model
	// that reads a different part number than the draft's *recorded* identifier
	// has misread the listing, and publishing its copy would mislabel the
	// product.
	if profile.Model != "" && !SameMarketModel(profile.Model, identifier) {
		reject, note := modelDisagreement(identifier, identifierSpeculative)
		notes = append(notes, note)
		if reject {
			return draft, EbayAIReviewResult{
				Status: EbayAIReviewRejected,
				Reason: "model_mismatch",
				Notes:  notes,
			}, nil
		}
	}

	// Use one vocabulary for the title, content, taxonomy and import validation.
	profile.PartType = CanonicalizeProductTypeFromText(profile.PartType)
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

	categoryMode := input.CategoryMode
	if strings.TrimSpace(categoryMode) == "" {
		categoryMode = EffectiveDraftCategoryMode(draft)
	}
	categoryID, categoryName, categoryCreated, err := ResolveDraftReviewCategoryWithMode(db, draft, profile, categoryMode)
	if NormalizeDraftCategoryMode(categoryMode) == DraftCategoryModeSource && strings.TrimSpace(draftReviewSourceCategory(draft.SourceSite, decodeRawPayload(draft.RawPayload))) != "" {
		draft.CategoryMode = DraftCategoryModeSource
	} else {
		draft.CategoryMode = DraftCategoryModeMixed
	}
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
	description := SanitizeListingDescription(firstNonEmptyString(content.Description, draft.DescriptionRaw))

	draft.ProposedShortDescription = SanitizeListingDescription(firstNonEmptyString(content.ShortDescription, truncateText(cleanDraftDescription(draft.DescriptionRaw), 320)))
	draft.ProposedDescription = description
	draft.ProposedCategoryID = &categoryID
	draft.ProposedCategoryName = categoryName
	draft.ProposedCategoryCreated = categoryCreated
	draft.ProposedBrand = firstNonEmptyString(profile.Brand, draft.NormalizedBrand)
	draft.ProposedModel = firstNonEmptyString(profile.Model, draft.NormalizedModel)
	draft.ProposedPartType = firstNonEmptyString(profile.PartType, draft.SuggestedPartType)
	draft.ProposedMetaTitle = BuildSafeMetaTitle(SanitizeListingTitle(content.MetaTitle), draft.ProposedName)
	draft.ProposedMetaDescription = BuildSafeMetaDescription(SanitizeListingTitle(content.MetaDescription), SanitizeListingTitle(draft.ProposedShortDescription))
	draft.ProposedMetaKeywords = SanitizeListingTitle(content.MetaKeywords)
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
		for key, value := range draftEditableReviewUpdates(draft) {
			updates[key] = value
		}
		updates["ai_reviewed_at"] = gorm.Expr("NOW()")
	}
	result := db.Model(&models.EbayImportDraft{}).
		Where("id = ? AND status NOT IN ? AND ai_review_status IN ?", draft.ID, []string{EbayDraftStatusImported, EbayDraftStatusSkipped}, []string{EbayAIReviewQueued, EbayAIReviewProcessing}).
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
		"category_mode":         EffectiveDraftCategoryMode(*draft),
		"normalized_price":      draft.NormalizedPrice,
		"suggested_category_id": *draft.ProposedCategoryID,
		"taxonomy_status":       EbayDraftTaxonomyMatched,
		"meta_title":            draft.ProposedMetaTitle,
		"meta_description":      draft.ProposedMetaDescription,
		"meta_keywords":         draft.ProposedMetaKeywords,
		"ai_review_status":      EbayAIReviewApproved,
	}
	for key, value := range draftEditableReviewUpdates(*draft) {
		updates[key] = value
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

	result := db.Model(&models.EbayImportDraft{}).
		Where("id = ? AND ai_review_status = ? AND status NOT IN ?", draft.ID, EbayAIReviewReady, []string{EbayDraftStatusImported, EbayDraftStatusSkipped}).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("draft %d changed before approval; reload it first", draft.ID)
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
	*draft = draftWithEditableReview(*draft)
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

// PrepareEbayDraftForManualImport is shared by every manual import entry point.
// Merely reviewing still does not publish; clicking either import button must
// consume the AI result instead of silently importing the original listing.
func PrepareEbayDraftForManualImport(db *gorm.DB, draft *models.EbayImportDraft) error {
	if draft == nil {
		return errors.New("draft is required")
	}
	if draft.Status == EbayDraftStatusImported || draft.Status == EbayDraftStatusSkipped {
		return errors.New("draft has already been processed")
	}
	switch draft.AIReviewStatus {
	case EbayAIReviewQueued, EbayAIReviewProcessing:
		return errors.New("AI optimization is still running; wait before importing")
	case EbayAIReviewReady:
		return ApplyDraftReviewToDraft(db, draft)
	default:
		return nil
	}
}
