package models

import "time"

// AIAgentSetting is the single persisted configuration row for the catalog AI.
// APIKeyEnc is encrypted at rest and intentionally excluded from every JSON response.
type AIAgentSetting struct {
	ID uint `json:"id" gorm:"primaryKey"`

	ActiveProfileID *uint  `json:"active_profile_id,omitempty" gorm:"index"`
	Enabled         bool   `json:"enabled" gorm:"default:false"`
	BaseURL         string `json:"base_url" gorm:"size:500;default:'https://api.openai.com/v1'"`
	APIKeyEnc       string `json:"-" gorm:"type:text"`
	Model           string `json:"model" gorm:"size:120;default:'gpt-5.6-terra'"`
	APIMode         string `json:"api_mode" gorm:"size:32;default:'standard_chat'"`
	ReasoningEffort string `json:"reasoning_effort" gorm:"size:32;default:'medium'"`
	TimeoutSeconds  int    `json:"timeout_seconds" gorm:"default:75"`
	// SEOJobConcurrency limits parallel product requests made by one AI SEO job.
	// It is deliberately capped by the controller so a large candidate job cannot
	// exhaust an OpenAI-compatible provider's rate limit.
	SEOJobConcurrency int `json:"seo_job_concurrency" gorm:"default:2"`
	// MaxConcurrentJobs is the global ceiling on how many AI tasks run at the
	// same time, across every task kind: product SEO jobs, category optimization
	// jobs, spec research jobs and AI assistant turns all hold one slot each.
	// SEOJobConcurrency answers "how many workers inside one task"; this answers
	// "how many tasks at all".
	MaxConcurrentJobs int `json:"max_concurrent_jobs" gorm:"default:4"`
	// AgentHistoryLimit is how many previous chat turns are replayed into the
	// assistant context. A larger window lets one instruction refer to models
	// listed several messages earlier instead of re-pasting them.
	AgentHistoryLimit int `json:"agent_history_limit" gorm:"default:24"`
	// SEOCandidateLimit is the persisted safety ceiling for automatic candidate
	// selection. Administrators can lower it, but never raise it above 30,000.
	SEOCandidateLimit int `json:"seo_candidate_limit" gorm:"default:30000"`
	// Product creation defaults are administrator-owned business values. AI may
	// propose catalog content, but it never supplies or overrides these fields.
	DefaultProductPrice   float64 `json:"default_product_price" gorm:"type:decimal(10,2);default:0.00"`
	DefaultWarrantyPeriod string  `json:"default_warranty_period" gorm:"size:50;default:'12 months'"`
	DefaultLeadTime       string  `json:"default_lead_time" gorm:"size:50;default:'4-5 DAYS'"`
	// AutoPublishNewProducts decides the state of an administrator-approved
	// product created by the assistant: true stores it live (is_active = 1),
	// false keeps it as an unpublished draft.
	AutoPublishNewProducts bool `json:"auto_publish_new_products" gorm:"default:true"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AIAgentSettingResponse is safe for the browser: the encrypted secret never leaves Go.
type AIAgentSettingResponse struct {
	ActiveProfileID        *uint     `json:"active_profile_id,omitempty"`
	ActiveProfileName      string    `json:"active_profile_name,omitempty"`
	Enabled                bool      `json:"enabled"`
	BaseURL                string    `json:"base_url"`
	HasAPIKey              bool      `json:"has_api_key"`
	Model                  string    `json:"model"`
	APIMode                string    `json:"api_mode"`
	ReasoningEffort        string    `json:"reasoning_effort"`
	TimeoutSeconds         int       `json:"timeout_seconds"`
	SEOJobConcurrency      int       `json:"seo_job_concurrency"`
	MaxConcurrentJobs      int       `json:"max_concurrent_jobs"`
	AgentHistoryLimit      int       `json:"agent_history_limit"`
	SEOCandidateLimit      int       `json:"seo_candidate_limit"`
	DefaultProductPrice    float64   `json:"default_product_price"`
	DefaultWarrantyPeriod  string    `json:"default_warranty_period"`
	DefaultLeadTime        string    `json:"default_lead_time"`
	AutoPublishNewProducts bool      `json:"auto_publish_new_products"`
	UpdatedAt              time.Time `json:"updated_at"`
}

func (s *AIAgentSetting) ToResponse() AIAgentSettingResponse {
	apiMode := s.APIMode
	if apiMode == "" {
		apiMode = "standard_chat"
	}
	return AIAgentSettingResponse{
		ActiveProfileID:        s.ActiveProfileID,
		Enabled:                s.Enabled,
		BaseURL:                s.BaseURL,
		HasAPIKey:              s.APIKeyEnc != "",
		Model:                  s.Model,
		APIMode:                apiMode,
		ReasoningEffort:        s.ReasoningEffort,
		TimeoutSeconds:         s.TimeoutSeconds,
		SEOJobConcurrency:      s.SEOJobConcurrency,
		MaxConcurrentJobs:      s.MaxConcurrentJobs,
		AgentHistoryLimit:      s.AgentHistoryLimit,
		SEOCandidateLimit:      s.SEOCandidateLimit,
		DefaultProductPrice:    s.DefaultProductPrice,
		DefaultWarrantyPeriod:  s.DefaultWarrantyPeriod,
		DefaultLeadTime:        s.DefaultLeadTime,
		AutoPublishNewProducts: s.AutoPublishNewProducts,
		UpdatedAt:              s.UpdatedAt,
	}
}
