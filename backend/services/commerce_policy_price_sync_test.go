package services

import (
	"math"
	"testing"

	"fanuc-backend/models"
)

func TestNormalizeCommercePolicyClampsPriceSyncSafetyFields(t *testing.T) {
	setting := models.DefaultCommercePolicy()
	setting.PriceSyncEnabled = true
	setting.PriceSyncFactor = math.NaN()
	setting.PriceSyncMinSamples = 0
	setting.PriceSyncMaxDeltaPct = -1
	setting.PriceSyncRoundTo = 10001

	normalized := NormalizeCommercePolicy(setting)
	defaults := models.DefaultCommercePolicy()
	if !normalized.PriceSyncEnabled {
		t.Error("the explicit opt-in switch must be retained")
	}
	if normalized.PriceSyncFactor != defaults.PriceSyncFactor {
		t.Errorf("invalid factor = %v, want fallback %v", normalized.PriceSyncFactor, defaults.PriceSyncFactor)
	}
	if normalized.PriceSyncMinSamples != defaults.PriceSyncMinSamples {
		t.Errorf("invalid sample minimum = %d, want %d", normalized.PriceSyncMinSamples, defaults.PriceSyncMinSamples)
	}
	if normalized.PriceSyncMaxDeltaPct != defaults.PriceSyncMaxDeltaPct {
		t.Errorf("invalid delta guard = %v, want %v", normalized.PriceSyncMaxDeltaPct, defaults.PriceSyncMaxDeltaPct)
	}
	if normalized.PriceSyncRoundTo != defaults.PriceSyncRoundTo {
		t.Errorf("invalid rounding = %v, want %v", normalized.PriceSyncRoundTo, defaults.PriceSyncRoundTo)
	}
}

func TestNormalizeCommercePolicyRetainsValidPriceSyncFields(t *testing.T) {
	setting := models.DefaultCommercePolicy()
	setting.PriceSyncEnabled = true
	setting.PriceSyncFactor = 1.15
	setting.PriceSyncMinSamples = 5
	setting.PriceSyncMaxDeltaPct = 35
	setting.PriceSyncRoundTo = 1

	normalized := NormalizeCommercePolicy(setting)
	if !normalized.PriceSyncEnabled || normalized.PriceSyncFactor != 1.15 || normalized.PriceSyncMinSamples != 5 || normalized.PriceSyncMaxDeltaPct != 35 || normalized.PriceSyncRoundTo != 1 {
		t.Errorf("valid price settings changed: %+v", normalized)
	}
}
