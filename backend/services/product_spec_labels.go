package services

import (
	"regexp"
	"strings"
)

// Canonical specification labels.
//
// Every parameter that can be published ends up as a key in Product.TechnicalSpecs
// and is rendered as a row on the storefront. A label is therefore part of the
// public page, not an internal detail: two spellings of the same measurement
// ("Voltage" and "Input voltage") would render as two duplicate rows, and a
// later merge could keep two contradictory values under different keys.
//
// This file maps every recognised spelling onto one published label so the
// research pipeline, the review queue and the generated content skeleton all
// agree on the same key.
const (
	specLabelInputVoltage         = "Input voltage"
	specLabelRatedCurrent         = "Rated current"
	specLabelRatedPower           = "Rated power"
	specLabelFrequency            = "Frequency"
	specLabelWeight               = "Weight"
	specLabelDimensions           = "Dimensions"
	specLabelMaxSpeed             = "Max speed"
	specLabelEncoderResolution    = "Encoder resolution"
	specLabelOperatingTemperature = "Operating temperature"
	specLabelProtectionClass      = "Protection class"
	specLabelInsulationClass      = "Insulation class"
	specLabelCoolingMethod        = "Cooling method"
	specLabelMountingType         = "Mounting type"
	specLabelInterface            = "Interface"
	specLabelCertifications       = "Certifications"
)

// specLabelAliases maps a normalised spelling onto its published label. The
// normalisation step removes punctuation, parenthetical remarks and the
// "rated/nominal/output" prefixes that datasheets add inconsistently, so a
// single entry covers most of the real-world variations.
var specLabelAliases = map[string]string{
	"input voltage":           specLabelInputVoltage,
	"voltage":                 specLabelInputVoltage,
	"supply voltage":          specLabelInputVoltage,
	"power supply voltage":    specLabelInputVoltage,
	"operating voltage":       specLabelInputVoltage,
	"rated voltage":           specLabelInputVoltage,
	"nominal voltage":         specLabelInputVoltage,
	"rated input voltage":     specLabelInputVoltage,
	"control voltage":         specLabelInputVoltage,
	"主电源电压":                   specLabelInputVoltage,
	"输入电压":                    specLabelInputVoltage,
	"rated current":           specLabelRatedCurrent,
	"current":                 specLabelRatedCurrent,
	"output current":          specLabelRatedCurrent,
	"nominal current":         specLabelRatedCurrent,
	"rated output current":    specLabelRatedCurrent,
	"current rating":          specLabelRatedCurrent,
	"input current":           specLabelRatedCurrent,
	"额定电流":                    specLabelRatedCurrent,
	"rated power":             specLabelRatedPower,
	"power":                   specLabelRatedPower,
	"output power":            specLabelRatedPower,
	"capacity":                specLabelRatedPower,
	"motor capacity":          specLabelRatedPower,
	"rated output":            specLabelRatedPower,
	"power rating":            specLabelRatedPower,
	"rated capacity":          specLabelRatedPower,
	"output capacity":         specLabelRatedPower,
	"额定功率":                    specLabelRatedPower,
	"frequency":               specLabelFrequency,
	"rated frequency":         specLabelFrequency,
	"output frequency":        specLabelFrequency,
	"input frequency":         specLabelFrequency,
	"频率":                      specLabelFrequency,
	"weight":                  specLabelWeight,
	"net weight":              specLabelWeight,
	"mass":                    specLabelWeight,
	"unit weight":             specLabelWeight,
	"重量":                      specLabelWeight,
	"dimensions":              specLabelDimensions,
	"dimension":               specLabelDimensions,
	"overall dimensions":      specLabelDimensions,
	"size":                    specLabelDimensions,
	"external dimensions":     specLabelDimensions,
	"w x h x d":               specLabelDimensions,
	"width x height x depth":  specLabelDimensions,
	"尺寸":                      specLabelDimensions,
	"max speed":               specLabelMaxSpeed,
	"maximum speed":           specLabelMaxSpeed,
	"rated speed":             specLabelMaxSpeed,
	"spindle speed":           specLabelMaxSpeed,
	"max spindle speed":       specLabelMaxSpeed,
	"highest speed":           specLabelMaxSpeed,
	"max rpm":                 specLabelMaxSpeed,
	"encoder resolution":      specLabelEncoderResolution,
	"resolution":              specLabelEncoderResolution,
	"pulses per revolution":   specLabelEncoderResolution,
	"pulse per revolution":    specLabelEncoderResolution,
	"ppr":                     specLabelEncoderResolution,
	"encoder pulses":          specLabelEncoderResolution,
	"operating temperature":   specLabelOperatingTemperature,
	"ambient temperature":     specLabelOperatingTemperature,
	"temperature range":       specLabelOperatingTemperature,
	"operating temp":          specLabelOperatingTemperature,
	"protection class":        specLabelProtectionClass,
	"protection rating":       specLabelProtectionClass,
	"degree of protection":    specLabelProtectionClass,
	"ip rating":               specLabelProtectionClass,
	"enclosure rating":        specLabelProtectionClass,
	"ingress protection":      specLabelProtectionClass,
	"防护等级":                    specLabelProtectionClass,
	"insulation class":        specLabelInsulationClass,
	"insulation system":       specLabelInsulationClass,
	"insulation":              specLabelInsulationClass,
	"cooling method":          specLabelCoolingMethod,
	"cooling":                 specLabelCoolingMethod,
	"cooling type":            specLabelCoolingMethod,
	"method of cooling":       specLabelCoolingMethod,
	"mounting type":           specLabelMountingType,
	"mounting method":         specLabelMountingType,
	"mounting":                specLabelMountingType,
	"installation type":       specLabelMountingType,
	"interface":               specLabelInterface,
	"communication interface": specLabelInterface,
	"communication":           specLabelInterface,
	"comms":                   specLabelInterface,
	"fieldbus":                specLabelInterface,
	"bus":                     specLabelInterface,
	"protocol":                specLabelInterface,
	"communication port":      specLabelInterface,
	"通讯接口":                    specLabelInterface,
	"certifications":          specLabelCertifications,
	"certification":           specLabelCertifications,
	"approvals":               specLabelCertifications,
	"approval":                specLabelCertifications,
	"standards":               specLabelCertifications,
	"compliance":              specLabelCertifications,
}

