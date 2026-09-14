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
