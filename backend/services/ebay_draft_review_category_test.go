package services

import (
	"testing"

	"fanuc-backend/models"
)

// The AI read the listing's title, item specifics and marketplace category;
// InferProductCategory only pattern-matches the model number. When the AI named
// a specific type it must win, or an AI-reviewed draft would be filed under the
// same guess the plain classification pass already made.
func TestReviewCategoryPrefersTheAITypeOverTheKeywordGuess(t *testing.T) {
	cases := []struct {
		name     string
		profile  ProductProfile
		model    string
		wantType string
	}{
		{
			// The AI's wording is mapped onto the shared vocabulary, so listings
			// that described the same kind of part differently ("Servo Amplifier",
			// "Servo Drive") end up on one branch instead of three.
			name:     "specific AI type replaces the keyword guess",
			profile:  ProductProfile{Brand: "FANUC", PartType: "Servo Amplifier", Confidence: 0.8},
			model:    "A06B-6079-H208",
			wantType: "Servo Amplifier / Drive",
		},
		{
			name:     "a generic AI type is ignored so the keyword guess stands",
			profile:  ProductProfile{Brand: "FANUC", PartType: "Spare Part", Confidence: 0.8},
			model:    "A06B-6079-H208",
			wantType: "", // asserted as "not the generic label" below
		},
		{
			name:     "an empty AI type leaves the keyword inference alone",
			profile:  ProductProfile{Brand: "FANUC", Confidence: 0.8},
			model:    "A06B-6079-H208",
			wantType: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inference := inferReviewCategory(tc.profile, models.EbayImportDraft{NormalizedModel: tc.model}, tc.model)
			if tc.wantType != "" && inference.PartType != tc.wantType {
				t.Errorf("part type = %q, want %q", inference.PartType, tc.wantType)
			}
			if IsGenericProductType(inference.PartType) {
				t.Errorf("part type = %q is generic, which must never reach the taxonomy", inference.PartType)
			}
		})
	}
}

// Approval writes the reading onto the draft, and the import re-validates the
// category before it upserts a product. That validation has to see the approved
// reading too - otherwise a row whose part-number family the deterministic table
// does not cover would be rejected at the last step, which is where the parts in
// the queue were actually being lost.
func TestApprovedReadingIsWhatTheImportValidates(t *testing.T) {
	approved := models.EbayImportDraft{
		AIReviewStatus:    EbayAIReviewApproved,
		NormalizedBrand:   "OMRON",
		NormalizedModel:   "CJ1W-CT021",
		SuggestedPartType: "High-speed Counter Unit",
	}
	reading := draftApprovedReadingInference(approved)
	if !IsConfirmedProductCategory(reading, "CJ1W-CT021") {
		t.Fatalf("an approved reading must classify (rule %q)", reading.MatchRule)
	}
	if reading.PartType != "High-speed Counter Unit" {
		t.Errorf("part type = %q, want the approved reading", reading.PartType)
	}

	// The approval is what makes it evidence: a proposal waiting for one has not
	// been through the step the import validates.
	pending := approved
	pending.AIReviewStatus = EbayAIReviewReady
	if IsConfirmedProductCategory(draftApprovedReadingInference(pending), "CJ1W-CT021") {
		t.Errorf("a pending proposal must not satisfy the import gate")
	}

	// Nor may a placeholder stand in for a reading.
	placeholder := approved
	placeholder.SuggestedPartType = "Spare Part"
	if IsConfirmedProductCategory(draftApprovedReadingInference(placeholder), "CJ1W-CT021") {
		t.Errorf("a placeholder type must not satisfy the import gate")
	}

	// An unreadable brand is not a reading either.
	unknownBrand := approved
	unknownBrand.NormalizedBrand = ""
	if IsConfirmedProductCategory(draftApprovedReadingInference(unknownBrand), "CJ1W-CT021") {
		t.Errorf("a draft with no manufacturer must not satisfy the import gate")
	}
}

