package models

import "time"

// PriceSyncChange is the audit trail for market-driven price updates.
//
// Every applied change records the quote it came from and the policy factor in
// force at the time, so a price can always be explained after the fact.
type PriceSyncChange struct {
	ID        uint    `json:"id" gorm:"primaryKey"`
	ProductID uint    `json:"product_id" gorm:"index"`
	SKU       string  `json:"sku" gorm:"size:100;index"`
	Model     string  `json:"model" gorm:"size:160;index"`
	OldPrice  float64 `json:"old_price" gorm:"type:decimal(12,2)"`
	NewPrice  float64 `json:"new_price" gorm:"type:decimal(12,2)"`

	DeltaPercent float64 `json:"delta_percent" gorm:"type:decimal(8,2)"`

	QuoteID      uint    `json:"quote_id" gorm:"index"`
	MedianPrice  float64 `json:"median_price" gorm:"type:decimal(12,2)"`
	MatchedCount int     `json:"matched_count"`
	Factor       float64 `json:"factor" gorm:"type:decimal(6,3)"`

	Reason    string    `json:"reason" gorm:"size:255"`
	AppliedBy uint      `json:"applied_by" gorm:"index"`
	AppliedAt time.Time `json:"applied_at" gorm:"index"`
	CreatedAt time.Time `json:"created_at"`
}
