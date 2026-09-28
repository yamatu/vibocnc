package services

import (
	"encoding/json"
	"testing"
)

const scrapedEbayBreadcrumb = "Business & Industrial > Industrial Automation & Motion Controls > PLCs & HMIs > PLC Processors"

// Picking a category for one source site must land under that site's own key:
// an eBay breadcrumb written into the BAS key (or the reverse) is exactly the
// mix-up the split keys exist to prevent.
func TestApplyDraftSourceCategoryWritesTheSitesOwnKey(t *testing.T) {
	scraped := `{"category_breadcrumb":"` + scrapedEbayBreadcrumb + `","category_leaf":"PLC Processors","product_title":"OMRON CJ1W-CT021"}`
	picked := "Business & Industrial > Industrial Automation & Motion Controls > Sensors > Proximity Sensors"

	encoded, err := applyDraftSourceCategory(scraped, DraftSourceSiteEbay, picked)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(encoded), &raw); err != nil {
		t.Fatalf("the payload is no longer valid JSON: %v", err)
	}
	if got := firstLegacyString(raw[rawKeyEbayCategory]); got != picked {
		t.Errorf("eBay category key = %q, want %q", got, picked)
	}
	if _, present := raw[rawKeyBasCategory]; present {
		t.Errorf("picking an eBay category must not write the BAS key")
	}
	if got := firstLegacyString(raw[rawKeySharedCategory]); got != scrapedEbayBreadcrumb {
		t.Errorf("the scraped breadcrumb was overwritten: %q", got)
	}
	if got := firstLegacyString(raw["product_title"]); got != "OMRON CJ1W-CT021" {
		t.Errorf("an unrelated payload key was lost: %q", got)
	}
	// The pick has to be what the list and detail API report.
	if got := ResolveDraftSourceCategories(DraftSourceSiteEbay, raw).EbayCategory; got != picked {
		t.Errorf("resolved eBay category = %q, want %q", got, picked)
	}
}

// Clearing records the absence explicitly. Deleting the key instead would let the
// scraped breadcrumb reappear, so an administrator who corrected a mis-filed
// listing could never undo the correction.
func TestApplyDraftSourceCategoryClearHidesTheScrapedValue(t *testing.T) {
	scraped := `{"category_breadcrumb":"` + scrapedEbayBreadcrumb + `"}`
	encoded, err := applyDraftSourceCategory(scraped, DraftSourceSiteEbay, "   ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(encoded), &raw); err != nil {
		t.Fatalf("the payload is no longer valid JSON: %v", err)
	}
	if _, present := raw[rawKeyEbayCategory]; !present {
		t.Fatalf("clearing must record the key, otherwise the scraped breadcrumb is read back")
	}
	if got := ResolveDraftSourceCategories(DraftSourceSiteEbay, raw).EbayCategory; got != "" {
		t.Errorf("resolved eBay category = %q, want empty", got)
	}
}

// A recorded but empty key is a decision; a row written before the split has no
// key at all and keeps falling back to the shared one.
func TestResolveDraftSourceCategoriesDistinguishesClearedFromLegacy(t *testing.T) {
	cleared := ResolveDraftSourceCategories(DraftSourceSiteEbay, map[string]any{
		rawKeyEbayCategory:   "",
		rawKeySharedCategory: scrapedEbayBreadcrumb,
	})
	if cleared.EbayCategory != "" {
		t.Errorf("an explicitly cleared category = %q, want empty", cleared.EbayCategory)
	}
	legacy := ResolveDraftSourceCategories(DraftSourceSiteEbay, map[string]any{
		rawKeySharedCategory: scrapedEbayBreadcrumb,
	})
	if legacy.EbayCategory != scrapedEbayBreadcrumb {
		t.Errorf("a legacy row = %q, want the shared breadcrumb %q", legacy.EbayCategory, scrapedEbayBreadcrumb)
	}
}

// Writing a category for a site the importer never records would file it under a
// key nothing reads, so it is refused rather than guessed.
func TestApplyDraftSourceCategoryRefusesAnUnknownSite(t *testing.T) {
	for _, site := range []string{"", "   ", "shopify", "b-automationservices"} {
		if _, err := applyDraftSourceCategory("{}", site, "anything"); err == nil {
			t.Errorf("site %q was accepted, want an error", site)
		}
	}
}
