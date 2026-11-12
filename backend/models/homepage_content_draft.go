package models

import (
	"time"

	"gorm.io/datatypes"
)

// HomepageContentDraft holds an administrator's unsaved edits for one homepage
// section. Only the admin preview reads drafts; the public page never does.
type HomepageContentDraft struct {
	ID         uint           `json:"id" gorm:"primaryKey"`
	UserID     uint           `json:"user_id" gorm:"not null;uniqueIndex:idx_homepage_draft_user_section,priority:1"`
	SectionKey string         `json:"section_key" gorm:"size:255;not null;uniqueIndex:idx_homepage_draft_user_section,priority:2"`
	Payload    datatypes.JSON `json:"payload" gorm:"type:json"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
}
