package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"gorm.io/gorm"
)

var turnstileVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

var turnstileHTTPClient = &http.Client{Timeout: 10 * time.Second}

var (
	ErrTurnstileMissingToken = errors.New("turnstile token is required")
	ErrTurnstileRejected     = errors.New("turnstile verification failed")
)

func GetOrCreateTurnstileSetting(db *gorm.DB) (*models.TurnstileSetting, error) {
	var s models.TurnstileSetting
	err := db.First(&s, 1).Error
	if err == nil {
		return &s, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	s = models.TurnstileSetting{ID: 1}
	if err := db.Create(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// VerifyTurnstileIfEnabled enforces Turnstile only when the administrator has
// enabled it with both keys; otherwise it is a no-op.
func VerifyTurnstileIfEnabled(ctx context.Context, db *gorm.DB, token, remoteIP string) error {
	s, err := GetOrCreateTurnstileSetting(db)
	if err != nil {
		return err
	}
	if !s.IsActive() {
		return nil
	}
	secret, err := utils.DecryptSecret(s.SecretKeyEnc)
	if err != nil {
		return fmt.Errorf("decrypt turnstile secret: %w", err)
	}
	return VerifyTurnstileToken(ctx, secret, token, remoteIP)
}

func VerifyTurnstileToken(ctx context.Context, secret, token, remoteIP string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrTurnstileMissingToken
	}
	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, turnstileVerifyURL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := turnstileHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("turnstile siteverify request: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("turnstile siteverify response: %w", err)
	}
	if !result.Success {
		return fmt.Errorf("%w: %s", ErrTurnstileRejected, strings.Join(result.ErrorCodes, ","))
	}
	return nil
}
