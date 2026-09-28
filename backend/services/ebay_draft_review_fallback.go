package services

import (
	"encoding/json"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/utils"
)

// enrichEbayReviewProfile keeps the eBay pass useful when the provider returns
// an empty/generic type. The listing already contains two independent signals:
// its title and the marketplace breadcrumb. We use those signals only to fill
// missing identity fields; a concrete AI reading always wins.
//
// This is deliberately deterministic and conservative. It does not turn a
// category path into a public category name verbatim. It maps recognizable
// listing language to the same component vocabulary used by the storefront,
// after which the normal verified-listing -> resolve-or-create path takes over.
func enrichEbayReviewProfile(profile *ProductProfile, draft models.EbayImportDraft, identifier string) {
	if profile == nil {
		return
	}
	if strings.TrimSpace(profile.Model) == "" {
		profile.Model = strings.TrimSpace(identifier)
	}
	if strings.TrimSpace(profile.Brand) == "" {
		profile.Brand = draftReviewBrandFromListing(*profile, draft)
	}

	partType := CanonicalizeProductTypeFromText(profile.PartType)
	if !IsPublishableProductType(partType) {
		partType = inferDraftListingPartType(draft)
	}
	if !IsPublishableProductType(partType) {
		// ProductCategory is a useful fallback only when it contains a concrete
		// phrase. "Sensors" and "PLCs & HMIs" are intentionally rejected by
		// inferPartTypeFromListingText rather than becoming public nodes.
		partType = inferPartTypeFromListingText(profile.ProductCategory)
	}
	if !IsPublishableProductType(partType) {
		return
	}

	profile.PartType = CanonicalizeProductTypeFromText(partType)
	if strings.TrimSpace(profile.ProductCategory) == "" {
		profile.ProductCategory = profile.PartType
	}
	// A deterministic title/category signal from the listing is stronger than a
	// provider confidence of 0.2 caused by sparse seller copy. It is still not
	// treated as a model identity: the exact model is separately checked above.
	if profile.Confidence < 0.75 {
		profile.Confidence = 0.75
	}
}

// draftReviewBrandFromListing chooses a canonical manufacturer without trusting
// arbitrary text as a brand. The provider's concrete brand is preferred; known
// brand names in the listing are only a fallback for old eBay rows whose brand
// field was empty.
func draftReviewBrandFromListing(profile ProductProfile, draft models.EbayImportDraft) string {
	for _, candidate := range []string{profile.Brand, draft.NormalizedBrand} {
		if key := NormalizeBrandKey(candidate); key != "" && key != "unknown" {
			return CanonicalBrandName(key)
		}
	}
	evidence := DraftEvidenceFromDraft(draft)
	text := strings.TrimSpace(strings.Join([]string{evidence.Title, evidence.CategoryPath, evidence.Description}, " "))
	for _, brand := range KnownBrandDisplayNames() {
		if evidenceContainsBrand(text, NormalizeBrandKey(brand)) {
			return brand
		}
	}
	return ""
}

// inferDraftListingPartType reads the listing itself, not the model-number
// family table. This is what lets eBay titles such as E3S-CL2 Photoelectric
// Sensor, H3CR-A8 Timer Module and W4S1-03B under PLC Processors all become
// reviewable without a manual classification step.
func inferDraftListingPartType(draft models.EbayImportDraft) string {
	evidence := DraftEvidenceFromDraft(draft)
	identifier := strings.TrimSpace(evidence.Model)
	if identifier == "" {
		identifier, _ = utils.ExtractTitleIdentifier(evidence.Title)
	}
	if identifier != "" {
		brand := draftReviewBrandFromListing(ProductProfile{}, draft)
		if inference := InferProductCategory(brand, identifier); IsConfirmedProductCategory(inference, identifier) && IsPublishableProductType(inference.PartType) {
			return inference.PartType
		}
	}
	parts := []string{evidence.Title, evidence.CategoryPath, evidence.Description}
	for _, value := range evidence.ItemSpecifics {
		parts = append(parts, rawStringValue(value))
	}
	return inferPartTypeFromListingText(strings.Join(parts, " "))
}

