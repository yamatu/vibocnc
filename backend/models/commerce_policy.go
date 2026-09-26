package models

import "time"

// CommercePolicySetting is a single-row, admin-editable record that drives the
// storefront's shipping, warranty and return promises.
//
// Every promise that used to be hard-coded inside templates ("12 months",
// "3-7 days", "Worldwide") is read from this record instead, so the operator can
// change the commercial promise once (shipping time, return window, who pays
// return freight) without touching code. The same values feed:
//
//   - the visible product page / policy pages,
//   - the generated content skeleton,
//   - the schema.org Offer (shippingDetails / hasMerchantReturnPolicy).
type CommercePolicySetting struct {
	ID uint `json:"id" gorm:"primaryKey"`

	// --- Shipping promise ------------------------------------------------
	// Text values are free-form so the operator can advertise phrases such as
	// "4-5 DAYS" while the numeric min/max drive the schema.org delivery time.
	ShippingHandlingTimeText string `json:"shipping_handling_time_text" gorm:"size:80;default:'1-2 days'"`
	ShippingHandlingDaysMin  int    `json:"shipping_handling_days_min" gorm:"default:1"`
	ShippingHandlingDaysMax  int    `json:"shipping_handling_days_max" gorm:"default:2"`
	ShippingTransitTimeText  string `json:"shipping_transit_time_text" gorm:"size:80;default:'4-5 DAYS'"`
	ShippingTransitDaysMin   int    `json:"shipping_transit_days_min" gorm:"default:4"`
	ShippingTransitDaysMax   int    `json:"shipping_transit_days_max" gorm:"default:5"`
	ShippingCarriers         string `json:"shipping_carriers" gorm:"size:255;default:'DHL,FedEx,UPS'"`
	// Comma separated ISO-3166 alpha-2 codes; "GLOBAL" means worldwide.
	ShippingDestinationCountries string  `json:"shipping_destination_countries" gorm:"size:255;default:'GLOBAL'"`
	ShippingRateAmount           float64 `json:"shipping_rate_amount" gorm:"type:decimal(10,2);default:0.00"`
	ShippingCurrency             string  `json:"shipping_currency" gorm:"size:8;default:'USD'"`
	ShippingNotes                string  `json:"shipping_notes" gorm:"type:text"`

	// --- Defaults used when a product has no explicit value ---------------
	DefaultWarrantyPeriod string `json:"default_warranty_period" gorm:"size:50;default:'12 months'"`
	DefaultLeadTime       string `json:"default_lead_time" gorm:"size:50;default:'4-5 DAYS'"`

	// --- Returns ----------------------------------------------------------
	// ReturnWindowDays is capped at 365 because it is published as
	// MerchantReturnPolicy.merchantReturnDays, which schema.org consumers cap
	// at one year for a finite return window.
	ReturnWindowDays    int    `json:"return_window_days" gorm:"default:365"`
	ReturnWindowText    string `json:"return_window_text" gorm:"size:80;default:'1 year'"`
	ReturnShippingPayer string `json:"return_shipping_payer" gorm:"size:16;default:'shared'"` // shared | customer | merchant
	ReturnPolicyCountry string `json:"return_policy_country" gorm:"size:2;default:'US'"`
	ReturnPolicyNotes   string `json:"return_policy_notes" gorm:"type:text"`

	// --- eBay market price sync -------------------------------------------
	// The crawler researches eBay median prices per model number. Nothing is
	// written to a product automatically: these settings only control which
	// suggestions the admin review screen is willing to offer.
	//
	// PriceSyncEnabled          master switch for the whole suggestion engine.
	// PriceSyncFactor           multiplier applied to the eBay median price.
	//                           Default 1.0 means "follow eBay as-is".
	// PriceSyncMinSamples       listings required before a suggestion is offered.
	// PriceSyncMaxDeltaPct      changes beyond this percentage are flagged for
	//                           manual review instead of being auto-marked ready.
	// PriceSyncRoundTo          rounding step for the suggested price (e.g. 1.00
	//                           or 5.00). 0 disables rounding.
	PriceSyncEnabled     bool    `json:"price_sync_enabled" gorm:"default:false"`
	PriceSyncFactor      float64 `json:"price_sync_factor" gorm:"type:decimal(6,3);default:1.000"`
	PriceSyncMinSamples  int     `json:"price_sync_min_samples" gorm:"default:3"`
	PriceSyncMaxDeltaPct float64 `json:"price_sync_max_delta_pct" gorm:"type:decimal(6,2);default:50.00"`
	PriceSyncRoundTo     float64 `json:"price_sync_round_to" gorm:"type:decimal(8,2);default:0.00"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ReturnShippingPayer* enumerates who carries return freight. It is stored as a
// short string so unknown admin values never break the API.
const (
	ReturnShippingPayerShared   = "shared"
	ReturnShippingPayerCustomer = "customer"
	ReturnShippingPayerMerchant = "merchant"
)

// DefaultCommercePolicy returns the seeded defaults used when the settings row
// does not exist yet.
func DefaultCommercePolicy() CommercePolicySetting {
	return CommercePolicySetting{
		ID:                           1,
		ShippingHandlingTimeText:     "1-2 days",
		ShippingHandlingDaysMin:      1,
		ShippingHandlingDaysMax:      2,
		ShippingTransitTimeText:      "4-5 DAYS",
		ShippingTransitDaysMin:       4,
		ShippingTransitDaysMax:       5,
		ShippingCarriers:             "DHL,FedEx,UPS",
		ShippingDestinationCountries: "GLOBAL",
		ShippingRateAmount:           0,
		ShippingCurrency:             "USD",
		DefaultWarrantyPeriod:        "12 months",
		DefaultLeadTime:              "4-5 DAYS",
		ReturnWindowDays:             365,
		ReturnWindowText:             "1 year",
		ReturnShippingPayer:          ReturnShippingPayerShared,
		ReturnPolicyCountry:          "US",
		PriceSyncEnabled:             false,
		PriceSyncFactor:              1.0,
		PriceSyncMinSamples:          3,
		PriceSyncMaxDeltaPct:         50,
		PriceSyncRoundTo:             0,
	}
}
