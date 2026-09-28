package services

import (
	"strings"
	"testing"
)

const (
	ebayBreadcrumb = "Business & Industrial > Industrial Automation & Motion Controls > PLCs & HMIs > PLC Processors"
	basCollection  = "Circuit Breakers, Fuses & Protection"
)

// The two source sites' categories used to share one payload key, so the drafts
// list could only show them unlabelled and they looked like the same field.
// An eBay row must never be reported with the BAS store's wording, and the
// reverse.
func TestResolveDraftSourceCategoriesKeepsTheTwoSitesApart(t *testing.T) {
	ebayRow := ResolveDraftSourceCategories(DraftSourceSiteEbay, map[string]any{
		"category_breadcrumb": ebayBreadcrumb,
		"_product_data": map[string]any{
			"_shangjia_category": ebayBreadcrumb,
		},
		// Decoy: a BAS-shaped key on an eBay row must not be read as eBay's.
		"product_type": basCollection,
	})
	if ebayRow.EbayCategory != ebayBreadcrumb {
		t.Fatalf("eBay row: got eBay category %q, want %q", ebayRow.EbayCategory, ebayBreadcrumb)
	}
	if ebayRow.BasCategory != "" {
		t.Fatalf("eBay row: BAS category must stay empty, got %q", ebayRow.BasCategory)
	}

	basRow := ResolveDraftSourceCategories(DraftSourceSiteBas, map[string]any{
		"category_breadcrumb": basCollection,
		"product_type":        basCollection,
		// Decoy: eBay-shaped keys on a BAS row must not be read as eBay's.
		"category_leaf": "PLC Processors",
		"_product_data": map[string]any{
			"_shangjia_category": ebayBreadcrumb,
		},
	})
	if basRow.BasCategory != basCollection {
		t.Fatalf("BAS row: got BAS category %q, want %q", basRow.BasCategory, basCollection)
	}
	if basRow.EbayCategory != "" {
		t.Fatalf("BAS row: eBay category must stay empty, got %q", basRow.EbayCategory)
	}
}

// eBay's complete breadcrumb wins over the optional leaf so source taxonomy
// creation preserves the full path.
func TestResolveDraftSourceCategoriesPrefersTheEbayBreadcrumb(t *testing.T) {
	resolved := ResolveDraftSourceCategories(DraftSourceSiteEbay, map[string]any{
		"category_leaf": "PLC Processors",
		"_product_data": map[string]any{
			"_shangjia_category": ebayBreadcrumb,
		},
	})
	if resolved.EbayCategory != ebayBreadcrumb {
		t.Fatalf("got %q, want the complete breadcrumb", resolved.EbayCategory)
	}
}

// A row imported before the split carries the category only in the shared key,
// and source_site is then the only evidence of which site wrote it.
func TestResolveDraftSourceCategoriesAttributesTheLegacySharedKey(t *testing.T) {
	legacyEbay := ResolveDraftSourceCategories(DraftSourceSiteEbay, map[string]any{
		"category_breadcrumb": ebayBreadcrumb,
	})
	if legacyEbay.EbayCategory != ebayBreadcrumb || legacyEbay.BasCategory != "" {
		t.Fatalf("legacy eBay row: got %+v", legacyEbay)
	}

	legacyBas := ResolveDraftSourceCategories(" B-AutomationService ", map[string]any{
		"category_breadcrumb": basCollection,
	})
	if legacyBas.BasCategory != basCollection || legacyBas.EbayCategory != "" {
		t.Fatalf("legacy BAS row: got %+v", legacyBas)
	}
}

// A row whose site is unknown must not have its shared category guessed onto
// either site: a wrong label is worse than a missing one.
func TestResolveDraftSourceCategoriesDoesNotGuessForAnUnknownSite(t *testing.T) {
	resolved := ResolveDraftSourceCategories("some-other-marketplace", map[string]any{
		"category_breadcrumb": ebayBreadcrumb,
	})
	if !resolved.IsEmpty() {
		t.Fatalf("unknown site: expected no attribution, got %+v", resolved)
	}
}

// The split keys are authoritative, so a payload that was already normalized
// keeps both labels even when the recorded site is missing.
func TestResolveDraftSourceCategoriesTrustsTheSplitKeys(t *testing.T) {
	resolved := ResolveDraftSourceCategories("", map[string]any{
		rawKeyEbayCategory:   ebayBreadcrumb,
		rawKeyBasCategory:    basCollection,
		rawKeySharedCategory: "stale shared value",
	})
	if resolved.EbayCategory != ebayBreadcrumb || resolved.BasCategory != basCollection {
		t.Fatalf("got %+v", resolved)
	}
}

