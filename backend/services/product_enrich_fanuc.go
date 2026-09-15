package services

import (
	"regexp"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/utils"
)

type EnrichedProduct struct {
	Name              string
	ShortDescription  string
	Description       string
	MetaTitle         string
	MetaDescription   string
	MetaKeywords      string
	CompatibilityInfo string
	InstallationGuide string
	MaintenanceTips   string
	PartType          string
	CategorySlug      string
	// TechnicalSpecs carries the JSON specification table built from known
	// catalogue fields (plus reviewed research when available).
	TechnicalSpecs string
}

var (
	reFanucA02B               = regexp.MustCompile(`(?i)^A02B`)
	reFanucA03B               = regexp.MustCompile(`(?i)^A03B`)
	reFanucA06B               = regexp.MustCompile(`(?i)^A06B`)
	reFanucA06BServoAmplifier = regexp.MustCompile(`(?i)^A06B-6`)
	reFanucSpindleAmplifier   = regexp.MustCompile(`(?i)^A06B-6092-`)
	reFanucA06BServoMotor     = regexp.MustCompile(`(?i)^A06B-(0[0-6]|2[0-9]|3[0-9]|4[0-9]|5[0-9])`)
	reFanucA06BSpindleMotor   = regexp.MustCompile(`(?i)^A06B-(0[78]|1[0-8])`)
	reFanucA14B               = regexp.MustCompile(`(?i)^A14B`)
	reFanucCable              = regexp.MustCompile(`(?i)^(A66[0-9A-Z]-|CAB|CABLE|CONNECTOR|CONN)`)
	// Common FANUC PCB-ish prefixes
	reFanucPCB = regexp.MustCompile(`(?i)^(A16B|A20B|A17B|A18B)`)
)

// FanucEnrich keeps the historical entry point used by imports and CLI tools.
// The narrative itself now comes from the brand-agnostic content skeleton so
// every brand publishes the same structure and the same admin-editable promise
// (shipping / warranty / returns) instead of FANUC-specific hard-coded text.
func FanucEnrich(model string) EnrichedProduct {
	return enrichWithContentSkeleton("fanuc", "FANUC", model, nil)
}

// enrichWithContentSkeleton is the single entry point for generated catalogue
// copy across every supported brand.
func enrichWithContentSkeleton(brandKey string, brandName string, model string, product *models.Product) EnrichedProduct {
	normalizedModel := NormalizeProductModel(model)
	if normalizedModel == "" && product != nil {
		normalizedModel = NormalizeProductModel(product.Model)
	}

	inference := InferProductCategory(brandKey, normalizedModel)
	if strings.TrimSpace(inference.BrandKey) == "" || strings.EqualFold(inference.BrandKey, "unknown") {
		inference.BrandKey = NormalizeBrandKey(brandKey)
	}
	if strings.TrimSpace(inference.BrandName) == "" {
		inference.BrandName = brandName
	}
	if strings.TrimSpace(inference.BrandName) == "" {
		inference.BrandName = CanonicalBrandName(inference.BrandKey)
	}

	policy := CurrentCommercePolicy()

	// Reviewed research parameters live in the technical_specs column; merging
	// them here means an approved value flows into the next generated copy
	// without any second source of truth.
	var specs map[string]string
	if product != nil {
		specs = MergeTechnicalSpecs(KnownTechnicalSpecs(product, policy), ParseTechnicalSpecs(product.TechnicalSpecs))
	}

	return BuildProductContentSkeleton(ContentSkeletonInput{
		BrandKey:     inference.BrandKey,
		BrandName:    inference.BrandName,
		Model:        normalizedModel,
		PartType:     inference.PartType,
		CategorySlug: inference.CategorySlug,
		Product:      product,
		Policy:       policy,
		Specs:        specs,
	})
}

func inferFanucCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	if upper == "" {
		return ProductCategoryInference{
			BrandKey:     "fanuc",
			BrandName:    "FANUC",
			PartType:     "Spare Part",
			CategorySlug: "fanuc-accessories-others",
			MatchRule:    "fanuc:empty-model",
		}
	}
	tokens := classificationTokenSet(upper)

	switch {
	case strings.HasPrefix(upper, "A05B") || strings.HasPrefix(upper, "18-MB"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Operator Panel / MDI", CategorySlug: "fanuc-operator-panel-mdi", MatchRule: "fanuc:operator-panel"}
	case strings.Contains(upper, "MDI") || strings.Contains(upper, "PENDANT"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Operator Panel / MDI", CategorySlug: "fanuc-operator-panel-mdi", MatchRule: "fanuc:keyword-operator-panel"}
	case strings.HasPrefix(upper, "A61L"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Display / Monitor", CategorySlug: "fanuc-display-monitor", MatchRule: "fanuc:display"}
	case strings.Contains(upper, "DISPLAY") || strings.Contains(upper, "MONITOR") || strings.Contains(upper, "CRT") || strings.Contains(upper, "LCD"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Display / Monitor", CategorySlug: "fanuc-display-monitor", MatchRule: "fanuc:keyword-display"}
	case strings.HasPrefix(upper, "A860"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Encoder / Feedback", CategorySlug: "fanuc-encoder-feedback", MatchRule: "fanuc:encoder"}
	case strings.Contains(upper, "ENCODER") || strings.Contains(upper, "PULSE-CODER") || strings.Contains(upper, "PULSECODER"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Encoder / Feedback", CategorySlug: "fanuc-encoder-feedback", MatchRule: "fanuc:keyword-encoder"}
	case strings.HasPrefix(upper, "A66"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Cable / Connector", CategorySlug: "fanuc-cables-connectors", MatchRule: "fanuc:cable"}
	case reFanucCable.MatchString(upper) || classificationHasToken(tokens, "cable", "cab", "connector", "conn", "harness", "wire", "plug", "socket") || strings.Contains(upper, "#L-"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Cable / Connector", CategorySlug: "fanuc-cables-connectors", MatchRule: "fanuc:keyword-cable"}
	case strings.HasPrefix(upper, "A90L"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Fan / Cooling Unit", CategorySlug: "fanuc-filters-fan-unit-cooling", MatchRule: "fanuc:cooling"}
	case strings.Contains(upper, "FAN") || strings.Contains(upper, "FILTER") || strings.Contains(upper, "COOL"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Fan / Cooling Unit", CategorySlug: "fanuc-filters-fan-unit-cooling", MatchRule: "fanuc:keyword-cooling"}
	case strings.HasPrefix(upper, "A98L"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Battery", CategorySlug: "fanuc-battery", MatchRule: "fanuc:battery"}
	case strings.Contains(upper, "BATTERY"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Battery", CategorySlug: "fanuc-battery", MatchRule: "fanuc:keyword-battery"}
	case strings.HasPrefix(upper, "A50L") || strings.HasPrefix(upper, "A60L") || strings.HasPrefix(upper, "A58L") || reFanucA14B.MatchString(upper):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Power Supply Unit", CategorySlug: "fanuc-power-supply", MatchRule: "fanuc:power"}
	case reFanucA03B.MatchString(upper) || strings.HasPrefix(upper, "A04B"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "I/O Module", CategorySlug: "fanuc-i-o-module", MatchRule: "fanuc:io"}
	case reFanucSpindleAmplifier.MatchString(upper):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Spindle Amplifier / Drive", CategorySlug: "fanuc-spindle-amplifier-drive", MatchRule: "fanuc:spindle-amplifier"}
	case reFanucA06BServoAmplifier.MatchString(upper):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Servo Amplifier / Drive", CategorySlug: "fanuc-servo-amplifier-drive", MatchRule: "fanuc:servo-amplifier"}
	case reFanucA06BSpindleMotor.MatchString(upper):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Spindle Motor", CategorySlug: "fanuc-spindle-motor", MatchRule: "fanuc:spindle-motor"}
	case reFanucA06BServoMotor.MatchString(upper) || reFanucA06B.MatchString(upper):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Servo Motor", CategorySlug: "fanuc-servo-motor", MatchRule: "fanuc:servo-motor"}
	case strings.HasPrefix(upper, "A87L") || strings.HasPrefix(upper, "A48L"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Memory / Storage", CategorySlug: "fanuc-memory-storage", MatchRule: "fanuc:memory"}
	case reFanucA02B.MatchString(upper) || reFanucPCB.MatchString(upper) || strings.HasPrefix(upper, "A20B") || strings.HasPrefix(upper, "A16B") || strings.HasPrefix(upper, "A17B") || strings.HasPrefix(upper, "A20B") || strings.HasPrefix(upper, "A15L") || strings.HasPrefix(upper, "F02B"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "PCB Board", CategorySlug: "fanuc-pcb-control-board", MatchRule: "fanuc:pcb"}
	case strings.HasPrefix(upper, "A230") || strings.HasPrefix(upper, "A250") || strings.HasPrefix(upper, "A13B") || strings.HasPrefix(upper, "A08B") || strings.HasPrefix(upper, "A990") || strings.HasPrefix(upper, "A980") || strings.HasPrefix(upper, "A028") || strings.HasPrefix(upper, "A300") || strings.HasPrefix(upper, "A370"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "CNC System Part", CategorySlug: "fanuc-cnc-system-parts", MatchRule: "fanuc:cnc-system"}
	default:
		partType := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(utils.DetermineProductType(upper), "Industrial Component", ""), "  ", " "))
		if partType == "" {
			partType = "Accessory / Spare Part"
		}
		return ProductCategoryInference{
			BrandKey:     "fanuc",
			BrandName:    "FANUC",
			PartType:     partType,
			CategorySlug: inferFanucCategorySlugFromPartType(partType),
			MatchRule:    "fanuc:fallback",
		}
	}
}

func inferFanucCategorySlugFromPartType(partType string) string {
	lower := strings.ToLower(strings.TrimSpace(partType))
	switch {
	case lower == "":
		return "fanuc-accessories-others"
	case strings.Contains(lower, "cable"), strings.Contains(lower, "connector"), strings.Contains(lower, "harness"), strings.Contains(lower, "plug"), strings.Contains(lower, "socket"):
		return "fanuc-cables-connectors"
	case strings.Contains(lower, "power"), strings.Contains(lower, "fuse"), strings.Contains(lower, "transistor"):
		return "fanuc-power-supply"
	case strings.Contains(lower, "i/o"), strings.Contains(lower, "io module"), strings.Contains(lower, "input"), strings.Contains(lower, "output"):
		return "fanuc-i-o-module"
	case strings.Contains(lower, "spindle") && strings.Contains(lower, "amplifier"):
		return "fanuc-spindle-amplifier-drive"
	case strings.Contains(lower, "spindle") && strings.Contains(lower, "motor"):
		return "fanuc-spindle-motor"
	case strings.Contains(lower, "servo") && (strings.Contains(lower, "drive") || strings.Contains(lower, "amplifier")):
		return "fanuc-servo-amplifier-drive"
	case strings.Contains(lower, "servo") && strings.Contains(lower, "motor"):
		return "fanuc-servo-motor"
	case strings.Contains(lower, "encoder"), strings.Contains(lower, "feedback"):
		return "fanuc-encoder-feedback"
	case strings.Contains(lower, "pcb"), strings.Contains(lower, "board"), strings.Contains(lower, "cpu"), strings.Contains(lower, "memory card"), strings.Contains(lower, "main board"):
		return "fanuc-pcb-control-board"
	case strings.Contains(lower, "memory"), strings.Contains(lower, "storage"):
		return "fanuc-memory-storage"
	case strings.Contains(lower, "battery"):
		return "fanuc-battery"
	case strings.Contains(lower, "fan"), strings.Contains(lower, "filter"), strings.Contains(lower, "cool"):
		return "fanuc-filters-fan-unit-cooling"
	case strings.Contains(lower, "operator"), strings.Contains(lower, "mdi"), strings.Contains(lower, "pendant"):
		return "fanuc-operator-panel-mdi"
	case strings.Contains(lower, "display"), strings.Contains(lower, "monitor"), strings.Contains(lower, "crt"), strings.Contains(lower, "lcd"):
		return "fanuc-display-monitor"
	case strings.Contains(lower, "controller"), strings.Contains(lower, "control"), strings.Contains(lower, "cnc system"):
		return "fanuc-cnc-system-parts"
	default:
		return "fanuc-accessories-others"
	}
}

func inferFanucTypeAndCategory(model string) (partType string, categorySlug string) {
	inference := inferFanucCategoryInference(model)
	return inference.PartType, inference.CategorySlug
}

func dedupeStrings(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		key := strings.ToLower(s)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, s)
	}
	return out
}

func limitLen(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 {
		return s
	}
	if len(s) <= max {
		return s
	}
	if max <= 3 {
		return s[:max]
	}
	return strings.TrimSpace(s[:max-3]) + "..."
}
