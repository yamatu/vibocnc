package models

import "time"

// AIAgentProfile stores one OpenAI-compatible provider/model configuration.
// The encrypted credential is never serialized; API responses expose only
// whether a credential has been saved.
type AIAgentProfile struct {
	ID uint `json:"id" gorm:"primaryKey"`

	Name            string `json:"name" gorm:"size:80;not null;uniqueIndex"`
	BaseURL         string `json:"base_url" gorm:"size:500;not null"`
	APIKeyEnc       string `json:"-" gorm:"type:text"`
	Model           string `json:"model" gorm:"size:120;not null"`
	APIMode         string `json:"api_mode" gorm:"size:32;not null;default:'standard_chat'"`
	ReasoningEffort string `json:"reasoning_effort" gorm:"size:32"`
	TimeoutSeconds  int    `json:"timeout_seconds" gorm:"default:75"`
	// WebSearchEnabled routes product web research through the DeepSeek Search
	// API with this profile's key. Only honoured for api.deepseek.com profiles.
	WebSearchEnabled bool `json:"web_search_enabled" gorm:"default:false"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AIAgentProfileResponse struct {
	ID               uint      `json:"id"`
	Name             string    `json:"name"`
	BaseURL          string    `json:"base_url"`
	HasAPIKey        bool      `json:"has_api_key"`
	Model            string    `json:"model"`
	APIMode          string    `json:"api_mode"`
	ReasoningEffort  string    `json:"reasoning_effort"`
	TimeoutSeconds   int       `json:"timeout_seconds"`
	WebSearchEnabled bool      `json:"web_search_enabled"`
	IsActive         bool      `json:"is_active"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (p *AIAgentProfile) ToResponse(activeProfileID *uint) AIAgentProfileResponse {
	apiMode := p.APIMode
	if apiMode == "" {
		apiMode = "standard_chat"
	}
	return AIAgentProfileResponse{
		ID:               p.ID,
		Name:             p.Name,
		BaseURL:          p.BaseURL,
		HasAPIKey:        p.APIKeyEnc != "",
		Model:            p.Model,
		APIMode:          apiMode,
		ReasoningEffort:  p.ReasoningEffort,
		TimeoutSeconds:   p.TimeoutSeconds,
		WebSearchEnabled: p.WebSearchEnabled,
		IsActive:         activeProfileID != nil && *activeProfileID == p.ID,
		CreatedAt:        p.CreatedAt,
		UpdatedAt:        p.UpdatedAt,
	}
}
