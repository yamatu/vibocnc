package middleware

import (
	"context"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ipRateSettings is the runtime configuration for a limiter scope.
type ipRateSettings struct {
	Limit  int
	Window time.Duration
}

// normalizeScope turns a human scope like "customer_login" into the env var
// suffix used to override it: RATE_LIMIT_CUSTOMER_LOGIN_PER_MINUTE.
func rateLimitEnvKey(scope string) string {
	return "RATE_LIMIT_" + strings.ToUpper(strings.NewReplacer("-", "_", "/", "_", " ", "_").Replace(scope)) + "_PER_MINUTE"
}

func resolveIPRateSettings(scope string, defaultLimit int, defaultWindow time.Duration) ipRateSettings {
	s := ipRateSettings{Limit: defaultLimit, Window: defaultWindow}
	if s.Limit <= 0 {
		s.Limit = 30
	}
	if s.Window <= 0 {
		s.Window = time.Minute
	}
	// A window of exactly one minute is tunable via env so operators can tighten
	// or relax a specific endpoint without a rebuild.
	if raw := strings.TrimSpace(os.Getenv(rateLimitEnvKey(scope))); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			s.Limit = v
		}
	}
	return s
}

// ---------------------------------------------------------------------------
// In-memory fallback limiter (used when Redis is unavailable)
// ---------------------------------------------------------------------------

type memoryBucket struct {
	count     int
	expiresAt time.Time
}

var (
	memoryLimiterMu sync.Mutex
	memoryLimiter   = make(map[string]memoryBucket)
	lastSweep       time.Time
)

func memoryAllow(key string, limit int, window time.Duration) bool {
	now := time.Now()
	memoryLimiterMu.Lock()
	defer memoryLimiterMu.Unlock()

	// Opportunistic sweep of expired buckets so the map cannot grow forever.
	if now.Sub(lastSweep) > time.Minute {
		for k, b := range memoryLimiter {
			if now.After(b.expiresAt) {
				delete(memoryLimiter, k)
			}
		}
		lastSweep = now
	}

	b, ok := memoryLimiter[key]
	if !ok || now.After(b.expiresAt) {
		memoryLimiter[key] = memoryBucket{count: 1, expiresAt: now.Add(window)}
		return true
	}
	if b.count >= limit {
		return false
	}
	b.count++
	memoryLimiter[key] = b
	return true
}

// IPRateLimit limits requests to a scope per client IP. It uses Redis when
// available (works across multiple instances) and falls back to an in-process
// fixed-window limiter otherwise, so a Redis outage never disables protection.
func IPRateLimit(scope string, limit int, window time.Duration) gin.HandlerFunc {
	settings := resolveIPRateSettings(scope, limit, window)

	return func(c *gin.Context) {
		ip := GetClientIP(c)
		if ip == "" {
			c.Next()
			return
		}

		win := settings.Window
		now := time.Now().UTC()
		suffix := strconv.FormatInt(now.Truncate(win).Unix(), 10)
		key := "rl:" + scope + ":" + ip + ":" + suffix

		allowed := false
		decidedByRedis := false

		if rdb := config.GetRedis(); rdb != nil {
			ctx, cancel := context.WithTimeout(c.Request.Context(), 300*time.Millisecond)
			cnt, err := rdb.Incr(ctx, key).Result()
			if err == nil {
				if cnt == 1 {
					_, _ = rdb.Expire(ctx, key, win+5*time.Second).Result()
				}
				allowed = cnt <= int64(settings.Limit)
				decidedByRedis = true
			}
			cancel()
		}

		// Redis unavailable or errored: fall back to the in-process limiter so a
		// Redis outage never disables rate limiting.
		if !decidedByRedis {
			allowed = memoryAllow(key, settings.Limit, win)
		}

		if !allowed {
			c.Header("Retry-After", strconv.Itoa(int(win.Seconds())))
			c.JSON(http.StatusTooManyRequests, models.APIResponse{
				Success: false,
				Message: "Too many requests, please slow down and try again later",
				Error:   "rate_limited",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
