package middleware

import (
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

// defaultTrustedProxies covers the common self-hosted deployment: a host-level
// Nginx (or Docker's userland proxy) forwarding to this backend over loopback
// or a private container network.
//
// Trusting a whole range means every peer inside it is allowed to supply a
// forwarding header. That is only safe because the Nginx configs shipped with
// this project *overwrite* X-Forwarded-For with $remote_addr instead of
// appending to it, and because the backend port is bound to loopback. Narrow
// this list via TRUSTED_PROXIES for any other topology.
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

// headerNamePattern matches RFC 7230 field-name tokens. It is used to validate
// a custom TRUSTED_PLATFORM value before handing it to Gin.
var headerNamePattern = regexp.MustCompile("^[A-Za-z0-9!#$%&'*+\\-.^_`|~]+$")

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

	platform := strings.TrimSpace(os.Getenv("TRUSTED_PLATFORM"))
	switch strings.ToLower(platform) {
	case "cloudflare", "cf":
		r.TrustedPlatform = gin.PlatformCloudflare
		r.RemoteIPHeaders = append([]string{gin.PlatformCloudflare}, trustedProxyIPHeaders...)
		log.Printf("Client IP: using CF-Connecting-IP; the origin must only be reachable through Cloudflare")
	case "":
		r.RemoteIPHeaders = trustedProxyIPHeaders
	default:
		if headerNamePattern.MatchString(platform) {
			r.TrustedPlatform = platform
			r.RemoteIPHeaders = append([]string{platform}, trustedProxyIPHeaders...)
			log.Printf("Client IP: using %q; the origin must only be reachable through the CDN that sets it", platform)
		} else {
			log.Printf("Warning: unknown TRUSTED_PLATFORM=%q ignored", platform)
			r.RemoteIPHeaders = trustedProxyIPHeaders
		}
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
