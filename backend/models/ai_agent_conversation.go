package models

import "time"

// AIAgentConversation is one persisted chat session of the admin AI
// assistant. The message list lives in the database instead of React state so
// it survives page navigations, browser refreshes and new tabs.
type AIAgentConversation struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Title     string    `json:"title" gorm:"size:255"`
	Status    string    `json:"status" gorm:"size:32;default:'idle';index"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AIAgentConversationMessage stores one user or assistant turn. The structured
// extras (step timeline, reviewable proposals, tool trace) are JSON blobs
// because they are only ever read back whole by the same chat UI that wrote
// them.
type AIAgentConversationMessage struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	ConversationID  uint      `json:"conversation_id" gorm:"index"`
	Role            string    `json:"role" gorm:"size:16"`
	Content         string    `json:"content" gorm:"type:longtext"`
	StepsJSON       string    `json:"-" gorm:"type:longtext"`
	SuggestionsJSON string    `json:"-" gorm:"type:longtext"`
	ToolCallsJSON   string    `json:"-" gorm:"type:longtext"`
	CreatedAt       time.Time `json:"created_at"`
}
