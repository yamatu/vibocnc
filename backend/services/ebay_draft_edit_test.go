package services

import (
	"testing"

	"fanuc-backend/models"
)

func editableCJ1WDraft() models.EbayImportDraft {
	category := uint(23)
	return models.EbayImportDraft{
		Status: EbayDraftStatusNeedsReview, AIReviewStatus: EbayAIReviewReady,
		TitleRaw:        "One New Omron CJ1W-DA08C PLC Module In Box Fast Shipping",
		NormalizedTitle: "One New Omron CJ1W-DA08C PLC Module In Box Fast Shipping",
		NormalizedModel: "CJ1W-DA08C", NormalizedPrice: 251.34,
		DescriptionRaw: "<div>Seller HTML<br>Fast Shipping</div>", MetaDescription: "<div>Seller HTML</div>",
		ProposedName: "OMRON CJ1W-DA08C Analog Output Module", ProposedBrand: "OMRON", ProposedModel: "CJ1W-DA08C",
		ProposedPartType: "Analog Output Module", ProposedCategoryID: &category, ProposedCategoryName: "Analog Output Module",
		ProposedDescription:      "OMRON CJ1W-DA08C analog output module for industrial control systems.",
		ProposedShortDescription: "OMRON CJ1W-DA08C analog output module.",
		ProposedMetaTitle:        "OMRON CJ1W-DA08C Analog Output Module | Vibocnc",
		ProposedMetaDescription:  "OMRON CJ1W-DA08C analog output module for industrial automation. Confirm the exact part number and system compatibility before ordering.",
		ProposedMetaKeywords:     "OMRON, CJ1W-DA08C, analog output module",
		ImageSourceURLs:          `["https://example.com/watermarked.jpg"]`, MediaAssetIDs: "[7]", ProposedImages: `["https://example.com/watermarked.jpg"]`,
		MainImageSourceURL: "https://example.com/watermarked.jpg",
	}
}

func TestDraftEditableProjectionIncludesAllAIFields(t *testing.T) {
	draft := editableCJ1WDraft()
	got := draftWithEditableReview(draft)
	if got.NormalizedTitle != draft.ProposedName || got.NormalizedBrand != "OMRON" || got.NormalizedDescription != draft.ProposedDescription || got.MetaDescription != draft.ProposedMetaDescription || got.MetaKeywords != draft.ProposedMetaKeywords || got.SuggestedCategoryID != draft.ProposedCategoryID || got.TaxonomyStatus != EbayDraftTaxonomyMatched {
		t.Fatal("editable fields do not match the optimized product")
	}
	if got.TitleRaw != draft.TitleRaw || got.DescriptionRaw != draft.DescriptionRaw || got.NormalizedPrice != 251.34 || got.AIReviewStatus != EbayAIReviewReady {
		t.Fatal("projection modified evidence, price or approval state")
	}
}

func TestDraftCopyAndImageEditsPreserveReview(t *testing.T) {
	draft := editableCJ1WDraft()
	name, description, meta, include := "OMRON CJ1W-DA08C Analog Output Module", "<p>Edited product description</p>", "<div>Edited SEO text</div>", false
	updates, err := DraftEditableUpdates(nil, draft, models.EbayImportDraftUpdateRequest{NormalizedTitle: &name, NormalizedDescription: &description, MetaDescription: &meta, IncludeImages: &include})
	if err != nil {
		t.Fatal(err)
	}
	if _, invalidated := updates["ai_review_status"]; invalidated {
		t.Fatal("saving copy discarded the AI review")
	}
	if updates["proposed_description"] != "Edited product description" || updates["normalized_description"] != "Edited product description" || updates["proposed_meta_description"] != "Edited SEO text" || updates["exclude_source_images"] != true {
		t.Fatalf("edits lost: %+v", updates)
	}
	brand := "OMRON"
	updates, err = DraftEditableUpdates(nil, draft, models.EbayImportDraftUpdateRequest{NormalizedBrand: &brand})
	if err != nil {
		t.Fatal(err)
	}
	if _, invalidated := updates["ai_review_status"]; invalidated {
		t.Fatal("same effective brand discarded legacy ready review")
	}
}

func TestDraftIdentityChangeRequiresNewReview(t *testing.T) {
	model := "CJ1W-DA041"
	updates, err := DraftEditableUpdates(nil, editableCJ1WDraft(), models.EbayImportDraftUpdateRequest{NormalizedModel: &model})
	if err != nil || updates["ai_review_status"] != "" || updates["taxonomy_status"] != EbayDraftTaxonomyNeedsReview {
		t.Fatalf("stale identity survived: %+v %v", updates, err)
	}
}

func TestDraftImageOptOutBlocksEveryScrapedImagePath(t *testing.T) {
	draft := draftWithEditableReview(editableCJ1WDraft())
	draft.AIReviewStatus = EbayAIReviewApproved
	draft.ExcludeSourceImages = true
	req := BuildProductRequestFromDraft(nil, draft)
	if len(req.Images) != 0 || req.Name != draft.ProposedName || req.Description != draft.ProposedDescription || req.MetaKeywords != draft.ProposedMetaKeywords {
		t.Fatal("image-free request lost content or reattached source pictures")
	}
	existing := models.Product{ImageURLs: `["/uploads/own-photo.jpg"]`}
	PreserveExistingProductImages(&req, existing)
	if len(req.Images) != 1 || req.Images[0].URL != "/uploads/own-photo.jpg" {
		t.Fatal("existing product image was deleted or replaced with a scraped picture")
	}
}

func TestUnreadyOrProcessedDraftCannotBeEditedAsSuccess(t *testing.T) {
	for _, status := range []string{EbayAIReviewQueued, EbayAIReviewProcessing} {
		draft := editableCJ1WDraft()
		draft.AIReviewStatus = status
		if _, err := DraftEditableUpdates(nil, draft, models.EbayImportDraftUpdateRequest{}); err == nil {
			t.Fatal("allowed editing during optimization")
		}
	}
	for _, status := range []string{EbayDraftStatusImported, EbayDraftStatusSkipped} {
		draft := editableCJ1WDraft()
		draft.Status = status
		if _, err := DraftEditableUpdates(nil, draft, models.EbayImportDraftUpdateRequest{}); err == nil {
			t.Fatal("allowed editing an already processed draft")
		}
	}
	for _, status := range []string{"", EbayAIReviewRejected, EbayAIReviewFailed} {
		draft := editableCJ1WDraft()
		draft.AIReviewStatus = status
		if draftWithEditableReview(draft).NormalizedTitle != draft.NormalizedTitle {
			t.Fatal("failed proposal presented as success")
		}
	}
}

func TestDraftPLCAndIODirectionsCannotMatchWrongCategories(t *testing.T) {
	for _, tc := range []struct{ partType, path string }{
		{"Programmable Logic Controller", "OMRON > Control Board"},
		{"Programmable Logic Controller", "OMRON > Motor Controllers"},
		{"Analog Output Module", "OMRON > Analog Input Modules"},
		{"Analog Output Module", "OMRON > Digital Output Modules"},
	} {
		inference := inferReviewCategory(ProductProfile{Brand: "OMRON", Model: "CJ1W-DA08C", PartType: tc.partType}, models.EbayImportDraft{}, "CJ1W-DA08C")
		if CategoryPathMatchesInference(tc.path, inference) {
			t.Fatalf("%s incorrectly matched %s", tc.partType, tc.path)
		}
	}
}
