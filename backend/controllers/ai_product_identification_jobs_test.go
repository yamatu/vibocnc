package controllers

import (
	"testing"

	"fanuc-backend/models"
)

// Batch identification must never queue a product that already has a pending
// profile draft, is already in another AI task, is inactive, or has no usable
// model. These rules are the only thing preventing duplicate review rows and
// wasted AI spend, so they are asserted on the pure selection core.
func TestSelectIdentificationCandidatesSkipsBlockedAndIneligibleProducts(t *testing.T) {
	quotes := []models.EbayMarketQuote{
		{ID: 1, Model: "A06B-6077-H106"},
		{ID: 2, Model: "MR-J4-70A"},
		{ID: 3, Model: "SGDV-2R8A01A"},
		{ID: 4, Model: "6SN1123-1AA00-0AA1"},
		{ID: 5, Model: "A06B-6114-H105"},
	}
	matches := map[uint]models.Product{
		// Eligible.
		1: {ID: 10, SKU: "SKU-10", Brand: "FANUC", Model: "A06B-6077-H106", IsActive: true},
		// Already has a pending profile draft.
		2: {ID: 20, SKU: "SKU-20", Brand: "Mitsubishi", Model: "MR-J4-70A", IsActive: true},
		// Inactive catalogue entry.
		3: {ID: 30, SKU: "SKU-30", Brand: "Yaskawa", Model: "SGDV-2R8A01A", IsActive: false},
		// No usable model: model, part number and SKU are all empty.
		4: {ID: 40, Brand: "Siemens", IsActive: true},
		// Eligible but already inside another queued/running AI task.
		5: {ID: 50, SKU: "SKU-50", Brand: "FANUC", Model: "A06B-6114-H105", IsActive: true},
	}
	blocked := map[uint]bool{20: true, 50: true}

	selected := selectIdentificationCandidates(quotes, matches, nil, blocked, 100)
	if len(selected) != 1 || selected[0].ID != 10 {
		t.Fatalf("expected only the eligible product 10, got %+v", selected)
	}
	if selected[0].SKU != "SKU-10" {
		t.Errorf("expected the SKU to be carried into the job item, got %q", selected[0].SKU)
	}
}

func TestSelectIdentificationCandidatesRespectsRequestedIDsAndLimit(t *testing.T) {
	quotes := []models.EbayMarketQuote{
		{ID: 1, Model: "A06B-6077-H106"},
		{ID: 2, Model: "A06B-6114-H105"},
		{ID: 3, Model: "A06B-6220-H011"},
	}
	matches := map[uint]models.Product{
		1: {ID: 10, SKU: "SKU-10", Model: "A06B-6077-H106", IsActive: true},
		2: {ID: 20, SKU: "SKU-20", Model: "A06B-6114-H105", IsActive: true},
		3: {ID: 30, SKU: "SKU-30", Model: "A06B-6220-H011", IsActive: true},
	}

	// An explicit selection only queues the requested products.
	selected := selectIdentificationCandidates(quotes, matches, []uint{20, 30}, nil, 100)
	if len(selected) != 2 || selected[0].ID != 20 || selected[1].ID != 30 {
		t.Fatalf("requested-id filter failed: %+v", selected)
	}

	// The limit caps how many products one task may contain.
	limited := selectIdentificationCandidates(quotes, matches, nil, nil, 2)
	if len(limited) != 2 {
		t.Fatalf("limit was not applied: %+v", limited)
	}
}

// A quote whose model never matched a catalogue product must not produce a job
// item, otherwise the worker has no product id to identify.
func TestSelectIdentificationCandidatesIgnoresUnmatchedQuotes(t *testing.T) {
	quotes := []models.EbayMarketQuote{
		{ID: 1, Model: "UNKNOWN-1"},
		{ID: 2, Model: "A06B-6077-H106"},
	}
	matches := map[uint]models.Product{
		2: {ID: 20, SKU: "SKU-20", Model: "A06B-6077-H106", IsActive: true},
	}

	selected := selectIdentificationCandidates(quotes, matches, nil, nil, 100)
	if len(selected) != 1 || selected[0].ID != 20 {
		t.Fatalf("unmatched quote leaked into selection: %+v", selected)
	}
}
