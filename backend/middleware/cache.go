package middleware

import (
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
	"github.com/redis/go-redis/v9"
)

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
		ctx, cancel := context.WithTimeout(c.Request.Context(), 200*time.Millisecond)
		defer cancel()
		generation, generationErr := rdb.Get(ctx, "cache:public:catalog-generation").Result()
		if generationErr != nil && generationErr != redis.Nil {
			c.Next() // unavailable version => fresh DB read, never an old cache
			return
		}
		key := cacheKey(keyPrefix, "visibility-v2:"+generation+":"+full)

		if raw, err := rdb.Get(ctx, key).Bytes(); err == nil && len(raw) > 0 {
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

		// Cache only successful JSON responses
		ct := c.Writer.Header().Get("Content-Type")
		if bw.status == http.StatusOK && strings.Contains(ct, "application/json") && len(bw.body) > 0 {
			ctx2, cancel2 := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel2()
			_ = rdb.Set(ctx2, key, bw.body, ttl).Err()
			c.Header("X-Cache", "MISS")
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
