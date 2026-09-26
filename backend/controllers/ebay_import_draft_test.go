package controllers

import (
	"reflect"
	"testing"
)

func TestNormalizeBulkDraftIDs(t *testing.T) {
	got := normalizeBulkDraftIDs([]uint{0, 12, 12, 7, 0, 3, 7})
	want := []uint{12, 7, 3}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeBulkDraftIDs() = %#v, want %#v", got, want)
	}
}

func TestNormalizeBulkDraftIDsEmpty(t *testing.T) {
	if got := normalizeBulkDraftIDs([]uint{0, 0}); len(got) != 0 {
		t.Fatalf("normalizeBulkDraftIDs() = %#v, want empty", got)
	}
}

// A filter-based delete without a status bound could empty the entire review
// queue from one click, so it must be rejected rather than silently widened.
func TestNormalizeDraftStatusFilterRejectsEmpty(t *testing.T) {
	if got := normalizeDraftStatusFilter(nil, ""); len(got) != 0 {
		t.Fatalf("normalizeDraftStatusFilter(nil, \"\") = %#v, want empty", got)
	}
	if got := normalizeDraftStatusFilter([]string{"  ", "nonsense"}, "  "); len(got) != 0 {
		t.Fatalf("normalizeDraftStatusFilter(unknown) = %#v, want empty", got)
	}
}

// The status allow-list must be normalised (case/whitespace) and deduplicated so
// the SQL predicate matches exactly the statuses the admin selected.
func TestNormalizeDraftStatusFilterNormalizesAndDedupes(t *testing.T) {
	got := normalizeDraftStatusFilter([]string{" Pending ", "PENDING", "failed"}, "")
	want := []string{"pending", "failed"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeDraftStatusFilter() = %#v, want %#v", got, want)
	}
}

// A single status filter is honoured when no explicit list is supplied, which is
// the common "filter to pending, then delete all" flow.
func TestNormalizeDraftStatusFilterUsesSingleStatus(t *testing.T) {
	got := normalizeDraftStatusFilter(nil, "Imported")
	want := []string{"imported"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeDraftStatusFilter(nil, imported) = %#v, want %#v", got, want)
	}
}
