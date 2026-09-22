package controllers

import (
	"reflect"
	"strings"
	"testing"
)

func TestScanPastedProductModelsReadsRealLists(t *testing.T) {
	cases := []struct {
		name         string
		text         string
		wantModels   []string
		wantRejected int
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
			name:         "an unknown part number is reported instead of imported",
			text:         "ZZZ-0000-XY",
			wantModels:   []string{},
			wantRejected: 1,
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
