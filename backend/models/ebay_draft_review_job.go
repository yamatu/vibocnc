package models

import "time"

// EbayDraftReviewJob tracks an automated review pass over a batch of scraped
// eBay drafts.
//
// This is deliberately separate from AIAgentSEOJob. Those jobs are keyed on a
// product id and their items are products; a review pass runs before any
// product exists, so reusing that table would mean storing a zero product id
// for every row. A dedicated table also keeps the AI SEO history about
// published products, which is what an administrator looks at it for.
type EbayDraftReviewJob struct {
	ID     string `json:"id" gorm:"size:36;primaryKey"`
	Status string `json:"status" gorm:"size:20;not null;default:'queued';index"` // queued, running, paused, completed, completed_with_errors, failed, cancelled

	Total     int `json:"total" gorm:"not null;default:0"`
	Processed int `json:"processed" gorm:"not null;default:0"`
	// Ready counts drafts that produced an approvable proposal.
	Ready int `json:"ready" gorm:"not null;default:0"`
	// Rejected counts drafts the pass declined (missing identifier, model
	// mismatch, no category). They stay in the queue for a human.
	Rejected int `json:"rejected" gorm:"not null;default:0"`
	Failed   int `json:"failed" gorm:"not null;default:0"`

	// Stage is a human-readable line describing the current work, so a long run
	// is not a silent progress bar.
	Stage   string `json:"stage" gorm:"size:255"`
	Message string `json:"message" gorm:"type:text"`
	Error   string `json:"error" gorm:"type:text"`

	// WorkerToken identifies the worker allowed to advance this job. A paused or
	// superseded run cannot keep writing.
	WorkerToken string `json:"-" gorm:"size:64;index"`

	CreatedByID uint       `json:"created_by_id" gorm:"index"`
	CreatedAt   time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt   time.Time  `json:"updated_at"`
	StartedAt   *time.Time `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at"`
}

// EbayDraftReviewJobItem is one draft inside a review job.
//
// The log line is stored per item so the page can render the run as a log
// rather than a single percentage, which is what makes a failure diagnosable
// after the fact.
type EbayDraftReviewJobItem struct {
	ID    uint   `json:"id" gorm:"primaryKey"`
	JobID string `json:"job_id" gorm:"size:36;not null;index:idx_ebay_review_items_job_status,priority:1"`

	DraftID uint   `json:"draft_id" gorm:"not null;index"`
	Model   string `json:"model" gorm:"size:160"`
	Title   string `json:"title" gorm:"size:255"`

	Status string `json:"status" gorm:"size:20;not null;default:'queued';index:idx_ebay_review_items_job_status,priority:2"` // queued, running, ready, rejected, failed
	// Level drives the log styling: info, success, warn, error.
	Level   string `json:"level" gorm:"size:16;default:'info'"`
	Message string `json:"message" gorm:"type:text"`
	Error   string `json:"error" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
