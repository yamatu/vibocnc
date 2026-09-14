package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// trustedProxyCase drives a request through a real Gin engine so the assertions
// cover Gin's actual ClientIP() resolution (including its right-to-left scan of
// X-Forwarded-For) rather than our own reimplementation of it.
func clientIPFor(t *testing.T, remoteAddr string, headers map[string]string) string {
	t.Helper()
	gin.SetMode(gin.TestMode)

	r := gin.New()
	ConfigureTrustedProxies(r)
	r.GET("/ip", func(c *gin.Context) { c.String(200, c.ClientIP()) })

	req := httptest.NewRequest("GET", "/ip", nil)
	req.RemoteAddr = remoteAddr
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Body.String()
}

// A peer outside the trusted ranges must never be able to spoof its own address,
// otherwise every IP based rate limit is trivially bypassable.
func TestClientIPIgnoresHeadersFromUntrustedPeer(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "")
	t.Setenv("TRUSTED_PLATFORM", "")

	got := clientIPFor(t, "203.0.113.9:1234", map[string]string{
		"X-Forwarded-For": "1.2.3.4",
		"X-Real-IP":       "5.6.7.8",
	})
	if got != "203.0.113.9" {
		t.Fatalf("untrusted peer spoofed its client IP: got %q, want %q", got, "203.0.113.9")
	}
}

// An invalid TRUSTED_PROXIES value must fail closed (trust nobody) instead of
// silently falling back to Gin's "trust everything" default.
func TestClientIPTrustsNobodyOnInvalidProxyList(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "not-an-ip")
	t.Setenv("TRUSTED_PLATFORM", "")

	got := clientIPFor(t, "10.0.0.5:1234", map[string]string{
		"X-Forwarded-For": "1.2.3.4",
	})
	if got != "10.0.0.5" {
		t.Fatalf("invalid proxy list did not fail closed: got %q, want %q", got, "10.0.0.5")
	}
}

// A trusted proxy that overwrites X-Forwarded-For (what our Nginx configs do)
// yields exactly the real client IP.
func TestClientIPUsesOverwrittenHeaderFromTrustedProxy(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1,10.0.0.0/8")
	t.Setenv("TRUSTED_PLATFORM", "")

	got := clientIPFor(t, "10.0.0.5:1234", map[string]string{
		"X-Forwarded-For": "198.51.100.7",
	})
	if got != "198.51.100.7" {
		t.Fatalf("trusted proxy header not honoured: got %q, want %q", got, "198.51.100.7")
	}
}

// A trusted proxy that appends to a client supplied X-Forwarded-For still
// resolves to the real client, because Gin scans the list right to left and
// discards trusted entries.
func TestClientIPIgnoresPrependedSpoofFromAppendingProxy(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "10.0.0.0/8")
	t.Setenv("TRUSTED_PLATFORM", "")

	got := clientIPFor(t, "10.0.0.5:1234", map[string]string{
		"X-Forwarded-For": "1.2.3.4, 198.51.100.7",
	})
	if got != "198.51.100.7" {
		t.Fatalf("prepended spoof was used: got %q, want %q", got, "198.51.100.7")
	}
}

// This documents the residual risk the Nginx overwrite rule protects against:
// when the direct peer itself is trusted, a *single* spoofed entry is believed.
func TestClientIPBelievesSingleHeaderFromTrustedPeer(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "10.0.0.0/8")
	t.Setenv("TRUSTED_PLATFORM", "")

	got := clientIPFor(t, "10.0.0.5:1234", map[string]string{
		"X-Forwarded-For": "1.2.3.4",
	})
	if got != "1.2.3.4" {
		t.Fatalf("expected Gin to trust the single header from a trusted peer, got %q", got)
	}
}

// A CDN other than Cloudflare can nominate the header it overwrites with the
// real client IP.
func TestTrustedPlatformAcceptsCustomHeaderName(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1")
	t.Setenv("TRUSTED_PLATFORM", "X-Real-Client-IP")

	got := clientIPFor(t, "127.0.0.1:1234", map[string]string{
		"X-Real-Client-IP": "198.51.100.7",
		"X-Forwarded-For":  "1.2.3.4",
	})
	if got != "198.51.100.7" {
		t.Fatalf("custom platform header not used: got %q, want %q", got, "198.51.100.7")
	}
}

// A TRUSTED_PLATFORM value that is not a valid header name must be rejected so
// it cannot be smuggled into Gin as a header lookup.
func TestTrustedPlatformRejectsInvalidHeaderName(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1")
	t.Setenv("TRUSTED_PLATFORM", "not a header")

	got := clientIPFor(t, "127.0.0.1:1234", map[string]string{
		"X-Forwarded-For": "198.51.100.7",
	})
	if got != "198.51.100.7" {
		t.Fatalf("invalid platform name should be ignored, got %q", got)
	}
}
