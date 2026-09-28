package services

import (
	"reflect"
	"testing"

	"fanuc-backend/models"
)

func TestSourceCategorySegmentsKeepMarketplacePathUnderDedicatedRoot(t *testing.T) {
	segments, root, err := sourceCategorySegments(DraftSourceSiteEbay, "Business & Industrial > Industrial Automation > PLCs & HMIs > PLC Processors")
	if err != nil {
		t.Fatal(err)
	}
	if root != "eBay" {
		t.Fatalf("root = %q, want eBay", root)
	}
	want := []string{"Business & Industrial", "Industrial Automation", "PLCs & HMIs", "PLC Processors"}
	if !reflect.DeepEqual(segments, want) {
		t.Fatalf("segments = %#v, want %#v", segments, want)
	}
}

func TestEffectiveDraftCategoryModeFallsBackForLegacyRows(t *testing.T) {
	if got := EffectiveDraftCategoryMode(models.EbayImportDraft{SourceSite: DraftSourceSiteEbay, RawPayload: `{"category_breadcrumb":"Business > PLCs"}`}); got != DraftCategoryModeSource {
		t.Fatalf("legacy eBay row mode = %q, want source", got)
	}
	if got := EffectiveDraftCategoryMode(models.EbayImportDraft{SourceSite: DraftSourceSiteEbay, RawPayload: `{"product_title":"OMRON CJ1W-DA08C"}`}); got != DraftCategoryModeMixed {
		t.Fatalf("row without source category mode = %q, want mixed", got)
	}
	if got := EffectiveDraftCategoryMode(models.EbayImportDraft{CategoryMode: DraftCategoryModeMixed, SourceSite: DraftSourceSiteEbay, RawPayload: `{"category_breadcrumb":"Business > PLCs"}`}); got != DraftCategoryModeMixed {
		t.Fatalf("explicit mixed mode = %q, want mixed", got)
	}
}

func TestDraftSKUUsesTheSamePriorityAsProductCreation(t *testing.T) {
	draft := models.EbayImportDraft{NormalizedPartNumber: "CJ1W-DA08C", NormalizedMPN: "OTHER", NormalizedModel: "MODEL", EbayItemID: "123"}
	if got := DraftSKU(draft); got != "CJ1W-DA08C" {
		t.Fatalf("DraftSKU() = %q, want part number", got)
	}
	draft.NormalizedPartNumber = ""
	if got := DraftSKU(draft); got != "OTHER" {
		t.Fatalf("DraftSKU() = %q, want MPN", got)
	}
}
