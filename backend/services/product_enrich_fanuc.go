package services

import (
	"fmt"
	"regexp"
	"strings"

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
}

var (
	reFanucA02B               = regexp.MustCompile(`(?i)^A02B`)
	reFanucA03B               = regexp.MustCompile(`(?i)^A03B`)
	reFanucA06B               = regexp.MustCompile(`(?i)^A06B`)
	reFanucA06BServoAmplifier = regexp.MustCompile(`(?i)^A06B-6`)
	reFanucA06BServoMotor     = regexp.MustCompile(`(?i)^A06B-(0[0-6]|2[0-9]|3[0-9]|4[0-9]|5[0-9])`)
	reFanucA06BSpindleMotor   = regexp.MustCompile(`(?i)^A06B-(0[78]|1[0-8])`)
	reFanucA14B               = regexp.MustCompile(`(?i)^A14B`)
	reFanucCable              = regexp.MustCompile(`(?i)^(A66[0-9A-Z]-|CAB|CABLE|CONNECTOR|CONN)`)
	// Common FANUC PCB-ish prefixes
	reFanucPCB = regexp.MustCompile(`(?i)^(A16B|A20B|A17B|A18B)`)
)

func FanucEnrich(model string) EnrichedProduct {
	model = strings.TrimSpace(model)
	upper := NormalizeProductModel(model)

	inference := inferFanucCategoryInference(upper)
	partType := inference.PartType
	categorySlug := inference.CategorySlug

	name := fmt.Sprintf("FANUC %s %s", upper, partType)
	name = strings.TrimSpace(name)

	shortDesc := buildFanucShortDescription(upper, partType)
	shortDesc = limitLen(shortDesc, 200)

	desc := buildFanucDescription(upper, partType)

	metaTitle := buildMetaTitle("FANUC", upper, partType)
	metaDesc := buildMetaDescription("FANUC", upper, partType)
	metaKeywords := buildMetaKeywords("FANUC", upper, partType)

	return EnrichedProduct{
		Name:              name,
		ShortDescription:  shortDesc,
		Description:       desc,
		MetaTitle:         metaTitle,
		MetaDescription:   metaDesc,
		MetaKeywords:      metaKeywords,
		CompatibilityInfo: buildFanucCompatibilityInfo(upper, partType),
		InstallationGuide: buildFanucInstallationGuide(upper, partType),
		MaintenanceTips:   buildFanucMaintenanceTips(upper, partType),
		PartType:          partType,
		CategorySlug:      categorySlug,
	}
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

	switch {
	case strings.HasPrefix(upper, "A05B") || strings.HasPrefix(upper, "18-MB") || strings.Contains(upper, "MDI") || strings.Contains(upper, "PENDANT"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Operator Panel / MDI", CategorySlug: "fanuc-operator-panel-mdi", MatchRule: "fanuc:operator-panel"}
	case strings.HasPrefix(upper, "A61L") || strings.Contains(upper, "DISPLAY") || strings.Contains(upper, "MONITOR") || strings.Contains(upper, "CRT") || strings.Contains(upper, "LCD"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Display / Monitor", CategorySlug: "fanuc-display-monitor", MatchRule: "fanuc:display"}
	case strings.HasPrefix(upper, "A860") || strings.Contains(upper, "ENCODER") || strings.Contains(upper, "PULSE-CODER") || strings.Contains(upper, "PULSECODER"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Encoder / Feedback", CategorySlug: "fanuc-encoder-feedback", MatchRule: "fanuc:encoder"}
	case reFanucCable.MatchString(upper) || reGenericCableIndicators.MatchString(upper) || strings.Contains(upper, "#L-"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Cable / Connector", CategorySlug: "fanuc-cables-connectors", MatchRule: "fanuc:cable"}
	case strings.HasPrefix(upper, "A90L") || strings.Contains(upper, "FAN") || strings.Contains(upper, "FILTER") || strings.Contains(upper, "COOL"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Fan / Cooling Unit", CategorySlug: "fanuc-filters-fan-unit-cooling", MatchRule: "fanuc:cooling"}
	case strings.Contains(upper, "BATTERY"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Battery", CategorySlug: "fanuc-battery", MatchRule: "fanuc:battery"}
	case strings.HasPrefix(upper, "A50L") || strings.HasPrefix(upper, "A60L") || strings.HasPrefix(upper, "A58L") || reFanucA14B.MatchString(upper):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Power Supply Unit", CategorySlug: "fanuc-power-supply", MatchRule: "fanuc:power"}
	case reFanucA03B.MatchString(upper) || strings.HasPrefix(upper, "A04B"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "I/O Module", CategorySlug: "fanuc-i-o-module", MatchRule: "fanuc:io"}
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

func buildFanucDescription(model, partType string) string {
	application := fanucApplicationSummary(partType)
	selection := fanucSelectionGuidance(partType)
	seriesHint := fanucSeriesHint(model)

	lines := []string{
		fmt.Sprintf("FANUC %s %s", model, partType),
		"",
		fmt.Sprintf("FANUC %s is a %s used in CNC machine maintenance, retrofit, and industrial automation support. %s It is commonly sourced for replacement projects where stable operation, compatibility verification, and fast delivery matter.", model, strings.ToLower(partType), application),
		"",
		"Key details",
		fmt.Sprintf("- Brand: FANUC"),
		fmt.Sprintf("- Part No.: %s", model),
		fmt.Sprintf("- Type: %s", partType),
		"- Condition: New / Refurbished / Used (please confirm before ordering)",
		"- Warranty: 12 months",
		"- Lead time: 3-7 days",
		"- Shipping: Worldwide",
		"",
		"Compatibility and ordering guidance",
		"- Compatibility depends on the CNC series, machine builder configuration, and option code.",
		fmt.Sprintf("- %s", selection),
		"- Send your controller model, machine model, and original part label for verification before shipment.",
	}

	if seriesHint != "" {
		lines = append(lines,
			fmt.Sprintf("- Typical series family: %s", seriesHint),
		)
	}

	lines = append(lines,
		"",
		"Typical applications",
		fmt.Sprintf("- %s", application),
		"- Preventive maintenance and urgent breakdown replacement",
		"- Repair inventory for machine tool service teams",
		"",
		"Why buy from VIBO CNC",
		"- Professional industrial automation supplier since 2005",
		"- Stocked inventory and fast handling",
		"- International shipping support",
		"- Technical confirmation before dispatch when needed",
	)
	return strings.Join(lines, "\n")
}

func buildFanucShortDescription(model, partType string) string {
	return fmt.Sprintf(
		"FANUC %s %s for CNC repair, replacement, and industrial automation support. Tested supply with 12-month warranty and worldwide shipping.",
		model,
		partType,
	)
}

func buildFanucCompatibilityInfo(model, partType string) string {
	return fmt.Sprintf(
		"Compatibility for FANUC %s %s should be checked against the original part number, CNC series, amplifier or controller model, and machine builder option code. Share your existing nameplate photo or alarm information before ordering so we can confirm interchangeability.",
		model,
		partType,
	)
}

func buildFanucInstallationGuide(model, partType string) string {
	return strings.Join([]string{
		fmt.Sprintf("Before installing FANUC %s, isolate machine power and confirm the exact part number on the original unit.", model),
		"Inspect connectors, mounting points, and cable orientation before removal.",
		"After replacement, verify alarms, parameters, and axis or control response according to your machine maintenance procedure.",
		"If parameter backup or commissioning is required, ask your technician to complete it before production restart.",
	}, "\n")
}

func buildFanucMaintenanceTips(model, partType string) string {
	return strings.Join([]string{
		fmt.Sprintf("Keep FANUC %s clean, dry, and protected from conductive dust, oil mist, and unstable voltage.", model),
		"Check cabinet ventilation, grounding, and connector condition during routine maintenance.",
		"Record alarm history and replacement dates so future troubleshooting is faster.",
		"For long-term spares storage, use anti-static and moisture-protection packaging.",
	}, "\n")
}

func buildMetaTitle(brand, model, partType string) string {
	return BuildSafeMetaTitle(
		fmt.Sprintf("%s %s %s | VIBO CNC", brand, model, partType),
		fmt.Sprintf("%s %s | VIBO CNC", brand, model),
		fmt.Sprintf("%s %s %s", brand, model, partType),
		fmt.Sprintf("%s %s", brand, model),
	)
}

func buildMetaDescription(brand, model, partType string) string {
	return BuildSafeMetaDescription(
		fmt.Sprintf("%s %s %s for CNC repair and industrial automation. Compatibility check, 12-month warranty, fast worldwide shipping.", brand, model, partType),
		fmt.Sprintf("%s %s %s with compatibility support, 12-month warranty, and global delivery.", brand, model, partType),
		fmt.Sprintf("%s %s %s for CNC repair and replacement.", brand, model, partType),
	)
}

func buildMetaKeywords(brand, model, partType string) string {
	parts := []string{
		fmt.Sprintf("%s %s", brand, model),
		model,
		partType,
		"FANUC parts",
		"FANUC spare parts",
		"CNC replacement parts",
		"CNC parts",
		"industrial automation",
		"VIBO CNC",
	}
	return strings.Join(dedupeStrings(parts), ", ")
}

func fanucApplicationSummary(partType string) string {
	lower := strings.ToLower(partType)
	switch {
	case strings.Contains(lower, "servo"):
		return "Typical use includes axis motion control, servo response recovery, and machine uptime support in machining centers and automation cells."
	case strings.Contains(lower, "power"):
		return "Typical use includes restoring stable power distribution and cabinet operation in CNC controls and related drive systems."
	case strings.Contains(lower, "i/o"):
		return "Typical use includes input and output signal processing between the CNC controller, machine panel, and field devices."
	case strings.Contains(lower, "pcb"), strings.Contains(lower, "board"):
		return "Typical use includes signal processing, control logic, and board-level replacement inside FANUC CNC cabinets."
	case strings.Contains(lower, "control"):
		return "Typical use includes CNC control, operator interface, and machine system coordination in industrial environments."
	case strings.Contains(lower, "cable"), strings.Contains(lower, "connector"):
		return "Typical use includes stable signal and power transmission between FANUC units, panels, and machine assemblies."
	default:
		return "Typical use includes CNC maintenance, part replacement, and industrial automation system support."
	}
}

func fanucSelectionGuidance(partType string) string {
	lower := strings.ToLower(partType)
	switch {
	case strings.Contains(lower, "servo"):
		return "Confirm motor series, encoder specification, shaft or flange details, and amplifier pairing before purchase."
	case strings.Contains(lower, "power"):
		return "Confirm input voltage, output rating, cabinet series, and connector layout before purchase."
	case strings.Contains(lower, "i/o"):
		return "Confirm I/O point count, board revision, and matching controller series before purchase."
	case strings.Contains(lower, "pcb"), strings.Contains(lower, "board"):
		return "Confirm board assembly number, software version, and connector position before purchase."
	case strings.Contains(lower, "cable"), strings.Contains(lower, "connector"):
		return "Confirm cable length, terminal type, and mating connector reference before purchase."
	default:
		return "Confirm the original label, applicable CNC series, and machine configuration before purchase."
	}
}

func fanucSeriesHint(model string) string {
	switch {
	case strings.HasPrefix(model, "A02B"), strings.HasPrefix(model, "A03B"), strings.HasPrefix(model, "A04B"), strings.HasPrefix(model, "A05B"):
		return "FANUC control and I/O related assemblies"
	case strings.HasPrefix(model, "A06B"), strings.HasPrefix(model, "A860"), strings.HasPrefix(model, "A290"), strings.HasPrefix(model, "A660"):
		return "FANUC servo and encoder related assemblies"
	case strings.HasPrefix(model, "A14B"), strings.HasPrefix(model, "A16B"), strings.HasPrefix(model, "A20B"):
		return "FANUC power or PCB related assemblies"
	case strings.HasPrefix(model, "A61L"), strings.HasPrefix(model, "A66L"), strings.HasPrefix(model, "A98L"):
		return "FANUC panel, display, or power accessory related assemblies"
	default:
		return ""
	}
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
