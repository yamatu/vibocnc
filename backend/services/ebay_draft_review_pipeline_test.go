package services

import (
	"fanuc-backend/models"
	"strings"
	"testing"
)

func TestReviewEvidenceUsesSelectedSourceCategory(t *testing.T) {
	for _, tc := range []struct{ name, site, payload, want string }{
		{"ebay selection overrides old breadcrumb", "ebay", `{"ebay_category_breadcrumb":"Automation > Safety Relays","category_breadcrumb":"Old > PLCs","bas_category_breadcrumb":"BAS > Motors"}`, "Automation > Safety Relays"},
		{"explicit clear stays clear", "ebay", `{"ebay_category_breadcrumb":"","category_breadcrumb":"Old > PLCs"}`, ""},
		{"bas has its own choice", "b-automationservice", `{"bas_category_breadcrumb":"Circuit Breakers","ebay_category_breadcrumb":"PLCs"}`, "Circuit Breakers"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draft := models.EbayImportDraft{SourceSite: tc.site, RawPayload: tc.payload, TitleRaw: "1PC OMRON G7SA-2A2B Safety Relay", NormalizedModel: "G7SA-2A2B"}
			evidence := buildDraftReviewEvidence(EbayDraftReviewInput{Draft: draft, ProductName: "WRONG OLD CATALOGUE NAME"}, draft.NormalizedModel)
			if evidence.EbayCategoryPath != tc.want || evidence.Listings[0].CategoryPath != tc.want {
				t.Fatalf("selected category lost: %+v", evidence)
			}
			if strings.Contains(evidence.ProductName, "WRONG") {
				t.Fatal("catalogue guess replaced the listing title")
			}
		})
	}
}

func TestReviewOwnListingSurvivesEvidenceBudget(t *testing.T) {
	draft := models.EbayImportDraft{SourceSite: "ebay", TitleRaw: "OMRON G7SA-2A2B Safety Relay", RawPayload: `{"ebay_category_breadcrumb":"Relays"}`}
	market := make([]models.EbayMarketEvidenceItem, MaxIdentificationEvidence+2)
	for i := range market {
		market[i].Title = "Other quote"
		market[i].CategoryPath = "Broad category"
	}
	evidence := buildDraftReviewEvidence(EbayDraftReviewInput{Draft: draft, Evidence: market}, "G7SA-2A2B")
	if evidence.Listings[0].Title != draft.TitleRaw {
		t.Fatal("own listing was not first")
	}
	if !strings.Contains(BuildIdentificationPayload(evidence), draft.TitleRaw) {
		t.Fatal("own listing was truncated from the AI prompt")
	}
}

func TestManualImportWaitsForReview(t *testing.T) {
	for _, state := range []string{EbayAIReviewQueued, EbayAIReviewProcessing} {
		draft := models.EbayImportDraft{Status: EbayDraftStatusNeedsReview, AIReviewStatus: state}
		if err := PrepareEbayDraftForManualImport(nil, &draft); err == nil {
			t.Fatal("running review allowed import")
		}
	}
	for _, state := range []string{EbayDraftStatusImported, EbayDraftStatusSkipped} {
		draft := models.EbayImportDraft{Status: state, AIReviewStatus: EbayAIReviewReady}
		if err := PrepareEbayDraftForManualImport(nil, &draft); err == nil {
			t.Fatal("processed draft allowed approval")
		}
	}
}
