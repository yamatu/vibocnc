package services

import "testing"

func TestInferFanucCategoryInference(t *testing.T) {
	tests := []struct {
		model        string
		wantPartType string
		wantSlug     string
	}{
		{model: "A06B-6114-H103", wantPartType: "Servo Amplifier / Drive", wantSlug: "fanuc-servo-amplifier-drive"},
		{model: "A06B-0123-B075", wantPartType: "Servo Motor", wantSlug: "fanuc-servo-motor"},
		{model: "A06B-1451-B100", wantPartType: "Spindle Motor", wantSlug: "fanuc-spindle-motor"},
		{model: "A16B-2200-0390", wantPartType: "PCB Board", wantSlug: "fanuc-pcb-control-board"},
		{model: "A03B-0819-C011", wantPartType: "I/O Module", wantSlug: "fanuc-i-o-module"},
		{model: "A14B-0082-B202", wantPartType: "Power Supply Unit", wantSlug: "fanuc-power-supply"},
		{model: "A860-0203-T001", wantPartType: "Encoder / Feedback", wantSlug: "fanuc-encoder-feedback"},
		{model: "CAB-0200", wantPartType: "Cable / Connector", wantSlug: "fanuc-cables-connectors"},
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			got := inferFanucCategoryInference(tt.model)
			if got.PartType != tt.wantPartType {
				t.Fatalf("part type mismatch: got %q want %q", got.PartType, tt.wantPartType)
			}
			if got.CategorySlug != tt.wantSlug {
				t.Fatalf("category slug mismatch: got %q want %q", got.CategorySlug, tt.wantSlug)
			}
		})
	}
}

func TestFanucEnrichProducesSEOContent(t *testing.T) {
	enriched := FanucEnrich("A06B-0123-B077")

	if enriched.Name == "" || enriched.ShortDescription == "" || enriched.Description == "" {
		t.Fatalf("expected enriched content to be populated: %+v", enriched)
	}
	if enriched.MetaTitle == "" || enriched.MetaDescription == "" || enriched.MetaKeywords == "" {
		t.Fatalf("expected SEO fields to be populated: %+v", enriched)
	}
	if enriched.CompatibilityInfo == "" || enriched.InstallationGuide == "" || enriched.MaintenanceTips == "" {
		t.Fatalf("expected operational content to be populated: %+v", enriched)
	}
	if enriched.CategorySlug != "fanuc-servo-motor" {
		t.Fatalf("unexpected category slug: %s", enriched.CategorySlug)
	}
}

func TestInferProductCategoryTreatsUnknownFanucModelAsFanuc(t *testing.T) {
	got := InferProductCategory("UNKNOWN", "A06B-0278-B000")

	if got.BrandKey != "fanuc" {
		t.Fatalf("brand key mismatch: got %q want %q", got.BrandKey, "fanuc")
	}
	if got.CategorySlug != "fanuc-servo-motor" {
		t.Fatalf("category slug mismatch: got %q want %q", got.CategorySlug, "fanuc-servo-motor")
	}
}
