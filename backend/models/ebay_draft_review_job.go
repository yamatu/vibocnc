package models

import "time"

// EbayDraftReviewJob tracks an automated review pass over a batch of scraped
// eBay drafts.
type EbayDraftReviewJob struct {
	ID     string `json:"id" gorm:"size:36;primaryKey"`
	Status string `json:"status" gorm:"size:20;not null;default:'queued';index"`

	Total     int `json:"total" gorm:"not null;default:0"`
	Processed int `json:"processed" gorm:"not null;default:0"`
	Ready     int `json:"ready" gorm:"not null;default:0"`
	Rejected  int `json:"rejected" gorm:"not null;default:0"`
	Failed    int `json:"failed" gorm:"not null;default:0"`

	// CategoryMode is "source" for an eBay/B-Automation source taxonomy and
	// "mixed" for the existing brand > component-type catalogue.
	CategoryMode string `json:"category_mode" gorm:"size:20;not null;default:'source';index"`
	AutoPublish  bool   `json:"auto_publish" gorm:"not null;default:false"`
	Imported     int    `json:"imported" gorm:"not null;default:0"`
	ImportFailed int    `json:"import_failed" gorm:"not null;default:0"`

	Stage   string `json:"stage" gorm:"size:255"`
	Message string `json:"message" gorm:"type:text"`
	Error   string `json:"error" gorm:"type:text"`

	WorkerToken string `json:"-" gorm:"size:64;index"`

	CreatedByID uint       `json:"created_by_id" gorm:"index"`
	CreatedAt   time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt   time.Time  `json:"updated_at"`
	StartedAt   *time.Time `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at"`
}

// EbayDraftReviewJobItem is one draft inside a review job.
type EbayDraftReviewJobItem struct {
	ID      uint   `json:"id" gorm:"primaryKey"`
	JobID   string `json:"job_id" gorm:"size:36;not null;index:idx_ebay_review_items_job_status,priority:1"`
	DraftID uint   `json:"draft_id" gorm:"not null;index"`
	Model   string `json:"model" gorm:"size:160"`
	Title   string `json:"title" gorm:"size:255"`

	Status  string `json:"status" gorm:"size:20;not null;default:'queued';index:idx_ebay_review_items_job_status,priority:2"`
	Level   string `json:"level" gorm:"size:16;default:'info'"`
	Message string `json:"message" gorm:"type:text"`
	Error   string `json:"error" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
