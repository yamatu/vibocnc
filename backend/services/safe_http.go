package services

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

var blockedOutboundRanges = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),   // Carrier-grade NAT
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),    // TEST-NET-1
	netip.MustParsePrefix("198.18.0.0/15"),   // Benchmarking
	netip.MustParsePrefix("198.51.100.0/24"), // TEST-NET-2
	netip.MustParsePrefix("203.0.113.0/24"),  // TEST-NET-3
	netip.MustParsePrefix("2001:db8::/32"),   // IPv6 documentation
}

func isPublicOutboundIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() ||
		addr.IsLinkLocalUnicast() || addr.IsUnspecified() || addr.IsMulticast() {
		return false
	}
	for _, blocked := range blockedOutboundRanges {
		if blocked.Contains(addr) {
			return false
		}
	}
	return true
}

// validateOutboundURL guards provider URLs against SSRF. allowPrivate relaxes
// the address range checks and is only ever set from AIProviderAllowPrivateAddresses.
func validateOutboundURL(raw string, allowPrivate bool) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.Hostname() == "" {
		return nil, fmt.Errorf("invalid outbound URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("unsupported outbound URL scheme")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("outbound URL userinfo is not allowed")
	}
	if !allowPrivate {
		if port := parsed.Port(); port != "" && port != "80" && port != "443" {
			return nil, fmt.Errorf("outbound URL port is not allowed")
		}
	}

	hostname := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if !allowPrivate {
		if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") ||
			hostname == "local" || strings.HasSuffix(hostname, ".local") ||
			strings.HasSuffix(hostname, ".internal") {
			return nil, fmt.Errorf("private outbound hostname is not allowed")
		}
	}

	if ip := net.ParseIP(hostname); ip != nil {
		if !allowPrivate && !isPublicOutboundIP(ip) {
			return nil, fmt.Errorf("private outbound address is not allowed")
		}
		return parsed, nil
	}
	if allowPrivate {
		// The dialer re-resolves and connects to whatever the name points at, so
		// there is no point pre-resolving here.
		return parsed, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", hostname)
	if err != nil || len(ips) == 0 {
		return nil, fmt.Errorf("outbound hostname could not be resolved")
	}
	for _, ip := range ips {
		if !isPublicOutboundIP(ip) {
			return nil, fmt.Errorf("outbound hostname resolves to a private address")
		}
	}
	return parsed, nil
}

func validatePublicHTTPURL(raw string) (*url.URL, error) {
	return validateOutboundURL(raw, false)
}

func publicDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if !isPublicOutboundIP(ip) {
			return nil, fmt.Errorf("outbound hostname resolved to a private address")
		}
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("outbound hostname has no usable address")
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
}

// AIProviderAllowPrivateAddresses reports whether the operator explicitly allowed
// AI provider URLs to point at private addresses (a self hosted model server, or
// a hostname resolved through a local proxy / fake-IP DNS that answers with a
// reserved range such as 198.18.0.0/15). It is off by default: the AI provider
// URL is admin supplied, but relaxing the guard is still a deliberate decision
// that must not happen silently.
func AIProviderAllowPrivateAddresses() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES"))) {
	case "true", "1", "yes", "on":
		return true
	default:
		return false
	}
}

// aiDialContext is the opt-in dialer. It keeps the resolved address so the
// request cannot be redirected to a different host after the check, but it
// accepts private and reserved ranges.
func aiDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	return dialer.DialContext(ctx, network, address)
}

// aiProviderTransport is built once, on first use, so the default configuration
// keeps sharing the hardened public transport.
var (
	aiProviderTransport     *http.Transport
	aiProviderTransportOnce sync.Once
)

func newAIProviderTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = aiDialContext
	transport.MaxIdleConnsPerHost = 8
	transport.MaxIdleConns = 64
	transport.IdleConnTimeout = 90 * time.Second
	return transport
}

// NewAIProviderHTTPClient returns the client used for AI providers. By default
// it is the hardened public client; setting AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES=true
// returns one that may reach private/self hosted endpoints instead.
func NewAIProviderHTTPClient(timeout time.Duration) *http.Client {
	if !AIProviderAllowPrivateAddresses() {
		return newPublicHTTPClient(timeout)
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	aiProviderTransportOnce.Do(func() {
		aiProviderTransport = newAIProviderTransport()
	})
	return &http.Client{
		Timeout:   timeout,
		Transport: aiProviderTransport,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			if _, err := validateOutboundURL(req.URL.String(), true); err != nil {
				return err
			}
			return nil
		},
	}
}

// publicTransport is the single connection pool shared by every safe outbound
// client. The SSRF guard lives in publicDialContext, so it is applied per
// connection instead of per request, and keeping one transport lets repeated
// provider calls (AI completions, PayPal, web search) reuse an already
// established TCP + TLS session. Building a fresh transport per call forced a
// full DNS lookup and handshake on every request, which dominated the runtime
// of large AI SEO jobs.
var publicTransport = newPublicTransport()

func newPublicTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = publicDialContext
	// AI SEO jobs issue concurrent completions against one provider host, so the
	// default of two idle connections per host would thrash.
	transport.MaxIdleConnsPerHost = 8
	transport.MaxIdleConns = 64
	transport.IdleConnTimeout = 90 * time.Second
	return transport
}

func newPublicHTTPClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: publicTransport,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			if _, err := validatePublicHTTPURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

// NewPublicHTTPClient is the safe outbound client for configured third-party
// providers. It prevents provider URLs from becoming an SSRF primitive.
// The returned client is cheap: it only carries a per-call timeout and shares
// the process-wide validated transport.
func NewPublicHTTPClient(timeout time.Duration) *http.Client {
	return newPublicHTTPClient(timeout)
}
