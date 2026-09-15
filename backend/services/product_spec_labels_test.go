package services

import (
	"strings"
	"testing"
)

func TestCanonicalSpecLabelFoldsSpellings(t *testing.T) {
	cases := map[string]string{
		"Voltage":                        specLabelInputVoltage,
		"Input voltage":                  specLabelInputVoltage,
		"input voltage (V)":              specLabelInputVoltage,
		"Rated input voltage":            specLabelInputVoltage,
		"Supply Voltage":                 specLabelInputVoltage,
		"主电源电压":                          specLabelInputVoltage,
		"Rated current":                  specLabelRatedCurrent,
		"Output Current (A)":             specLabelRatedCurrent,
		"motor capacity":                 specLabelRatedPower,
		"Rated Output":                   specLabelRatedPower,
		"Net Weight":                     specLabelWeight,
		"Overall dimensions (W x H x D)": specLabelDimensions,
		"Degree of protection":           specLabelProtectionClass,
		"Communication interface":        specLabelInterface,
		"Approvals":                      specLabelCertifications,
	}
	for input, want := range cases {
		if got := CanonicalSpecLabel(input); got != want {
			t.Errorf("CanonicalSpecLabel(%q) = %q, want %q", input, got, want)
		}
	}
}

// A parameter outside the known families must keep the reviewer's wording
// instead of being renamed into a family it does not belong to.
func TestCanonicalSpecLabelKeepsUnknownLabels(t *testing.T) {
	if got := CanonicalSpecLabel("Continuous stall torque"); got != "Continuous stall torque" {
		t.Errorf("unknown label was rewritten to %q", got)
	}
	if got := CanonicalSpecLabel("   "); got != "" {
		t.Errorf("blank label = %q, want empty", got)
	}
}

func TestCanonicalizeSpecMapNeverLosesAValue(t *testing.T) {
	specs := CanonicalizeSpecMap(map[string]string{
		"Voltage":       "200 V AC",
		"Input voltage": "200 V AC",
		"Weight":        "",
		"主电源电压":         "380 V AC",
	})
	if len(specs) != 1 {
		t.Fatalf("expected one canonical row, got %v", specs)
	}
	if specs[specLabelInputVoltage] == "" {
		t.Errorf("input voltage row lost its value: %v", specs)
	}
	if specs[specLabelWeight] != "" {
		t.Errorf("an empty value must not create a row: %v", specs)
	}
}

// Two sources that disagree must not silently collapse into one value.
func TestExtractSpecCandidatesRecordsConflictingValues(t *testing.T) {
	evidence := []ProductWebEvidence{
		specEvidence(
			"A06B-6089-H105 servo amplifier - Manufacturer",
			"https://www.fanuc.example/a06b-6089-h105",
			"The A06B-6089-H105 servo amplifier has input voltage: 200-240 V AC and rated current 12 A.",
			"manufacturer",
		),
		specEvidence(
			"A06B-6089-H105 servo amplifier - Distributor listing",
			"https://shop.example/a06b-6089-h105",
			"A06B-6089-H105 input voltage 400 V AC, rated current 12 A.",
			"distributor",
		),
	}

	candidates := ExtractSpecCandidates("A06B-6089-H105", evidence)
	var voltage *SpecResearchCandidate
	for index := range candidates {
		if candidates[index].Label == specLabelInputVoltage {
			voltage = &candidates[index]
		}
	}
	if voltage == nil {
		t.Fatalf("input voltage candidate missing: %+v", candidates)
	}
	if voltage.Value != "200-240 V AC" {
		t.Errorf("the stronger source must win: %+v", voltage)
	}
	if !voltage.Conflict || len(voltage.Alternatives) != 1 || voltage.Alternatives[0] != "400 V AC" {
		t.Errorf("conflicting value was not recorded: %+v", voltage)
	}
	// The value keeps its citation, and the quote really contains the value.
	if !strings.Contains(voltage.Evidence, "200-240 V AC") {
		t.Errorf("evidence quote does not contain the value: %q", voltage.Evidence)
	}
	// One row per parameter: no duplicate "Voltage" / "Input voltage" rows.
	seen := map[string]int{}
	for _, candidate := range candidates {
		seen[candidate.Label]++
	}
	for label, count := range seen {
		if count != 1 {
			t.Errorf("label %q appeared %d times", label, count)
		}
	}
}

