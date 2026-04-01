package models

import "time"

// IndexNowSetting stores IndexNow/Bing submission settings.
// The verification key is intentionally stored as plain text because it must
// be publicly reachable as a text file at the site root.
type IndexNowSetting struct {
	ID uint `json:"id" gorm:"primaryKey"`

	Enabled bool `json:"enabled" gorm:"default:false"`

	Key string `json:"key" gorm:"size:128;default:'';index"`

	// Optional override. If blank, SITE_URL env is used.
	SiteURL string `json:"site_url" gorm:"size:255;default:''"`

	// When true, product create/update will best-effort submit the canonical URL.
	AutoSubmitProductUpdates bool `json:"auto_submit_product_updates" gorm:"default:true"`

	LastSubmittedAt    *time.Time `json:"last_submitted_at"`
	LastSubmissionHost string     `json:"last_submission_host" gorm:"size:255;default:''"`
	LastSubmissionURLs int        `json:"last_submission_urls" gorm:"default:0"`
	LastSubmissionCode int        `json:"last_submission_code" gorm:"default:0"`
	LastSubmissionNote string     `json:"last_submission_note" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type IndexNowSettingResponse struct {
	ID uint `json:"id"`

	Enabled bool   `json:"enabled"`
	Key     string `json:"key"`
	SiteURL string `json:"site_url"`

	AutoSubmitProductUpdates bool `json:"auto_submit_product_updates"`

	KeyLocation string `json:"key_location"`
	Host        string `json:"host"`

	LastSubmittedAt    *time.Time `json:"last_submitted_at"`
	LastSubmissionHost string     `json:"last_submission_host"`
	LastSubmissionURLs int        `json:"last_submission_urls"`
	LastSubmissionCode int        `json:"last_submission_code"`
	LastSubmissionNote string     `json:"last_submission_note"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
