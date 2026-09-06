package models

import "time"

// AIAgentSEOJob records an explicit selection, a bounded automatic SEO batch,
// or an administrator-only category optimization task. Every mode remains
// auditable item-by-item.
type AIAgentSEOJob struct {
	ID            string `json:"id" gorm:"primaryKey;size:36"`
	Prompt        string `json:"prompt" gorm:"type:text"`
	SelectionMode string `json:"selection_mode" gorm:"size:32;default:'selected'"` // selected, auto_candidates, auto_failed, category_optimization
	Status        string `json:"status" gorm:"size:32;index;not null"`             // queued, running, paused, cancelled, completed, completed_with_errors, failed
	// AIProfileID pins queued and resumed work to the profile selected when the
	// job was created. Name/model snapshots keep completed jobs auditable even
	// after a profile is renamed or deleted.
	AIProfileID   *uint  `json:"ai_profile_id,omitempty" gorm:"column:ai_profile_id;index"`
	AIProfileName string `json:"ai_profile_name,omitempty" gorm:"column:ai_profile_name;size:80"`
	AIModel       string `json:"ai_model,omitempty" gorm:"size:120"`
	AIAPIMode     string `json:"ai_api_mode,omitempty" gorm:"size:32"`
	// WorkerToken fences an older worker after a pause/resume race. It is an
	// internal execution lease, deliberately never returned to the browser.
	WorkerToken string              `json:"-" gorm:"size:36;index"`
	Total       int                 `json:"total"`
	Processed   int                 `json:"processed"`
	Succeeded   int                 `json:"succeeded"`
	Failed      int                 `json:"failed"`
	CreatedByID uint                `json:"created_by_id;index"`
	Error       string              `json:"error" gorm:"type:text"`
	CreatedAt   time.Time           `json:"created_at"`
	StartedAt   *time.Time          `json:"started_at"`
	CompletedAt *time.Time          `json:"completed_at"`
	Items       []AIAgentSEOJobItem `json:"items,omitempty" gorm:"foreignKey:JobID"`
}

type AIAgentSEOJobItem struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	JobID     string    `json:"job_id" gorm:"size:36;index;not null"`
	ProductID uint      `json:"product_id" gorm:"index;not null"`
	SKU       string    `json:"sku" gorm:"size:100"`
	Status    string    `json:"status" gorm:"size:20;index;not null"` // queued, running, optimized, failed, cancelled
	Error     string    `json:"error" gorm:"type:text"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AIAgentSEOStats struct {
	Total        int64 `json:"total"`
	Optimized    int64 `json:"optimized"`
	NotOptimized int64 `json:"not_optimized"`
	Failed       int64 `json:"failed"`
	Running      int64 `json:"running"`
}
