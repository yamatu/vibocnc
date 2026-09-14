package utils

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// newCookieProbe builds a Gin context whose direct peer is remoteAddr and which
// carries the given forwarding headers, mimicking what a proxy would send.
func newCookieProbe(t *testing.T, remoteAddr string, headers map[string]string) *gin.Context {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
	req.RemoteAddr = remoteAddr
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	return c
}

func TestAuthCookieSecureHonoursExplicitEnv(t *testing.T) {
	t.Setenv("AUTH_COOKIE_SECURE", "true")
	t.Setenv("GO_ENV", "")
	c := newCookieProbe(t, "203.0.113.9:44321", map[string]string{"X-Forwarded-Proto": "http"})
	if !AuthCookieSecure(c) {
		t.Fatal("AUTH_COOKIE_SECURE=true must force the Secure flag even over plain HTTP")
	}

	t.Setenv("AUTH_COOKIE_SECURE", "false")
	t.Setenv("GO_ENV", "production")
	c = newCookieProbe(t, "172.18.0.5:51234", map[string]string{"X-Forwarded-Proto": "https"})
	if AuthCookieSecure(c) {
		t.Fatal("AUTH_COOKIE_SECURE=false must force the Secure flag off")
	}
}

func TestAuthCookieSecureTrustsProxyScheme(t *testing.T) {
	t.Setenv("AUTH_COOKIE_SECURE", "")
	t.Setenv("GO_ENV", "production")

	// Docker bridge peer (RFC1918) is a trusted proxy by default.
	c := newCookieProbe(t, "172.18.0.5:51234", map[string]string{"X-Forwarded-Proto": "https"})
	if !AuthCookieSecure(c) {
		t.Fatal("https reported by a trusted proxy must set the Secure flag")
	}

	c = newCookieProbe(t, "172.18.0.5:51234", map[string]string{"X-Forwarded-Proto": "http"})
	if AuthCookieSecure(c) {
		t.Fatal("http reported by a trusted proxy must not set the Secure flag")
	}
}

func TestAuthCookieSecureIgnoresForgedSchemeFromPublicPeer(t *testing.T) {
	t.Setenv("AUTH_COOKIE_SECURE", "")
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1")
	// A public client cannot downgrade its own session by claiming http...
	t.Setenv("GO_ENV", "production")
	c := newCookieProbe(t, "203.0.113.9:44321", map[string]string{"X-Forwarded-Proto": "http"})
	if !AuthCookieSecure(c) {
		t.Fatal("a forged X-Forwarded-Proto from an untrusted peer must be ignored")
	}

	// ...and it must not be able to force HTTPS handling on a plain-HTTP service
	// by claiming https either.
	t.Setenv("GO_ENV", "")
	c = newCookieProbe(t, "203.0.113.9:44321", map[string]string{"X-Forwarded-Proto": "https"})
	if AuthCookieSecure(c) {
		t.Fatal("a forged X-Forwarded-Proto must not enable Secure on an HTTP deployment")
	}
}

func TestAuthCookieSecureFallsBackToGoEnv(t *testing.T) {
	t.Setenv("AUTH_COOKIE_SECURE", "")
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1")
	t.Setenv("GO_ENV", "production")
	c := newCookieProbe(t, "127.0.0.1:41000", nil)
	if !AuthCookieSecure(c) {
		t.Fatal("GO_ENV=production must default to Secure cookies")
	}

	t.Setenv("GO_ENV", "development")
	if AuthCookieSecure(c) {
		t.Fatal("development must default to non-Secure cookies for plain HTTP")
	}
}

func TestAuthCookieSecureTrustsConfiguredPlatform(t *testing.T) {
	t.Setenv("AUTH_COOKIE_SECURE", "")
	t.Setenv("GO_ENV", "")
	t.Setenv("TRUSTED_PLATFORM", "cloudflare")
	// Behind Cloudflare the origin sees the edge, but the platform is trusted
	// explicitly, so the scheme header is honoured.
	c := newCookieProbe(t, "203.0.113.9:44321", map[string]string{"X-Forwarded-Proto": "https"})
	if !AuthCookieSecure(c) {
		t.Fatal("with TRUSTED_PLATFORM set, X-Forwarded-Proto: https must set the Secure flag")
	}
}

func TestSetAuthCookieHardening(t *testing.T) {
	t.Setenv("AUTH_COOKIE_SECURE", "")
	t.Setenv("GO_ENV", "production")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/login", func(c *gin.Context) {
		SetAuthCookie(c, AdminAuthCookieName, "token-value", 3600)
		c.Status(200)
	})
	r.POST("/logout", func(c *gin.Context) {
		ClearAuthCookie(c, AdminAuthCookieName)
		c.Status(200)
	})

	req := httptest.NewRequest("POST", "/login", nil)
	req.RemoteAddr = "172.18.0.5:51234"
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	header := rec.Header().Get("Set-Cookie")
	for _, want := range []string{AdminAuthCookieName + "=token-value", "HttpOnly", "SameSite=Lax", "Secure", "Path=/"} {
		if !containsFold(header, want) {
			t.Fatalf("Set-Cookie %q is missing %q", header, want)
		}
	}
	if containsFold(header, "Domain=") {
		t.Fatalf("auth cookie must stay host-only, got %q", header)
	}

	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("POST", "/logout", nil))
	cleared := rec.Header().Get("Set-Cookie")
	if !containsFold(cleared, "Max-Age=0") && !containsFold(cleared, "Max-Age=-1") {
		t.Fatalf("logout must expire the cookie, got %q", cleared)
	}
}

func containsFold(haystack, needle string) bool {
	return len(needle) == 0 || strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}
