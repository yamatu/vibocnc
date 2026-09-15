package services

import (
	"strings"
	"testing"

	"fanuc-backend/models"
)

func specEvidence(title, url, snippet, sourceType string) ProductWebEvidence {
	return ProductWebEvidence{Title: title, URL: url, Snippet: snippet, SourceType: sourceType, EvidenceLevel: sourceType}
}

func candidateValue(candidates []SpecResearchCandidate, label string) string {
	for _, candidate := range candidates {
		if candidate.Label == label {
			return candidate.Value
		}
	}
	return ""
}

func TestExtractSpecCandidatesCopiesValuesVerbatim(t *testing.T) {
	evidence := []ProductWebEvidence{
		specEvidence(
			"A06B-6089-H105 AC Servo Amplifier - Manufacturer",
			"https://www.fanuc.example/products/a06b-6089-h105",
			"The A06B-6089-H105 servo amplifier has input voltage: 200-240 V AC, rated current 12 A, weight 3.5 kg and protection class IP20. Interface: FSSB.",
			"manufacturer",
		),
	}

	candidates := ExtractSpecCandidates("A06B-6089-H105", evidence)
	if len(candidates) == 0 {
		t.Fatalf("expected parameter candidates, got none")
	}
	if got := candidateValue(candidates, "Input voltage"); got != "200-240 V AC" {
		t.Errorf("Input voltage = %q, want %q", got, "200-240 V AC")
	}
	if got := candidateValue(candidates, "Rated current"); got != "12 A" {
		t.Errorf("Rated current = %q, want %q", got, "12 A")
	}
	if got := candidateValue(candidates, "Weight"); got != "3.5 kg" {
		t.Errorf("Weight = %q, want %q", got, "3.5 kg")
	}
	if got := candidateValue(candidates, "Protection class"); got != "IP20" {
		t.Errorf("Protection class = %q, want %q", got, "IP20")
	}
	for _, candidate := range candidates {
		if candidate.SourceURL == "" {
			t.Fatalf("candidate %q lost its source URL", candidate.Label)
		}
		if candidate.Origin != "extracted" {
			t.Errorf("candidate %q origin = %q, want extracted", candidate.Label, candidate.Origin)
		}
	}
}

// A page that does not mention the exact model number may describe a sibling
// product; none of its values may be attributed to this model.
func TestExtractSpecCandidatesRequiresExactModelOnPage(t *testing.T) {
	evidence := []ProductWebEvidence{
		specEvidence(
			"A06B-6089-H106 AC Servo Amplifier",
			"https://www.fanuc.example/products/a06b-6089-h106",
			"The A06B-6089-H106 servo amplifier has input voltage: 400 V AC and weight 4.1 kg.",
			"manufacturer",
		),
	}

	if candidates := ExtractSpecCandidates("A06B-6089-H105", evidence); len(candidates) != 0 {
		t.Fatalf("expected no candidates for a different model, got %d", len(candidates))
	}
}

// Search-result snippets are engine-generated prose and are never a spec source.
func TestExtractSpecCandidatesIgnoresSearchResultSnippets(t *testing.T) {
	evidence := []ProductWebEvidence{
		specEvidence(
			"A06B-6089-H105 servo amplifier",
			"https://search.example/?q=a06b-6089-h105",
			"A06B-6089-H105 amplifier with input voltage 200 V AC, weight 3.5 kg and warranty 12 months.",
			"search-result",
		),
	}

	if candidates := ExtractSpecCandidates("A06B-6089-H105", evidence); len(candidates) != 0 {
		t.Fatalf("expected search-result snippets to be ignored, got %d candidates", len(candidates))
	}
}

