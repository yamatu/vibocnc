package services

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestResolveCountryCode(t *testing.T) {
	cases := map[string]string{
		"US":            "US",
		"us":            "US",
		"United States": "US",
		"美国":            "US",
		"USA":           "US",
		"美国(US)":        "US",
		"DE Germany":    "DE",
		"UK":            "GB",
		"South Korea":   "KR",
		"香港":            "HK",
		"中国香港":          "HK",
		"Czechia":       "CZ",
		"unknown land":  "",
		"重量(kg)":        "",
		"":              "",
	}
	for in, want := range cases {
		if got := ResolveCountryCode(in); got != want {
			t.Errorf("ResolveCountryCode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeCountryCodeDoesNotTruncateNames(t *testing.T) {
	if got := NormalizeCountryCode("United States"); got != "US" {
		t.Fatalf("got %q", got)
	}
	if got := NormalizeCountryCode("美国"); got != "US" {
		t.Fatalf("got %q", got)
	}
	if got := NormalizeCountryCode("日本国家"); got != "" {
		t.Fatalf("non-ASCII unknown should be empty, got %q", got)
	}
}

func TestEnglishCountryName(t *testing.T) {
	if got := EnglishCountryName("DE", "德国"); got != "Germany" {
		t.Fatalf("got %q", got)
	}
	if got := EnglishCountryName("ZZ", "德国"); got != "ZZ" {
		t.Fatalf("got %q", got)
	}
}

func TestGeneratedPerKgTemplateRoundTrip(t *testing.T) {
	b, err := GenerateShippingPerKgTemplateXLSX(nil)
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := f.GetRows(perKgSheetName)
	if len(rows) < 200 {
		t.Fatalf("expected all world countries, got %d rows", len(rows))
	}
	for i, r := range rows {
		if len(r) > 0 && r[0] == "US" {
			_ = f.SetCellValue(perKgSheetName, "D"+itoa(i+1), 12.5)
		}
		if len(r) > 0 && r[0] == "DE" {
			_ = f.SetCellValue(perKgSheetName, "D"+itoa(i+1), "$9.8/kg")
		}
	}
	out, errs, found := parsePerKgSheets(f)
	if !found || len(errs) > 0 {
		t.Fatalf("found=%v errs=%v", found, errs)
	}
	if len(out) != 2 {
		t.Fatalf("expected 2 filled rows, got %d: %+v", len(out), out)
	}
	got := map[string]float64{}
	for _, r := range out {
		got[r.CountryCode] = r.RatePerKg
		if r.MinKg != 0 || r.MaxKg != 0 {
			t.Fatalf("per-kg rows must be open brackets: %+v", r)
		}
	}
	if got["US"] != 12.5 || got["DE"] != 9.8 {
		t.Fatalf("unexpected rates %+v", got)
	}
}

func TestParsePerKgCustomSheet(t *testing.T) {
	f := excelize.NewFile()
	sh := "Sheet1"
	_ = f.SetCellValue(sh, "A1", "FedEx 报价 2026")
	_ = f.SetCellValue(sh, "A3", "目的地国家")
	_ = f.SetCellValue(sh, "B3", "单价(USD/kg)")
	_ = f.SetCellValue(sh, "A4", "美国")
	_ = f.SetCellValue(sh, "B4", "11")
	_ = f.SetCellValue(sh, "A5", "Australia")
	_ = f.SetCellValue(sh, "B5", 13.2)
	_ = f.SetCellValue(sh, "A6", "火星")
	_ = f.SetCellValue(sh, "B6", 5)
	_ = f.SetCellValue(sh, "A7", "Canada")
	_ = f.SetCellValue(sh, "B7", "")
	out, errs, found := parsePerKgSheets(f)
	if !found {
		t.Fatal("header not detected")
	}
	if len(out) != 2 || len(errs) != 1 {
		t.Fatalf("out=%+v errs=%v", out, errs)
	}
}

func TestParsePerKgIgnoresBracketSheets(t *testing.T) {
	f := excelize.NewFile()
	sh := "Sheet1"
	_ = f.SetCellValue(sh, "A1", "国家代码")
	_ = f.SetCellValue(sh, "B1", "重量区间(kg)")
	_ = f.SetCellValue(sh, "C1", "每公斤价格")
	_, _, found := parsePerKgSheets(f)
	if found {
		t.Fatal("bracket sheet should not be treated as per-kg")
	}
}

func itoa(i int) string {
	b := []byte{}
	if i == 0 {
		return "0"
	}
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}
