package services

import (
	"testing"

	"fanuc-backend/models"
)

func TestShippingPriceTableSummaryAndSignature(t *testing.T) {
	brackets := []models.ShippingWeightBracket{
		{MinKg: 1, MaxKg: 1, RatePerKg: 53.04},
		{MinKg: 0.5, MaxKg: 0.5, RatePerKg: 46.43},
		{MinKg: 20, MaxKg: 20, RatePerKg: 389.32},
		{MinKg: 21, MaxKg: 0, RatePerKg: 19.47},
	}
	table := BuildShippingPriceTable("USD", brackets, nil)
	if len(table.Fixed) != 3 || table.Fixed[0].WeightKg != 0.5 || len(table.PerKg) != 1 {
		t.Fatalf("unexpected table: %+v", table)
	}
	s := table.Summary()
	if s.FeeFrom != 46.43 || s.FeeTo != 389.32 || s.FixedMinKg != 0.5 || s.FixedMaxKg != 20 || s.OverRatePerKg != 19.47 {
		t.Fatalf("unexpected summary: %+v", s)
	}
	// Order of rows must not change the signature; a different price must.
	reordered := BuildShippingPriceTable("USD", []models.ShippingWeightBracket{brackets[3], brackets[2], brackets[1], brackets[0]}, nil)
	if reordered.Summary().PriceSignature != s.PriceSignature {
		t.Fatal("signature depends on row order")
	}
	brackets[0].RatePerKg = 53.05
	if BuildShippingPriceTable("USD", brackets, nil).Summary().PriceSignature == s.PriceSignature {
		t.Fatal("signature ignores a price change")
	}
}

func TestShippingPriceTableValidate(t *testing.T) {
	cases := []struct {
		name  string
		table ShippingPriceTable
		ok    bool
	}{
		{"valid", ShippingPriceTable{Fixed: []ShippingFixedFee{{0.5, 10}}, PerKg: []ShippingPerKgBand{{21, 0, 5}}}, true},
		{"empty", ShippingPriceTable{}, false},
		{"fixed at 21kg", ShippingPriceTable{Fixed: []ShippingFixedFee{{21, 10}}}, false},
		{"zero fee", ShippingPriceTable{Fixed: []ShippingFixedFee{{1, 0}}}, false},
		{"duplicate weight", ShippingPriceTable{Fixed: []ShippingFixedFee{{1, 5}, {1.0004, 6}}}, false},
		{"inverted band", ShippingPriceTable{PerKg: []ShippingPerKgBand{{30, 21, 5}}}, false},
	}
	for _, tc := range cases {
		err := tc.table.Validate()
		if (err == nil) != tc.ok {
			t.Errorf("%s: err=%v", tc.name, err)
		}
	}
	tbl := ShippingPriceTable{Currency: "", Fixed: []ShippingFixedFee{{0.5, 10.005}}}
	if err := tbl.Validate(); err != nil || tbl.Currency != "USD" {
		t.Fatalf("currency default/rounding: %+v %v", tbl, err)
	}
}
