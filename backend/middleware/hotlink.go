package middleware

import (
	"fanuc-backend/config"
	"fanuc-backend/models"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type hotlinkCache struct {
	mu        sync.Mutex
	expiresAt time.Time
	val       *models.HotlinkProtectionSetting
}

var hlCache hotlinkCache

func loadHotlinkSetting(db *gorm.DB) (*models.HotlinkProtectionSetting, error) {
	hlCache.mu.Lock()
	defer hlCache.mu.Unlock()

	now := time.Now()
	if hlCache.val != nil && now.Before(hlCache.expiresAt) {
		return hlCache.val, nil
	}

	var s models.HotlinkProtectionSetting
	if err := db.First(&s, 1).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			s = models.HotlinkProtectionSetting{ID: 1, Enabled: true, AllowedHosts: "www.vibocnc.com,vibocnc.com,localhost,127.0.0.1", AllowEmptyReferer: true, AllowSameHost: true}
			_ = db.Create(&s).Error
		} else {
			return nil, err
		}
	}

	hlCache.val = &s
	hlCache.expiresAt = now.Add(30 * time.Second)
	return &s, nil
}

func parseHostFromHeader(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	u, err := url.Parse(v)
	if err != nil {
		return ""
	}
	h := strings.ToLower(strings.TrimSpace(u.Hostname()))
	return h
}

func splitAllowedHosts(csv string) map[string]bool {
	m := map[string]bool{}
	for _, part := range strings.Split(csv, ",") {
		h := strings.ToLower(strings.TrimSpace(part))
		if h == "" {
			continue
		}
		m[h] = true
	}
	return m
}

// HotlinkProtectionMiddleware enforces referer/origin host allowlist for /uploads/*.
func HotlinkProtectionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only protect /uploads/*
		if !strings.HasPrefix(c.Request.URL.Path, "/uploads/") {
			c.Next()
			return
		}

		db := config.GetDB()
		if db == nil {
			c.Next()
			return
		}
		s, err := loadHotlinkSetting(db)
		if err != nil {
			// Fail open to avoid breaking the site if DB has issues.
			c.Next()
			return
		}
		if !s.Enabled {
			c.Next()
			return
		}

		refererHost := parseHostFromHeader(c.GetHeader("Referer"))
		originHost := parseHostFromHeader(c.GetHeader("Origin"))

		if refererHost == "" && originHost == "" {
			if s.AllowEmptyReferer {
				c.Next()
				return
			}
			c.AbortWithStatus(http.StatusForbidden)
			return
		}

		allowed := splitAllowedHosts(s.AllowedHosts)

		// Always allow same host if enabled.
		if s.AllowSameHost {
			reqHost := strings.ToLower(strings.TrimSpace(c.Request.Host))
			// Host may include port
			if i := strings.IndexByte(reqHost, ':'); i >= 0 {
				reqHost = reqHost[:i]
			}
			if refererHost == reqHost || originHost == reqHost {
				c.Next()
				return
			}
		}

		if (refererHost != "" && allowed[refererHost]) || (originHost != "" && allowed[originHost]) {
			c.Next()
			return
		}

		c.AbortWithStatus(http.StatusForbidden)
	}
}
