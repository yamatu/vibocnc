package controllers

import (
	"strings"
	"testing"
)

func TestDefaultImageURLForSKUVersionKeepsFullSKU(t *testing.T) {
	sku := "A06B-6117-H209/210#H550"
	got := defaultImageURLForSKUVersion(sku, "1725321600")
	if !strings.Contains(got, "sku=A06B-6117-H209%2F210%23H550") {
		t.Fatalf("URL did not preserve the full escaped SKU: %s", got)
	}
	if !strings.Contains(got, "v=1725321600") {
		t.Fatalf("URL did not include the image version: %s", got)
	}
}

func TestNormalizeProductImageAutofillBatchSize(t *testing.T) {
	cases := []struct {
		input int
		want  int
	}{
		{input: 0, want: defaultProductImageAutofillBatchSize},
		{input: 25, want: 25},
		{input: maxProductImageAutofillBatchSize + 1, want: maxProductImageAutofillBatchSize},
	}
	for _, testCase := range cases {
		if got := normalizeProductImageAutofillBatchSize(testCase.input); got != testCase.want {
			t.Fatalf("normalizeProductImageAutofillBatchSize(%d) = %d, want %d", testCase.input, got, testCase.want)
		}
	}
}
