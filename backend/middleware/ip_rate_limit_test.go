package middleware

import (
	"testing"
	"time"
)

// The in-process limiter is the fallback that keeps rate limiting alive when
// Redis is unavailable, so its window behaviour must be predictable.
func TestMemoryAllowEnforcesLimitWithinWindow(t *testing.T) {
	key := t.Name() + "-window"
	const limit = 3

	for i := 1; i <= limit; i++ {
		if !memoryAllow(key, limit, time.Minute) {
			t.Fatalf("request %d should have been allowed", i)
		}
	}
	if memoryAllow(key, limit, time.Minute) {
		t.Fatal("request above the limit should have been rejected")
	}
}

func TestMemoryAllowResetsAfterWindow(t *testing.T) {
	key := t.Name() + "-reset"
	if !memoryAllow(key, 1, 10*time.Millisecond) {
		t.Fatal("first request should be allowed")
	}
	if memoryAllow(key, 1, 10*time.Millisecond) {
		t.Fatal("second request in the same window should be rejected")
	}
	time.Sleep(20 * time.Millisecond)
	if !memoryAllow(key, 1, 10*time.Millisecond) {
		t.Fatal("request after the window should be allowed again")
	}
}

func TestResolveIPRateSettingsEnvOverride(t *testing.T) {
	t.Setenv("RATE_LIMIT_CUSTOMER_LOGIN_PER_MINUTE", "7")
	s := resolveIPRateSettings("customer_login", 20, 15*time.Minute)
	if s.Limit != 7 {
		t.Fatalf("expected env override to apply, got %d", s.Limit)
	}
	if s.Window != 15*time.Minute {
		t.Fatalf("expected window to be preserved, got %s", s.Window)
	}
	// The window is always expressed per minute by the env var, so callers that
	// pass an hour-long window still keep their window.
	if got := rateLimitEnvKey("customer-login"); got != "RATE_LIMIT_CUSTOMER_LOGIN_PER_MINUTE" {
		t.Fatalf("unexpected env key: %s", got)
	}
}

func TestResolveIPRateSettingsDefaults(t *testing.T) {
	t.Setenv("RATE_LIMIT_CONTACT_PER_MINUTE", "not-a-number")
	s := resolveIPRateSettings("contact", 5, time.Minute)
	if s.Limit != 5 || s.Window != time.Minute {
		t.Fatalf("invalid env value should keep defaults, got %+v", s)
	}
	if got := resolveIPRateSettings("contact", 0, 0); got.Limit <= 0 || got.Window <= 0 {
		t.Fatalf("zero defaults should be normalised, got %+v", got)
	}
}
