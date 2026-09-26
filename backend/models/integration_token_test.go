package models

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestIntegrationTokenIsUsable(t *testing.T) {
	now := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	cases := []struct {
		name     string
		token    IntegrationToken
		expected bool
	}{
		{"active permanent", IntegrationToken{IsActive: true}, true},
		{"inactive", IntegrationToken{IsActive: false}, false},
		{"revoked", IntegrationToken{IsActive: true, RevokedAt: &past}, false},
		{"expired", IntegrationToken{IsActive: true, ExpiresAt: &past}, false},
		{"not yet expired", IntegrationToken{IsActive: true, ExpiresAt: &future}, true},
		{"revoked and expired", IntegrationToken{IsActive: true, RevokedAt: &past, ExpiresAt: &past}, false},
	}
	for _, testCase := range cases {
		if got := testCase.token.IsUsable(now); got != testCase.expected {
			t.Errorf("%s: IsUsable() = %v, want %v", testCase.name, got, testCase.expected)
		}
	}
}

// The token hash must never reach a JSON response, or every list endpoint would
// leak the credential in a form that can still be used for lookup.
func TestIntegrationTokenNeverSerialisesHash(t *testing.T) {
	encoded, err := json.Marshal(IntegrationToken{
		ID:          1,
		Name:        "crawler",
		TokenHash:   "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
		TokenPrefix: "vib_12345678",
		Role:        "editor",
	})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	serialized := string(encoded)
	if strings.Contains(serialized, "deadbeef") {
		t.Errorf("token hash leaked into JSON: %s", serialized)
	}
	if strings.Contains(serialized, "token_hash") {
		t.Errorf("token_hash key must not appear in JSON: %s", serialized)
	}
	// The display prefix and metadata are expected to be present.
	if !strings.Contains(serialized, "vib_12345678") {
		t.Error("the display prefix should be serialised for the admin list")
	}
}

func TestIntegrationTokenCreatedCarriesPlaintextSeparately(t *testing.T) {
	payload, err := json.Marshal(IntegrationTokenCreated{
		Token:      IntegrationToken{ID: 7, Name: "crawler"},
		PlainToken: "vib_plaintext",
		UsageHint:  "Authorization: Bearer vib_plaintext",
	})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	if !strings.Contains(string(payload), "vib_plaintext") {
		t.Error("the creation response is the one place the plaintext must appear")
	}
}
