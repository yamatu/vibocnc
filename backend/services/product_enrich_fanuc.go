package services

import (
	"fmt"
	"regexp"
	"strings"

	"fanuc-backend/utils"
)

type EnrichedProduct struct {
	Name             string
	ShortDescription string
	Description      string
	MetaTitle        string
	MetaDescription  string
	MetaKeywords     string
	PartType         string
	CategorySlug     string
}

var (
	reFanucA02B  = regexp.MustCompile(`(?i)^A02B`)
	reFanucA03B  = regexp.MustCompile(`(?i)^A03B`)
	reFanucA06B  = regexp.MustCompile(`(?i)^A06B`)
	reFanucA14B  = regexp.MustCompile(`(?i)^A14B`)
	reFanucCable = regexp.MustCompile(`(?i)^(A66[0-9A-Z]-|CAB|CABLE|CONNECTOR|CONN)`)
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

	shortDesc := fmt.Sprintf("FANUC %s %s for CNC and industrial automation. Tested, ready to ship worldwide.", upper, partType)
	shortDesc = limitLen(shortDesc, 200)

	desc := buildFanucDescription(upper, partType)

	metaTitle := buildMetaTitle("FANUC", upper, partType)
	metaDesc := buildMetaDescription("FANUC", upper, partType)
	metaKeywords := buildMetaKeywords("FANUC", upper, partType)

	return EnrichedProduct{
		Name:             name,
		ShortDescription: shortDesc,
		Description:      desc,
		MetaTitle:        metaTitle,
		MetaDescription:  metaDesc,
		MetaKeywords:     metaKeywords,
		PartType:         partType,
		CategorySlug:     categorySlug,
	}
}

func inferFanucCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	if upper == "" {
		return ProductCategoryInference{
			BrandKey:     "fanuc",
			BrandName:    "FANUC",
			PartType:     "Spare Part",
			CategorySlug: "control-units",
			MatchRule:    "fanuc:empty-model",
		}
	}

	switch {
	case reFanucCable.MatchString(upper) || reGenericCableIndicators.MatchString(upper) || strings.Contains(upper, "#L-"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Cable / Connector", CategorySlug: "cables-connectors", MatchRule: "fanuc:cable"}
	case strings.HasPrefix(upper, "A97L") || strings.HasPrefix(upper, "A98L") || strings.HasPrefix(upper, "A90L") || strings.HasPrefix(upper, "A86L") || strings.HasPrefix(upper, "A63L") || strings.HasPrefix(upper, "A66L") || strings.HasPrefix(upper, "A76L") || strings.HasPrefix(upper, "A40L") || strings.HasPrefix(upper, "A42L") || strings.HasPrefix(upper, "A44L") || strings.HasPrefix(upper, "A45L") || strings.HasPrefix(upper, "A55L") || strings.HasPrefix(upper, "A57L") || strings.HasPrefix(upper, "A61L") || strings.HasPrefix(upper, "A65L") || strings.HasPrefix(upper, "A70L") || strings.HasPrefix(upper, "A74L") || strings.HasPrefix(upper, "A80L") || strings.HasPrefix(upper, "A81L") || strings.HasPrefix(upper, "A91L") || strings.HasPrefix(upper, "A13L"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Power Supply Unit", CategorySlug: "power-supplies", MatchRule: "fanuc:l-series-power"}
	case strings.HasPrefix(upper, "A03B") || strings.HasPrefix(upper, "A02B-00") || strings.HasPrefix(upper, "A02B-02") || strings.HasPrefix(upper, "A08B") || strings.HasPrefix(upper, "A04B"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "I/O Module", CategorySlug: "io-modules", MatchRule: "fanuc:io"}
	case strings.HasPrefix(upper, "A06B") || strings.HasPrefix(upper, "A860") || strings.HasPrefix(upper, "A290") || strings.HasPrefix(upper, "A660") || strings.HasPrefix(upper, "F660") || strings.HasPrefix(upper, "F06B") || strings.HasPrefix(upper, "A57L") || strings.HasPrefix(upper, "A86L"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Servo Motor / Drive", CategorySlug: "servo-motors", MatchRule: "fanuc:servo"}
	case strings.HasPrefix(upper, "A14B") || strings.HasPrefix(upper, "A50L") || strings.HasPrefix(upper, "A60L") || strings.HasPrefix(upper, "A58L"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Power Supply Unit", CategorySlug: "power-supplies", MatchRule: "fanuc:power"}
	case strings.HasPrefix(upper, "A230") || strings.HasPrefix(upper, "A250") || strings.HasPrefix(upper, "A13B") || strings.HasPrefix(upper, "A05B") || strings.HasPrefix(upper, "A87L") || strings.HasPrefix(upper, "A990") || strings.HasPrefix(upper, "A980"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "Control Unit", CategorySlug: "control-units", MatchRule: "fanuc:control"}
	case reFanucA02B.MatchString(upper) || reFanucPCB.MatchString(upper) || strings.HasPrefix(upper, "A20B") || strings.HasPrefix(upper, "A16B") || strings.HasPrefix(upper, "A17B") || strings.HasPrefix(upper, "A20B") || strings.HasPrefix(upper, "A15L") || strings.HasPrefix(upper, "F02B"):
		return ProductCategoryInference{BrandKey: "fanuc", BrandName: "FANUC", PartType: "PCB Board", CategorySlug: "pcb-boards", MatchRule: "fanuc:pcb"}
	default:
		partType := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(utils.DetermineProductType(upper), "Industrial Component", ""), "  ", " "))
		if partType == "" {
			partType = "Spare Part"
		}
		return ProductCategoryInference{
			BrandKey:     "fanuc",
			BrandName:    "FANUC",
			PartType:     partType,
			CategorySlug: inferCategorySlugFromPartType(partType),
			MatchRule:    "fanuc:fallback",
		}
	}
}

func inferFanucTypeAndCategory(model string) (partType string, categorySlug string) {
	inference := inferFanucCategoryInference(model)
	return inference.PartType, inference.CategorySlug
}

func buildFanucDescription(model, partType string) string {
	lines := []string{
		fmt.Sprintf("FANUC %s %s", model, partType),
		"",
		"Overview",
		fmt.Sprintf("- Brand: FANUC"),
		fmt.Sprintf("- Part No.: %s", model),
		fmt.Sprintf("- Type: %s", partType),
		"- Condition: New / Refurbished / Used (please confirm before ordering)",
		"- Warranty: 12 months",
		"- Lead time: 3-7 days",
		"- Shipping: Worldwide",
		"",
		"Compatibility",
		"- Compatibility depends on your CNC system series and option configuration.",
		"- Send us your controller model and alarm code, we will confirm before shipment.",
		"",
		"Why buy from Vcocnc",
		"- Professional industrial automation supplier since 2005",
		"- Stocked inventory and fast handling",
		"- International shipping support",
	}
	return strings.Join(lines, "\n")
}

func buildMetaTitle(brand, model, partType string) string {
	t := fmt.Sprintf("%s %s %s | In Stock | Vcocnc", brand, model, partType)
	// Keep around <= 60 chars
	if len(t) > 60 {
		t = fmt.Sprintf("%s %s %s | Vcocnc", brand, model, partType)
	}
	if len(t) > 60 {
		t = fmt.Sprintf("%s %s | Vcocnc", brand, model)
	}
	return t
}

func buildMetaDescription(brand, model, partType string) string {
	d := fmt.Sprintf("Buy %s %s %s. Tested industrial automation spare part with 12-month warranty, fast handling, and worldwide shipping. Request compatibility check before ordering.", brand, model, partType)
	return limitLen(d, 155)
}

func buildMetaKeywords(brand, model, partType string) string {
	parts := []string{
		fmt.Sprintf("%s %s", brand, model),
		model,
		partType,
		"FANUC parts",
		"FANUC spare parts",
		"CNC parts",
		"industrial automation",
		"Vcocnc",
	}
	return strings.Join(dedupeStrings(parts), ", ")
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
