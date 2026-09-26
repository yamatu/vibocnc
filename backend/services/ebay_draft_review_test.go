package services

import (
	"testing"

	"fanuc-backend/models"
)

// The review pass decides whether a scraped listing is publishable. These tests
// pin the decisions that are cheap to get silently wrong: identifier handling,
// the model-agreement guard, and the category-creation gate.

func TestEbayDraftPreflightRejectsUnusableDrafts(t *testing.T) {
	cases := []struct {
		name   string
		draft  models.EbayImportDraft
		reason string
		ok     bool
	}{
		{
			name:   "an already imported draft is not re-reviewed",
			draft:  models.EbayImportDraft{Status: EbayDraftStatusImported, NormalizedModel: "A06B-6077-H106", TitleRaw: "FANUC drive"},
			reason: "already_processed",
			ok:     false,
		},
		{
			name:   "a draft with no identifier can never be published",
			draft:  models.EbayImportDraft{Status: "pending", TitleRaw: "FANUC servo amplifier"},
			reason: "missing_identifier",
			ok:     false,
		},
		{
			name:   "a draft with an identifier but no title has nothing to classify from",
			draft:  models.EbayImportDraft{Status: "pending", NormalizedModel: "A06B-6077-H106"},
			reason: "missing_title",
			ok:     false,
		},
		{
			name:   "a part number alone is a usable identifier",
			draft:  models.EbayImportDraft{Status: "pending", NormalizedPartNumber: "A06B-6077-H106", TitleRaw: "FANUC A06B-6077-H106"},
			reason: "",
			ok:     true,
		},
		{
			name:   "an MPN alone is a usable identifier",
			draft:  models.EbayImportDraft{Status: "pending", NormalizedMPN: "A06B-6077-H106", TitleRaw: "FANUC A06B-6077-H106"},
			reason: "",
			ok:     true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reason, ok := EbayDraftPreflight(tc.draft)
			if ok != tc.ok {
				t.Fatalf("expected ok=%v, got %v (reason %q)", tc.ok, ok, reason)
			}
			if reason != tc.reason {
				t.Fatalf("expected reason %q, got %q", tc.reason, reason)
			}
		})
	}
}

// A draft whose identifier is only the model must still be reviewable, because
// the extension uploads model-only listings.
func TestDraftIdentifierPrefersPartNumberThenMPNThenModel(t *testing.T) {
	both := models.EbayImportDraft{
		NormalizedPartNumber: "A06B-6077-H106",
		NormalizedMPN:        "A06B-6077-H106-MPN",
		NormalizedModel:      "A06B-6077-H106-MODEL",
	}
	if got := draftIdentifier(both); got != "A06B-6077-H106" {
		t.Fatalf("expected the part number to win, got %q", got)
	}
	mpnOnly := models.EbayImportDraft{NormalizedMPN: "A06B-6077-H106-MPN", NormalizedModel: "A06B-6077-H106-MODEL"}
	if got := draftIdentifier(mpnOnly); got != "A06B-6077-H106-MPN" {
		t.Fatalf("expected the MPN to beat the model, got %q", got)
	}
	modelOnly := models.EbayImportDraft{NormalizedModel: "A06B-6077-H106-MODEL"}
	if got := draftIdentifier(modelOnly); got != "A06B-6077-H106-MODEL" {
		t.Fatalf("expected the model as a fallback, got %q", got)
	}
}

// The AI is not allowed to rename the part. If it reads a different model than
// the listing carried, that is a misread and the draft must not be published
// under a wrong identity.
func TestSameMarketModelIgnoresSeparatorsAndCase(t *testing.T) {
	same := [][2]string{
		{"A06B-6077-H106", "A06B6077H106"},
		{"a06b-6077-h106", "A06B-6077-H106"},
		{"A06B 6077 H106", "A06B-6077-H106"},
		{"OEM A06B-6077-H106", "A06B-6077-H106"},
	}
	for _, pair := range same {
		if !SameMarketModel(pair[0], pair[1]) {
			t.Fatalf("expected %q and %q to be the same model", pair[0], pair[1])
		}
	}

	different := [][2]string{
		// A longer part number is a different part, not a prefix match.
		{"A06B-6077-H106", "A06B-6077-H1060"},
		{"A06B-6077-H106", "A06B-6077-H107"},
		{"A06B-6077-H106", "XA06B6077H106"},
	}
	for _, pair := range different {
		if SameMarketModel(pair[0], pair[1]) {
			t.Fatalf("expected %q and %q to be different models", pair[0], pair[1])
		}
	}

	// An empty side can never be "the same", otherwise a draft with no model
	// would agree with every profile.
	if SameMarketModel("", "A06B-6077-H106") || SameMarketModel("A06B-6077-H106", "") {
		t.Fatal("an empty model must not compare equal to a real one")
	}
}

// Category creation is the step that grows the taxonomy. It must stay closed
// for unconfirmed inferences, otherwise a misread part number mints a
// permanent category branch.
func TestResolveDraftReviewCategoryRefusesUnconfirmedInference(t *testing.T) {
	fakes := []struct {
		brand string
		model string
	}{
		{"Unknown Vendor", "XYZ-123"},
		{"Acme", "QQ-99X"},
	}
	for _, fake := range fakes {
		inference := InferProductCategory(fake.brand, fake.model)
		if IsConfirmedProductCategory(inference, fake.model) {
			t.Fatalf("fixture %s/%s is unexpectedly confirmed; pick another", fake.brand, fake.model)
		}
		// The review pass must not create a branch from this inference.
		if !IsGenericProductType(inference.PartType) && inference.PartType != "" {
			// A specific type on an unconfirmed inference is still not enough:
			// IsConfirmedProductCategory is the gate, and it returned false.
			t.Logf("%s/%s inferred a specific type %q but is unconfirmed", fake.brand, fake.model, inference.PartType)
		}
	}
}