// specLabelKeywords are the words that must appear near a value before a label
// is accepted. They are the weakest useful proof that a page is talking about
// the parameter and not about something that merely looks like its unit, which
// is what keeps "3" from becoming a rated current.
var specLabelKeywords = map[string][]string{
	specLabelInputVoltage:         {"voltage", "volt", "vac", "vdc"},
	specLabelRatedCurrent:         {"current", "amp", "ampere"},
	specLabelRatedPower:           {"power", "capacity", "watt", "kw"},
	specLabelFrequency:            {"frequency", "hz", "hertz"},
	specLabelWeight:               {"weight", "mass", "kg"},
	specLabelDimensions:           {"dimension", "size", "width", "height", "depth"},
	specLabelMaxSpeed:             {"speed", "rpm", "rev"},
	specLabelEncoderResolution:    {"resolution", "pulse", "ppr", "encoder"},
	specLabelOperatingTemperature: {"temperature", "ambient", "temp"},
	specLabelProtectionClass:      {"protection", "ip", "enclosure", "ingress"},
	specLabelInsulationClass:      {"insulation", "class"},
	specLabelCoolingMethod:        {"cooling", "cooled"},
	specLabelMountingType:         {"mounting", "mount", "installation", "install"},
	specLabelInterface:            {"interface", "communication", "bus", "protocol", "port"},
	specLabelCertifications:       {"certif", "approval", "standard", "compliant", "ce", "ul", "rohs", "csa"},
}

var specLabelParenPattern = regexp.MustCompile(`\([^)]*\)|\[[^\]]*\]|（[^）]*）`)
var specLabelSeparatorPattern = regexp.MustCompile(`[\s_/\\|,;:.\-–—+*]+`)

// specLabelQualifiers are the words datasheets stack in front of a parameter
// name ("rated", "maximum", "output", …). They are removed one at a time when
// the full spelling is not a known alias, so "rated maximum input voltage" still
// lands on "Input voltage".
var specLabelQualifiers = []string{
	"rated", "nominal", "maximum", "max", "minimum", "min", "typical", "output",
	"input", "net", "unit", "motor", "value", "spec", "specification", "specs",
	"rating", "of", "the",
}

// CanonicalSpecLabel maps any spelling of a known parameter onto the single
// label the catalogue publishes. Unknown labels are returned cleaned up, so a
// parameter outside the known families (a specific torque figure, say) keeps the
// reviewer's wording instead of being silently renamed.
func CanonicalSpecLabel(label string) string {
	cleaned := NormalizeWhitespaceCopy(label)
	if cleaned == "" {
		return ""
	}
	key := normalizeSpecLabelKey(cleaned)
	if canonical, ok := specLabelAliases[key]; ok {
		return canonical
	}
	// Strip the qualifier words one at a time from both ends until either a known
	// alias appears or no word can be removed any more.
	trimmed := key
	for changed := true; changed; {
		changed = false
		for _, qualifier := range specLabelQualifiers {
			next := strings.TrimSpace(strings.TrimPrefix(trimmed, qualifier+" "))
			next = strings.TrimSpace(strings.TrimSuffix(next, " "+qualifier))
			if next != trimmed && next != "" {
				trimmed = next
				changed = true
			}
		}
	}
	if trimmed != key {
		if canonical, ok := specLabelAliases[trimmed]; ok {
			return canonical
		}
	}
	return cleaned
}

// normalizeSpecLabelKey lowercases a label and strips the parts that never carry
// meaning: parenthetical units and separators.
func normalizeSpecLabelKey(label string) string {
	key := specLabelParenPattern.ReplaceAllString(label, " ")
	key = strings.ToLower(key)
	key = strings.NewReplacer("×", "x", "／", "/", "、", ",", "：", ":").Replace(key)
	key = specLabelSeparatorPattern.ReplaceAllString(key, " ")
	return NormalizeWhitespaceCopy(strings.ToLower(key))
}

// SpecLabelKeywords returns the words that must co-occur with a value before a
// researched label is trusted. Unknown labels return nil, which callers treat as
// "the value alone is enough" because the reviewer picked the wording.
func SpecLabelKeywords(label string) []string {
	return specLabelKeywords[CanonicalSpecLabel(label)]
}

// CanonicalizeSpecMap rewrites a specification table so every key is the
// published label. A later duplicate loses to the earlier value, except that an
// empty value never wins, so merging two spellings of one parameter can never
// publish an empty row.
func CanonicalizeSpecMap(specs map[string]string) map[string]string {
	canonical := make(map[string]string, len(specs))
	for key, value := range specs {
		label := CanonicalSpecLabel(key)
		value = NormalizeWhitespaceCopy(value)
		if label == "" || value == "" {
			continue
		}
		if existing, ok := canonical[label]; ok && strings.TrimSpace(existing) != "" {
			continue
		}
		canonical[label] = value
	}
	return canonical
}
