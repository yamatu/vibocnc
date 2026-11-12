package models

import "time"

// TurnstileSetting stores the Cloudflare Turnstile (human verification) keys.
// Single-row table (ID=1); the secret key is encrypted at rest and never
// serialized.
type TurnstileSetting struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	Enabled      bool      `json:"enabled" gorm:"default:false"`
	SiteKey      string    `json:"site_key" gorm:"size:255;default:''"`
	SecretKeyEnc string    `json:"-" gorm:"type:text"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type TurnstileAdminConfig struct {
	ID           uint      `json:"id"`
	Enabled      bool      `json:"enabled"`
	SiteKey      string    `json:"site_key"`
	HasSecretKey bool      `json:"has_secret_key"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type TurnstilePublicConfig struct {
	Enabled bool   `json:"enabled"`
	SiteKey string `json:"site_key"`
}

// IsActive reports whether verification is enforced. Both keys are required;
// a half-configured setting would otherwise lock every visitor out.
func (s *TurnstileSetting) IsActive() bool {
	return s != nil && s.Enabled && s.SiteKey != "" && s.SecretKeyEnc != ""
}

func (s *TurnstileSetting) ToAdminConfig() TurnstileAdminConfig {
	return TurnstileAdminConfig{
		ID:           s.ID,
		Enabled:      s.Enabled,
		SiteKey:      s.SiteKey,
		HasSecretKey: s.SecretKeyEnc != "",
		Active:       s.IsActive(),
		CreatedAt:    s.CreatedAt,
		UpdatedAt:    s.UpdatedAt,
	}
}

func (s *TurnstileSetting) ToPublicConfig() TurnstilePublicConfig {
	if !s.IsActive() {
		return TurnstilePublicConfig{}
	}
	return TurnstilePublicConfig{Enabled: true, SiteKey: s.SiteKey}
}
