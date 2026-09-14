package config

import (
	"os"
	"strings"
)

// defaultUploadPath mirrors the historical hard-coded fallback used by the
// upload controller and the static file route.
const defaultUploadPath = "./uploads"

// UploadPath returns the directory that holds uploaded media. It is centralised
// here so the uploader and the static file server can never disagree about
// where files live (which previously allowed path confusion).
func UploadPath() string {
	if p := strings.TrimSpace(os.Getenv("UPLOAD_PATH")); p != "" {
		return p
	}
	return defaultUploadPath
}
