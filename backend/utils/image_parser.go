package utils

import (
	"regexp"
	"strings"
)

// ParseModelFromFilename extracts a model number from an image filename.
//
// The catalogue covers many manufacturers (FANUC, Mitsubishi, Siemens, ABB,
// Allen-Bradley, Omron, Yaskawa, ...), so the patterns are grouped by family
// instead of assuming a single brand's numbering scheme. Examples:
//
//	A02B-0120-C041MAR_$_57.jpg
//	A06B-6220-H006.png
//	A860-2000-T301_image.jpg
//	MR-J4-40A.jpg
//	6ES7215-1AG40-0XB0.png
//	1756-L61_main.jpg
func ParseModelFromFilename(filename string) string {
	// Remove file extension
	nameWithoutExt := strings.TrimSuffix(filename, getFileExtension(filename))
	return extractModelFromText(nameWithoutExt, true)
}

// ExtractModelFromText pulls the first part number out of free-form text such as
// a marketplace listing title.
//
// Marketplace listings frequently carry no structured "Model" attribute, while
// the title almost always names the part. Recovering it here is what makes such
// a draft reviewable at all, because product identification requires a model.
//
// Only the known part-number families are considered, so marketing prose is
// never coerced into a model number.
func ExtractModelFromText(text string) string {
	return extractModelFromText(text, false)
}

// modelFamilies lists part-number families, most specific first. Patterns are
// matched against upper-cased input, so every result is returned in upper case.
// Brand-anchored patterns are listed before the loose numeric ones, otherwise
// "A02B-0120-C041" would be truncated to "0120-C041".
//
// They are compiled once rather than per call: the same table serves filename
// parsing and listing-title parsing, both of which run once per imported row.
var modelFamilies = []*regexp.Regexp{
	// Siemens SIMATIC / SINAMICS / motors: 6ES7215-1AG40-0XB0, 6SN1118-0DJ21-0AA1
	regexp.MustCompile(`6[A-Z]{2}\d{4}-\d[A-Z]{2}\d{2}-\d[A-Z]{2}\d`),
	regexp.MustCompile(`6[A-Z]{2}\d{4}-\d[A-Z]{2}\d{2}`),
	regexp.MustCompile(`1[A-Z]{2}\d{4}-\d[A-Z]{2}\d{2}-\d[A-Z]{2}\d`),
	// FANUC: A##B-####-#### (amplifiers, motors, boards)
	regexp.MustCompile(`A\d{2}B-\d{4}-[A-Z]\d{3}[A-Z0-9]*`),
	// FANUC encoder / pulse coder: A###-####-T###
	regexp.MustCompile(`A\d{3}-\d{4}-[A-Z]\d{3}[A-Z0-9]*`),
	// Mitsubishi MELSERVO / MELSEC: MR-J4-40A, MR-J3-70B, HC-KFS43, FX3U-16MT
	regexp.MustCompile(`MR-[A-Z]\d[A-Z]?-\d{2,4}[A-Z]?`),
	regexp.MustCompile(`HC-[A-Z]{2,4}\d{2,4}[A-Z]?`),
	regexp.MustCompile(`(?:FX|Q|RJ|R)\d{1,2}[A-Z]{1,2}(?:-[A-Z0-9]{1,10}){1,3}`),
	// Yaskawa: SGDV-2R8A01A, SGMJV-04ADE6S, SGD7S-2R8A00A, SGMPS-04A
	// The suffix runs to three letters (SGMJV, SGMPS), so the family is matched
	// with {2,4} — a fixed {2} silently never matched those listings.
	regexp.MustCompile(`SG[A-Z]{2,4}-[A-Z0-9]{4,12}`),
	// Omron: CJ2M-CPU31, CS1W-ID211, E3Z-D62, R88M-K40030H
	regexp.MustCompile(`(?:CJ|CS|CP|CQM)\d[A-Z]{0,2}(?:-[A-Z0-9]{1,12}){1,2}`),
	regexp.MustCompile(`(?:E3Z|E2E|R88M|R88D)-[A-Z0-9]{2,14}`),
	// ABB: DSQC-664, ACS580-01-046A-4
	regexp.MustCompile(`DSQC-?\d{3,4}`),
	regexp.MustCompile(`ACS\d{3}-[A-Z0-9-]{4,20}`),
	// Delta / Schneider: ASDA-B2-0421, ATV320U07N4C, TM241CE24T
	regexp.MustCompile(`ASDA-[A-Z]\d(?:-[A-Z0-9]{3,10})?`),
	regexp.MustCompile(`ATV\d{3}[A-Z0-9]{4,12}`),
	regexp.MustCompile(`TM\d{3}[A-Z0-9]{4,12}`),
	// Allen-Bradley / Rockwell: 1756-L61, 1769-IF4, 1794-IB16, 2094-BM01
	regexp.MustCompile(`\d{4}-[A-Z]{1,3}\d{1,3}[A-Z]{0,3}`),
	// Loosely structured manufacturer formats (A1-2345-ABCD and similar)
	regexp.MustCompile(`[A-Z]\d{2,3}[A-Z]?-\d{4}-[A-Z0-9]{4,}`),
	regexp.MustCompile(`A\d{2}B-\d{4}`),
	regexp.MustCompile(`A\d{3}-\d{4}`),
}