func TestFilterSpecCandidatesByVerbatimEvidenceDropsInventedValues(t *testing.T) {
	evidence := []ProductWebEvidence{
		specEvidence(
			"A06B-6089-H105 AC Servo Amplifier",
			"https://www.fanuc.example/products/a06b-6089-h105",
			"The A06B-6089-H105 servo amplifier has input voltage: 200-240 V AC and weight 3.5 kg.",
			"manufacturer",
		),
	}
	proposed := []SpecResearchCandidate{
		{Label: "Input voltage", Value: "200-240 V AC"},
		{Label: "Rated power", Value: "7.5 kW"},
		{Label: "Weight", Value: "3.5kg"},
	}

	kept := FilterSpecCandidatesByVerbatimEvidence("A06B-6089-H105", proposed, evidence)
	if len(kept) != 1 {
		t.Fatalf("expected only the cited value to survive, got %d (%v)", len(kept), kept)
	}
	if kept[0].Label != "Input voltage" || kept[0].Value != "200-240 V AC" {
		t.Errorf("unexpected surviving candidate: %+v", kept[0])
	}
	if kept[0].SourceURL == "" || kept[0].Origin != "ai" {
		t.Errorf("surviving candidate lost provenance: %+v", kept[0])
	}
}

func TestMergeSpecCandidateListsPrefersExtractedValues(t *testing.T) {
	extracted := []SpecResearchCandidate{{Label: "Weight", Value: "3.5 kg", Origin: "extracted"}}
	verified := []SpecResearchCandidate{
		{Label: "Weight", Value: "3.50 kg", Origin: "ai"},
		{Label: "Interface", Value: "FSSB", Origin: "ai"},
	}

	merged := MergeSpecCandidateLists(extracted, verified)
	if len(merged) != 2 {
		t.Fatalf("expected 2 merged candidates, got %d", len(merged))
	}
	if merged[0].Value != "3.5 kg" {
		t.Errorf("extracted value was replaced by the AI value: %+v", merged[0])
	}
}

func TestSpecCandidatesToMapAndParseTechnicalSpecs(t *testing.T) {
	specs := SpecCandidatesToMap([]SpecResearchCandidate{
		{Label: " Input voltage ", Value: " 200-240 V AC "},
		{Label: "Weight", Value: ""},
	})
	if len(specs) != 1 || specs["Input voltage"] != "200-240 V AC" {
		t.Fatalf("unexpected spec map: %v", specs)
	}

	roundTrip := ParseTechnicalSpecs(TechnicalSpecsJSON(specs))
	if roundTrip["Input voltage"] != "200-240 V AC" {
		t.Errorf("round trip lost the value: %v", roundTrip)
	}
	if len(ParseTechnicalSpecs("not json")) != 0 {
		t.Error("malformed technical_specs must decode to an empty map")
	}
	if len(ParseTechnicalSpecs(`{"Weight":3.5}`)) != 1 {
		t.Error("numeric spec values must not be dropped")
	}
}

// Approving a draft writes technical_specs; the next content generation must
// publish that value, and it must never inject another brand's name into a page
// for a different brand (that used to make the SEO refresher loop).
func TestEnrichProductForRecordPublishesApprovedSpecsBrandAgnostically(t *testing.T) {
	product := &models.Product{
		Brand:          "Mitsubishi",
		Model:          "MR-J4-40A",
		SKU:            "MR-J4-40A",
		Name:           "Mitsubishi MR-J4-40A servo amplifier",
		TechnicalSpecs: `{"Rated power":"400 W","Protection class":"IP20"}`,
	}

	enriched := EnrichProductForRecord(product)
	if !strings.Contains(enriched.TechnicalSpecs, "400 W") {
		t.Fatalf("approved parameter missing from generated specs: %s", enriched.TechnicalSpecs)
	}
	if !strings.Contains(enriched.TechnicalSpecs, "IP20") {
		t.Fatalf("approved parameter missing from generated specs: %s", enriched.TechnicalSpecs)
	}

	body := strings.Join([]string{
		enriched.Name, enriched.ShortDescription, enriched.Description,
		enriched.MetaTitle, enriched.MetaDescription, enriched.CompatibilityInfo,
		enriched.InstallationGuide, enriched.MaintenanceTips,
	}, "\n")
	if strings.Contains(strings.ToUpper(body), "FANUC") {
		t.Fatalf("generated copy for a Mitsubishi product mentioned FANUC:\n%s", body)
	}
}
