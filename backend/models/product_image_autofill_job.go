package models

import "time"

// ProductImageAutofillJob records a restart-safe background task that assigns
// SKU-based fallback image URLs to products whose image list is still empty.
// The generated JPEG itself is rendered lazily on first request, so a large
// catalogue does not spend minutes rendering images that may never be viewed.
type ProductImageAutofillJob struct {
	ID                 string     `json:"id" gorm:"primaryKey;size:36"`
	Status             string     `json:"status" gorm:"size:32;index;not null"` // queued, running, paused, completed, completed_with_errors, failed
	Brand              string     `json:"brand" gorm:"size:100;index"`
	CategoryID         uint       `json:"category_id" gorm:"index"`
	IncludeDescendants bool       `json:"include_descendants"`
	ProductStatus      string     `json:"product_status" gorm:"size:16"`
	BatchSize          int        `json:"batch_size"`
	MaxProductID       uint       `json:"max_product_id"`
	LastProductID      uint       `json:"last_product_id"`
	ImageVersion       string     `json:"image_version" gorm:"size:32"`
	WorkerToken        string     `json:"-" gorm:"size:36;index"`
	Total              int        `json:"total"`
	Processed          int        `json:"processed"`
	Updated            int        `json:"updated"`
	Skipped            int        `json:"skipped"`
	Failed             int        `json:"failed"`
	Message            string     `json:"message" gorm:"size:255"`
	Error              string     `json:"error" gorm:"type:text"`
	CreatedByID        uint       `json:"created_by_id" gorm:"index"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	StartedAt          *time.Time `json:"started_at"`
	CompletedAt        *time.Time `json:"completed_at"`
}
