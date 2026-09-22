package controllers

import (
	"reflect"
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
