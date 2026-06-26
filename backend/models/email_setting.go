package models

import "time"

// EmailSetting stores outbound email configuration.
// This is a single-row table (ID=1) managed from the admin panel.
//
// Provider currently supports "smtp" (works with Poste.io, AliMail, etc.).
// Secrets (smtp_password) are stored in DB; if SETTINGS_ENCRYPTION_KEY is set,
// the backend will store them encrypted.
type EmailSetting struct {
	ID uint `json:"id" gorm:"primaryKey"`

	Enabled  bool   `json:"enabled" gorm:"default:false"`
	Provider string `json:"provider" gorm:"size:32;default:'smtp'"`

	FromName  string `json:"from_name" gorm:"size:128;default:'VIBO CNC'"`
	FromEmail string `json:"from_email" gorm:"size:255;default:''"`
	ReplyTo   string `json:"reply_to" gorm:"size:255;default:''"`

	SMTPHost     string `json:"smtp_host" gorm:"size:255;default:''"`
	SMTPPort     int    `json:"smtp_port" gorm:"default:587"`
	SMTPUsername string `json:"smtp_username" gorm:"size:255;default:''"`
	// SMTPPassword may be plain text or encrypted payload, depending on server config.
	SMTPPassword string `json:"smtp_password" gorm:"type:text"`
	// SMTPTLSMode: "starttls" (default) | "ssl" | "none"
	SMTPTLSMode string `json:"smtp_tls_mode" gorm:"size:16;default:'starttls'"`

	// Resend provider
	ResendAPIKey string `json:"resend_api_key" gorm:"type:text"`
	// Optional: used to verify inbound webhook signatures.
	ResendWebhookSecret string `json:"resend_webhook_secret" gorm:"type:text"`

	VerificationEnabled          bool `json:"verification_enabled" gorm:"default:false"`
	MarketingEnabled             bool `json:"marketing_enabled" gorm:"default:false"`
	ShippingNotificationsEnabled bool `json:"shipping_notifications_enabled" gorm:"default:true"`
	// Legacy: kept for backward compatibility. If enabled and the new toggles are both false,
	// the backend will treat both order-created and order-paid notifications as enabled.
	OrderNotificationsEnabled bool `json:"order_notifications_enabled" gorm:"default:false"`

	OrderCreatedNotificationsEnabled bool `json:"order_created_notifications_enabled" gorm:"default:false"`
	OrderPaidNotificationsEnabled    bool `json:"order_paid_notifications_enabled" gorm:"default:false"`
	// Admin notification recipients (comma/newline separated emails)
	OrderNotificationEmails string `json:"order_notification_emails" gorm:"type:text"`

	CodeExpiryMinutes int `json:"code_expiry_minutes" gorm:"default:10"`
	CodeResendSeconds int `json:"code_resend_seconds" gorm:"default:60"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type EmailPublicConfig struct {
	Enabled                      bool   `json:"enabled"`
	Provider                     string `json:"provider"`
	VerificationEnabled          bool   `json:"verification_enabled"`
	MarketingEnabled             bool   `json:"marketing_enabled"`
	ShippingNotificationsEnabled bool   `json:"shipping_notifications_enabled"`
	CodeExpiryMinutes            int    `json:"code_expiry_minutes"`
	CodeResendSeconds            int    `json:"code_resend_seconds"`
}

func (s *EmailSetting) ToPublicConfig() EmailPublicConfig {
	provider := s.Provider
	if provider == "" {
		provider = "smtp"
	}
	exp := s.CodeExpiryMinutes
	if exp <= 0 {
		exp = 10
	}
	resend := s.CodeResendSeconds
	if resend <= 0 {
		resend = 60
	}
	return EmailPublicConfig{
		Enabled:                      s.Enabled,
		Provider:                     provider,
		VerificationEnabled:          s.VerificationEnabled,
		MarketingEnabled:             s.MarketingEnabled,
		ShippingNotificationsEnabled: s.ShippingNotificationsEnabled,
		CodeExpiryMinutes:            exp,
		CodeResendSeconds:            resend,
	}
}