func TestMergeSpecCandidateListsRecordsAIAlternatives(t *testing.T) {
	extracted := []SpecResearchCandidate{{Label: "Voltage", Value: "200-240 V AC", Origin: "extracted"}}
	verified := []SpecResearchCandidate{{Label: "Input voltage", Value: "400 V AC", Origin: "ai"}}

	merged := MergeSpecCandidateLists(extracted, verified)
	if len(merged) != 1 {
		t.Fatalf("expected one canonical row, got %+v", merged)
	}
	if merged[0].Label != specLabelInputVoltage || merged[0].Value != "200-240 V AC" {
		t.Errorf("unexpected merged row: %+v", merged[0])
	}
	if !merged[0].Conflict || len(merged[0].Alternatives) != 1 || merged[0].Alternatives[0] != "400 V AC" {
		t.Errorf("AI alternative was dropped: %+v", merged[0])
	}
}

// An AI value that appears on the page but nowhere near the parameter it claims
// to describe must not be published.
func TestFilterSpecCandidatesRequiresLabelNearValue(t *testing.T) {
	evidence := []ProductWebEvidence{
		specEvidence(
			"A06B-6089-H105 servo amplifier",
			"https://www.fanuc.example/a06b-6089-h105",
			"The A06B-6089-H105 amplifier ships in a carton of 4 and the interface is FSSB.",
			"manufacturer",
		),
	}
	proposed := []SpecResearchCandidate{
		{Label: "Rated current", Value: "4"},
		{Label: "Interface", Value: "FSSB"},
	}
	kept := FilterSpecCandidatesByVerbatimEvidence("A06B-6089-H105", proposed, evidence)
	if len(kept) != 1 || kept[0].Label != specLabelInterface {
		t.Fatalf("expected only the interface row, got %+v", kept)
	}
	if !strings.Contains(kept[0].Evidence, "FSSB") {
		t.Errorf("AI row lost its evidence quote: %q", kept[0].Evidence)
	}
}

func TestSpecEvidenceWindowsKeepVerbatimSpecifications(t *testing.T) {
	page := strings.Repeat("Welcome to our store. Shipping and returns policy apply. ", 20) +
		"Technical data for the MR-J4-40A servo amplifier. Rated power 400 W. Input voltage 200-240 V AC. " +
		"Protection class IP20. Weight 1.5 kg. " +
		strings.Repeat("Contact us for a quotation and delivery times. ", 20)

	windows := SpecEvidenceWindows(page, "MR-J4-40A")
	if windows == "" {
		t.Fatal("no specification window was produced for a datasheet-like page")
	}
	for _, expected := range []string{"Rated power 400 W", "Input voltage 200-240 V AC", "Protection class IP20"} {
		if !strings.Contains(windows, expected) {
			t.Errorf("window lost the verbatim text %q: %s", expected, windows)
		}
	}
	if len([]rune(windows)) > specEvidenceTotalChars {
		t.Errorf("window budget exceeded: %d characters", len([]rune(windows)))
	}

	// The extracted values must still be found in the window text, which is what
	// makes the reviewer's citation trustworthy.
	evidence := []ProductWebEvidence{{
		Title:         "MR-J4-40A servo amplifier",
		URL:           "https://www.mitsubishi.example/mr-j4-40a",
		Snippet:       windows,
		SourceType:    "manufacturer",
		EvidenceLevel: "manufacturer",
	}}
	candidates := ExtractSpecCandidates("MR-J4-40A", evidence)
	if got := candidateValue(candidates, specLabelRatedPower); got != "400 W" {
		t.Errorf("rated power from a spec window = %q, want 400 W", got)
	}
	if got := candidateValue(candidates, specLabelInputVoltage); got != "200-240 V AC" {
		t.Errorf("input voltage from a spec window = %q, want 200-240 V AC", got)
	}
}

func TestSpecEvidenceWindowsFallBackToModelContext(t *testing.T) {
	page := "Store front page without a datasheet heading. Product MR-J4-40A is in stock and ships today. " +
		strings.Repeat("Extra promotional text. ", 50)
	windows := SpecEvidenceWindows(page, "MR-J4-40A")
	if !strings.Contains(windows, "MR-J4-40A") {
		t.Fatalf("fallback window lost the model identifier: %q", windows)
	}
}
