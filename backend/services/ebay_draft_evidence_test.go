package services

import (
	"encoding/json"
	"testing"

	"fanuc-backend/models"
)

func draftWithPayload(t *testing.T, raw map[string]any, title string) models.EbayImportDraft {
	t.Helper()
	encoded, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return models.EbayImportDraft{
		NormalizedTitle: title,
		RawPayload:      string(encoded),
	}
}

// A review used to see evidence only when a market quote existed. Without this
// the model classified a part from its model number alone, which is what let
// wrong categories through.
func TestDraftEvidenceCarriesTheListingsOwnCategoryAndSpecifics(t *testing.T) {
	draft := draftWithPayload(t, map[string]any{
		"category_breadcrumb": "Business & Industrial > Automation > Servo Drives",
		"condition":           "Used",
		"item_specifics": map[string]any{
			"Brand":   "FANUC",
			"MPN":     "A06B-6079-H208",
			"Voltage": "200V",
		},
		"description_html": "<p>Servo amplifier</p><script>x=1;</script>",
	}, "FANUC A06B-6079-H208 Servo Amplifier")
	draft.NormalizedBrand = "FANUC"
	draft.NormalizedModel = "A06B-6079-H208"
	draft.DescriptionRaw = "<p>Servo amplifier</p><script>x=1;</script>"

	evidence := DraftEvidenceFromDraft(draft)

	if evidence.CategoryPath != "Business & Industrial > Automation > Servo Drives" {
		t.Errorf("category path = %q, want the scraped breadcrumb", evidence.CategoryPath)
	}
	if evidence.Title != "FANUC A06B-6079-H208 Servo Amplifier" {
		t.Errorf("title = %q", evidence.Title)
	}
	if evidence.Model != "A06B-6079-H208" {
		t.Errorf("model = %q", evidence.Model)
	}
	if evidence.Brand != "FANUC" {
		t.Errorf("brand = %q", evidence.Brand)
	}
	if evidence.Condition != "Used" {
		t.Errorf("condition = %q", evidence.Condition)
	}
	if len(evidence.ItemSpecifics) == 0 {
		t.Fatal("item specifics were dropped")
	}
	if got := rawStringValue(evidence.ItemSpecifics["Voltage"]); got != "200V" {
		t.Errorf("Voltage specific = %q, want 200V", got)
	}
	// The description must arrive sanitized, because it goes into the prompt and
	// from there into generated copy.
	if evidence.Description != "Servo amplifier" {
		t.Errorf("description = %q, want the sanitized text", evidence.Description)
	}
}

func TestDraftEvidenceReadsSpecificsFromEveryShapeTheScraperUses(t *testing.T) {
	cases := []struct {
		name string
		raw  map[string]any
	}{
		{
			name: "camelCase key",
			raw:  map[string]any{"itemSpecifics": map[string]any{"MPN": "A06B-6079-H208"}},
		},
		{
			name: "nested under product_data",
			raw: map[string]any{
				"product_data": map[string]any{
					"item_specifics": map[string]any{"MPN": "A06B-6079-H208"},
				},
			},
		},
		{
			name: "name/value list",
			raw: map[string]any{
				"item_specifics": []any{
					map[string]any{"name": "MPN", "value": "A06B-6079-H208"},
				},
			},
		},
		{
			name: "json string",
			raw:  map[string]any{"item_specifics": `{"MPN":"A06B-6079-H208"}`},
		},
		{
			name: "flat top-level attributes",
			raw:  map[string]any{"mpn": "A06B-6079-H208", "voltage": "200V"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			evidence := DraftEvidenceFromDraft(draftWithPayload(t, tc.raw, "listing"))
			if len(evidence.ItemSpecifics) == 0 {
				t.Fatalf("no item specifics recovered from %#v", tc.raw)
			}
			found := false
			for _, value := range evidence.ItemSpecifics {
				if rawStringValue(value) == "A06B-6079-H208" {
					found = true
				}
			}
			if !found {
				t.Errorf("the MPN was not recovered from %#v (got %#v)", tc.raw, evidence.ItemSpecifics)
			}
		})
	}
}

// An empty payload must not be appended as evidence: it would waste the prompt
// budget and imply a listing was found with no title.
func TestDraftEvidenceIsBlankWhenTheDraftHasNothing(t *testing.T) {
	if !isBlankEvidenceListing(DraftEvidenceFromDraft(models.EbayImportDraft{})) {
		t.Error("an empty draft produced non-blank evidence")
	}
	if !isBlankEvidenceListing(DraftEvidenceFromDraft(draftWithPayload(t, map[string]any{}, ""))) {
		t.Error("an empty payload produced non-blank evidence")
	}
	if isBlankEvidenceListing(DraftEvidenceFromDraft(draftWithPayload(t, map[string]any{}, "FANUC drive"))) {
		t.Error("a titled draft was treated as blank evidence")
	}
}

// Numeric and boolean attributes must survive as text rather than being dropped.
func TestDraftEvidenceKeepsNonStringAttributes(t *testing.T) {
	evidence := DraftEvidenceFromDraft(draftWithPayload(t, map[string]any{
		"item_specifics": map[string]any{
			"Power":  3.7,
			"Qty":    2,
			"Tested": true,
		},
	}, "listing"))

	for key, want := range map[string]string{"Power": "3.7", "Qty": "2", "Tested": "true"} {
		got := rawStringValue(evidence.ItemSpecifics[key])
		if got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
}

// A malformed payload must not panic or fabricate values.
func TestDraftEvidenceToleratesMalformedPayload(t *testing.T) {
	draft := models.EbayImportDraft{RawPayload: "{not json", TitleRaw: "FANUC drive"}
	evidence := DraftEvidenceFromDraft(draft)
	if evidence.Title != "FANUC drive" {
		t.Errorf("title = %q, want the raw title fallback", evidence.Title)
	}
	if evidence.CategoryPath != "" {
		t.Errorf("category path = %q, want empty", evidence.CategoryPath)
	}
}
