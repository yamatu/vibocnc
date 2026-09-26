package services

import (
	"context"
	"strings"
	"testing"

	"fanuc-backend/models"
)

func TestValidateProductProfileDropsUncitedSpecs(t *testing.T) {
	profile := ProductProfile{
		Brand:      "FANUC",
		PartType:   "Servo Amplifier",
		Confidence: 0.9,
		Specs: []ProductProfileSpec{
			{Label: "Rated Output", Value: "3.7 kW", Source: "https://example.com/a"},
			{Label: "Voltage", Value: "200 V"}, // no source -> dropped
			{Label: "", Value: "x", Source: "https://example.com/b"},
		},
	}
	validateProductProfile(&profile, ProductIdentificationEvidence{})

	if len(profile.Specs) != 1 {
		t.Fatalf("expected 1 cited spec to survive, got %d", len(profile.Specs))
	}
	if profile.Specs[0].Label != "Rated Output" {
		t.Errorf("unexpected spec kept: %+v", profile.Specs[0])
	}
}

func TestValidateProductProfileRejectsGenericType(t *testing.T) {
	profile := ProductProfile{PartType: "Spare Part", Confidence: 0.95}
	validateProductProfile(&profile, ProductIdentificationEvidence{})

	if profile.PartType != "" {
		t.Errorf("generic part type should be cleared, got %q", profile.PartType)
	}
	if profile.Confidence > 0.2 {
		t.Errorf("confidence should be capped for an unidentified profile, got %v", profile.Confidence)
	}
}

func TestValidateProductProfileCapsUncorroboratedBrand(t *testing.T) {
	profile := ProductProfile{Brand: "Siemens", PartType: "PLC Module", Confidence: 0.95}
	evidence := ProductIdentificationEvidence{
		Listings: []models.EbayMarketEvidenceItem{
			{Title: "FANUC A06B-6077-H106 servo amplifier"},
		},
	}
	validateProductProfile(&profile, evidence)

	if profile.Confidence > 0.5 {
		t.Errorf("uncorroborated brand must cap confidence, got %v", profile.Confidence)
	}
}

func TestValidateProductProfileKeepsCorroboratedBrand(t *testing.T) {
	profile := ProductProfile{Brand: "FANUC", PartType: "Servo Amplifier", Confidence: 0.9}
	evidence := ProductIdentificationEvidence{
		Listings: []models.EbayMarketEvidenceItem{
			{Title: "FANUC A06B-6077-H106 servo amplifier", Brand: "FANUC"},
		},
	}
	validateProductProfile(&profile, evidence)

	if profile.Confidence != 0.9 {
		t.Errorf("corroborated brand should keep its confidence, got %v", profile.Confidence)
	}
}

func TestParseProductProfileToleratesMarkdownFence(t *testing.T) {
	raw := "```json\n{\"brand\":\"FANUC\",\"part_type\":\"Servo Amplifier\",\"confidence\":0.8}\n```"
	profile, err := parseProductProfile(raw)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if profile.Brand != "FANUC" || profile.PartType != "Servo Amplifier" {
		t.Errorf("unexpected profile: %+v", profile)
	}
}

func TestParseProductProfileRejectsGarbage(t *testing.T) {
	if _, err := parseProductProfile("I cannot help with that."); err == nil {
		t.Fatal("expected an error for a reply with no JSON object")
	}
}

func TestBuildProfileProductTitle(t *testing.T) {
	profile := ProductProfile{
		Brand:      "FANUC",
		Model:      "A06B-6077-H106",
		PartType:   "Servo Amplifier",
		Confidence: 0.9,
	}
	proposal := BuildProfileProductTitle(profile, "Used high quality Fanuc A06B-6077-H106 fast delivery")
	if proposal.Status != "ready" {
		t.Fatalf("expected ready, got %q (%s)", proposal.Status, proposal.Message)
	}
	if proposal.NewName != "FANUC A06B-6077-H106 Servo Amplifier / Drive" {
		t.Errorf("unexpected title: %q", proposal.NewName)
	}
}

func TestBuildProfileProductTitleRefusesLowConfidence(t *testing.T) {
	profile := ProductProfile{
		Brand:      "FANUC",
		Model:      "A06B-6077-H106",
		PartType:   "Servo Amplifier",
		Confidence: 0.3,
	}
	proposal := BuildProfileProductTitle(profile, "old name")
	if proposal.Status != "unresolved" {
		t.Errorf("low confidence must not rename, got %q", proposal.Status)
	}
}

