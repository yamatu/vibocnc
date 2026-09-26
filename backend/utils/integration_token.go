package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
)

// IntegrationTokenPrefix marks machine credentials so they are recognisable in
// logs, bug reports and configuration files. A value starting with this prefix
// is never a session JWT.
const IntegrationTokenPrefix = "vib_"

// integrationTokenRandomBytes controls the entropy of a new token. 32 bytes
// (256 bits) is comfortably beyond brute force for a bearer credential.
const integrationTokenRandomBytes = 32

// IntegrationTokenPrefixDisplay is how many leading characters are kept for
// display in the admin UI.
const IntegrationTokenPrefixDisplay = 12

// GenerateIntegrationToken returns a new random token in plaintext form.
//
// The plaintext is returned to the caller exactly once (at creation) and is
// never stored: only HashIntegrationToken's output is persisted.
func GenerateIntegrationToken() (string, error) {
	buffer := make([]byte, integrationTokenRandomBytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return IntegrationTokenPrefix + hex.EncodeToString(buffer), nil
}

// HashIntegrationToken hashes a token for storage and lookup.
//
// SHA-256 without a salt is deliberate here, not an oversight: the input is a
// 256-bit random value, so there is no dictionary or rainbow-table attack, and
// a deterministic hash is what allows an indexed lookup by token.
func HashIntegrationToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

// IsIntegrationToken reports whether a bearer value is a machine token rather
// than a session JWT, so the middleware can pick the right validation path.
func IsIntegrationToken(token string) bool {
	return strings.HasPrefix(strings.TrimSpace(token), IntegrationTokenPrefix)
}

// IntegrationTokenDisplayPrefix returns the short, non-secret prefix shown in
// the admin list.
func IntegrationTokenDisplayPrefix(token string) string {
	token = strings.TrimSpace(token)
	if len(token) <= IntegrationTokenPrefixDisplay {
		return token
	}
	return token[:IntegrationTokenPrefixDisplay]
}

// ValidateIntegrationTokenShape rejects obviously malformed values before a
// database round trip.
func ValidateIntegrationTokenShape(token string) error {
	token = strings.TrimSpace(token)
	if !IsIntegrationToken(token) {
		return errors.New("token does not have the expected prefix")
	}
	if len(token) != len(IntegrationTokenPrefix)+integrationTokenRandomBytes*2 {
		return errors.New("token has an unexpected length")
	}
	if _, err := hex.DecodeString(token[len(IntegrationTokenPrefix):]); err != nil {
		return errors.New("token body is not valid hex")
	}
	return nil
}
