package models

import "time"

// ProductSpecDraft is the review queue for parameters that were researched from
// a model number. Nothing in this table is public: a draft only reaches the
// product's technical_specs column after an administrator approves it, and the
// cited sources travel with the values so the decision stays auditable.
type ProductSpecDraft struct {
	ID uint `json:"id" gorm:"primaryKey"`
	// ProductID is 0 when the research was started from a bare model number
	// (for example while preparing a listing that does not exist yet).
	ProductID uint   `json:"product_id" gorm:"index"`
	SKU       string `json:"sku,omitempty" gorm:"size:120;index"`
	Brand     string `json:"brand,omitempty" gorm:"size:120;index"`
	// Model is the exact identifier (型号) the research was performed for.
	Model string `json:"model" gorm:"size:160;index"`
	// Status is pending | approved | rejected | superseded.
	Status string `json:"status" gorm:"size:24;index"`
	// Confidence is high | medium | low, derived from the source mix.
	Confidence string `json:"confidence,omitempty" gorm:"size:16"`
	// SpecsJSON holds the proposed parameters as a flat JSON object.
	SpecsJSON string `json:"specs_json,omitempty" gorm:"type:json"`
	// CandidatesJSON keeps the per-value provenance (label, value, source URL,
	// source type, evidence snippet).
	CandidatesJSON string `json:"candidates_json,omitempty" gorm:"type:json"`
	// EvidenceJSON keeps the raw public evidence that was collected.
	EvidenceJSON string `json:"evidence_json,omitempty" gorm:"type:json"`
	Notes        string `json:"notes,omitempty" gorm:"type:text"`
	// JobID links a draft back to the batch job that produced it.
	JobID        string     `json:"job_id,omitempty" gorm:"size:36;index"`
	RequestedBy  uint       `json:"requested_by,omitempty"`
	ReviewedBy   uint       `json:"reviewed_by,omitempty"`
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty"`
	AppliedAt    *time.Time `json:"applied_at,omitempty"`
	RejectReason string     `json:"reject_reason,omitempty" gorm:"type:text"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}