// inferPartTypeFromListingText maps only specific phrases. It is shared by the
// AI profile fallback and tests; raw eBay taxonomy wording is never returned as
// the storefront node.
func inferPartTypeFromListingText(raw string) string {
	text := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(raw)), " "))
	if text == "" {
		return ""
	}
	text = strings.NewReplacer("&", " and ", "/", " ", "_", " ", "-", " ", ",", " ", ":", " ").Replace(text)
	text = " " + strings.Join(strings.Fields(text), " ") + " "
	contains := func(values ...string) bool {
		for _, value := range values {
			if strings.Contains(text, " "+value+" ") {
				return true
			}
		}
		return false
	}
	containsAll := func(values ...string) bool {
		for _, value := range values {
			if !strings.Contains(text, " "+value+" ") {
				return false
			}
		}
		return true
	}

	// Specific sensor/safety phrases must run before the generic sensor and
	// switch cases.
	switch {
	case containsAll("photoelectric", "sensor") || containsAll("photoelectric", "switch"):
		return "Photoelectric Sensor"
	case containsAll("fiber", "optic", "sensor") || containsAll("optical", "fiber", "sensor"):
		return "Fiber Optic Sensor"
	case containsAll("proximity", "sensor"):
		return "Proximity Sensor"
	case containsAll("distance", "sensor"):
		return "Distance Sensor"
	case containsAll("vision", "sensor"):
		return "Vision Sensor"
	case containsAll("safety", "light", "curtain"):
		return "Safety Light Curtain"
	case containsAll("safety", "laser", "scanner"):
		return "Safety Laser Scanner"
	case containsAll("safety", "door", "switch") || containsAll("guard", "lock"):
		return "Safety Door Switch"
	case containsAll("safety", "relay"):
		return "Safety Relay"
	case containsAll("photoelectric") && contains("sensor", "switch"):
		return "Photoelectric Sensor"
	case containsAll("sensor"):
		return "Sensor"
	}

	switch {
	case containsAll("industrial", "ethernet", "switch") || containsAll("ethernet", "switch"):
		return "Industrial Ethernet Switch"
	case containsAll("ethernet", "ip", "coupler") || contains("coupler") && contains("ethernet", "bus"):
		return "EtherNet/IP Coupler Unit"
	case containsAll("barcode", "scanner"):
		return "Barcode Scanner"
	case contains("rfid"):
		return "RFID Controller"
	}

	switch {
	case containsAll("temperature", "controller") || containsAll("temperature", "control"):
		return "Temperature Controller"
	case containsAll("temperature", "input", "module"):
		return "Temperature Input Module"
	case containsAll("digital", "time", "switch"):
		return "Digital Timer"
	case containsAll("timer", "relay") || containsAll("timer", "module") || contains("timer"):
		return "Timer Relay"
	case containsAll("counter", "module"):
		return "Counter Module"
	}

	switch {
	case containsAll("frequency", "converter") || containsAll("frequency", "inverter") || containsAll("variable", "frequency", "drive") || contains("vfd"):
		return "Variable Frequency Drive"
	case containsAll("spindle", "amplifier") || containsAll("spindle", "drive"):
		return "Spindle Amplifier / Drive"
	case containsAll("spindle", "motor"):
		return "Spindle Motor"
	case containsAll("servo", "amplifier") || containsAll("servo", "drive"):
		return "Servo Amplifier / Drive"
	case containsAll("servo", "motor"):
		return "Servo Motor"
	}

	switch {
	case containsAll("power", "supply") || contains("psu"):
		return "Power Supply Unit"
	case containsAll("analog", "output", "module"):
		return "Analog Output Module"
	case containsAll("analog", "input", "module"):
		return "Analog Input Module"
	case containsAll("digital", "output", "module"):
		return "Digital Output Module"
	case containsAll("digital", "input", "module"):
		return "Digital Input Module"
	case containsAll("i", "o", "module") || containsAll("io", "module") || containsAll("input", "output", "module"):
		return "I/O Module"
	case containsAll("remote", "terminal"):
		return "Remote Terminal Module"
	case containsAll("communication", "module") || containsAll("communication", "interface"):
		return "Communication Interface Module"
	}

	switch {
	case containsAll("touch", "screen") || contains("hmi", "operator", "panel"):
		return "Operator Panel / HMI"
	case containsAll("programmable", "logic", "controller") || containsAll("programmable", "controller") || containsAll("plc", "processor") || contains("plc"):
		return "Programmable Logic Controller"
	case contains("relay"):
		return "Relay"
	case contains("controller"):
		return "Control Unit"
	case contains("module") && contains("unit"):
		return "Control Unit"
	}
	return ""
}

// listingEvidenceJSON is useful when diagnosing a provider response without
// logging credentials or the full raw payload. It is kept local to tests and
// future diagnostics; production paths continue to send the normal evidence
// builder.
func listingEvidenceJSON(draft models.EbayImportDraft) string {
	encoded, _ := json.Marshal(DraftEvidenceFromDraft(draft))
	return string(encoded)
}
