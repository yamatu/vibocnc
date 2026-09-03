package controllers

import "testing"

func TestIsDefaultImageURLForSKURecognizesVersionedURL(t *testing.T) {
	sku := "A06B-6117-H209/210"
	if !isDefaultImageURLForSKU(defaultImageURLForSKUVersion(sku, "123"), sku) {
		t.Fatal("versioned default image URL was not recognized")
	}
	if isDefaultImageURLForSKU("/api/v1/public/products/default-image?sku=OTHER", sku) {
		t.Fatal("a different SKU default image URL was recognized")
	}
}
