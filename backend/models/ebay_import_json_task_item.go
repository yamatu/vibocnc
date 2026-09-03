package models

import "time"

// EbayImportJSONTaskItem makes processing idempotent across worker retries.
// The unique task/fingerprint key closes the small crash window between draft
// creation and progress persistence without changing the existing drafts table.
type EbayImportJSONTaskItem struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	TaskID      string    `json:"task_id" gorm:"size:36;not null;uniqueIndex:idx_ebay_import_json_task_item_key,priority:1;index"`
	Fingerprint string    `json:"-" gorm:"size:64;not null;uniqueIndex:idx_ebay_import_json_task_item_key,priority:2"`
	Status      string    `json:"status" gorm:"size:24;not null;default:'completed';index"`
	DraftID     *uint     `json:"draft_id,omitempty" gorm:"index"`
	Error       string    `json:"error,omitempty" gorm:"type:text"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (EbayImportJSONTaskItem) TableName() string { return "ebay_import_json_task_items" }
