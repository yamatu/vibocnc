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
			name:     "specific AI type replaces the keyword guess",
			profile:  ProductProfile{Brand: "FANUC", PartType: "Servo Amplifier", Confidence: 0.8},
			model:    "A06B-6079-H208",
			wantType: "Servo Amplifier",
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
