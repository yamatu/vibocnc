package services

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// httpClientRevalidate is a shared client with a short timeout for ISR triggers.
var httpClientRevalidate = &http.Client{Timeout: 5 * time.Second}

// TriggerNextRevalidate sends an on-demand ISR revalidation request to the Next.js frontend.
// It notifies Next.js to purge the cached page for a specific product (by tag)
// and optionally the "all-products" tag for sitemaps / listing pages.
// Errors are logged but never bubble up – revalidation is best-effort.
func TriggerNextRevalidate(slug string, alsoAllProducts bool) {
	frontendURL := strings.TrimRight(strings.TrimSpace(os.Getenv("FRONTEND_URL")), "/")
	secret := strings.TrimSpace(os.Getenv("REVALIDATE_SECRET"))
	if frontendURL == "" || secret == "" {
		return // not configured – skip silently
	}

	endpoint := frontendURL + "/api/revalidate"

	// Always revalidate the specific product tag
	if slug != "" {
		tag := "product-" + strings.ToLower(strings.ReplaceAll(slug, "/", "-"))
		go doRevalidateRequest(endpoint, secret, "", tag)
	}

	// Optionally revalidate the "all-products" tag (sitemaps, listing pages)
	if alsoAllProducts {
		go doRevalidateRequest(endpoint, secret, "", "all-products")
	}
}

func doRevalidateRequest(endpoint, secret, path, tag string) {
	body := map[string]string{}
	if path != "" {
		body["path"] = path
	}
	if tag != "" {
		body["tag"] = tag
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		log.Printf("revalidate: failed to marshal body: %v", err)
		return
	}

	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonBody))
	if err != nil {
		log.Printf("revalidate: failed to create request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Revalidate-Secret", secret)

	resp, err := httpClientRevalidate.Do(req)
	if err != nil {
		log.Printf("revalidate: request failed (tag=%s, path=%s): %v", tag, path, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("revalidate: non-200 response (tag=%s, path=%s): %d", tag, path, resp.StatusCode)
	}
}
