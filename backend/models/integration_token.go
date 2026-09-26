package models

import "time"

// IntegrationToken is a long-lived API credential for machine clients such as
// the eBay crawler.
//
// Design notes:
//
//   - The raw token is never stored. Only its SHA-256 hash is persisted, so a
//     database leak does not hand out working credentials. The plaintext value
//     is returned exactly once, at creation time.
//   - TokenHash carries a unique index and is the lookup key.
//   - Tokens are scoped by role, so a crawler token can be an "editor" (enough
//     to push market research) without being an "admin" (able to delete data
//     or apply price changes).
//   - Revocation is a soft delete: RevokedAt is set, the row is kept so the
//     audit trail still shows what existed.
type IntegrationToken struct {
	ID   uint   `json:"id" gorm:"primaryKey"`
	Name string `json:"name" gorm:"size:120;not null"`
	// TokenHash is the hex SHA-256 of the full token string.
	TokenHash string `json:"-" gorm:"size:64;uniqueIndex;not null"`
	// TokenPrefix is the first characters of the token, shown in the UI so an
	// administrator can tell two tokens apart without revealing them.
	TokenPrefix string `json:"token_prefix" gorm:"size:16;index"`

	Role string `json:"role" gorm:"type:enum('admin','editor','viewer');default:'editor';index"`

	// Scope optionally narrows what the token may call. Empty means "role only".
	// market_ingest accepts aggregated quotes; ebay_ingest additionally accepts
	// individual listings into the eBay draft review queue.
	Scope string `json:"scope" gorm:"size:50;index"`

	IsActive bool `json:"is_active" gorm:"default:true;index"`

	// CreatedBy records which administrator issued the token.
	CreatedBy     uint   `json:"created_by" gorm:"index"`
	CreatedByName string `json:"created_by_name" gorm:"size:100"`

	// LastUsedAt is refreshed on a successful authentication (at most once per
	// minute per token, to avoid writing on every crawl request).
	LastUsedAt   *time.Time `json:"last_used_at"`
	LastUsedIP   string     `json:"last_used_ip" gorm:"size:64"`
	RequestCount int64      `json:"request_count" gorm:"default:0"`

	ExpiresAt *time.Time `json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// IsUsable reports whether the token may currently authenticate a request.
func (t IntegrationToken) IsUsable(now time.Time) bool {
	if !t.IsActive || t.RevokedAt != nil {
		return false
	}
	if t.ExpiresAt != nil && now.After(*t.ExpiresAt) {
		return false
	}
	return true
}

// IntegrationTokenCreateRequest is the body of POST /admin/integration-tokens.
type IntegrationTokenCreateRequest struct {
	Name string `json:"name" binding:"required,min=2,max=120"`
	Role string `json:"role"`
	// ExpiresInDays of 0 (or omitted) means the token never expires.
	ExpiresInDays int    `json:"expires_in_days"`
	Scope         string `json:"scope"`
}

// IntegrationTokenCreated is the one-time response that carries the plaintext
// token. It is deliberately a different type from IntegrationToken so the raw
// value cannot be returned by accident from a list endpoint.
type IntegrationTokenCreated struct {
	Token      IntegrationToken `json:"token"`
	PlainToken string           `json:"plain_token"`
	// UsageHint shows the exact header a client should send.
	UsageHint string `json:"usage_hint"`
}

// IntegrationTokenUpdateRequest toggles a token's active state.
type IntegrationTokenUpdateRequest struct {
	IsActive *bool `json:"is_active"`
}
