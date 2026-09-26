package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPublicCommercePolicyExcludesPriceStrategy(t *testing.T) {
	setting := DefaultCommercePolicy()
	setting.PriceSyncEnabled = true
	setting.PriceSyncFactor = 1.37
	setting.PriceSyncMinSamples = 9
	setting.PriceSyncMaxDeltaPct = 22
	setting.PriceSyncRoundTo = 5

	encoded, err := json.Marshal(setting.Public())
	if err != nil {
		t.Fatal(err)
	}
	value := string(encoded)
	if strings.Contains(value, "price_sync") || strings.Contains(value, "1.37") {
		t.Errorf("internal pricing strategy leaked into public policy: %s", value)
	}
	for _, required := range []string{"shipping_transit_time_text", "default_warranty_period", "return_window_days"} {
		if !strings.Contains(value, required) {
			t.Errorf("public promise field %q is missing: %s", required, value)
		}
	}
}
