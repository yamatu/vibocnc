package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
)

const (
	encPrefixV1 = "v1:"

	// EncryptionKeyHint is appended to every key error: the backend cannot invent
	// a key, and the administrator cannot see the value, so the message must say
	// exactly what to run and what it costs to rotate it.
	EncryptionKeyHint = "generate one with `openssl rand -hex 32` (or `python -c \"import secrets;print(secrets.token_hex(32))\"`), " +
		"set SETTINGS_ENCRYPTION_KEY in the backend environment and restart the service; " +
		"any secret already saved (AI keys, PayPal, SMTP password) must be entered again afterwards"
)

var (
	// ErrEncryptionKeyMissing and ErrEncryptionKeyInvalid let callers answer with
	// an actionable message instead of a generic "invalid request".
	ErrEncryptionKeyMissing = errors.New("SETTINGS_ENCRYPTION_KEY is not set")
	ErrEncryptionKeyInvalid = errors.New("SETTINGS_ENCRYPTION_KEY must decode to 32 bytes (raw 32 chars, base64 or hex)")
)

// ValidateEncryptionKey reports whether the configured key can be used at all.
// Startup calls it so a broken key is visible before an administrator saves one.
func ValidateEncryptionKey() error {
	_, err := getEncryptionKey()
	return err
}

// getEncryptionKey reads SETTINGS_ENCRYPTION_KEY from env.
// Accepted formats:
// - 32 raw ASCII chars (length 32)
// - base64 (decodes to 32 bytes)
// - hex (decodes to 32 bytes)
func getEncryptionKey() ([]byte, error) {
	v := strings.TrimSpace(os.Getenv("SETTINGS_ENCRYPTION_KEY"))
	if v == "" {
		return nil, ErrEncryptionKeyMissing
	}
	// Raw 32-byte string
	if len(v) == 32 {
		return []byte(v), nil
	}
	// Try base64
	if b, err := base64.StdEncoding.DecodeString(v); err == nil {
		if len(b) == 32 {
			return b, nil
		}
	}
	// Try hex
	if b, err := hex.DecodeString(v); err == nil {
		if len(b) == 32 {
			return b, nil
		}
	}
	return nil, ErrEncryptionKeyInvalid
}

// EncryptSecret encrypts plaintext into a versioned string suitable for DB storage.
func EncryptSecret(plaintext string) (string, error) {
	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ct := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	buf := append(nonce, ct...)
	return encPrefixV1 + base64.StdEncoding.EncodeToString(buf), nil
}

// DecryptSecret decrypts a string previously returned by EncryptSecret.
func DecryptSecret(enc string) (string, error) {
	enc = strings.TrimSpace(enc)
	if enc == "" {
		return "", errors.New("empty secret")
	}
	if !strings.HasPrefix(enc, encPrefixV1) {
		return "", errors.New("unsupported secret format")
	}

	payloadB64 := strings.TrimPrefix(enc, encPrefixV1)
	payload, err := base64.StdEncoding.DecodeString(payloadB64)
	if err != nil {
		return "", err
	}

	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	ns := gcm.NonceSize()
	if len(payload) < ns {
		return "", errors.New("invalid secret payload")
	}
	nonce := payload[:ns]
	ct := payload[ns:]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
