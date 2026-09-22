package models

import "time"

// AIAgentPromptPreset is one reusable instruction kept in the assistant's prompt
// library. The administrator saves a prompt once (a long bulk-import
// instruction, a recurring audit request, a fixed SEO wording) and can then
// insert it into the chat box or copy it to the clipboard in one click instead
// of retyping it.
//
// Presets are plain text and administrator-owned: nothing here is interpreted
// by the server, it is only stored and handed back to the chat UI.
type AIAgentPromptPreset struct {
	ID        uint   `json:"id" gorm:"primaryKey"`
	Name      string `json:"name" gorm:"size:120;not null"`
	Content   string `json:"content" gorm:"type:text;not null"`
	Tags      string `json:"tags" gorm:"size:200"`
	SortOrder int    `json:"sort_order" gorm:"default:0;index"`
	// IsFavorite pins the preset to the top of the library.
	IsFavorite bool `json:"is_favorite" gorm:"default:false"`
	// UsageCount is a coarse popularity signal, bumped each time the preset is
	// inserted into the chat box.
	UsageCount int       `json:"usage_count" gorm:"default:0"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
