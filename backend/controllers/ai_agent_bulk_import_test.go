package controllers

import (
	"reflect"
	"slices"
	"strings"
	"testing"
)

func TestScanPastedProductModelsReadsRealLists(t *testing.T) {
	cases := []struct {
		name            string
		text            string
		wantModels      []string
		wantRejected    int
		wantUnconfirmed int
	}{
		{
			name:       "one model per line with chinese labels bullets and notes",
			text:       "帮我上架这些型号：\n型号：A06B-2235-B100 （FANUC 伺服电机）\nMR-J4-70B, 三菱驱动器\n- 1756-L71  AB PLC",
			wantModels: []string{"A06B-2235-B100", "MR-J4-70B", "1756-L71"},
		},
		{
			name:       "comma separated list",
			text:       "A06B-6089-H105, A06B-6089-H106,A06B-6089-H107",
			wantModels: []string{"A06B-6089-H105", "A06B-6089-H106", "A06B-6089-H107"},
		},
		{
			name:       "the same model written with spaces is one entry",
			text:       "A06B-6089-H105\nA06B 6089 H105\na06b-6089-h105",
			wantModels: []string{"A06B-6089-H105"},
		},
		{
			name:         "prose without model numbers imports nothing",
			text:         "请检查一下未分类的商品，并告诉我 SEO 缺口，谢谢。",
			wantModels:   []string{},
			wantRejected: 0,
		},
		{
			name:       "pure words are not models",
			text:       "Servo Motor Drive and FANUC spare parts list",
			wantModels: []string{},
		},
		{
			// A model the rule engine cannot place is still a model the
			// administrator pasted: it is imported in the unverified tier and
			// reported for review, instead of being dropped with a note.
			name:            "an unknown part number is imported and reported",
			text:            "ZZZ-0000-XY",
			wantModels:      []string{"ZZZ-0000-XY"},
			wantUnconfirmed: 1,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			scan := scanPastedProductModels(testCase.text, 0)
			if testCase.wantModels == nil {
				testCase.wantModels = []string{}
			}
			if !reflect.DeepEqual(scan.Models, testCase.wantModels) {
				t.Fatalf("parsed %v, want %v", scan.Models, testCase.wantModels)
			}
			if scan.UnrecognisedTotal != testCase.wantRejected {
				t.Fatalf("unrecognised %d, want %d (%v)", scan.UnrecognisedTotal, testCase.wantRejected, scan.Unrecognised)
			}
			if scan.UnconfirmedTotal != testCase.wantUnconfirmed {
				t.Fatalf("unconfirmed %d, want %d (%v)", scan.UnconfirmedTotal, testCase.wantUnconfirmed, scan.Unconfirmed)
			}
		})
	}
}

// A list pasted out of a spreadsheet, a PDF or a chat window carries invisible
// characters. They must not split a model number into two entries, and a stray
// zero-width character must not hide the model either.
func TestScanPastedProductModelsStripsInvisibleCharacters(t *testing.T) {
	cases := []struct {
		name string
		text string
	}{
		{name: "non breaking space", text: "A06B\u00a0-6089-H105"},
		{name: "zero width joiner", text: "A06B-6089\u200bH105"},
		{name: "full width space", text: "A06B\u3000-6089-H105"},
		{name: "byte order mark", text: "\ufeffA06B-6089-H105"},
		{name: "line of invisible characters", text: "A06B-6089-H105\n\u200b\nA06B-6089-H106"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			scan := scanPastedProductModels(testCase.text, 0)
			for _, model := range scan.Models {
				if strings.Contains(model, "\u00a0") || strings.Contains(model, "\u200b") || strings.Contains(model, "\u3000") {
					t.Fatalf("invisible character survived into model %q", model)
				}
			}
			if len(scan.Models) == 0 {
				t.Fatalf("no model parsed out of %q (unrecognised=%v)", testCase.text, scan.Unrecognised)
			}
		})
	}
}

// Models past the per-message limit are counted, so the assistant can ask for the
// remainder instead of claiming the whole list was imported.
func TestScanPastedProductModelsCountsOverflow(t *testing.T) {
	text := "A06B-6089-H105 A06B-6089-H106 A06B-6089-H107 A06B-6089-H108 A06B-6089-H109"
	got := scanPastedProductModels(text, 3)
	if len(got.Models) != 3 {
		t.Fatalf("limit ignored: parsed %d models", len(got.Models))
	}
	if got.Truncated != 2 {
		t.Fatalf("overflow count is %d, want 2", got.Truncated)
	}
	if full := scanPastedProductModels(text, 0); full.Truncated != 0 {
		t.Fatalf("a list inside the limit reported %d truncated entries", full.Truncated)
	}
}

