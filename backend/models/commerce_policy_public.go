package models

// PublicCommercePolicySetting is the customer-visible subset of
// CommercePolicySetting. Internal market-pricing controls are intentionally not
// exposed by /public/commerce-policy: the storefront needs shipping/returns,
// not the operator's pricing factor and review thresholds.
type PublicCommercePolicySetting struct {
	ShippingHandlingTimeText     string  `json:"shipping_handling_time_text"`
	ShippingHandlingDaysMin      int     `json:"shipping_handling_days_min"`
	ShippingHandlingDaysMax      int     `json:"shipping_handling_days_max"`
	ShippingTransitTimeText      string  `json:"shipping_transit_time_text"`
	ShippingTransitDaysMin       int     `json:"shipping_transit_days_min"`
	ShippingTransitDaysMax       int     `json:"shipping_transit_days_max"`
	ShippingCarriers             string  `json:"shipping_carriers"`
	ShippingDestinationCountries string  `json:"shipping_destination_countries"`
	ShippingRateAmount           float64 `json:"shipping_rate_amount"`
	ShippingCurrency             string  `json:"shipping_currency"`
	ShippingNotes                string  `json:"shipping_notes"`
	DefaultWarrantyPeriod        string  `json:"default_warranty_period"`
	DefaultLeadTime              string  `json:"default_lead_time"`
	ReturnWindowDays             int     `json:"return_window_days"`
	ReturnWindowText             string  `json:"return_window_text"`
	ReturnShippingPayer          string  `json:"return_shipping_payer"`
	ReturnPolicyCountry          string  `json:"return_policy_country"`
	ReturnPolicyNotes            string  `json:"return_policy_notes"`
}

func (setting CommercePolicySetting) Public() PublicCommercePolicySetting {
	return PublicCommercePolicySetting{
		ShippingHandlingTimeText:     setting.ShippingHandlingTimeText,
		ShippingHandlingDaysMin:      setting.ShippingHandlingDaysMin,
		ShippingHandlingDaysMax:      setting.ShippingHandlingDaysMax,
		ShippingTransitTimeText:      setting.ShippingTransitTimeText,
		ShippingTransitDaysMin:       setting.ShippingTransitDaysMin,
		ShippingTransitDaysMax:       setting.ShippingTransitDaysMax,
		ShippingCarriers:             setting.ShippingCarriers,
		ShippingDestinationCountries: setting.ShippingDestinationCountries,
		ShippingRateAmount:           setting.ShippingRateAmount,
		ShippingCurrency:             setting.ShippingCurrency,
		ShippingNotes:                setting.ShippingNotes,
		DefaultWarrantyPeriod:        setting.DefaultWarrantyPeriod,
		DefaultLeadTime:              setting.DefaultLeadTime,
		ReturnWindowDays:             setting.ReturnWindowDays,
		ReturnWindowText:             setting.ReturnWindowText,
		ReturnShippingPayer:          setting.ReturnShippingPayer,
		ReturnPolicyCountry:          setting.ReturnPolicyCountry,
		ReturnPolicyNotes:            setting.ReturnPolicyNotes,
	}
}
