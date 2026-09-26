package services

import (
	"strings"
	"testing"
	"time"

	"fanuc-backend/models"
)

func profileDraftFixture() ProductProfile {
	return ProductProfile{
		Brand:          "FANUC",
		Model:          "A06B-6077-H106",
		PartType:       "Servo Amplifier",
		WhatItIs:       "A single-axis servo amplifier for FANUC CNC systems.",
		KeyFunctions:   []string{"Drives one servo axis"},
		Applications:   []string{"CNC machine tool feed axes"},
		CompatibleWith: []string{"FANUC Series 0"},
		Specs: []ProductProfileSpec{
			{Label: "Rated output", Value: "3.7 kW", Source: "https://www.ebay.com/itm/1"},
		},
		Confidence: 0.91,
		Reason:     "Three exact-model listings agree.",
		SourceURLs: []string{"https://www.ebay.com/itm/1"},
	}
}

func TestBuildProductProfileDraftCreatesReviewPreviewOnly(t *testing.T) {
	now := time.Now().UTC()
	product := &models.Product{
		ID:            7,
		SKU:           "FANUC-A06B-6077-H106",
		Name:          "Used high quality Fanuc A06B-6077-H106 fast delivery",
		Brand:         "FANUC",
		Model:         "A06B-6077-H106",
		ConditionType: "used",
		UpdatedAt:     now,
	}
	quote := &models.EbayMarketQuote{
		ID:       5,
		Evidence: `[{"title":"FANUC A06B-6077-H106","url":"https://www.ebay.com/itm/1"}]`,
	}

	draft, payload, err := BuildProductProfileDraft(product, quote, profileDraftFixture(), 3)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	if draft.ProductID != product.ID || draft.QuoteID != quote.ID || draft.Status != "pending" {
		t.Errorf("unexpected draft identity: %+v", draft)
	}
	if draft.ProposedTitle != "FANUC A06B-6077-H106 Servo Amplifier / Drive" {
		t.Errorf("unexpected proposed title: %q", draft.ProposedTitle)
	}
	if !strings.Contains(payload.Content.Description, "single-axis servo amplifier") {
		t.Errorf("profile-aware description was not generated: %q", payload.Content.Description)
	}
	if draft.ProductUpdatedAt == nil || !draft.ProductUpdatedAt.Equal(now) {
		t.Error("the stale-write snapshot must be retained")
	}
	if product.Name != "Used high quality Fanuc A06B-6077-H106 fast delivery" {
		t.Error("building a draft must never mutate the product")
	}

	decoded, err := DecodeProductProfileDraft(draft)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if decoded.Profile.Brand != "FANUC" || len(decoded.Evidence) != 1 {
		t.Errorf("decoded payload drifted: %+v", decoded)
	}
}

func TestBuildProductProfileDraftRejectsWeakIdentity(t *testing.T) {
	profile := profileDraftFixture()
	profile.Confidence = 0.3
	if _, _, err := BuildProductProfileDraft(nil, nil, profile, 0); err == nil {
		t.Fatal("low-confidence identity must not enter the approval queue")
	}

	profile = profileDraftFixture()
	profile.PartType = "Spare Part"
	if _, _, err := BuildProductProfileDraft(nil, nil, profile, 0); err == nil {
		t.Fatal("generic product type must not enter the approval queue")
	}
}

func TestSanitizeProductProfileRemovesForeignBrandCopy(t *testing.T) {
	profile := profileDraftFixture()
	profile.WhatItIs = "A Siemens-compatible FANUC servo amplifier."
	profile.KeyFunctions = append(profile.KeyFunctions, "Connects to Mitsubishi drives")
	profile.Applications = append(profile.Applications, "ABB robot cells")
	profile.CompatibleWith = append(profile.CompatibleWith, "Siemens S7")

	sanitized := SanitizeProductProfileForStorefront(profile)
	if sanitized.WhatItIs != "" {
		t.Errorf("foreign-brand summary must be removed, got %q", sanitized.WhatItIs)
	}
	joined := strings.Join(append(append(sanitized.KeyFunctions, sanitized.Applications...), sanitized.CompatibleWith...), " ")
	if foreign := ForeignBrandMentions(joined, "FANUC"); len(foreign) > 0 {
		t.Errorf("foreign brand survived sanitization: %v in %q", foreign, joined)
	}
	if !strings.Contains(joined, "Drives one servo axis") {
		t.Error("brand-safe facts must be retained")
	}
}

func TestProductProfileSpecCandidatesRequireCitations(t *testing.T) {
	profile := profileDraftFixture()
	profile.Specs = append(profile.Specs,
		ProductProfileSpec{Label: "Voltage", Value: "200 V"},
		ProductProfileSpec{Label: "", Value: "5 A", Source: "https://example.com"},
	)
	candidates := ProductProfileSpecCandidates(profile)
	if len(candidates) != 1 {
		t.Fatalf("expected only one cited complete candidate, got %d", len(candidates))
	}
	if candidates[0].SourceURL == "" || candidates[0].Origin != "ai" {
		t.Errorf("candidate provenance is missing: %+v", candidates[0])
	}
}

func TestProfileConfidenceLabel(t *testing.T) {
	cases := map[float64]string{0.9: "high", 0.8: "high", 0.79: "medium", 0.5: "medium", 0.49: "low"}
	for input, expected := range cases {
		if got := ProfileConfidenceLabel(input); got != expected {
			t.Errorf("ProfileConfidenceLabel(%v) = %q, want %q", input, got, expected)
		}
	}
}
