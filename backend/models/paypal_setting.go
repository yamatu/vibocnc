package models

import "time"

// PayPalSetting stores PayPal configuration.
//
// This is a single-row table (ID=1) so the admin UI can update it easily.
// Client secrets are encrypted at rest and never included in JSON responses.
type PayPalSetting struct {
	ID uint `json:"id" gorm:"primaryKey"`

	Enabled bool `json:"enabled" gorm:"default:false"`

	// Mode selects which Client ID is used.
	// Allowed: "sandbox" | "live"
	Mode string `json:"mode" gorm:"size:16;default:'sandbox'"`

	ClientIDSandbox        string `json:"client_id_sandbox" gorm:"size:255;default:''"`
	ClientIDLive           string `json:"client_id_live" gorm:"size:255;default:''"`
	ClientSecretSandboxEnc string `json:"-" gorm:"type:text"`
	ClientSecretLiveEnc    string `json:"-" gorm:"type:text"`

	// WebhookID is the PayPal webhook identifier used to verify inbound
	// webhook signatures. It is not a secret, but webhook reconciliation is
	// disabled until it is configured.
	WebhookID string `json:"webhook_id" gorm:"size:255;default:''"`

	Currency string `json:"currency" gorm:"size:10;default:'USD'"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type PayPalAdminConfig struct {
	ID                     uint      `json:"id"`
	Enabled                bool      `json:"enabled"`
	Mode                   string    `json:"mode"`
	ClientIDSandbox        string    `json:"client_id_sandbox"`
	ClientIDLive           string    `json:"client_id_live"`
	HasClientSecretSandbox bool      `json:"has_client_secret_sandbox"`
	HasClientSecretLive    bool      `json:"has_client_secret_live"`
	WebhookID              string    `json:"webhook_id"`
	Currency               string    `json:"currency"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

func (s *PayPalSetting) ToAdminConfig() PayPalAdminConfig {
	return PayPalAdminConfig{
		ID:                     s.ID,
		Enabled:                s.Enabled,
		Mode:                   s.Mode,
		ClientIDSandbox:        s.ClientIDSandbox,
		ClientIDLive:           s.ClientIDLive,
		HasClientSecretSandbox: s.ClientSecretSandboxEnc != "",
		HasClientSecretLive:    s.ClientSecretLiveEnc != "",
		WebhookID:              s.WebhookID,
		Currency:               s.Currency,
		CreatedAt:              s.CreatedAt,
		UpdatedAt:              s.UpdatedAt,
	}
}

func (s *PayPalSetting) EffectiveClientID() string {
	if s == nil {
		return ""
	}
	if s.Mode == "live" {
		return s.ClientIDLive
	}
	return s.ClientIDSandbox
}

type PayPalPublicConfig struct {
	Enabled  bool   `json:"enabled"`
	Mode     string `json:"mode"`
	ClientID string `json:"client_id"`
	Currency string `json:"currency"`
}

func (s *PayPalSetting) ToPublicConfig() PayPalPublicConfig {
	mode := s.Mode
	if mode != "live" {
		mode = "sandbox"
	}
	cur := s.Currency
	if cur == "" {
		cur = "USD"
	}
	return PayPalPublicConfig{
		Enabled:  s.Enabled,
		Mode:     mode,
		ClientID: s.EffectiveClientID(),
		Currency: cur,
	}
}
