package middleware

import (
	"log"
	"os"
	"strings"

	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
)

// trustedProxyIPHeaders are the headers Gin may read to determine the client
// IP *only* when the direct peer is a trusted proxy.
var trustedProxyIPHeaders = []string{"X-Forwarded-For", "X-Real-IP"}

// ConfigureTrustedProxies hardens client-IP detection so that rate limiting and
// audit logging cannot be bypassed with spoofed forwarding headers.
//
//	TRUSTED_PROXIES  comma separated IPs/CIDRs of the reverse proxies in front
//	                 of this service. Defaults to loopback + RFC1918 ranges.
//	TRUSTED_PLATFORM "cloudflare" when the site is served through Cloudflare,
//	                 or the name of the header a CDN overwrites with the real
//	                 client IP (e.g. X-Real-Client-IP). When set, Gin trusts
//	                 that header without checking the peer address, so the
//	                 origin must be firewalled to the CDN.
func ConfigureTrustedProxies(r *gin.Engine) {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	proxies := utils.TrustedProxyList()

	if err := r.SetTrustedProxies(proxies); err != nil {
		// Never fail open with Gin's default (trust everything). Fall back to
		// the safest option: trust nobody, so only the socket peer IP is used.
		log.Printf("Warning: invalid TRUSTED_PROXIES (%v): %v; trusting no proxies", proxies, err)
		_ = r.SetTrustedProxies(nil)
		return
	}

	platform := utils.TrustedPlatform()
	if header := utils.TrustedPlatformHeader(); header != "" {
		r.TrustedPlatform = header
		r.RemoteIPHeaders = append([]string{header}, trustedProxyIPHeaders...)
		if header == gin.PlatformCloudflare {
			log.Printf("Client IP: using CF-Connecting-IP; the origin must only be reachable through Cloudflare")
		} else {
			log.Printf("Client IP: using %q; the origin must only be reachable through the CDN that sets it", header)
		}
	} else {
		if platform != "" {
			log.Printf("Warning: unknown TRUSTED_PLATFORM=%q ignored", platform)
		}
		r.RemoteIPHeaders = trustedProxyIPHeaders
	}

	if raw == "" && isProductionEnv() {
		log.Printf("Warning: TRUSTED_PROXIES is not set, trusting loopback and all RFC1918 ranges (%v); "+
			"set TRUSTED_PROXIES to the exact proxies in front of this service and keep the backend port "+
			"unreachable from untrusted networks", proxies)
	}

	log.Printf("Client IP: trusted proxies = %v", proxies)
}

// isProductionEnv reports whether GO_ENV selects the production profile.
func isProductionEnv() bool {
	return strings.ToLower(strings.TrimSpace(os.Getenv("GO_ENV"))) == "production"
}
