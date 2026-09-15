package utils

import (
	"strings"
	"testing"
)

func TestParseModelFromFilenameHandlesMultipleBrands(t *testing.T) {
	cases := []struct {
		filename string
		want     string
	}{
		{"A02B-0120-C041MAR_$_57.jpg", "A02B-0120-C041MAR"},
		{"A06B-6220-H006.png", "A06B-6220-H006"},
		{"A860-2000-T301_image.jpg", "A860-2000-T301"},
		{"MR-J4-40A.jpg", "MR-J4-40A"},
		{"MR-J3-70B_main.png", "MR-J3-70B"},
		{"6ES7215-1AG40-0XB0.png", "6ES7215-1AG40-0XB0"},
		{"1756-L61_main.jpg", "1756-L61"},
		{"SGDV-2R8A01A.webp", "SGDV-2R8A01A"},
		{"CJ2M-CPU31.jpg", "CJ2M-CPU31"},
		{"DSQC-664.png", "DSQC-664"},
	}
	for _, tc := range cases {
		got := ParseModelFromFilename(tc.filename)
		if got == "" {
			t.Errorf("ParseModelFromFilename(%q) returned nothing, want %q", tc.filename, tc.want)
			continue
		}
		if got != tc.want {
			t.Errorf("ParseModelFromFilename(%q) = %q, want %q", tc.filename, got, tc.want)
		}
	}
}

// Generated copy must never name a brand that was not supplied, otherwise a
// Mitsubishi or Siemens page would ship with FANUC text and be flagged as
// contaminated content.
func TestGeneratedCopyNeverInventsABrand(t *testing.T) {
	const model = "MR-J4-40A"

	generators := map[string]string{
		"name":            GenerateProductNameForBrand("", model, "Servo Amplifier"),
		"short":           GenerateShortDescriptionForBrand("", model, "Servo Amplifier"),
		"description":     GenerateDescriptionForBrand("", model, "Servo Amplifier"),
		"seo title":       GenerateSEOTitleForBrand("", model, "Servo Amplifier"),
		"seo description": GenerateSEODescriptionForBrand("", model, "Servo Amplifier"),
		"keywords":        GenerateSEOKeywordsForBrand("", model, "Servo Amplifier"),
	}
	for label, value := range generators {
		if strings.TrimSpace(value) == "" {
			t.Errorf("%s is empty", label)
		}
		if strings.Contains(strings.ToUpper(value), "FANUC") {
			t.Errorf("%s invented a brand: %q", label, value)
		}
	}

	// The legacy signature must behave the same way.
	if strings.Contains(strings.ToUpper(GenerateProductNameFromModel(model)), "FANUC") {
		t.Error("GenerateProductNameFromModel invented a brand")
	}
}

func TestGeneratedCopyUsesTheSuppliedBrandOnly(t *testing.T) {
	name := GenerateProductNameForBrand("Mitsubishi", "MR-J4-40A", "Servo Amplifier")
	if name != "Mitsubishi Servo Amplifier MR-J4-40A" {
		t.Errorf("unexpected name: %q", name)
	}
	description := GenerateDescriptionForBrand("Mitsubishi", "MR-J4-40A", "Servo Amplifier")
	if !strings.Contains(description, "Compatible with Mitsubishi systems") {
		t.Errorf("description should reference the supplied brand: %q", description)
	}
	if strings.Contains(strings.ToUpper(description), "FANUC") {
		t.Errorf("description leaked another brand: %q", description)
	}
	keywords := GenerateSEOKeywordsForBrand("Mitsubishi", "MR-J4-40A", "Servo Amplifier")
	if !strings.Contains(keywords, "Mitsubishi") || strings.Contains(strings.ToUpper(keywords), "FANUC") {
		t.Errorf("unexpected keywords: %q", keywords)
	}
}

func TestGeneratedCopyHandlesEmptyModel(t *testing.T) {
	if got := GenerateProductNameForBrand("FANUC", "  ", "Servo Motor"); got != "" {
		t.Errorf("empty model should produce empty name, got %q", got)
	}
	if got := GenerateDescriptionForBrand("FANUC", "", "Servo Motor"); got != "" {
		t.Errorf("empty model should produce empty description, got %q", got)
	}
}
