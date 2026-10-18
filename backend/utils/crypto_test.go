package utils

import (
	"errors"
	"strings"
	"testing"
)

// SETTINGS_ENCRYPTION_KEY is an AES-256 key. scripts/init-env.py used to emit
// token_hex(24) (48 chars == 24 bytes), which made every AI key / PayPal /
// SMTP save fail with "must be 32 bytes". These cases pin the accepted shapes
// so the generator and the validator can never disagree again.
func TestEncryptionKeyAcceptsOnly32Bytes(t *testing.T) {
	cases := []struct {
		name    string
		value   string
		wantErr error
	}{
		{"missing", "", ErrEncryptionKeyMissing},
		{"hex 32 bytes", strings.Repeat("ab", 32), nil},
		{"raw 32 chars", "12345678901234567890123456789012", nil},
		{"base64 32 bytes", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", nil},
		{"hex 24 bytes (the old generator)", strings.Repeat("ab", 24), ErrEncryptionKeyInvalid},
		{"short", "tooshort", ErrEncryptionKeyInvalid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SETTINGS_ENCRYPTION_KEY", tc.value)
			err := ValidateEncryptionKey()
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("expected the key to be accepted, got %v", err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("expected %v, got %v", tc.wantErr, err)
			}
		})
	}
}

// A stored secret must round-trip with the same key and be readable only with it,
// so rotating the key is a deliberate, visible loss rather than silent garbage.
func TestEncryptSecretRoundTripAndKeyRotation(t *testing.T) {
	t.Setenv("SETTINGS_ENCRYPTION_KEY", strings.Repeat("ab", 32))
	enc, err := EncryptSecret("sk-test-key")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !strings.HasPrefix(enc, encPrefixV1) {
		t.Fatalf("expected %q prefix, got %q", encPrefixV1, enc)
	}
	plain, err := DecryptSecret(enc)
	if err != nil || plain != "sk-test-key" {
		t.Fatalf("round trip mismatch: %q %v", plain, err)
	}

	t.Setenv("SETTINGS_ENCRYPTION_KEY", strings.Repeat("cd", 32))
	if _, err := DecryptSecret(enc); err == nil {
		t.Fatal("a different key must not decrypt the stored secret")
	}
}
