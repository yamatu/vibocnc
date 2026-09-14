package middleware

import (
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// skipPrefixes lists URL path prefixes that should NOT be tracked.
var skipPrefixes = []string{
	"/api/",
	"/uploads/",
	"/health",
	"/api/v1/admin/",
	"/api/v1/auth/",
	"/_next/",
	"/favicon",
}

// skipExtensions lists file extensions that indicate static assets.
var skipExtensions = []string{
	".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg",
	".ico", ".woff", ".woff2", ".ttf", ".eot", ".map",
	".webp", ".avif", ".mp4", ".webm",
}

// shouldSkipTracking returns true if the request should not be logged.
func shouldSkipTracking(urlPath string) bool {
	for _, prefix := range skipPrefixes {
		if strings.HasPrefix(urlPath, prefix) {
			return true
		}
	}
	ext := strings.ToLower(path.Ext(urlPath))
	for _, skipExt := range skipExtensions {
		if ext == skipExt {
			return true
		}
	}
	return false
}

// shouldTrackAPIPath keeps tracking for selected public product APIs so SKU
// analytics can still work when traffic goes through backend API endpoints.
func shouldTrackAPIPath(urlPath string) bool {
	return strings.HasPrefix(urlPath, "/api/v1/public/products")
}

func normalizeProductPathToken(token string) string {
	t := strings.TrimSpace(token)
	if t == "" {
		return ""
	}
	t = strings.ReplaceAll(t, "\\", "-")
	t = strings.ReplaceAll(t, "/", "-")
	if strings.ContainsAny(t, " \t\n\r") {
		t = strings.Join(strings.Fields(t), "-")
	}
	t = strings.Trim(t, "-")
	return strings.ToUpper(t)
}

func extractProductTokenFromReferer(referer string) string {
	if referer == "" {
		return ""
	}
	lower := strings.ToLower(referer)
	idx := strings.Index(lower, "/products/")
	if idx < 0 {
		return ""
	}
	segment := referer[idx+len("/products/"):]
	if qIdx := strings.IndexAny(segment, "?#"); qIdx >= 0 {
		segment = segment[:qIdx]
	}
	if slashIdx := strings.Index(segment, "/"); slashIdx >= 0 {
		segment = segment[:slashIdx]
	}
	return strings.TrimSpace(segment)
}

func deriveTrackedPath(urlPath string, querySku string, referer string) string {
	if strings.HasPrefix(urlPath, "/products/") {
		segment := strings.Trim(strings.TrimPrefix(urlPath, "/products/"), "/")
		if segment != "" {
			if i := strings.Index(segment, "/"); i >= 0 {
				segment = segment[:i]
			}
			if normalized := normalizeProductPathToken(segment); normalized != "" {
				return "/products/" + normalized
			}
		}
		return urlPath
	}

	if !shouldTrackAPIPath(urlPath) {
		return urlPath
	}

	if normalized := normalizeProductPathToken(querySku); normalized != "" {
		return "/products/" + normalized
	}

	if strings.HasPrefix(urlPath, "/api/v1/public/products/sku/") {
		segment := strings.Trim(strings.TrimPrefix(urlPath, "/api/v1/public/products/sku/"), "/")
		if i := strings.Index(segment, "/"); i >= 0 {
			segment = segment[:i]
		}
		if normalized := normalizeProductPathToken(segment); normalized != "" {
			return "/products/" + normalized
		}
	}

	if refToken := extractProductTokenFromReferer(referer); refToken != "" {
		if normalized := normalizeProductPathToken(refToken); normalized != "" {
			return "/products/" + normalized
		}
	}

	return urlPath
}

// isPrivateIP returns true for loopback, link-local, and RFC-1918 addresses.
func isPrivateIP(ip string) bool {
	if ip == "" || ip == "127.0.0.1" || ip == "::1" || ip == "0.0.0.0" {
		return true
	}
	if strings.HasPrefix(ip, "192.168.") || strings.HasPrefix(ip, "10.") {
		return true
	}
	// 172.16.0.0 – 172.31.255.255
	if strings.HasPrefix(ip, "172.") {
		parts := strings.SplitN(ip, ".", 3)
		if len(parts) >= 2 {
			var second int
			for _, ch := range parts[1] {
				if ch >= '0' && ch <= '9' {
					second = second*10 + int(ch-'0')
				} else {
					break
				}
			}
			if second >= 16 && second <= 31 {
				return true
			}
		}
	}
	// fe80:: link-local, fc00::/7 unique-local
	lower := strings.ToLower(ip)
	if strings.HasPrefix(lower, "fe80:") || strings.HasPrefix(lower, "fc") || strings.HasPrefix(lower, "fd") {
		return true
	}
	return false
}

// ---------------------------------------------------------------------------
// Per-IP rate limiter – prevents a single IP from flooding the visitor_logs
// table (e.g. DDoS or scraping). Allows at most maxHitsPerWindow hits per IP
// within the sliding window. Excess requests are silently not logged.
// ---------------------------------------------------------------------------

const (
	ipRateWindow        = 1 * time.Minute
	ipRateMaxHits       = 30 // max logged requests per IP per minute
	ipRateCleanInterval = 5 * time.Minute
)

type ipRateEntry struct {
	count     int
	windowEnd time.Time
}

var (
	ipRateMap    = make(map[string]*ipRateEntry)
	ipRateMu     sync.Mutex
	ipRateLastGC time.Time
)

// ipRateAllow returns true if the IP has not exceeded the logging rate limit.
func ipRateAllow(ip string) bool {
	now := time.Now()
	ipRateMu.Lock()
	defer ipRateMu.Unlock()

	// Periodic garbage collection
	if now.Sub(ipRateLastGC) > ipRateCleanInterval {
		for k, v := range ipRateMap {
			if now.After(v.windowEnd) {
				delete(ipRateMap, k)
			}
		}
		ipRateLastGC = now
	}

	entry, exists := ipRateMap[ip]
	if !exists || now.After(entry.windowEnd) {
		ipRateMap[ip] = &ipRateEntry{count: 1, windowEnd: now.Add(ipRateWindow)}
		return true
	}
	entry.count++
	return entry.count <= ipRateMaxHits
}

// AnalyticsMiddleware records page visits in a non-blocking goroutine.
// Private/internal IPs are silently skipped.
// Per-IP rate limiting prevents storage abuse from floods/attacks.
func AnalyticsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		urlPath := c.Request.URL.Path
		forceTrack := shouldTrackAPIPath(urlPath)

		if shouldSkipTracking(urlPath) && !forceTrack {
			c.Next()
			return
		}

		// Capture data before handler runs
		ip := GetClientIP(c)

		// Skip private/internal IPs entirely – only track public visitors
		if isPrivateIP(ip) {
			c.Next()
			return
		}

		ua := c.GetHeader("User-Agent")
		method := c.Request.Method
		referer := c.GetHeader("Referer")
		querySku := c.Query("sku")
		trackedPath := deriveTrackedPath(urlPath, querySku, referer)

		c.Next()

		// Per-IP rate limit check – don't log if this IP is flooding
		if !ipRateAllow(ip) {
			return
		}

		statusCode := c.Writer.Status()

		// Non-blocking: buffer the log record; a background writer flushes it in
		// batches so the request path never performs a per-hit INSERT.
		go func() {
			db := config.GetDB()
			if db == nil {
				return
			}

			// Cheap cached check (refreshed every 30s) instead of a SELECT per hit.
			if !services.IsTrackingEnabled(db) {
				return
			}

			isBot, botName := services.DetectBot(ua)
			geo := services.LookupGeoIP(ip)

			services.EnqueueVisitorLog(models.VisitorLog{
				IPAddress:   ip,
				Country:     geo.Country,
				CountryCode: geo.CountryCode,
				Region:      geo.RegionName,
				City:        geo.City,
				Latitude:    geo.Lat,
				Longitude:   geo.Lon,
				Path:        trackedPath,
				Method:      method,
				StatusCode:  statusCode,
				UserAgent:   ua,
				IsBot:       isBot,
				BotName:     botName,
				Referer:     referer,
			})
		}()
	}
}
