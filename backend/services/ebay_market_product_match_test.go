package services

import (
	"testing"

	"fanuc-backend/models"
)

func TestMatchProductsForMarketQuotesUsesSharedModelKey(t *testing.T) {
	products := []models.Product{
		{ID: 1, SKU: "FANUC-A06B-6077-H106", Brand: "FANUC"},
		{ID: 2, SKU: "MR-J4-70A", Model: "MR-J4-70A", Brand: "Mitsubishi"},
	}
	quotes := []models.EbayMarketQuote{
		{ID: 11, BrandKey: "fanuc", Model: "A06B 6077 H106", ModelNormalized: "A06B6077H106"},
		{ID: 12, BrandKey: "mitsubishi", Model: "MR-J4-70A", ModelNormalized: "MRJ470A"},
	}
	matches := matchProductsForMarketQuotes(products, quotes)
	if matches[11].ID != 1 {
		t.Errorf("brand-prefixed FANUC SKU did not match: %+v", matches[11])
	}
	if matches[12].ID != 2 {
		t.Errorf("separator-normalized Mitsubishi model did not match: %+v", matches[12])
	}
}

func TestMatchProductsForMarketQuotesLeavesBareCollisionUnmatched(t *testing.T) {
	products := []models.Product{
		{ID: 1, Model: "ABC-100", Brand: "Brand One"},
		{ID: 2, Model: "ABC-100", Brand: "Brand Two"},
	}
	quotes := []models.EbayMarketQuote{
		{ID: 10, Model: "ABC-100", ModelNormalized: "ABC100"},
		{ID: 11, BrandKey: NormalizeBrandKey("Brand One"), Model: "ABC-100", ModelNormalized: "ABC100"},
	}
	matches := matchProductsForMarketQuotes(products, quotes)
	if _, found := matches[10]; found {
		t.Fatal("a brand-less quote must not guess between duplicate model owners")
	}
	if matches[11].ID != 1 {
		t.Errorf("brand should disambiguate the model, got %+v", matches[11])
	}
}

func TestMatchProductsForMarketQuotesRejectsSameBrandCollision(t *testing.T) {
	products := []models.Product{
		{ID: 1, Model: "ABC-100", Brand: "FANUC"},
		{ID: 2, PartNumber: "ABC100", Brand: "FANUC"},
	}
	quotes := []models.EbayMarketQuote{
		{ID: 10, BrandKey: "fanuc", Model: "ABC-100", ModelNormalized: "ABC100"},
	}
	if matches := matchProductsForMarketQuotes(products, quotes); len(matches) != 0 {
		t.Fatalf("same-brand duplicate must remain unresolved, got %+v", matches)
	}
}
