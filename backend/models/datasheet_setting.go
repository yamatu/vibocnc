package models

import "time"

// DatasheetSetting is the single persisted configuration row for the
// Datasheets.com product search API. It backs an assistant feature in the admin
// catalogue: an administrator looks a part number up, reads what the API knows
// about it, and decides by hand whether any of it belongs on the product.
//
// Two rules shape this model:
//   - the API key is encrypted at rest and never leaves Go (APIKeyEnc is
//     json:"-"), exactly like AIAgentSetting.APIKeyEnc,
//   - the monthly call budget is stored here because the provider quota is
//     owned by the account, not by the process. Restarting the backend must not
//     hand us another 5,000 calls.
type DatasheetSetting struct {
	ID uint `json:"id" gorm:"primaryKey"`

	Enabled bool `json:"enabled" gorm:"default:false"`

	// APIKeyEnc holds utils.EncryptSecret(api key). Never serialised.
	APIKeyEnc string `json:"-" gorm:"type:text"`

	// APIKeyFromEnv records that the active key comes from
	// DATASHEETS_API_KEY instead of the database, so the UI can say so instead
	// of showing an empty field the administrator cannot explain.
	APIKeyFromEnv bool `json:"api_key_from_env" gorm:"default:false"`

	// Provider quotas. The published defaults are 60/min, 500/hour and
	// 5,000/month; they are editable because the provider adjusts them per
	// account.
	PerMinuteLimit int `json:"per_minute_limit" gorm:"default:60"`
	PerHourLimit   int `json:"per_hour_limit" gorm:"default:500"`
	MonthlyLimit   int `json:"monthly_limit" gorm:"default:5000"`

	// Budget guard: calls stop being made on their own once the monthly count
	// reaches this share of MonthlyLimit. Lookups a human starts are still
	// allowed, because the administrator is watching the result.
	AutoStopPercent int `json:"auto_stop_percent" gorm:"default:90"`

	// CacheTTLDays reuses an identical part-number lookup without spending a
	// call. 0 disables cache reuse.
	CacheTTLDays int `json:"cache_ttl_days" gorm:"default:90"`

	// DefaultPageLimit is the provider page size used by a lookup (max 10).
	DefaultPageLimit int `json:"default_page_limit" gorm:"default:10"`

	// Monthly counter, reset by the service when the billing month changes.
	QuotaMonth      string     `json:"quota_month" gorm:"size:7;default:''"`
	MonthlyUsed     int        `json:"monthly_used" gorm:"default:0"`
	QuotaResetAt    *time.Time `json:"quota_reset_at,omitempty"`
	LastCallAt      *time.Time `json:"last_call_at,omitempty"`
	LastCallStatus  int        `json:"last_call_status" gorm:"default:0"`
	LastCallQuery   string     `json:"last_call_query" gorm:"size:160;default:''"`
	LastCallMessage string     `json:"last_call_message" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// DatasheetSettingResponse is the browser-safe projection: the key itself is
// replaced by a boolean, and the remaining call budget is computed here so the
// admin UI cannot disagree with the guard that enforces it.
type DatasheetSettingResponse struct {
	ID      uint `json:"id"`
	Enabled bool `json:"enabled"`

	HasAPIKey     bool `json:"has_api_key"`
	APIKeyFromEnv bool `json:"api_key_from_env"`

	PerMinuteLimit   int `json:"per_minute_limit"`
	PerHourLimit     int `json:"per_hour_limit"`
	MonthlyLimit     int `json:"monthly_limit"`
	AutoStopPercent  int `json:"auto_stop_percent"`
	CacheTTLDays     int `json:"cache_ttl_days"`
	DefaultPageLimit int `json:"default_page_limit"`

	QuotaMonth      string     `json:"quota_month"`
	MonthlyUsed     int        `json:"monthly_used"`
	MonthlyRemaining int       `json:"monthly_remaining"`
	QuotaResetAt    *time.Time `json:"quota_reset_at,omitempty"`
	LastCallAt      *time.Time `json:"last_call_at,omitempty"`
	LastCallStatus  int        `json:"last_call_status"`
	LastCallQuery   string     `json:"last_call_query"`
	LastCallMessage string     `json:"last_call_message"`

	UpdatedAt time.Time `json:"updated_at"`
}

// ToResponse projects the row for the admin UI.
func (s *DatasheetSetting) ToResponse() DatasheetSettingResponse {
	remaining := s.MonthlyLimit - s.MonthlyUsed
	if remaining < 0 {
		remaining = 0
	}
	return DatasheetSettingResponse{
		ID:               s.ID,
		Enabled:          s.Enabled,
		HasAPIKey:        s.APIKeyFromEnv || s.APIKeyEnc != "",
		APIKeyFromEnv:    s.APIKeyFromEnv,
		PerMinuteLimit:   s.PerMinuteLimit,
		PerHourLimit:     s.PerHourLimit,
		MonthlyLimit:     s.MonthlyLimit,
		AutoStopPercent:  s.AutoStopPercent,
		CacheTTLDays:     s.CacheTTLDays,
		DefaultPageLimit: s.DefaultPageLimit,
		QuotaMonth:       s.QuotaMonth,
		MonthlyUsed:      s.MonthlyUsed,
		MonthlyRemaining: remaining,
		QuotaResetAt:     s.QuotaResetAt,
		LastCallAt:       s.LastCallAt,
		LastCallStatus:   s.LastCallStatus,
		LastCallQuery:    s.LastCallQuery,
		LastCallMessage:  s.LastCallMessage,
		UpdatedAt:        s.UpdatedAt,
	}
}

// DatasheetLookupCache stores one provider response per normalised part number
// so a repeated lookup costs nothing. Datasheets.com allows 5,000 calls a month
// against a catalogue of hundreds of thousands of SKUs, so reuse is not an
// optimisation here, it is the only way the feature stays inside the quota.
//
// The payload is the provider's JSON, kept verbatim: rewriting it would lose
// fields (lifecycle, package, datasheet URL) that later versions of the UI may
// want, and a cache is exactly the wrong place to be clever.
type DatasheetLookupCache struct {
	ID uint `json:"id" gorm:"primaryKey"`
	// QueryKey is the normalised part number used for lookup and matching.
	QueryKey string `json:"query_key" gorm:"size:160;uniqueIndex"`
	// MPN is the part number as the administrator typed it.
	MPN          string     `json:"mpn" gorm:"size:160"`
	ResultCount  int        `json:"result_count" gorm:"default:0"`
	MatchCount   int        `json:"match_count" gorm:"default:0"`
	PayloadJSON  string     `json:"payload_json" gorm:"type:mediumtext"`
	FetchedAt    time.Time  `json:"fetched_at" gorm:"index"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty" gorm:"index"`
	LastHitAt    *time.Time `json:"last_hit_at,omitempty"`
	HitCount     int        `json:"hit_count" gorm:"default:0"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}
