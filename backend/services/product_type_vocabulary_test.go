package services

import "testing"

// One kind of part arrives labelled differently from listing to listing, and
// every distinct wording used to become its own category branch. Mapping the
// wording onto the shared vocabulary is what keeps "Power Supply", "Power
// Supply Unit" and "PLC Power Supply Module" from all existing at once.
func TestCanonicalizeProductTypeFromText(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"PLC Power Supply Module", "Power Supply Unit"},
		{"Power Supply", "Power Supply Unit"},
		{"Analog I/O Module", "I/O Module"},
		{"AC Servo Motor", "Servo Motor"},
		{"Servo Amplifier", "Servo Amplifier / Drive"},
		// "PLC" is a modifier in real type names: matching it on its own would
		// file an analog output module as a controller.
		{"PLC Analog Output Module", "PLC Analog Output Module"},
		{"EtherNet/IP Coupler Unit", "EtherNet/IP Coupler Unit"},
		{"Digital Output Unit", "Digital Output Unit"},
		{"  ", ""},
	}
	for _, tc := range cases {
		if got := CanonicalizeProductTypeFromText(tc.in); got != tc.want {
			t.Errorf("CanonicalizeProductTypeFromText(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// A type read out of a listing may name a new public category, so the
// placeholder vocabulary and a repeated part number have to be refused; a
// specific type has to survive.
func TestIsPublishableProductType(t *testing.T) {
	publishable := []string{"EtherNet/IP Coupler Unit", "Digital Output Unit", "I/O Module", "Servo Motor", "HMI"}
	for _, value := range publishable {
		if !IsPublishableProductType(value) {
			t.Errorf("IsPublishableProductType(%q) = false, want true", value)
		}
	}
	refused := []string{"", "   ", "Spare Part", "Accessories", "Other", "CJ1W-PA205R", "24V/5A", "NX"}
	for _, value := range refused {
		if IsPublishableProductType(value) {
			t.Errorf("IsPublishableProductType(%q) = true, want false", value)
		}
	}
}