// The provider prompt must stay small even when the administrator pastes a
// thousand model numbers: the import tool reads the stored message server side.
func TestAIAgentPromptUserMessageCompactsLongLists(t *testing.T) {
	short := "上架 A06B-6089-H105"
	if got := aiAgentPromptUserMessage(short); got != short {
		t.Fatalf("a short message was rewritten: %q", got)
	}
	long := strings.Repeat("A06B-6089-H105\n", 1000)
	got := aiAgentPromptUserMessage(long)
	if len([]rune(got)) > aiAgentPromptRequestMaxRunes+400 {
		t.Fatalf("compacted prompt is still %d characters", len([]rune(got)))
	}
	if !strings.Contains(got, "TRUNCATED") {
		t.Fatalf("compacted prompt carries no truncation note: %q", got[len(got)-200:])
	}
	if !strings.HasPrefix(got, "A06B-6089-H105") {
		t.Fatalf("the head of the message was dropped: %q", got[:40])
	}
}

func TestScanPastedProductModelsHonoursLimit(t *testing.T) {
	text := "A06B-6089-H105 A06B-6089-H106 A06B-6089-H107 A06B-6089-H108 A06B-6089-H109"
	if got := scanPastedProductModels(text, 3); len(got.Models) != 3 {
		t.Fatalf("limit ignored: parsed %d models", len(got.Models))
	}
	if got := scanPastedProductModels(text, 9999); len(got.Models) != 5 {
		t.Fatalf("large limit truncated the list: parsed %d models", len(got.Models))
	}
	if got := scanPastedProductModels(text, aiAgentMaxBulkImportModels+500); len(got.Models) != 5 {
		t.Fatalf("limit clamp changed the result: parsed %d models", len(got.Models))
	}
}

// A real list of Siemens, Schneider or ABB numbers sits largely outside the
// deterministic rule set. Those models must still be imported - that is what the
// administrator pasted - while being reported as needing review. The test stays
// away from a total count on purpose: it pins the behaviour (verified numbers are
// not flagged, unverified ones are) without breaking every time a rule is added.
func TestScanPastedProductModelsAcceptsModelsOutsideTheRuleSet(t *testing.T) {
	text := "3VA1125-4ED46-0AA0\nLC1D093-BD-24V\nACS800-104\nA06B-2235-B100\n请检查未分类商品"
	scan := scanPastedProductModels(text, 0)
	if len(scan.Models) != 4 {
		t.Fatalf("recognised %d models, want 4 (%v)", len(scan.Models), scan.Models)
	}
	// A FANUC number and an ABB drive family the rules do resolve must not be
	// pushed into the review list, or the review list becomes noise.
	if slices.Contains(scan.Unconfirmed, "A06B-2235-B100") {
		t.Fatalf("a rule-verified FANUC model was flagged for review: %v", scan.Unconfirmed)
	}
	if slices.Contains(scan.Unconfirmed, "ACS800-104") {
		t.Fatalf("a rule-verified ABB model was flagged for review: %v", scan.Unconfirmed)
	}
	// The Siemens breaker has no rule, so it is imported and reported.
	if !slices.Contains(scan.Unconfirmed, "3VA1125-4ED46-0AA0") {
		t.Fatalf("the model outside the rule set was not reported: %v", scan.Unconfirmed)
	}
	if scan.UnrecognisedTotal != 0 {
		t.Fatalf("unrecognised %d, want 0 (%v)", scan.UnrecognisedTotal, scan.Unrecognised)
	}
}

// The prose guard must still keep a sentence or a price column out of the import
// now that the rule-engine gate no longer does that job.
func TestScanPastedProductModelsStillRejectsProse(t *testing.T) {
	for _, text := range []string{
		"Please check the uncategorised products and report the SEO gaps",
		"Total: 1000 pcs, unit price 12.5 USD",
		"1. Servo Motor Drive\n2. Spare Parts List",
	} {
		scan := scanPastedProductModels(text, 0)
		if len(scan.Models) != 0 {
			t.Fatalf("imported %v from prose %q", scan.Models, text)
		}
	}
}
