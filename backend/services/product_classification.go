package services

import (
	"regexp"
	"strings"

	"fanuc-backend/utils"
)

type ProductCategoryInference struct {
	BrandKey     string `json:"brand_key"`
	BrandName    string `json:"brand_name"`
	PartType     string `json:"part_type"`
	CategorySlug string `json:"category_slug"`
	MatchRule    string `json:"match_rule"`
}

var (
	reLikelyFanucModel       = regexp.MustCompile(`(?i)^(A0[234568]B|A1[3467]B|A20B|A230|A250|A290|A300|A370|A[0-9]{2}L|A660|A860|A980|A990|F0?6B|F660|CAB|CABLE|CONNECTOR|CONN|18-MB)`)
	reGenericCableIndicators = regexp.MustCompile(`(?i)(CABLE|CAB|CONN|CONNECTOR|HARNESS|WIRE|PLUG|SOCKET|TERMINAL|#L-?\d|-\d+(\.\d+)?M$)`)
	reGenericPowerIndicators = regexp.MustCompile(`(?i)(POWER|PSU|FUSE|TRANSISTOR|MODULE)`)
	reGenericIOIndicators    = regexp.MustCompile(`(?i)(I/?O|INPUT|OUTPUT|PLC)`)
	reGenericServoIndicators = regexp.MustCompile(`(?i)(SERVO|SPINDLE|ENCODER|AMPLIFIER|MOTOR|DRIVE)`)
	reGenericBoardIndicators = regexp.MustCompile(`(?i)(PCB|BOARD|CPU|MEMORY|AXIS|MAIN\s*BOARD|CARD)`)
	reGenericControlWords    = regexp.MustCompile(`(?i)(CONTROL|CONTROLLER|PENDANT|HMI|DISPLAY|MONITOR)`)
)

func NormalizeProductModel(model string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	model = strings.ReplaceAll(model, "\\", "-")
	model = strings.ReplaceAll(model, "/", "-")
	model = strings.ReplaceAll(model, " ", "-")
	for strings.Contains(model, "--") {
		model = strings.ReplaceAll(model, "--", "-")
	}
	model = strings.Trim(model, "-")
	model = strings.ToUpper(model)
	if strings.HasPrefix(model, "FANUC-") {
		model = strings.TrimPrefix(model, "FANUC-")
	}
	if strings.HasPrefix(model, "FANUC ") {
		model = strings.TrimSpace(strings.TrimPrefix(model, "FANUC "))
	}
	return model
}

func NormalizeBrandKey(brand string) string {
	key := strings.ToLower(strings.TrimSpace(brand))
	key = strings.NewReplacer(" ", "", "-", "", "_", "").Replace(key)
	switch key {
	case "":
		return ""
	case "fanuc":
		return "fanuc"
	case "mitsubishi", "misubishi", "melsec":
		return "mitsubishi"
	case "siemens":
		return "siemens"
	case "abb":
		return "abb"
	case "allenbradley", "allenbradly", "ab", "rockwell":
		return "allen-bradley"
	default:
		return key
	}
}

func CanonicalBrandName(brand string) string {
	switch NormalizeBrandKey(brand) {
	case "":
		return ""
	case "fanuc":
		return "FANUC"
	case "mitsubishi":
		return "Mitsubishi"
	case "siemens":
		return "Siemens"
	case "abb":
		return "ABB"
	case "allen-bradley":
		return "Allen-Bradley"
	default:
		return strings.TrimSpace(brand)
	}
}

func InferProductCategory(brand string, model string) ProductCategoryInference {
	brandKey := NormalizeBrandKey(brand)
	switch brandKey {
	case "fanuc":
		return inferFanucCategoryInference(model)
	case "mitsubishi":
		return inferGenericCategoryInference("mitsubishi", model)
	default:
		if (brandKey == "" || brandKey == "unknown") && IsLikelyFanucModel(model) {
			return inferFanucCategoryInference(model)
		}
		return inferGenericCategoryInference(brand, model)
	}
}

func IsLikelyFanucModel(model string) bool {
	upper := NormalizeProductModel(model)
	return upper != "" && reLikelyFanucModel.MatchString(upper)
}

func inferGenericCategoryInference(brand string, model string) ProductCategoryInference {
	brandKey := NormalizeBrandKey(brand)
	brandName := CanonicalBrandName(brand)
	upper := NormalizeProductModel(model)
	if upper == "" {
		return ProductCategoryInference{
			BrandKey:     brandKey,
			BrandName:    brandName,
			PartType:     "Spare Part",
			CategorySlug: "control-units",
			MatchRule:    "generic:empty-model",
		}
	}

	switch {
	case reGenericCableIndicators.MatchString(upper):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Cable / Connector", CategorySlug: "cables-connectors", MatchRule: "generic:cable-keyword"}
	case reGenericPowerIndicators.MatchString(upper):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Power Supply Unit", CategorySlug: "power-supplies", MatchRule: "generic:power-keyword"}
	case reGenericIOIndicators.MatchString(upper):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "I/O Module", CategorySlug: "io-modules", MatchRule: "generic:io-keyword"}
	case reGenericServoIndicators.MatchString(upper):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Servo Motor / Drive", CategorySlug: "servo-motors", MatchRule: "generic:servo-keyword"}
	case reGenericBoardIndicators.MatchString(upper):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "PCB Board", CategorySlug: "pcb-boards", MatchRule: "generic:board-keyword"}
	case reGenericControlWords.MatchString(upper):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Control Unit", CategorySlug: "control-units", MatchRule: "generic:control-keyword"}
	default:
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Spare Part", CategorySlug: "control-units", MatchRule: "generic:fallback"}
	}
}

func inferCategorySlugFromPartType(partType string) string {
	lower := strings.ToLower(strings.TrimSpace(partType))
	switch {
	case lower == "":
		return "control-units"
	case strings.Contains(lower, "cable"), strings.Contains(lower, "connector"), strings.Contains(lower, "harness"), strings.Contains(lower, "plug"), strings.Contains(lower, "socket"):
		return "cables-connectors"
	case strings.Contains(lower, "power"), strings.Contains(lower, "fuse"), strings.Contains(lower, "transistor"):
		return "power-supplies"
	case strings.Contains(lower, "i/o"), strings.Contains(lower, "io module"), strings.Contains(lower, "input"), strings.Contains(lower, "output"):
		return "io-modules"
	case strings.Contains(lower, "servo"), strings.Contains(lower, "spindle"), strings.Contains(lower, "encoder"), strings.Contains(lower, "motor"), strings.Contains(lower, "drive"), strings.Contains(lower, "amplifier"):
		return "servo-motors"
	case strings.Contains(lower, "pcb"), strings.Contains(lower, "board"), strings.Contains(lower, "cpu"), strings.Contains(lower, "memory"), strings.Contains(lower, "card"):
		return "pcb-boards"
	case strings.Contains(lower, "controller"), strings.Contains(lower, "control"), strings.Contains(lower, "pendant"), strings.Contains(lower, "display"), strings.Contains(lower, "monitor"):
		return "control-units"
	default:
		return "control-units"
	}
}

func inferProductTypeFromModel(brand string, model string) string {
	if NormalizeBrandKey(brand) == "fanuc" {
		partType := utils.DetermineProductType(NormalizeProductModel(model))
		if partType != "" && partType != "Industrial Component" {
			return partType
		}
	}
	return InferProductCategory(brand, model).PartType
}
