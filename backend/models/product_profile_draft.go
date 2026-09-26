package models

import "time"

// ProductProfileDraft is the review boundary between AI product identification
// and public catalogue content.
//
// Identification may read eBay evidence and propose brand/type/copy, but it
// never writes a product. An administrator must approve this row explicitly.
// Cited specifications are still not written by approval: they are converted
// into a pending ProductSpecDraft and pass through the existing spec review
// queue independently.
type ProductProfileDraft struct {
	ID        uint   `json:"id" gorm:"primaryKey"`
	ProductID uint   `json:"product_id" gorm:"index"`
	QuoteID   uint   `json:"quote_id" gorm:"index"`
	JobID     string `json:"job_id,omitempty" gorm:"size:36;index"`

	SKU   string `json:"sku,omitempty" gorm:"size:120;index"`
	Brand string `json:"brand,omitempty" gorm:"size:120;index"`
	Model string `json:"model" gorm:"size:160;index"`

	// pending | approved | rejected | superseded.
	Status     string  `json:"status" gorm:"size:24;index"`
	Confidence float64 `json:"confidence" gorm:"type:decimal(5,4)"`

	ProposedTitle        string `json:"proposed_title,omitempty" gorm:"size:255"`
	ProposedCategoryName string `json:"proposed_category_name,omitempty" gorm:"size:160"`
	CurrentNameSnapshot  string `json:"current_name_snapshot,omitempty" gorm:"size:255"`
	// ProductUpdatedAt is a stale-write guard. Approval refuses a product that
	// changed after this draft unless the administrator explicitly forces it.
	ProductUpdatedAt *time.Time `json:"product_updated_at,omitempty"`

	ProfileJSON  string `json:"-" gorm:"type:longtext"`
	ContentJSON  string `json:"-" gorm:"type:longtext"`
	EvidenceJSON string `json:"-" gorm:"type:longtext"`

	Reason string `json:"reason,omitempty" gorm:"type:text"`

	RequestedBy uint       `json:"requested_by,omitempty" gorm:"index"`
	ReviewedBy  uint       `json:"reviewed_by,omitempty" gorm:"index"`
	ReviewedAt  *time.Time `json:"reviewed_at,omitempty"`
	AppliedAt   *time.Time `json:"applied_at,omitempty"`

	AppliedFieldsJSON string `json:"-" gorm:"type:longtext"`
	SpecDraftID       *uint  `json:"spec_draft_id,omitempty" gorm:"index"`
	RejectReason      string `json:"reject_reason,omitempty" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at" gorm:"index"`
	UpdatedAt time.Time `json:"updated_at"`
}
