package controllers

import (
	"testing"

	"fanuc-backend/models"
	"fanuc-backend/services"
)

func TestProfileProductUpdatesPreservesMatureCopyByDefault(t *testing.T) {
	product := models.Product{
		ID:                1,
		Name:              "Old marketplace title",
		Brand:             "",
		Manufacturer:      "",
		ShortDescription:  "This is an existing reviewed short description that should remain unchanged.",
		Description:       "This is a long existing description. " + repeatForProfileTest("reviewed copy ", 25),
		MetaTitle:         "Existing reviewed meta title",
		MetaDescription:   "Existing reviewed meta description with enough useful detail to preserve.",
		MetaKeywords:      "existing, reviewed, keywords",
		CompatibilityInfo: "Existing compatibility guidance.",
	}
	draft := models.ProductProfileDraft{ProposedTitle: "FANUC A06B-6077-H106 Servo Amplifier / Drive"}
	content := services.ProfileContent{
		ShortDescription:  "New short description",
		Description:       "New long description",
		MetaTitle:         "New meta title",
		MetaDescription:   "New meta description",
		MetaKeywords:      "new, keywords",
		CompatibilityInfo: "New compatibility",
	}
	inference, err := services.InferenceFromAIClassification("FANUC", "Servo Amplifier", "")
	if err != nil {
		t.Fatal(err)
	}

	updates, fields := profileProductUpdates(product, draft, content, inference, 9, true, true, false, false)
	if updates["name"] != draft.ProposedTitle {
		t.Error("explicit title approval must apply the reviewed title")
	}
	for _, protected := range []string{"short_description", "description", "meta_title", "meta_description", "meta_keywords", "compatibility_info"} {
		if _, changed := updates[protected]; changed {
			t.Errorf("mature field %s was overwritten without permission; fields=%v", protected, fields)
		}
	}
	if updates["category_id"] != uint(9) || updates["brand"] != "FANUC" {
		t.Errorf("identity fields are missing: %+v", updates)
	}
}

func TestProfileProductUpdatesFillsEmptyOrShortFields(t *testing.T) {
	product := models.Product{
		Name:             "Old title",
		ShortDescription: "short",
		Description:      "too short",
		MetaTitle:        "",
		MetaDescription:  "",
	}
	draft := models.ProductProfileDraft{ProposedTitle: "FANUC A06B-6077-H106 Servo Amplifier / Drive"}
	content := services.ProfileContent{
		ShortDescription: "Identified short description.",
		Description:      "Identified description with product-specific facts.",
		MetaTitle:        "FANUC A06B-6077-H106 Servo Amplifier",
		MetaDescription:  "A product-specific search description.",
		MetaKeywords:     "FANUC, A06B-6077-H106, servo amplifier",
	}
	inference, _ := services.InferenceFromAIClassification("FANUC", "Servo Amplifier", "")
	updates, _ := profileProductUpdates(product, draft, content, inference, 9, true, true, false, true)

	for _, expected := range []string{"name", "short_description", "description", "meta_title", "meta_description", "meta_keywords", "is_active"} {
		if _, ok := updates[expected]; !ok {
			t.Errorf("expected %s to be filled; updates=%+v", expected, updates)
		}
	}
}

func TestProfileProductUpdatesOverwriteIsExplicit(t *testing.T) {
	product := models.Product{
		Name:             "Old title",
		ShortDescription: "Existing reviewed short description that is sufficiently long to preserve.",
		Description:      repeatForProfileTest("existing ", 40),
		MetaTitle:        "Existing title",
		MetaDescription:  repeatForProfileTest("existing ", 10),
		MetaKeywords:     "old",
	}
	draft := models.ProductProfileDraft{ProposedTitle: "New title"}
	content := services.ProfileContent{
		ShortDescription: "New short",
		Description:      "New description",
		MetaTitle:        "New meta",
		MetaDescription:  "New meta description",
		MetaKeywords:     "new",
	}
	inference, _ := services.InferenceFromAIClassification("FANUC", "Servo Amplifier", "")
	updates, _ := profileProductUpdates(product, draft, content, inference, 2, true, true, true, false)
	for _, expected := range []string{"short_description", "description", "meta_title", "meta_description", "meta_keywords"} {
		if _, ok := updates[expected]; !ok {
			t.Errorf("overwrite_existing=true should replace %s", expected)
		}
	}
}

func repeatForProfileTest(value string, count int) string {
	out := ""
	for index := 0; index < count; index++ {
		out += value
	}
	return out
}