// looseModelFormat matches a dashed alphanumeric token that no known family
// claimed.
//
// It is only applied to filenames. A title is prose, where such a token is far
// more likely to be marketing copy ("NEW-2024-LOT") than a part number, and a
// wrong model is worse than no model: it would be compared against the AI's
// reading of the listing and reject a correct identification as a mismatch.
var looseModelFormat = regexp.MustCompile(`[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+`)

// extractModelFromText returns the first part number found in text.
//
// allowLoose enables the unstructured fallback described on looseModelFormat.
func extractModelFromText(text string, allowLoose bool) string {
	upper := strings.ToUpper(text)
	for _, pattern := range modelFamilies {
		if match := pattern.FindString(upper); match != "" {
			return match
		}
	}
	if allowLoose {
		return looseModelFormat.FindString(upper)
	}
	return ""
}

// getFileExtension returns the file extension including the dot
func getFileExtension(filename string) string {
	parts := strings.Split(filename, ".")
	if len(parts) > 1 {
		return "." + parts[len(parts)-1]
	}
	return ""
}

func joinNonEmptyStrings(sep string, parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			kept = append(kept, trimmed)
		}
	}
	return strings.Join(kept, sep)
}

// GenerateProductNameForBrand builds a storefront product name. When brand is
// empty the result stays brand-neutral: generated copy must never name a brand
// the catalogue record does not carry.
func GenerateProductNameForBrand(brand, model, productType string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	if strings.TrimSpace(productType) == "" {
		productType = determineProductType(model)
	}
	return joinNonEmptyStrings(" ", brand, productType, model)
}

// GenerateProductNameFromModel keeps the historical signature. It is
// brand-neutral by design; pass the record's brand through
// GenerateProductNameForBrand when the brand is known.
func GenerateProductNameFromModel(model string) string {
	return GenerateProductNameForBrand("", model, "")
}

// DetermineProductType determines the product type based on model number (exported version).
// The prefix table below is FANUC-shaped; other brands are resolved through
// services.InferProductCategory, which owns the multi-brand rules.
func DetermineProductType(model string) string {
	return determineProductType(model)
}

// determineProductType determines the product type based on model number.
// It only knows the FANUC numbering scheme, so callers must resolve other
// brands through the shared classifier instead of guessing here.
func determineProductType(model string) string {
	model = strings.ToUpper(model)

	// FANUC model number patterns and their corresponding product types
	typeMap := map[string]string{
		"A06B":   "Servo Motor",
		"A02B":   "PCB Board",
		"A20B":   "PCB Board",
		"A16B":   "PCB Board",
		"A03B":   "Teach Pendant",
		"A05B":   "Teach Pendant",
		"A860":   "Encoder",
		"A06B-6": "Servo Amplifier",
		"A06B-0": "Servo Motor",
		"A06B-2": "Spindle Motor",
		"A06B-1": "Linear Motor",
		"A230":   "Controller",
		"A02B-0": "I/O Module",
		"A16B-1": "Power Supply",
		"A16B-2": "Memory Board",
		"A20B-1": "CPU Board",
		"A20B-2": "Axis Control Board",
		"A20B-3": "Main Board",
	}

	// Check for specific patterns first (longer matches)
	for prefix, productType := range typeMap {
		if strings.HasPrefix(model, prefix) {
			return productType
		}
	}

	// Default fallback based on first 4 characters
	if len(model) >= 4 {
		prefix := model[:4]
		if productType, exists := typeMap[prefix]; exists {
			return productType
		}
	}

	return "Industrial Component"
}

// GenerateShortDescriptionForBrand creates a short description. A brand is only
// named when the caller supplies one, so a Mitsubishi part can never be
// described as a FANUC part.
func GenerateShortDescriptionForBrand(brand, model, productType string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	if strings.TrimSpace(productType) == "" {
		productType = determineProductType(model)
	}
	return joinNonEmptyStrings(" ", brand, productType, model) + " - High-quality industrial automation component"
}

