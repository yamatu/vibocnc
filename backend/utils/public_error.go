package utils

import (
	"log"
	"os"
	"strings"
)

// PublicError converts an internal error into a client-safe value.
//
// Internal errors frequently contain database/schema details, file paths or
// even credentials. They must never be echoed to an API caller. This helper
// logs the original error server-side and returns a stable, generic code that
// the UI can key off.
//
//	Error: utils.PublicError(err, "db_error")
func PublicError(err error, fallback string) string {
	if err != nil {
		log.Printf("[api-error] %v", err)
	}
	if strings.TrimSpace(fallback) == "" {
		fallback = "internal_error"
	}
	// A verbose mode helps local debugging without ever shipping internals to
	// production callers.
	if isVerboseErrorsEnabled() && err != nil {
		return err.Error()
	}
	return fallback
}

func isVerboseErrorsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("API_VERBOSE_ERRORS"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
