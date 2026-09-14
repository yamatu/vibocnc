package utils

import (
	"errors"
	"strings"
	"testing"
)

// Internal error text (schema names, file paths, credentials) must not be
// echoed to API callers by default.
func TestPublicErrorHidesInternalDetails(t *testing.T) {
	err := errors.New("Error 1054: Unknown column 'cost_price' in 'field list'")
	got := PublicError(err, "db_error")
	if got != "db_error" {
		t.Fatalf("expected generic code, got %q", got)
	}
	if strings.Contains(got, "cost_price") {
		t.Fatal("internal detail leaked to the client")
	}
}

func TestPublicErrorFallbackWhenBlank(t *testing.T) {
	if got := PublicError(nil, "  "); got != "internal_error" {
		t.Fatalf("expected internal_error fallback, got %q", got)
	}
}

// Verbose mode is an explicit opt-in for local debugging only.
func TestPublicErrorVerboseOptIn(t *testing.T) {
	t.Setenv("API_VERBOSE_ERRORS", "true")
	err := errors.New("boom")
	if got := PublicError(err, "db_error"); got != "boom" {
		t.Fatalf("expected verbose message, got %q", got)
	}
}
