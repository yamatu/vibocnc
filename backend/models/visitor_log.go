package models

import "time"

// VisitorLog is an append-only table recording each page visit.
type VisitorLog struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	IPAddress   string    `gorm:"size:45;index" json:"ip_address"`
	Country     string    `gorm:"size:100" json:"country"`
	CountryCode string    `gorm:"size:10;index" json:"country_code"`
	Region      string    `gorm:"size:100" json:"region"`
	City        string    `gorm:"size:100" json:"city"`
	Latitude    float64   `gorm:"type:decimal(10,7)" json:"latitude"`
	Longitude   float64   `gorm:"type:decimal(10,7)" json:"longitude"`
	Path        string    `gorm:"size:500;index" json:"path"`
	Method      string    `gorm:"size:10" json:"method"`
	StatusCode  int       `json:"status_code"`
	UserAgent   string    `gorm:"type:text" json:"user_agent"`
	IsBot       bool      `gorm:"index" json:"is_bot"`
	BotName     string    `gorm:"size:100" json:"bot_name"`
	Referer     string    `gorm:"size:1000" json:"referer"`
	CreatedAt   time.Time `gorm:"index" json:"created_at"`
}

func (VisitorLog) TableName() string {
	return "visitor_logs"
}

// AnalyticsSetting holds single-row (ID=1) configuration for the analytics system.
type AnalyticsSetting struct {
	ID                  uint       `gorm:"primaryKey" json:"id"`
	RetentionDays       int        `gorm:"default:90" json:"retention_days"`
	AutoCleanupEnabled  bool       `gorm:"default:true" json:"auto_cleanup_enabled"`
	TrackingEnabled     bool       `gorm:"default:true" json:"tracking_enabled"`
	TrackingCodeEnabled bool       `gorm:"default:false" json:"tracking_code_enabled"`
	TrackingCode        string     `gorm:"type:text" json:"tracking_code"`
	LastCleanupAt       *time.Time `json:"last_cleanup_at"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

func (AnalyticsSetting) TableName() string {
	return "analytics_settings"
}
