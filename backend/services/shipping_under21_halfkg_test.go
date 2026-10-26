package services

import (
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestParseUnder21MatrixKeepsHalfKgRows(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	if _, err := f.NewSheet("Under21Kg"); err != nil {
		t.Fatal(err)
	}
	rows := [][]any{
		{"Weight(kg)", "US United States", "DE Germany"},
		{"0.5", 46.43, 44.65},
		{"1.0", 53.04, 52.1},
		{"1.5", 66.59, 60},
		{"20", 389.32, 423.44},
	}
	for i, r := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow("Under21Kg", cell, &r); err != nil {
			t.Fatal(err)
		}
	}
	out, errs := parseUnder21MatrixSheet(f, "Under21Kg")
	if len(errs) > 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	got := map[string]map[float64]float64{}
	for _, w := range out {
		if w.MinKg != w.MaxKg {
			t.Fatalf("expected fixed-fee row, got %v-%v", w.MinKg, w.MaxKg)
		}
		if got[w.CountryCode] == nil {
			got[w.CountryCode] = map[float64]float64{}
		}
		got[w.CountryCode][w.MinKg] = w.RatePerKg
	}
	for _, kg := range []float64{0.5, 1, 1.5, 20} {
		if _, ok := got["US"][kg]; !ok {
			t.Errorf("US missing %.1fkg row: %v", kg, got["US"])
		}
	}
	if got["US"][0.5] != 46.43 || got["US"][1.5] != 66.59 {
		t.Errorf("half-kg fees collapsed: %v", got["US"])
	}
}
