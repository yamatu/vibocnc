package controllers

import (
	"net/http"
	"strings"
	"testing"
)

// A batch upload answered "eBay import drafts processed" even when HTTP 400
// rejected every item, and the browser extension surfaced that wording as the
// error text. The operator saw a success-sounding message next to a stopped
// upload, with no way to tell what had gone wrong, so the status and the
// message have to agree.
func TestEbayUploadResponseMessage(t *testing.T) {
	cases := []struct {
		name         string
		successCount int
		errorCount   int
		reasons      []string
		wantStatus   int
		wantContains []string
		wantMissing  []string
	}{
		{
			name:         "a fully accepted batch keeps the success wording",
			successCount: 3,
			errorCount:   0,
			wantStatus:   http.StatusCreated,
			wantContains: []string{"processed"},
			wantMissing:  []string{"rejected", "failed"},
		},
		{
			name:         "a rejected batch must not claim the drafts were processed",
			successCount: 0,
			errorCount:   3,
			reasons:      []string{"Unknown column 'ai_review_status'"},
			wantStatus:   http.StatusBadRequest,
			wantContains: []string{"rejected", "Unknown column 'ai_review_status'"},
			wantMissing:  []string{"processed"},
		},
		{
			name:         "a rejected batch without a captured reason still says it was rejected",
			successCount: 0,
			errorCount:   1,
			wantStatus:   http.StatusBadRequest,
			wantContains: []string{"rejected"},
			wantMissing:  []string{"processed"},
		},
		{
			name:         "a partial batch reports how many items failed",
			successCount: 7,
			errorCount:   2,
			wantStatus:   http.StatusPartialContent,
			wantContains: []string{"partially processed", "2"},
		},
		{
			name:         "every captured reason is carried through",
			successCount: 0,
			errorCount:   2,
			reasons:      []string{"first reason", "second reason"},
			wantStatus:   http.StatusBadRequest,
			wantContains: []string{"first reason", "second reason"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, message := ebayUploadResponseMessage(tc.successCount, tc.errorCount, tc.reasons)
			if status != tc.wantStatus {
				t.Fatalf("status = %d, want %d", status, tc.wantStatus)
			}
			for _, want := range tc.wantContains {
				if !strings.Contains(message, want) {
					t.Errorf("message %q does not contain %q", message, want)
				}
			}
			for _, missing := range tc.wantMissing {
				if strings.Contains(message, missing) {
					t.Errorf("message %q must not contain %q", message, missing)
				}
			}
		})
	}
}
