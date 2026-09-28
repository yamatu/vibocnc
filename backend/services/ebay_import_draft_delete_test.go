package services

import "testing"

func TestHasEbayImportDraftDeleteScopeRequiresAnExplicitPredicate(t *testing.T) {
	if HasEbayImportDraftDeleteScope(EbayImportDraftFilters{}) {
		t.Fatal("an empty filter must not be considered a safe bulk-delete scope")
	}
	cases := []EbayImportDraftFilters{
		{Status: EbayDraftStatusImported},
		{SourceSite: DraftSourceSiteBas},
		{Search: "CJ1W-DA08C"},
		{MatchStatus: EbayDraftMatchExact},
		{Brand: "OMRON"},
		{AIReviewStatus: EbayAIReviewReady},
	}
	for _, filters := range cases {
		if !HasEbayImportDraftDeleteScope(filters) {
			t.Fatalf("filter %#v was incorrectly rejected", filters)
		}
	}
}
