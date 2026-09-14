package middleware

import (
	"log"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// defaultTrustedProxies covers the common self-hosted deployment: a host-level
// Nginx (or Docker's userland proxy) forwarding to this backend over loopback
// or a private container network.
var defaultTrustedProxies = []string{
	"127.0.0.1",
	"::1",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
}

// trustedProxyIPHeaders are the headers Gin may read to determine the client
// IP *only* when the direct peer is a trusted proxy.
var trustedProxyIPHeaders = []string{"X-Forwarded-For", "X-Real-IP"}

// ConfigureTrustedProxies hardens client-IP detection so that rate limiting and
// audit logging cannot be bypassed with spoofed forwarding headers.
//
//	TRUSTED_PROXIES  comma separated IPs/CIDRs of the reverse proxies in front
//	                 of this service. Defaults to loopback + RFC1918 ranges.
//	TRUSTED_PLATFORM optional. Set to "cloudflare" when the site is served
//	                 through Cloudflare so that CF-Connecting-IP (which
//	                 Cloudflare overwrites at the edge) is used.
func ConfigureTrustedProxies(r *gin.Engine) {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	proxies := defaultTrustedProxies
	if raw != "" {
		proxies = nil
		for _, part := range strings.Split(raw, ",") {
			if p := strings.TrimSpace(part); p != "" {
				proxies = append(proxies, p)
			}
		}
	}

	if err := r.SetTrustedProxies(proxies); err != nil {
		// Never fail open with Gin's default (trust everything). Fall back to
		// the safest option: trust nobody, so only the socket peer IP is used.
		log.Printf("Warning: invalid TRUSTED_PROXIES (%v): %v; trusting no proxies", proxies, err)
		_ = r.SetTrustedProxies(nil)
		return
	}

	switch strings.ToLower(strings.TrimSpace(os.Getenv("TRUSTED_PLATFORM"))) {
	case "cloudflare", "cf":
		r.TrustedPlatform = gin.PlatformCloudflare
		r.RemoteIPHeaders = append([]string{"CF-Connecting-IP"}, trustedProxyIPHeaders...)
		log.Printf("Client IP: trusting CF-Connecting-IP for requests from trusted proxies")
	case "":
		r.RemoteIPHeaders = trustedProxyIPHeaders
	default:
		log.Printf("Warning: unknown TRUSTED_PLATFORM=%q ignored", os.Getenv("TRUSTED_PLATFORM"))
		r.RemoteIPHeaders = trustedProxyIPHeaders
	}

	log.Printf("Client IP: trusted proxies = %v", proxies)
}
