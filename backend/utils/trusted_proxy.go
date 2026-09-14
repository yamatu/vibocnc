package utils

import (
	"net"
	"os"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

// DefaultTrustedProxies covers the common self-hosted deployment: a host-level
// Nginx (or Docker's userland proxy) forwarding to this backend over loopback
// or a private container network.
//
// Trusting a whole range means every peer inside it is allowed to supply a
// forwarding header. That is only safe because the Nginx configs shipped with
// this project *overwrite* X-Forwarded-For/X-Forwarded-Proto instead of
// appending to them, and because the backend port is bound to loopback.
// Narrow this list via TRUSTED_PROXIES for any other topology.
var DefaultTrustedProxies = []string{
	"127.0.0.1",
	"::1",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
}

// headerNamePattern matches RFC 7230 field-name tokens. It is used to validate a
// custom TRUSTED_PLATFORM value before handing it to Gin.
var headerNamePattern = regexp.MustCompile("^[A-Za-z0-9!#$%&'*+\\-.^_`|~]+$")

// ValidHeaderName reports whether value can be used as an HTTP header name.
func ValidHeaderName(value string) bool {
	return headerNamePattern.MatchString(value)
}

// TrustedProxyList returns the configured proxies as IPs/CIDRs. An empty
// TRUSTED_PROXIES falls back to DefaultTrustedProxies.
func TrustedProxyList() []string {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		return DefaultTrustedProxies
	}
	var proxies []string
	for _, part := range strings.Split(raw, ",") {
		if p := strings.TrimSpace(part); p != "" {
			proxies = append(proxies, p)
		}
	}
	return proxies
}

// TrustedPlatform returns the configured CDN platform name ("cloudflare" or a
// header name the CDN overwrites with the real client IP).
func TrustedPlatform() string {
	return strings.TrimSpace(os.Getenv("TRUSTED_PLATFORM"))
}

// TrustedPlatformHeader returns the header Gin should read for the client IP
// when TRUSTED_PLATFORM is set, or "" when no platform is configured.
func TrustedPlatformHeader() string {
	platform := TrustedPlatform()
	switch strings.ToLower(platform) {
	case "cloudflare", "cf":
		return gin.PlatformCloudflare
	case "":
		return ""
	}
	if ValidHeaderName(platform) {
		return platform
	}
	return ""
}

// IsTrustedProxyPeer reports whether a direct peer address belongs to the
// trusted proxy set. An unparseable or empty address is never trusted, so a
// missing socket address cannot turn into "trust everything".
func IsTrustedProxyPeer(remoteAddr string) bool {
	ip := peerIP(remoteAddr)
	if ip == nil {
		return false
	}
	trusted := TrustedProxyList()
	if len(trusted) == 0 {
		return false
	}
	for _, entry := range trusted {
		if ipInEntry(ip, entry) {
			return true
		}
	}
	return false
}

// IsTrustedProxyRequest reports whether the direct peer of this request may
// supply the forwarding headers X-Forwarded-For / X-Real-IP / X-Forwarded-Proto.
//
// It mirrors middleware.ConfigureTrustedProxies: when TRUSTED_PLATFORM is set,
// the origin is assumed to be reachable only through that CDN, so its headers
// are trusted without checking the peer address.
func IsTrustedProxyRequest(c *gin.Context) bool {
	if TrustedPlatformHeader() != "" {
		return true
	}
	if c == nil || c.Request == nil {
		return false
	}
	return IsTrustedProxyPeer(c.Request.RemoteAddr)
}

// peerIP extracts the IP from a "host:port" socket address. IPv4-mapped IPv6
// addresses are unmapped so that ::ffff:127.0.0.1 matches 127.0.0.1/8.
func peerIP(remoteAddr string) net.IP {
	addr := strings.TrimSpace(remoteAddr)
	if addr == "" {
		return nil
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		// No port: accept a bare IP, but nothing else.
		host = strings.Trim(addr, "[]")
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return nil
	}
	return unmapIP(ip)
}

// unmapIP converts an IPv4-mapped IPv6 address (::ffff:127.0.0.1) to its IPv4
// form so it matches plain IPv4 CIDR entries. Pure IPv6 addresses pass through.
func unmapIP(ip net.IP) net.IP {
	if v4 := ip.To4(); v4 != nil {
		return v4
	}
	return ip
}

// ipInEntry matches an IP against one TRUSTED_PROXIES entry, which may be a
// plain address or a CIDR block.
func ipInEntry(ip net.IP, entry string) bool {
	value := strings.TrimSpace(entry)
	if value == "" {
		return false
	}
	if strings.Contains(value, "/") {
		_, block, err := net.ParseCIDR(value)
		if err != nil {
			return false
		}
		return block.Contains(ip)
	}
	parsed := net.ParseIP(strings.Trim(value, "[]"))
	if parsed == nil {
		return false
	}
	return unmapIP(parsed).Equal(ip)
}
