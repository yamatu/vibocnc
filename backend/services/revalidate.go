package services

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// httpClientRevalidate is a shared client with a short timeout for ISR triggers.
var httpClientRevalidate = &http.Client{Timeout: 5 * time.Second}
var nonAlnumRe = regexp.MustCompile(`[^a-z0-9]`)

func buildProductRevalidateTag(sku string) string {
	sku = strings.ToLower(strings.TrimSpace(sku))
	if sku == "" {
		return ""
	}
	return "product-" + nonAlnumRe.ReplaceAllString(sku, "-")
}

// TriggerNextRevalidate sends on-demand ISR revalidation requests to the Next.js frontend.
// It purges product fetch caches by tag and page caches by path.
// Errors are logged but never bubble up – revalidation is best-effort.
func TriggerNextRevalidate(skus []string, paths []string, alsoAllProducts bool) {
	frontendURL := strings.TrimRight(strings.TrimSpace(os.Getenv("FRONTEND_URL")), "/")
	secret := strings.TrimSpace(os.Getenv("REVALIDATE_SECRET"))
	if frontendURL == "" || secret == "" {
		return // not configured – skip silently
	}

	endpoint := frontendURL + "/api/revalidate"

	seenTags := map[string]bool{}
	for _, sku := range skus {
		tag := buildProductRevalidateTag(sku)
		if tag == "" || seenTags[tag] {
			continue
		}
		seenTags[tag] = true
		go doRevalidateRequest(endpoint, secret, "", tag)
	}

	seenPaths := map[string]bool{}
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" || seenPaths[path] {
			continue
		}
		seenPaths[path] = true
		go doRevalidateRequest(endpoint, secret, path, "")
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
