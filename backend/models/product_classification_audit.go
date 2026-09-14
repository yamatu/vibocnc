package models

import "time"

// ProductClassificationAudit preserves the evidence and decision path used by
// automatic taxonomy work. It is append-only from the application point of
// view so a later category correction can be traced back to its inputs.
//
// The audit trail is also the source of learned classification rules, so the
// status/brand/model triple is indexed: without it the lookup that rebuilds the
// rule cache has to group the whole table.
type ProductClassificationAudit struct {
	ID        uint   `json:"id" gorm:"primaryKey"`
	ProductID uint   `json:"product_id" gorm:"index;not null"`
	JobID     string `json:"job_id,omitempty" gorm:"size:36;index"`
	Model     string `json:"model" gorm:"size:160;index:idx_pca_status_brand_model,priority:3"`
	// BrandInput keeps the brand as it arrived from the upload, so a corrected
	// brand can be traced back to what the source actually claimed.
	BrandInput string `json:"brand_input" gorm:"size:120"`
	Brand      string `json:"brand" gorm:"size:120;index:idx_pca_status_brand_model,priority:2"`
	// ProductType stores the canonical type name, so learned rules do not have
	// to re-canonicalise every historical row.
	ProductType  string    `json:"product_type" gorm:"size:120"`
	Status       string    `json:"status" gorm:"size:24;index;index:idx_pca_status_brand_model,priority:1"`
	MatchRule    string    `json:"match_rule" gorm:"size:180"`
	CategoryID   uint      `json:"category_id,omitempty"`
	CategoryPath string    `json:"category_path,omitempty" gorm:"size:500"`
	EvidenceJSON string    `json:"evidence_json,omitempty" gorm:"type:text"`
	Reason       string    `json:"reason,omitempty" gorm:"type:text"`
	CreatedAt    time.Time `json:"created_at"`
}
