package services

import (
	"net"
	"net/http"
	"testing"
	"time"
)

func TestValidatePublicHTTPURLRejectsPrivateTargets(t *testing.T) {
	t.Parallel()

	blocked := []string{
		"http://localhost/image.jpg",
		"http://127.0.0.1/image.jpg",
		"http://10.0.0.1/image.jpg",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/image.jpg",
		"https://user:password@example.com/image.jpg",
		"https://8.8.8.8:8443/image.jpg",
	}
	for _, raw := range blocked {
		raw := raw
		t.Run(raw, func(t *testing.T) {
			t.Parallel()
			if _, err := validatePublicHTTPURL(raw); err == nil {
				t.Fatalf("validatePublicHTTPURL(%q) accepted a blocked target", raw)
			}
		})
	}
}

func TestValidatePublicHTTPURLAcceptsPublicIP(t *testing.T) {
	t.Parallel()

	if _, err := validatePublicHTTPURL("https://8.8.8.8/image.jpg"); err != nil {
		t.Fatalf("expected public IP URL to be accepted: %v", err)
	}
}

func TestIsPublicOutboundIP(t *testing.T) {
	t.Parallel()

	tests := []struct {
		ip   string
		want bool
	}{
		{ip: "8.8.8.8", want: true},
		{ip: "1.1.1.1", want: true},
		{ip: "127.0.0.1", want: false},
		{ip: "10.0.0.1", want: false},
		{ip: "100.64.0.1", want: false},
		{ip: "169.254.169.254", want: false},
		{ip: "::1", want: false},
	}
	for _, test := range tests {
		if got := isPublicOutboundIP(net.ParseIP(test.ip)); got != test.want {
			t.Errorf("isPublicOutboundIP(%q) = %v, want %v", test.ip, got, test.want)
		}
	}
}

// TestPublicHTTPClientsShareOneTransport locks in connection reuse. Every AI
// completion and every PayPal call used to build its own transport, so no
// request could ever reuse a TCP/TLS session with the provider.
func TestPublicHTTPClientsShareOneTransport(t *testing.T) {
	t.Parallel()

	first := NewPublicHTTPClient(5 * time.Second)
	second := NewPublicHTTPClient(75 * time.Second)
	if first.Transport != second.Transport {
		t.Fatal("outbound clients must share the validated transport so connections are reused")
	}
	if first.Transport != publicTransport {
		t.Fatal("outbound client must use the process-wide validated transport")
	}
	if first.Timeout != 5*time.Second || second.Timeout != 75*time.Second {
		t.Fatalf("per-client timeouts must be preserved, got %s and %s", first.Timeout, second.Timeout)
	}
	if _, ok := first.Transport.(*http.Transport); !ok {
		t.Fatalf("shared transport must stay an *http.Transport, got %T", first.Transport)
	}
}

func TestPublicHTTPClientDefaultsInvalidTimeout(t *testing.T) {
	t.Parallel()

	if got := NewPublicHTTPClient(0).Timeout; got != 30*time.Second {
		t.Fatalf("zero timeout should fall back to 30s, got %s", got)
	}
	if got := NewPublicHTTPClient(-time.Second).Timeout; got != 30*time.Second {
		t.Fatalf("negative timeout should fall back to 30s, got %s", got)
	}
}

func TestValidateOutboundURLBlocksPrivateTargets(t *testing.T) {
	blocked := []string{
		"http://127.0.0.1:8080/v1",
		"http://localhost/v1",
		"http://10.1.2.3/v1",
		"http://192.168.1.10/v1",
		"http://169.254.169.254/latest/meta-data", // cloud metadata
		"http://198.18.1.39/v1",                   // fake-IP DNS range
		"http://100.64.0.1/v1",                    // carrier grade NAT
		"http://ollama.internal/v1",               // internal suffix
		"http://api.example.com:8080/v1",          // only 80/443 allowed
		"ftp://api.example.com/v1",                // scheme
		"http://user:pass@api.example.com/v1",     // userinfo
		"http://[::1]/v1",                         // IPv6 loopback
	}
	for _, raw := range blocked {
		if _, err := validateOutboundURL(raw, false); err == nil {
			t.Errorf("validateOutboundURL(%q) must be rejected", raw)
		}
	}

	// A literal public address is the one case that can be checked without DNS.
	if _, err := validateOutboundURL("https://8.8.8.8/v1", false); err != nil {
		t.Errorf("public literal address must be allowed: %v", err)
	}
}

func TestValidateOutboundURLOptInAllowsPrivateTargets(t *testing.T) {
	allowed := []string{
		"http://127.0.0.1:11434/v1",
		"http://ollama.internal:11434/v1",
		"http://198.18.1.39/v1",
		"https://192.168.1.10:8443/v1",
	}
	for _, raw := range allowed {
		if _, err := validateOutboundURL(raw, true); err != nil {
			t.Errorf("validateOutboundURL(%q, allowPrivate) = %v, want nil", raw, err)
		}
	}

	// The opt-in must not disable the scheme and credential checks.
	for _, raw := range []string{"ftp://127.0.0.1/v1", "http://user:pass@127.0.0.1/v1", "not a url"} {
		if _, err := validateOutboundURL(raw, true); err == nil {
			t.Errorf("validateOutboundURL(%q, allowPrivate) must still be rejected", raw)
		}
	}
}

func TestAIProviderAllowPrivateAddresses(t *testing.T) {
	for _, value := range []string{"1", "true", "TRUE", "yes", "on"} {
		t.Setenv("AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES", value)
		if !AIProviderAllowPrivateAddresses() {
			t.Errorf("value %q must enable private AI provider addresses", value)
		}
	}
	for _, value := range []string{"", "0", "false", "off", "no", "maybe"} {
		t.Setenv("AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES", value)
		if AIProviderAllowPrivateAddresses() {
			t.Errorf("value %q must keep the guard enabled", value)
		}
	}
}

func TestNewAIProviderHTTPClientDefaultsToHardenedTransport(t *testing.T) {
	t.Setenv("AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES", "false")
	client := NewAIProviderHTTPClient(0)
	if client.Transport != publicTransport {
		t.Fatal("the default client must reuse the hardened public transport")
	}
	if client.Timeout <= 0 {
		t.Fatal("a zero timeout must fall back to a sane default")
	}

	t.Setenv("AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES", "true")
	relaxed := NewAIProviderHTTPClient(0)
	if relaxed.Transport == publicTransport {
		t.Fatal("the opt-in client must not reuse the hardened public transport")
	}
	if relaxed.Timeout <= 0 {
		t.Fatal("a zero timeout must fall back to a sane default")
	}
	// The opt-in path must still refuse non-HTTP schemes.
	if _, err := validateOutboundURL("ftp://127.0.0.1/v1", AIProviderAllowPrivateAddresses()); err == nil {
		t.Fatal("the opt-in must not allow an unsupported scheme")
	}
}
