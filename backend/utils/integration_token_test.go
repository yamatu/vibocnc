package utils

import (
	"strings"
	"testing"
)

func TestGenerateIntegrationTokenShape(t *testing.T) {
	token, err := GenerateIntegrationToken()
	if err != nil {
		t.Fatalf("generate failed: %v", err)
	}
	if !strings.HasPrefix(token, IntegrationTokenPrefix) {
		t.Errorf("token must carry the %q prefix, got %q", IntegrationTokenPrefix, token)
	}
	if err := ValidateIntegrationTokenShape(token); err != nil {
		t.Errorf("a freshly generated token must validate: %v", err)
	}
}

func TestGenerateIntegrationTokenIsUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		token, err := GenerateIntegrationToken()
		if err != nil {
			t.Fatalf("generate failed: %v", err)
		}
		if seen[token] {
			t.Fatalf("duplicate token generated: %q", token)
		}
		seen[token] = true
	}
}

func TestHashIntegrationTokenIsDeterministic(t *testing.T) {
	token, _ := GenerateIntegrationToken()
	first := HashIntegrationToken(token)
	second := HashIntegrationToken(token)

	if first != second {
		t.Error("hashing must be deterministic so an indexed lookup works")
	}
	if first == token {
		t.Error("the stored hash must not equal the plaintext token")
	}
	if len(first) != 64 {
		t.Errorf("expected a 64-character hex digest, got %d", len(first))
	}
	// A trailing space must not change the hash, because header values are
	// often trimmed inconsistently by proxies.
	if HashIntegrationToken(token+" ") != first {
		t.Error("hashing must tolerate surrounding whitespace")
	}
}

func TestHashIntegrationTokenDiffersPerToken(t *testing.T) {
	a, _ := GenerateIntegrationToken()
	b, _ := GenerateIntegrationToken()
	if HashIntegrationToken(a) == HashIntegrationToken(b) {
		t.Fatal("different tokens must not share a hash")
	}
}

func TestIsIntegrationToken(t *testing.T) {
	// A JWT must never be mistaken for an API token.
	jwt := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxfQ.signature"
	if IsIntegrationToken(jwt) {
		t.Error("a session JWT must not be treated as an API token")
	}
	token, _ := GenerateIntegrationToken()
	if !IsIntegrationToken(token) {
		t.Error("a generated token must be recognised")
	}
	if !IsIntegrationToken("  " + token) {
		t.Error("leading whitespace must not defeat prefix detection")
	}
}

func TestValidateIntegrationTokenShapeRejectsMalformed(t *testing.T) {
	cases := map[string]string{
		"empty":        "",
		"no prefix":    "abcdef123456",
		"wrong prefix": "xyz_" + strings.Repeat("a", 64),
		"too short":    IntegrationTokenPrefix + "abcd",
		"too long":     IntegrationTokenPrefix + strings.Repeat("a", 66),
		"non-hex body": IntegrationTokenPrefix + strings.Repeat("z", 64),
		"jwt":          "eyJhbGciOiJIUzI1NiJ9.eyJ1IjoxfQ.sig",
	}
	for name, value := range cases {
		if err := ValidateIntegrationTokenShape(value); err == nil {
			t.Errorf("%s: expected rejection for %q", name, value)
		}
	}
}

func TestIntegrationTokenDisplayPrefixTruncates(t *testing.T) {
	token, _ := GenerateIntegrationToken()
	prefix := IntegrationTokenDisplayPrefix(token)
	if len(prefix) != IntegrationTokenPrefixDisplay {
		t.Errorf("expected %d characters, got %d", IntegrationTokenPrefixDisplay, len(prefix))
	}
	if !strings.HasPrefix(token, prefix) {
		t.Error("the display prefix must be a real prefix of the token")
	}
	if prefix == token {
		t.Error("the display prefix must not reveal the whole token")
	}
	// Short input must not panic.
	if got := IntegrationTokenDisplayPrefix("vib_1"); got != "vib_1" {
		t.Errorf("short token returned %q", got)
	}
}
