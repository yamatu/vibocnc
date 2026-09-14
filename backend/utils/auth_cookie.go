package utils

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Cookie names used for browser sessions. The JWT is stored in HttpOnly
// cookies so client-side JavaScript (and therefore any XSS payload) cannot
// read or exfiltrate it. Non-browser clients may keep using the
// `Authorization: Bearer <jwt>` header instead.
const (
	AdminAuthCookieName    = "admin_token"
	CustomerAuthCookieName = "customer_token"
)

// AuthCookieSecure reports whether auth cookies should carry the Secure flag. It
// follows the actual request scheme when a trusted reverse proxy tells us (nginx
// / Cloudflare set X-Forwarded-Proto), and otherwise falls back to the
// environment. AUTH_COOKIE_SECURE=false forces the flag off (plain-HTTP dev).
func AuthCookieSecure(c *gin.Context) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_COOKIE_SECURE"))) {
	case "false", "0", "no", "off":
		return false
	case "true", "1", "yes", "on":
		return true
	}

	if c != nil {
		if c.Request != nil && c.Request.TLS != nil {
			return true
		}
		// X-Forwarded-Proto is only meaningful when it comes from a proxy we
		// trust: any client can send the header, and honouring it from a direct
		// peer would let an attacker decide whether our session cookie is
		// marked Secure.
		if IsTrustedProxyRequest(c) {
			if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
				first := strings.TrimSpace(strings.Split(proto, ",")[0])
				if strings.EqualFold(first, "https") {
					return true
				}
				if strings.EqualFold(first, "http") {
					return false
				}
			}
		}
	}

	return strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "production")
}

// SetAuthCookie stores a session JWT in a hardened, HttpOnly cookie.
func SetAuthCookie(c *gin.Context, name, token string, ttl time.Duration) {
	if c == nil || token == "" || ttl <= 0 {
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		name,
		token,
		int(ttl.Seconds()),
		"/",
		"", // host-only: never shared with sibling subdomains
		AuthCookieSecure(c),
		true, // HttpOnly
	)
}

// ClearAuthCookie expires a session cookie (logout).
func ClearAuthCookie(c *gin.Context, name string) {
	if c == nil {
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, "", -1, "/", "", AuthCookieSecure(c), true)
}
