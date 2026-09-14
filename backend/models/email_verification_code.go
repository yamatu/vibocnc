package models

import "time"

// EmailVerificationCode stores short-lived verification codes.
// CodeHash is a bcrypt hash of the code.
type EmailVerificationCode struct {
	ID uint `json:"id" gorm:"primaryKey"`

	Email   string `json:"email" gorm:"size:255;index;not null"`
	Purpose string `json:"purpose" gorm:"size:32;index;not null"` // register | reset | admin_reset

	CodeHash  string     `json:"-" gorm:"size:255;not null"`
	ExpiresAt time.Time  `json:"expires_at" gorm:"index;not null"`
	UsedAt    *time.Time `json:"used_at" gorm:"index"`

	// Attempts counts failed verification tries. The code is invalidated once
	// this reaches services.MaxVerificationAttempts so a 6-digit code cannot be
	// brute forced within its validity window.
	Attempts int `json:"attempts" gorm:"not null;default:0"`

	CreatedAt time.Time `json:"created_at"`
}
