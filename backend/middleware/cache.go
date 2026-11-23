package middleware

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fanuc-backend/config"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const notFoundCachePrefix = "__NOTFOUND__:"

type cachedResponse struct {
	Status  int
	Headers http.Header
	Body    []byte
}

type bodyWriter struct {
	gin.ResponseWriter
	status int
	body   []byte
}

func (w *bodyWriter) WriteHeader(statusCode int) {
	w.status = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *bodyWriter) Write(b []byte) (int, error) {
	w.body = append(w.body, b...)
	return w.ResponseWriter.Write(b)
}

func getTTLSeconds(envKey string, def int) time.Duration {
	v := strings.TrimSpace(os.Getenv(envKey))
	if v == "" {
		return time.Duration(def) * time.Second
	}
	if n, err := strconv.Atoi(v); err == nil && n >= 0 {
		return time.Duration(n) * time.Second
	}
	return time.Duration(def) * time.Second
}

func cacheKey(prefix, fullURL string) string {
	h := sha256.Sum256([]byte(fullURL))
	return prefix + hex.EncodeToString(h[:])
}

func normalizeURLForCache(r *http.Request) string {
	// Cache key should include path + canonicalized query.
	u := &url.URL{Path: r.URL.Path, RawQuery: r.URL.RawQuery}
	q := u.Query()
	// Sort keys by rebuilding RawQuery via Encode (it sorts by key).
	u.RawQuery = q.Encode()
	return u.String()
}

// CachePublicGET caches selected public GET endpoints in Redis.
// If Redis is not configured, it's a no-op.
func CachePublicGET(ttl time.Duration, keyPrefix string) gin.HandlerFunc {
	return CachePublicGETWithNotFound(ttl, 0, keyPrefix)
}

// CachePublicGETWithNotFound caches successful JSON responses for ttl, and
// optionally caches JSON 404 responses for notFoundTTL so repeated probes for
// missing SKUs do not keep hitting MySQL.
func CachePublicGETWithNotFound(ttl time.Duration, notFoundTTL time.Duration, keyPrefix string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			c.Next()
			return
		}
		rdb := config.GetRedis()
		if rdb == nil || ttl <= 0 {
			c.Next()
			return
		}

		full := normalizeURLForCache(c.Request)
		key := cacheKey(keyPrefix, full)

		ctx, cancel := context.WithTimeout(c.Request.Context(), 200*time.Millisecond)
		defer cancel()

		if raw, err := rdb.Get(ctx, key).Bytes(); err == nil && len(raw) > 0 {
			if notFoundTTL > 0 && bytes.HasPrefix(raw, []byte(notFoundCachePrefix)) {
				c.Header("X-Cache", "HIT-404")
				c.Data(http.StatusNotFound, "application/json; charset=utf-8", raw[len(notFoundCachePrefix):])
				c.Abort()
				return
			}
			// Serve cached JSON
			c.Header("X-Cache", "HIT")
			c.Data(http.StatusOK, "application/json; charset=utf-8", raw)
			c.Abort()
			return
		}

		// Capture response
		bw := &bodyWriter{ResponseWriter: c.Writer, status: 200}
		c.Writer = bw
		c.Next()

		// Cache successful JSON responses (and optional short-lived 404 responses)
		ct := c.Writer.Header().Get("Content-Type")
		if bw.status == http.StatusOK && strings.Contains(ct, "application/json") && len(bw.body) > 0 {
			ctx2, cancel2 := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel2()
			_ = rdb.Set(ctx2, key, bw.body, ttl).Err()
			c.Header("X-Cache", "MISS")
		} else if notFoundTTL > 0 && bw.status == http.StatusNotFound && strings.Contains(ct, "application/json") && len(bw.body) > 0 {
			ctx2, cancel2 := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel2()
			payload := make([]byte, 0, len(notFoundCachePrefix)+len(bw.body))
			payload = append(payload, notFoundCachePrefix...)
			payload = append(payload, bw.body...)
			_ = rdb.Set(ctx2, key, payload, notFoundTTL).Err()
			c.Header("X-Cache", "MISS-404")
		}
	}
}

func CacheTTLHomepage() time.Duration {
	return getTTLSeconds("CACHE_TTL_HOMEPAGE_SECONDS", 120)
}

func CacheTTLCategories() time.Duration {
	return getTTLSeconds("CACHE_TTL_CATEGORIES_SECONDS", 300)
}

func CacheTTLProducts() time.Duration {
	return getTTLSeconds("CACHE_TTL_PRODUCTS_SECONDS", 60)
}

func CacheTTLSitemap() time.Duration {
	return getTTLSeconds("CACHE_TTL_SITEMAP_SECONDS", 600)
}

func CacheTTLShipping() time.Duration {
	return getTTLSeconds("CACHE_TTL_SHIPPING_SECONDS", 600)
}

func CacheTTLContent() time.Duration {
	return getTTLSeconds("CACHE_TTL_CONTENT_SECONDS", 300)
}