// These are the remaining Omron families for which the deterministic table
// intentionally has no model rule. The eBay listing evidence/AI reading must
// be able to classify them instead of returning no_category_match.
func TestReviewCategoryCoversFamiliesTheDeterministicTableMisses(t *testing.T) {
	models := []string{"CJ1W-CT021", "CS1W-NC113", "CS1W-EIP21"}
	for _, model := range models {
		deterministic := InferProductCategory("OMRON", model)
		if IsConfirmedProductCategory(deterministic, model) {
			t.Errorf("%s is already confirmed by the deterministic table (rule %q), so it never needed the AI reading", model, deterministic.MatchRule)
		}
	}
}

// A draft whose model number belongs to no family in the deterministic table
// used to be thrown away: the AI identified the part from the listing, but the
// classification gate only looked at the deterministic rule, decided the type
// was unverified, and the review answered "no category could be confirmed" - so
// the draft was discarded even though the part had been identified. The reading
// is the evidence that makes such a draft classifiable, so it has to carry its
// verification with it - and only for a type specific enough to name a public
// category node.
func TestReviewCategoryTreatsTheModelReadingAsVerification(t *testing.T) {
	cases := []struct {
		name          string
		brand         string
		aiType        string
		model         string
		wantType      string
		wantConfirmed bool
	}{
		{
			name:          "a part-number family the deterministic table does not know",
			brand:         "OMRON",
			aiType:        "High-speed Counter Unit",
			model:         "CJ1W-CT021",
			wantType:      "High-speed Counter Unit",
			wantConfirmed: true,
		},
		{
			name:          "a specific type outside the shared vocabulary",
			brand:         "OMRON",
			aiType:        "EtherNet/IP Coupler Unit",
			model:         "NX-EIC202",
			wantType:      "EtherNet/IP Coupler Unit",
			wantConfirmed: true,
		},
		{
			name:          "the reading is mapped onto the shared vocabulary",
			brand:         "OMRON",
			aiType:        "Analog I/O Module",
			model:         "CJ1W-MAD42",
			wantType:      "I/O Module",
			wantConfirmed: true,
		},
		{
			name:          "a manufacturer outside the deterministic registry still classifies",
			brand:         "IDEC",
			aiType:        "Safety Relay",
			model:         "RF1V-3A1BL",
			wantType:      "Safety Relay",
			wantConfirmed: true,
		},
		{
			name:          "a placeholder may never name a node",
			brand:         "OMRON",
			aiType:        "Spare Part",
			model:         "CJ1W-CT021",
			wantConfirmed: false,
		},
		{
			name:          "a part number the model repeated is not a type",
			brand:         "OMRON",
			aiType:        "CJ1W-CT021",
			model:         "CJ1W-CT021",
			wantConfirmed: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inference := inferReviewCategory(
				ProductProfile{Brand: tc.brand, PartType: tc.aiType, Confidence: 0.9},
				models.EbayImportDraft{NormalizedBrand: tc.brand, NormalizedModel: tc.model},
				tc.model,
			)
			if tc.wantType != "" && inference.PartType != tc.wantType {
				t.Errorf("part type = %q, want %q", inference.PartType, tc.wantType)
			}
			if got := IsConfirmedProductCategory(inference, tc.model); got != tc.wantConfirmed {
				t.Errorf("confirmed = %v, want %v (rule %q)", got, tc.wantConfirmed, inference.MatchRule)
			}
			if IsGenericProductType(inference.PartType) && tc.wantType != "" {
				t.Errorf("part type %q is a placeholder", inference.PartType)
			}
		})
	}
}

// The keyword inference has to remain the fallback, otherwise a listing the AI
// could not place would lose the classification it already had.
func TestReviewCategoryKeepsTheKeywordInferenceAsFallback(t *testing.T) {
	inference := inferReviewCategory(
		ProductProfile{Brand: "FANUC", Confidence: 0.8},
		models.EbayImportDraft{NormalizedModel: "A06B-6079-H208"},
		"A06B-6079-H208",
	)
	if inference.BrandKey != "fanuc" {
		t.Errorf("brand key = %q, want fanuc", inference.BrandKey)
	}
	if IsGenericProductType(inference.PartType) {
		t.Errorf("part type %q is generic", inference.PartType)
	}
}
