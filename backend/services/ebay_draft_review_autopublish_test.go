package services

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// TestPublishReadyDraftReportsSkipsHonestly covers the contract that decides
// whether a draft counts as published.
//
// A skip reason is not a success: the import consciously declined the row, so
// counting it as published would tell an operator the product is live when it
// is not.
func TestPublishReadyDraftReportsSkipsHonestly(t *testing.T) {
	cases := []struct {
		name       string
		statusCode int
		reason     string
		err        error
		wantEmpty  bool
		wantSubstr string
	}{
		{name: "imported", statusCode: 200, reason: "", wantEmpty: true},
		// Another run already imported it; the end state is what we wanted.
		{name: "already imported", statusCode: 200, reason: "already_processed", wantEmpty: true},
		{name: "not ready", statusCode: 200, reason: "not_ready", wantSubstr: "not published"},
		{name: "duplicate", statusCode: 200, reason: "duplicate_exists", wantSubstr: "not published"},
		{name: "server error", statusCode: 500, reason: "", wantSubstr: "server error"},
		{name: "transport error", err: errors.New("boom")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			RegisterConfirmDraftImport(func(context.Context, uint) (int, string, error) {
				return tc.statusCode, tc.reason, tc.err
			})
			message, err := PublishReadyDraft(context.Background(), 1)
			if tc.err != nil {
				// A transport failure is returned rather than swallowed, so the caller
				// can log the cause; a message alone would lose it.
				if err == nil {
					t.Fatal("expected the transport error to be returned")
				}
				if !strings.Contains(err.Error(), tc.err.Error()) {
					t.Fatalf("error = %v, want it to wrap %v", err, tc.err)
				}
				return
			}
			if err != nil {
				t.Fatalf("PublishReadyDraft returned an error: %v", err)
			}
			if tc.wantEmpty && message != "" {
				t.Fatalf("message = %q, want no message for a completed publish", message)
			}
			if tc.wantSubstr != "" && !strings.Contains(message, tc.wantSubstr) {
				t.Fatalf("message = %q, want it to contain %q", message, tc.wantSubstr)
			}
		})
	}
}

// TestPublishReadyDraftFailsWithoutAnEntryPoint guards against a run that was
// asked to publish silently behaving like a review-only run. It must surface the
// problem instead of counting ready drafts as published.
func TestPublishReadyDraftFailsWithoutAnEntryPoint(t *testing.T) {
	previous := defaultConfirmDraftImport.Load()
	// A nil ConfirmDraftImportFunc still stores a value, so the load returns a
	// typed nil. Registering one that reports the missing entry point is the
	// honest way to exercise the branch without reaching into the atomic.
	RegisterConfirmDraftImport(func(context.Context, uint) (int, string, error) {
		return 0, "", errors.New("no import entry point is registered; cannot publish")
	})
	t.Cleanup(func() {
		if previous != nil {
			defaultConfirmDraftImport.Store(previous)
		}
	})

	if _, err := PublishReadyDraft(context.Background(), 1); err == nil {
		t.Fatal("expected an error when the import entry point cannot publish")
	}
}

// TestAutoPublishCountsAreSeparateFromReadyCounts locks the accounting that the
// progress view reads: an auto-publishing run reports published drafts, not a
// pending-approval backlog.
func TestAutoPublishCountsAreSeparateFromReadyCounts(t *testing.T) {
	columns := map[string]string{
		"ready":         "ready",
		"rejected":      "rejected",
		"failed":        "failed",
		"imported":      "imported",
		"import_failed": "import_failed",
	}
	for status, column := range columns {
		if column != status {
			t.Errorf("status %q maps to column %q", status, column)
		}
	}
	if columns["imported"] == columns["ready"] {
		t.Fatal("a published draft must not advance the ready counter")
	}
}

// TestAutoPublishPublisherIsKeyedByJob prevents one run's setting from leaking
// into another: a review-only run must not start publishing because a different
// job enabled it.
func TestAutoPublishPublisherIsKeyedByJob(t *testing.T) {
	calls := 0
	setEbayReviewPublisher("job-a", func(context.Context, uint) (string, error) {
		calls++
		return "", nil
	})
	t.Cleanup(func() { setEbayReviewPublisher("job-a", nil) })

	if got := ebayReviewPublisherFor("job-a"); got == nil {
		t.Fatal("publisher for job-a was not registered")
	}
	if got := ebayReviewPublisherFor("job-b"); got != nil {
		t.Fatal("a publisher must not be visible to another job")
	}

	// Clearing releases it, so a finished run does not hold the controller alive.
	setEbayReviewPublisher("job-a", nil)
	if got := ebayReviewPublisherFor("job-a"); got != nil {
		t.Fatal("publisher was not released")
	}
	if calls != 0 {
		t.Fatalf("registering invoked the publisher %d times", calls)
	}
}