func TestBuildProfileProductTitleSkipsWhenUnchanged(t *testing.T) {
	profile := ProductProfile{
		Brand:      "FANUC",
		Model:      "A06B-6077-H106",
		PartType:   "Servo Amplifier",
		Confidence: 0.9,
	}
	proposal := BuildProfileProductTitle(profile, "FANUC A06B-6077-H106 Servo Amplifier / Drive")
	if proposal.Status != "skipped" {
		t.Errorf("expected skipped, got %q", proposal.Status)
	}
}

func TestBuildProfileContentUsesPolicyNotHardcodedText(t *testing.T) {
	profile := ProductProfile{
		Brand:        "FANUC",
		Model:        "A06B-6077-H106",
		PartType:     "Servo Amplifier",
		WhatItIs:     "A single-axis servo amplifier for FANUC CNC systems.",
		KeyFunctions: []string{"Closes the position loop", "Drives one servo axis"},
		Confidence:   0.9,
	}
	content := BuildProfileContent(profile, ProfileContentCatalog{SKU: "FANUC-A06B-6077-H106"})

	if !strings.Contains(content.Description, "A single-axis servo amplifier") {
		t.Errorf("description is missing the profile summary: %q", content.Description)
	}
	if !strings.Contains(content.Description, "Closes the position loop") {
		t.Error("description is missing key functions")
	}
	// The warranty sentence must come from the policy, whatever it says.
	policy := CurrentCommercePolicy()
	if warranty := CommercePolicyWarrantyText(policy); warranty != "" && !strings.Contains(content.Description, warranty) {
		t.Errorf("description is missing the policy warranty text: %q", content.Description)
	}
	if content.MetaTitle == "" || content.MetaDescription == "" {
		t.Error("SEO fields must not be empty")
	}
	if len([]rune(content.MetaTitle)) > 60 {
		t.Errorf("meta title exceeds 60 runes: %d", len([]rune(content.MetaTitle)))
	}
	if len([]rune(content.MetaDescription)) > 160 {
		t.Errorf("meta description exceeds 160 runes: %d", len([]rune(content.MetaDescription)))
	}
}

func TestBuildProfileContentShortDescriptionPrefersWhatItIs(t *testing.T) {
	profile := ProductProfile{
		Brand:      "FANUC",
		Model:      "A06B-6077-H106",
		PartType:   "Servo Amplifier",
		WhatItIs:   "Single-axis servo amplifier.",
		Confidence: 0.9,
	}
	content := BuildProfileContent(profile, ProfileContentCatalog{})
	if content.ShortDescription != "Single-axis servo amplifier." {
		t.Errorf("unexpected short description: %q", content.ShortDescription)
	}
}

func TestDominantEbayCategory(t *testing.T) {
	items := []models.EbayMarketEvidenceItem{
		{CategoryPath: "Business & Industrial > Automation"},
		{CategoryPath: "Business & Industrial > Automation"},
		{CategoryPath: "Computers/Tablets & Networking"},
	}
	if got := DominantEbayCategory(items); got != "Business & Industrial > Automation" {
		t.Errorf("unexpected dominant category: %q", got)
	}
}

func TestBuildIdentificationPayloadIncludesItemSpecifics(t *testing.T) {
	evidence := ProductIdentificationEvidence{
		Model: "A06B-6077-H106",
		Listings: []models.EbayMarketEvidenceItem{
			{
				Title:         "FANUC A06B-6077-H106",
				ItemSpecifics: map[string]any{"Brand": "FANUC", "MPN": "A06B-6077-H106"},
				CategoryPath:  "Business & Industrial > Automation",
			},
		},
	}
	payload := BuildIdentificationPayload(evidence)
	for _, expected := range []string{"A06B-6077-H106", "item_specifics", "category_path", "Brand"} {
		if !strings.Contains(payload, expected) {
			t.Errorf("payload is missing %q: %s", expected, payload)
		}
	}
}

func TestIdentifyProductWithoutClient(t *testing.T) {
	_, err := IdentifyProduct(nil, ProductIdentificationEvidence{Model: "A06B-6077-H106"}, nil)
	if err == nil {
		t.Fatal("expected an error when no AI client is configured")
	}
}

func TestIdentifyProductRequiresModel(t *testing.T) {
	client := func(ctx context.Context, system, user string) (string, error) {
		t.Fatal("the provider must not be called without a model")
		return "", nil
	}
	if _, err := IdentifyProduct(nil, ProductIdentificationEvidence{}, client); err == nil {
		t.Fatal("expected an error when the model is missing")
	}
}
