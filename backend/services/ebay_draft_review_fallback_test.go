package services

import (
	"testing"

	"fanuc-backend/models"
)

func TestInferPartTypeFromListingText(t *testing.T) {
	cases := []struct {
		name string
		text string
		want string
	}{
		{"photoelectric", "OMRON E3S-CL2 Photoelectric Sensor Switch", "Photoelectric Sensor"},
		{"ethernet switch", "OMRON W4S1-03B Industrial Ethernet Switch", "Industrial Ethernet Switch"},
		{"timer", "Omron H3CR-A8 Timer Module", "Timer Relay"},
		{"frequency converter", "OMRON 3G3JZ-A4015 Frequency Converter", "Variable Frequency Drive"},
		{"touch panel", "OMRON NS10-TV01B-V2 Touch Screen", "Operator Panel / HMI"},
		{"safety relay", "OMRON G7SA-2A2B Safety Relay", "Safety Relay"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := inferPartTypeFromListingText(tc.text); got != tc.want {
				t.Fatalf("inferPartTypeFromListingText() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEnrichEbayReviewProfileUsesListingWhenAITypeIsEmpty(t *testing.T) {
	draft := models.EbayImportDraft{
		SourceSite:       DraftSourceSiteEbay,
		TitleRaw:         "OMRON E3S-CL2 Photoelectric Sensor Switch E3SCL2 New In Box",
		NormalizedModel:  "E3S-CL2",
		NormalizedBrand:  "",
		RawPayload:       `{"category_breadcrumb":"Business & Industrial > Sensors > Photoelectric Sensors"}`,
	}
	profile := ProductProfile{Model: "E3S-CL2", Confidence: 0.2}
	enrichEbayReviewProfile(&profile, draft, "E3S-CL2")
	if profile.Brand != "OMRON" || profile.PartType != "Photoelectric Sensor" {
		t.Fatalf("listing fallback did not fill identity: %#v", profile)
	}
	if profile.Confidence < 0.75 {
		t.Fatalf("listing fallback did not make the usable profile reviewable: %#v", profile)
	}
}

func TestOmronTitleFamiliesAreConfirmed(t *testing.T) {
	cases := []struct {
		model string
		want  string
	}{
		{"E3S-CL2", "Photoelectric Sensor"},
		{"W4S1-03B", "Industrial Ethernet Switch"},
		{"H3CR-A8", "Timer Relay"},
		{"3G3JZ-A4015", "Variable Frequency Drive"},
		{"NS10-TV01B-V2", "Operator Panel / HMI"},
		{"G7SA-2A2B", "Safety Relay"},
	}
	for _, tc := range cases {
		t.Run(tc.model, func(t *testing.T) {
			inference := InferProductCategory("OMRON", tc.model)
			if inference.PartType != tc.want || !IsConfirmedProductCategory(inference, tc.model) {
				t.Fatalf("InferProductCategory(%q) = %#v, want confirmed %q", tc.model, inference, tc.want)
			}
		})
	}
}
