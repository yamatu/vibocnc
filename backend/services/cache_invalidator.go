package services

import (
	"context"
	"errors"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"log"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
)

var productPathSlashRe = regexp.MustCompile(`[\\/]+`)
var productPathSpaceRe = regexp.MustCompile(`\s+`)

// Default Redis cache key prefixes used by middleware.CachePublicGET.
const (
	redisPrefixCategories      = "cache:public:categories:"
	redisPrefixProducts        = "cache:public:products:"
	redisPrefixProduct         = "cache:public:product:"
	redisPrefixProductSKU      = "cache:public:product_sku:"
	redisPrefixProductSKUQuery = "cache:public:product_sku_query:"
	redisPrefixHomepage        = "cache:public:homepage:"
)

func getSiteURLForPurge() string {
	if v := strings.TrimSpace(os.Getenv("SITE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	// Fallback: keep consistent with sitemap controller.
	return "https://www.vibocnc.com"
}

func getOrCreateCloudflareSetting(db *gorm.DB) (*models.CloudflareCacheSetting, error) {
	var s models.CloudflareCacheSetting
	err := db.First(&s, 1).Error
	if err == nil {
		return &s, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	// Create default row
	s = models.CloudflareCacheSetting{
		ID:                       1,
		Enabled:                  false,
		AutoPurgeOnMutation:      true,
		AutoClearRedisOnMutation: true,
		AutoPurgeIntervalMinutes: 0,
		PurgeEverything:          false,
	}
	if e := db.Create(&s).Error; e != nil {
		return nil, e
	}
	return &s, nil
}

func buildDefaultPurgeURLs(extra []string) []string {
	base := getSiteURLForPurge()
	urls := []string{
		base + "/",
		base + "/products",
		base + "/categories",
	}
	urls = append(urls, extra...)
	// Dedup
	seen := map[string]bool{}
	out := make([]string, 0, len(urls))
	for _, u := range urls {
		u = normalizePurgeURL(base, u)
		if u == "" {
			continue
		}
		if !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}

func normalizePurgeURL(base, raw string) string {
	u := strings.TrimSpace(raw)
	if u == "" {
		return ""
	}
	if strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") {
		return strings.TrimRight(u, "/")
	}
	if strings.HasPrefix(u, "/") {
		return strings.TrimRight(base, "/") + u
	}
	return strings.TrimRight(base, "/") + "/" + strings.TrimLeft(u, "/")
}

func BuildProductPublicPath(sku string) string {
	sku = strings.TrimSpace(sku)
	if sku == "" {
		return ""
	}
	sku = productPathSlashRe.ReplaceAllString(sku, "-")
	sku = productPathSpaceRe.ReplaceAllString(sku, "-")
	return "/products/" + url.PathEscape(sku)
}

// ClearRedisByPrefixes deletes keys matching prefix* for each prefix.
func ClearRedisByPrefixes(ctx context.Context, prefixes ...string) error {
	rdb := config.GetRedis()
	if rdb == nil {
		return nil
	}

	// Keep the scan tight; this is a best-effort invalidation.
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	for _, prefix := range prefixes {
		pattern := prefix + "*"
		var cursor uint64
		for {
			keys, next, err := rdb.Scan(ctx, cursor, pattern, 200).Result()
			if err != nil {
				return err
			}
			if len(keys) > 0 {
				if err := rdb.Del(ctx, keys...).Err(); err != nil {
					return err
				}
			}
			cursor = next
			if cursor == 0 {
				break
			}
		}
	}
	return nil
}

// InvalidatePublicCaches purges Redis (origin cache) and optionally purges Cloudflare (edge cache).
// It is safe to call even when Redis or Cloudflare are not configured.
func InvalidatePublicCaches(ctx context.Context, reason string, extraURLs []string) {
	// Load settings once (controls Redis + Cloudflare behavior)
	db := config.GetDB()
	if db == nil {
		return
	}
	s, err := getOrCreateCloudflareSetting(db)
	if err != nil {
		log.Printf("cache invalidation: settings load failed (%s): %v", reason, err)
		return
	}

	// 1) Origin (Redis) cache
	if s.AutoClearRedisOnMutation {
		if err := ClearRedisByPrefixes(
			ctx,
			redisPrefixCategories,
			redisPrefixProducts,
			redisPrefixProduct,
			redisPrefixProductSKU,
			redisPrefixProductSKUQuery,
			redisPrefixHomepage,
		); err != nil {
			log.Printf("cache invalidation: redis clear failed (%s): %v", reason, err)
		}
	}

	// 2) Cloudflare edge cache
	if !s.Enabled {
		return
	}
	if !s.AutoPurgeOnMutation {
		return
	}

	apiKey, err := utils.DecryptSecret(s.ApiKeyEnc)
	if err != nil {
		log.Printf("cache invalidation: failed to decrypt Cloudflare api key (%s): %v", reason, err)
		return
	}
	client := NewCloudflareClient()

	go func() {
		ctx2, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if s.PurgeEverything {
			err = client.PurgeEverything(ctx2, s.Email, apiKey, s.ZoneID)
		} else {
			urls := buildDefaultPurgeURLs(extraURLs)
			err = client.PurgeURLs(ctx2, s.Email, apiKey, s.ZoneID, urls)
		}
		if err != nil {
			log.Printf("cache invalidation: cloudflare purge failed (%s): %v", reason, err)
			return
		}
		now := time.Now().UTC()
		_ = db.Model(&models.CloudflareCacheSetting{}).Where("id = ?", s.ID).Update("last_purge_at", &now).Error
	}()
}

// StartCloudflareAutoPurgeScheduler runs a periodic purge based on DB settings.
// This is intentionally lightweight (time.Ticker) and best-effort.
func StartCloudflareAutoPurgeScheduler() {
	db := config.GetDB()
	if db == nil {
		return
	}
	client := NewCloudflareClient()

	go func() {
		t := time.NewTicker(1 * time.Minute)
		defer t.Stop()

		for range t.C {
			s, err := getOrCreateCloudflareSetting(db)
			if err != nil {
				log.Printf("cloudflare scheduler: settings load failed: %v", err)
				continue
			}
			if !s.Enabled {
				continue
			}
			if s.AutoPurgeIntervalMinutes <= 0 {
				continue
			}

			// Check last purge timestamp
			if s.LastPurgeAt != nil {
				if time.Since(*s.LastPurgeAt) < time.Duration(s.AutoPurgeIntervalMinutes)*time.Minute {
					continue
				}
			}

			apiKey, err := utils.DecryptSecret(s.ApiKeyEnc)
			if err != nil {
				log.Printf("cloudflare scheduler: failed to decrypt api key: %v", err)
				continue
			}

			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			if s.PurgeEverything {
				err = client.PurgeEverything(ctx, s.Email, apiKey, s.ZoneID)
			} else {
				err = client.PurgeURLs(ctx, s.Email, apiKey, s.ZoneID, buildDefaultPurgeURLs(nil))
			}
			cancel()

			if err != nil {
				log.Printf("cloudflare scheduler: purge failed: %v", err)
				continue
			}
			now := time.Now().UTC()
			_ = db.Model(&models.CloudflareCacheSetting{}).Where("id = ?", s.ID).Update("last_purge_at", &now).Error
		}
	}()
}
