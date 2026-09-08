package controllers

import "testing"

func TestValidMarketingEmail(t *testing.T) {
	valid := []string{"buyer@example.com", "ops.team+cn@example.co.uk"}
	for _, value := range valid {
		if !validMarketingEmail(value) {
			t.Errorf("validMarketingEmail(%q) = false", value)
		}
	}
	invalid := []string{"", "buyer", "Buyer <buyer@example.com>", "buyer@", "buyer@example"}
	for _, value := range invalid {
		if validMarketingEmail(value) {
			t.Errorf("validMarketingEmail(%q) = true", value)
		}
	}
}
