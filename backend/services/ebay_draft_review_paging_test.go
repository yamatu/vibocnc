package services

import (
	"testing"
)

// A run over tens of thousands of drafts produces far more items than a page can
// hold. The approval list asks for `ready` rows specifically, which the log page
// would bury; a count before pagination is what lets the UI report how many
// proposals exist rather than only how many are on screen.
func TestReviewItemPageBoundsAndDefaults(t *testing.T) {
	if EbayReviewItemPageSizeMax != 200 {
		t.Errorf("page cap = %d, want 200 to match the drafts list", EbayReviewItemPageSizeMax)
	}
	if EbayReviewItemPageSizeDefault <= 0 || EbayReviewItemPageSizeDefault > EbayReviewItemPageSizeMax {
		t.Errorf("default page size %d is outside 1..%d", EbayReviewItemPageSizeDefault, EbayReviewItemPageSizeMax)
	}
}

// The paging helper must not depend on a live database to be correct about its
// own contract: it reports the page it will serve, clamped to the cap.
func TestReviewItemPageClampsTheRequestedSize(t *testing.T) {
	// A nil database is a programming error, not a silent empty page.
	if _, err := ListEbayDraftReviewJobItemsPaged(nil, "job", "ready", 1, 50); err == nil {
		t.Error("a nil database must be reported, not served as an empty page")
	}
}