func TestResolveDraftSourceCategoriesClampsAndCollapses(t *testing.T) {
	resolved := ResolveDraftSourceCategories(DraftSourceSiteBas, map[string]any{
		"collection_name": "  Motors  &\n\nMotor   Controls  ",
	})
	if resolved.BasCategory != "Motors & Motor Controls" {
		t.Fatalf("got %q", resolved.BasCategory)
	}

	long := ResolveDraftSourceCategories(DraftSourceSiteEbay, map[string]any{
		"category_leaf": strings.Repeat("a", 300),
	})
	if len([]rune(long.EbayCategory)) != draftSourceCategoryLimit {
		t.Fatalf("got %d runes, want %d", len([]rune(long.EbayCategory)), draftSourceCategoryLimit)
	}
}

func TestResolveDraftSourceCategoriesIgnoresBlankValues(t *testing.T) {
	resolved := ResolveDraftSourceCategories(DraftSourceSiteEbay, map[string]any{
		"category_breadcrumb": "   ",
		"category_leaf":       "",
	})
	if !resolved.IsEmpty() {
		t.Fatalf("expected an empty result, got %+v", resolved)
	}
}

// The eBay importer has to write the split key, otherwise a future row falls
// back to source_site again and the two sites stay coupled.
func TestNormalizeEbayImportDraftPayloadWritesTheEbayCategoryKey(t *testing.T) {
	normalized := NormalizeEbayImportDraftPayload(map[string]any{
		"product_title": "OMRON CJ1W-DA08C Analog Output Unit",
		"_product_data": map[string]any{
			"_shangjia_category": ebayBreadcrumb,
		},
	})
	if got := firstLegacyString(normalized[rawKeyEbayCategory]); got != ebayBreadcrumb {
		t.Fatalf("eBay category key: got %q, want %q", got, ebayBreadcrumb)
	}
	// The legacy shared key is still filled: existing readers depend on it.
	if got := firstLegacyString(normalized[rawKeySharedCategory]); got != ebayBreadcrumb {
		t.Fatalf("shared key changed: got %q", got)
	}
	// And the row must not be readable as a BAS row.
	if got := ResolveDraftSourceCategories(DraftSourceSiteEbay, normalized).BasCategory; got != "" {
		t.Fatalf("eBay payload reported a BAS category %q", got)
	}
}

func TestNormalizeShopifyImportPayloadWritesTheBasCategoryKey(t *testing.T) {
	raw := map[string]any{
		"platform":      "shopify",
		"handle":        "omron-g7sa-2a2b",
		"variants":      []any{map[string]any{"sku": "G7SA-2A2B", "price": "12.00"}},
		"product_title": "Omron G7SA-2A2B Safety Relay",
		"product_type":  basCollection,
	}
	normalized := map[string]any{}
	for key, value := range raw {
		normalized[key] = value
	}
	normalizeShopifyImportPayload(normalized, raw)

	if got := firstLegacyString(normalized[rawKeyBasCategory]); got != basCollection {
		t.Fatalf("BAS category key: got %q, want %q", got, basCollection)
	}
	resolved := ResolveDraftSourceCategories(DraftSourceSiteBas, normalized)
	if resolved.BasCategory != basCollection {
		t.Fatalf("BAS row: got %q", resolved.BasCategory)
	}
	if resolved.EbayCategory != "" {
		t.Fatalf("BAS row reported an eBay category %q", resolved.EbayCategory)
	}
}

// A BAS row whose payload happens to carry eBay-shaped keys must still report
// only the BAS store's own category: the store sends one category, in its own
// vocabulary, so a stray category_leaf is not evidence of an eBay listing.
func TestResolveDraftSourceCategoriesIgnoresEbayKeysOnABasRow(t *testing.T) {
	resolved := ResolveDraftSourceCategories(DraftSourceSiteBas, map[string]any{
		"category_leaf":           "PLC Processors",
		"_product_data":           map[string]any{"_shangjia_category": ebayBreadcrumb},
		"collection_handle":       "circuit-breakers",
		"unrelated_payload_field": "ignored",
	})
	if resolved.BasCategory != "circuit-breakers" {
		t.Fatalf("BAS category: got %q, want the collection handle", resolved.BasCategory)
	}
	if resolved.EbayCategory != "" {
		t.Fatalf("BAS row reported an eBay category %q", resolved.EbayCategory)
	}
}
