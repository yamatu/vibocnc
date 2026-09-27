package services

import (
	"testing"

	"fanuc-backend/models"
)

// TestScrapedListingWithoutStructuredModelBecomesReviewable is the end-to-end
// guard for the reported 409.
//
// A scraped eBay listing carries a "Model" item specific only sometimes; the
// rest arrive with no model at all, while the title always names the part.
// Product identification requires a model, so before the title was parsed those
// drafts could never be reviewed - selecting them returned "no reviewable drafts
// were selected" no matter how many were ticked.
//
// This asserts the whole chain the review depends on: an unmodelled payload
// produces a draft whose identifier exists, passes the preflight, and yields the
// model the AI is asked about.
func TestScrapedListingWithoutStructuredModelBecomesReviewable(t *testing.T) {
	payloads := []struct {
		name  string
		title string
		want  string
	}{
		{
			name:  "fanuc amplifier listing",
			title: "FANUC A06B-6079-H208 Servo Amplifier Module TESTED",
			want:  "A06B-6079-H208",
		},
		{
			name:  "siemens listing",
			title: "Siemens 6ES7215-1AG40-0XB0 SIMATIC S7-1200 CPU",
			want:  "6ES7215-1AG40-0XB0",
		},
		{
			name:  "lower case listing",
			title: "used mitsubishi mr-j4-40a servo drive 400w",
			want:  "MR-J4-40A",
		},
	}

	for _, tc := range payloads {
		t.Run(tc.name, func(t *testing.T) {
			// The payload has a title and nothing else that could identify the
			// part, which is exactly what the scraper sends for these rows.
			raw := map[string]any{
				"product_title": tc.title,
				"current_price": "120.00",
			}
			result := BuildEbayImportDraft(nil, raw)
			if len(result.Errors) > 0 {
				t.Fatalf("BuildEbayImportDraft() reported errors: %v", result.Errors)
			}

			draft := models.EbayImportDraft{
				Status:          EbayDraftStatusPending,
				TitleRaw:        result.Draft.TitleRaw,
				NormalizedTitle: result.Draft.NormalizedTitle,
				NormalizedModel: result.Draft.NormalizedModel,
			}

			if got := draftIdentifier(draft); got == "" {
				t.Fatalf("draft from title %q has no identifier, so no batch can ever review it", tc.title)
			}
			if !SameMarketModel(draftIdentifier(draft), tc.want) {
				t.Fatalf("identifier = %q, want it to match %q", draftIdentifier(draft), tc.want)
			}
			if reason, ok := EbayDraftPreflight(draft); !ok {
				t.Fatalf("EbayDraftPreflight() rejected a reviewable scraped draft: %q", reason)
			}
		})
	}
}

// TestScrapedPayloadWithStructuredModelIsUnchanged keeps the title parser from
// overriding a model the scraper actually extracted.
func TestScrapedPayloadWithStructuredModelIsUnchanged(t *testing.T) {
	raw := map[string]any{
		// A title naming a different part must not win over the structured
		// attribute, which is the more reliable of the two.
		"product_title": "FANUC servo amplifier A06B-6079-H208",
		"model":         "A06B-6220-H006",
		"current_price": "99.00",
	}
	result := BuildEbayImportDraft(nil, raw)
	if len(result.Errors) > 0 {
		t.Fatalf("BuildEbayImportDraft() reported errors: %v", result.Errors)
	}
	if result.Draft.NormalizedModel != "A06B-6220-H006" {
		t.Fatalf("NormalizedModel = %q, want the structured model %q", result.Draft.NormalizedModel, "A06B-6220-H006")
	}
}

// TestScrapedPayloadWithoutAnyModelStaysUnreviewable documents the intended
// failure mode: when neither the payload nor the title names a part, the draft
// must stay out of the review queue rather than be guessed at.
func TestScrapedPayloadWithoutAnyModelStaysUnreviewable(t *testing.T) {
	raw := map[string]any{
		"product_title": "Lot of 5 industrial servo parts, used, as pictured",
		"current_price": "50.00",
	}
	result := BuildEbayImportDraft(nil, raw)
	draft := models.EbayImportDraft{
		Status:          EbayDraftStatusPending,
		TitleRaw:        result.Draft.TitleRaw,
		NormalizedTitle: result.Draft.NormalizedTitle,
		NormalizedModel: result.Draft.NormalizedModel,
	}
	reason, ok := EbayDraftPreflight(draft)
	if ok {
		t.Fatalf("a listing naming no part must not be reviewable, got model %q", result.Draft.NormalizedModel)
	}
	if reason != "missing_identifier" {
		t.Fatalf("preflight reason = %q, want missing_identifier", reason)
	}
}