// GenerateShortDescription keeps the historical signature and stays
// brand-neutral.
func GenerateShortDescription(model, productType string) string {
	return GenerateShortDescriptionForBrand("", model, productType)
}

// GenerateDescriptionForBrand creates a detailed description for the product.
func GenerateDescriptionForBrand(brand, model, productType string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	if strings.TrimSpace(productType) == "" {
		productType = determineProductType(model)
	}

	subject := joinNonEmptyStrings(" ", brand, model)
	compatibility := "Compatible with a wide range of industrial control systems"
	if strings.TrimSpace(brand) != "" {
		compatibility = "Compatible with " + strings.TrimSpace(brand) + " systems"
	}

	description := "The " + subject + " is a high-performance " + strings.ToLower(productType) +
		" designed for industrial automation applications. It provides " +
		"exceptional reliability and precision for demanding manufacturing environments.\n\n"

	description += "Key Features:\n"
	description += "• Industrial-grade quality and reliability\n"
	description += "• Designed for industrial automation\n"
	description += "• High-performance specifications\n"
	description += "• " + compatibility + "\n"
	description += "• Professional-grade construction\n\n"

	description += "Applications:\n"
	description += "• CNC machine tools\n"
	description += "• Industrial robots\n"
	description += "• Factory automation systems\n"
	description += "• Manufacturing equipment\n\n"

	description += "This " + model + " component is ideal for replacement, repair, or upgrade applications " +
		"in industrial control systems. We provide quality-assured parts with technical support."

	return description
}

// GenerateDescription keeps the historical signature and stays brand-neutral.
func GenerateDescription(model, productType string) string {
	return GenerateDescriptionForBrand("", model, productType)
}

// GenerateSEOTitleForBrand creates an SEO-friendly title.
func GenerateSEOTitleForBrand(brand, model, productType string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	if strings.TrimSpace(productType) == "" {
		productType = determineProductType(model)
	}
	return joinNonEmptyStrings(" ", brand, model, productType) + " | Industrial Automation Parts"
}

// GenerateSEOTitle keeps the historical signature and stays brand-neutral.
func GenerateSEOTitle(model, productType string) string {
	return GenerateSEOTitleForBrand("", model, productType)
}

// GenerateSEODescriptionForBrand creates an SEO-friendly meta description.
func GenerateSEODescriptionForBrand(brand, model, productType string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	if strings.TrimSpace(productType) == "" {
		productType = determineProductType(model)
	}
	subject := joinNonEmptyStrings(" ", brand, model)
	compatibility := "Industrial automation component"
	if strings.TrimSpace(brand) != "" {
		compatibility = "Compatible with " + strings.TrimSpace(brand) + " systems"
	}
	return "Buy " + subject + " " + strings.ToLower(productType) +
		". High-quality industrial automation component with fast shipping and warranty. " + compatibility + "."
}

// GenerateSEODescription keeps the historical signature and stays
// brand-neutral.
func GenerateSEODescription(model, productType string) string {
	return GenerateSEODescriptionForBrand("", model, productType)
}

// GenerateSEOKeywordsForBrand creates SEO keywords. Brand keywords are only
// emitted when a brand is supplied.
func GenerateSEOKeywordsForBrand(brand, model, productType string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	if strings.TrimSpace(productType) == "" {
		productType = determineProductType(model)
	}

	brand = strings.TrimSpace(brand)
	keywords := []string{
		joinNonEmptyStrings(" ", brand, model),
		model,
	}
	if brand != "" {
		keywords = append(keywords,
			joinNonEmptyStrings(" ", brand, strings.ToLower(productType)),
			brand+" parts",
			brand+" replacement",
		)
	}
	keywords = append(keywords,
		productType,
		"industrial automation",
		"CNC parts",
		"automation components",
		"industrial parts",
	)

	return strings.Join(RemoveEmpty(keywords), ", ")
}

// GenerateSEOKeywords keeps the historical signature and stays brand-neutral.
func GenerateSEOKeywords(model, productType string) string {
	return GenerateSEOKeywordsForBrand("", model, productType)
}

// CleanFilename removes special characters and normalizes filename
func CleanFilename(filename string) string {
	// Remove special characters except alphanumeric, dots, dashes, and underscores
	re := regexp.MustCompile(`[^a-zA-Z0-9.\-_]`)
	cleaned := re.ReplaceAllString(filename, "_")

	// Remove multiple consecutive underscores
	re = regexp.MustCompile(`_+`)
	cleaned = re.ReplaceAllString(cleaned, "_")

	// Remove leading/trailing underscores
	cleaned = strings.Trim(cleaned, "_")

	return cleaned
}
