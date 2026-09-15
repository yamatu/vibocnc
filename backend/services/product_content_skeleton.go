package services

import (
	"fmt"
	"sort"
	"strings"

	"fanuc-backend/models"
)

// This file replaces the FANUC-only content skeleton with a brand-agnostic one.
// The catalogue covers FANUC, Mitsubishi, Siemens, ABB, Allen-Bradley, Omron,
// Yaskawa, Schneider and more, so no generated copy may assume a single brand
// and no promise (warranty, lead time, shipping, returns) may be hard-coded.
//
// The skeleton is deliberately conservative about facts:
//   - only values that already exist on the product record are published as
//     technical specifications (the operator or the reviewed AI research step
//     adds measured parameters later),
//   - the commercial promise comes from the admin-editable commerce policy.
type ContentSkeletonInput struct {
	BrandKey     string
	BrandName    string
	Model        string
	PartType     string
	CategorySlug string
	// CategoryName is the human readable category path used in the narrative.
	CategoryName string
	// Product is optional. When present, known facts (condition, weight,
	// dimensions, MOQ, certifications, packaging) are folded into the copy.
	Product *models.Product
	// Policy carries the operator's shipping / warranty / return promise.
	Policy models.CommercePolicySetting
	// Specs optionally overrides the specifications built from Product. The AI
	// research pipeline passes reviewed parameters here.
	Specs map[string]string
}

// KnownTechnicalSpecs builds the specification table from data the catalogue
// already owns. Nothing is invented: empty fields are skipped so the published
// table never contains a guessed value.
func KnownTechnicalSpecs(product *models.Product, policy models.CommercePolicySetting) map[string]string {
	specs := map[string]string{}
	if product == nil {
		return specs
	}

	add := func(label, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, exists := specs[label]; exists {
			return
		}
		specs[label] = value
	}

	add("Brand", strings.TrimSpace(product.Brand))
	add("Model / part number", firstNonEmpty(product.Model, product.PartNumber, product.SKU))
	if strings.TrimSpace(product.PartNumber) != "" && !strings.EqualFold(strings.TrimSpace(product.PartNumber), strings.TrimSpace(product.Model)) {
		add("Manufacturer part number", strings.TrimSpace(product.PartNumber))
	}
	add("SKU", strings.TrimSpace(product.SKU))
	add("Component type", inferProductTypeLabelForSkeleton(product))
	add("Condition", conditionLabel(product.ConditionType))
	if product.Weight != nil && *product.Weight > 0 {
		add("Weight", fmt.Sprintf("%s kg", trimTrailingZero(fmt.Sprintf("%.2f", *product.Weight))))
	}
	add("Dimensions", strings.TrimSpace(product.Dimensions))
	add("Country of origin", strings.TrimSpace(product.OriginCountry))
	add("Minimum order quantity", fmt.Sprintf("%d", product.MinimumOrderQuantity))
	add("Warranty", firstNonEmpty(product.WarrantyPeriod, policy.DefaultWarrantyPeriod))
	add("Lead time", firstNonEmpty(product.LeadTime, policy.DefaultLeadTime))
	add("Packaging", strings.TrimSpace(product.PackagingInfo))
	add("Certifications", strings.TrimSpace(product.Certifications))

	if product.MinimumOrderQuantity <= 0 {
		delete(specs, "Minimum order quantity")
	}
	return specs
}

// MergeTechnicalSpecs overlays researched parameters onto the deterministic
// base table. Later values win, which is how reviewed AI research is applied.
func MergeTechnicalSpecs(base map[string]string, overlay map[string]string) map[string]string {
	merged := map[string]string{}
	for key, value := range base {
		if strings.TrimSpace(value) != "" {
			merged[key] = strings.TrimSpace(value)
		}
	}
	for key, value := range overlay {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		merged[key] = value
	}
	return merged
}

// TechnicalSpecsJSON renders the specification table for the JSON column.
func TechnicalSpecsJSON(specs map[string]string) string {
	if len(specs) == 0 {
		return ""
	}
	keys := make([]string, 0, len(specs))
	for key := range specs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		lines = append(lines, fmt.Sprintf("%s: %s", jsonEscape(key), jsonEscape(specs[key])))
	}
	return "{" + strings.Join(lines, ", ") + "}"
}

func jsonEscape(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`"`, `\"`,
		"\n", `\n`,
		"\r", `\r`,
		"\t", `\t`,
	)
	return `"` + replacer.Replace(value) + `"`
}

// BuildProductContentSkeleton generates the reviewable content skeleton for any
// brand. The caller decides whether to persist it.
func BuildProductContentSkeleton(in ContentSkeletonInput) EnrichedProduct {
	policy := in.Policy
	if strings.TrimSpace(policy.DefaultWarrantyPeriod) == "" {
		policy = NormalizeCommercePolicy(policy)
	}

	brandKey := NormalizeBrandKey(in.BrandKey)
	brandName := strings.TrimSpace(in.BrandName)
	if brandName == "" {
		brandName = CanonicalBrandName(brandKey)
	}
	if brandName == "" {
		brandName = "Industrial automation"
	}

	model := strings.TrimSpace(in.Model)
	if model == "" && in.Product != nil {
		model = NormalizeProductModel(firstNonEmpty(in.Product.Model, in.Product.PartNumber, in.Product.SKU))
	}
	model = strings.TrimSpace(model)

	partType := strings.TrimSpace(in.PartType)
	if partType == "" && in.Product != nil {
		partType = inferProductTypeLabelForSkeleton(in.Product)
	}
	if partType == "" {
		partType = "spare part"
	}

	categorySlug := strings.TrimSpace(in.CategorySlug)
	categoryName := strings.TrimSpace(in.CategoryName)
	if categoryName == "" {
		categoryName = humanizeCategorySlug(categorySlug)
	}

	specs := in.Specs
	if len(specs) == 0 {
		specs = KnownTechnicalSpecs(in.Product, policy)
	}
	if len(specs) > 0 {
		if _, hasType := specs["Component type"]; !hasType && !strings.EqualFold(partType, "spare part") {
			specs["Component type"] = partType
		}
	}

	warranty := firstNonEmpty(productString(in.Product, func(p *models.Product) string { return p.WarrantyPeriod }), policy.DefaultWarrantyPeriod)
	leadTime := firstNonEmpty(productString(in.Product, func(p *models.Product) string { return p.LeadTime }), policy.DefaultLeadTime)
	condition := conditionLabel(productString(in.Product, func(p *models.Product) string { return p.ConditionType }))
	carriers := strings.Join(CommercePolicyCarrierList(policy), ", ")
	shippingLine := fmt.Sprintf("Shipping: %s handling, %s transit by %s", policy.ShippingHandlingTimeText, policy.ShippingTransitTimeText, carriers)
	// Destination wording follows the policy: GLOBAL reads as "worldwide".
	shipScope := shipScopeOf(policy)

	subject := strings.TrimSpace(strings.Join(filterEmptyStrings([]string{brandName, model}), " "))
	if subject == "" {
		subject = partType
	}

	name := NormalizeWhitespaceCopy(strings.Join(filterEmptyStrings([]string{brandName, model, partType}), " "))
	shortDesc := limitLen(fmt.Sprintf(
		"%s %s for %s maintenance, repair and replacement. %s warranty, %s handling and shipping %s.",
		subject,
		strings.ToLower(partType),
		brandName,
		warranty,
		policy.ShippingHandlingTimeText,
		shipScope,
	), 200)

	description := buildSkeletonDescription(skeletonNarrative{
		BrandName:    brandName,
		Model:        model,
		PartType:     partType,
		CategoryName: categoryName,
		Subject:      subject,
		Warranty:     warranty,
		LeadTime:     leadTime,
		Condition:    condition,
		ShippingLine: shippingLine,
		Policy:       policy,
		Specs:        specs,
		Product:      in.Product,
	})

	metaTitle := BuildSafeMetaTitle(
		fmt.Sprintf("%s %s %s | Vibocnc", brandName, model, partType),
		fmt.Sprintf("%s %s | Vibocnc", brandName, model),
		fmt.Sprintf("%s %s %s", brandName, model, partType),
		fmt.Sprintf("%s %s", brandName, model),
	)
	metaDescription := BuildSafeMetaDescription(
		fmt.Sprintf("%s %s %s for %s maintenance and repair. Compatibility support, %s warranty, %s shipping %s.", brandName, model, partType, brandName, warranty, policy.ShippingTransitTimeText, shipScope),
		fmt.Sprintf("%s %s %s with compatibility support, %s warranty and shipping %s.", brandName, model, partType, warranty, shipScope),
		fmt.Sprintf("%s %s %s for industrial automation repair and replacement.", brandName, model, partType),
	)

	compatibility := buildSkeletonCompatibility(subject, brandName, partType, categoryName, policy)
	installation := buildSkeletonInstallation(subject, partType)
	maintenance := buildSkeletonMaintenance(subject, partType)

	return EnrichedProduct{
		Name:              name,
		ShortDescription:  shortDesc,
		Description:       description,
		MetaTitle:         metaTitle,
		MetaDescription:   metaDescription,
		MetaKeywords:      buildSkeletonKeywords(brandName, model, partType, categoryName),
		CompatibilityInfo: compatibility,
		InstallationGuide: installation,
		MaintenanceTips:   maintenance,
		TechnicalSpecs:    TechnicalSpecsJSON(specs),
		PartType:          partType,
		CategorySlug:      categorySlug,
	}
}

type skeletonNarrative struct {
	BrandName    string
	Model        string
	PartType     string
	CategoryName string
	Subject      string
	Warranty     string
	LeadTime     string
	Condition    string
	ShippingLine string
	Policy       models.CommercePolicySetting
	Specs        map[string]string
	Product      *models.Product
}

func buildSkeletonDescription(n skeletonNarrative) string {
	lines := []string{
		strings.TrimSpace(fmt.Sprintf("%s %s", n.Subject, n.PartType)),
		"",
		"Overview",
		fmt.Sprintf(
			"%s is a %s supplied for industrial automation maintenance, breakdown replacement and retrofit projects. %s",
			n.Subject,
			strings.ToLower(n.PartType),
			partTypeApplicationSentence(n.PartType),
		),
		fmt.Sprintf(
			"Because %s assemblies differ between machine builds, the model is confirmed against the original unit label before dispatch.",
			n.BrandName,
		),
		"",
		"Key details",
		fmt.Sprintf("- Brand: %s", n.BrandName),
	}
	if n.Model != "" {
		lines = append(lines, fmt.Sprintf("- Part number: %s", n.Model))
	}
	lines = append(lines, fmt.Sprintf("- Type: %s", n.PartType))
	if n.CategoryName != "" {
		lines = append(lines, fmt.Sprintf("- Category: %s", n.CategoryName))
	}
	lines = append(lines,
		fmt.Sprintf("- Condition: %s", n.Condition),
		fmt.Sprintf("- Warranty: %s", n.Warranty),
		fmt.Sprintf("- Lead time: %s", n.LeadTime),
		fmt.Sprintf("- %s", n.ShippingLine),
		fmt.Sprintf("- Returns: %s return window, %s", n.Policy.ReturnWindowText, CommercePolicyReturnShippingText(n.Policy)),
	)

	if len(n.Specs) > 0 {
		lines = append(lines, "", "Technical specifications")
		for _, key := range sortedSpecKeys(n.Specs) {
			lines = append(lines, fmt.Sprintf("- %s: %s", key, n.Specs[key]))
		}
		lines = append(lines,
			"",
			"Values above are taken from the catalogue record and the original unit label. Send a photo of your existing nameplate if you need the specification confirmed before dispatch.",
		)
	}

	lines = append(lines,
		"",
		"Compatibility and ordering guidance",
		fmt.Sprintf("- %s", partTypeSelectionSentence(n.PartType)),
		fmt.Sprintf("- %s availability is confirmed against stock and the manufacturer lead time before payment is captured.", n.Subject),
		"- Share the machine builder, controller model, amplifier or drive reference and the alarm code so interchangeability can be verified.",
		"",
		"Typical applications",
		fmt.Sprintf("- %s", partTypeApplicationSentence(n.PartType)),
		"- Preventive maintenance and urgent breakdown replacement",
		"- Service inventory for machine tool and automation maintenance teams",
		"",
		"Why buy from Vibocnc",
		// Deliberately no brand list here: a page for one brand must never read as
		// if it belongs to another, and repeating other brands inside the body is
		// what made the previous generator regenerate its own copy in a loop.
		"- Multi-brand industrial automation parts supplier",
		"- Stocked inventory with fast handling",
		fmt.Sprintf("- Shipping %s with tracking", shipScopeOf(n.Policy)),
		"- Model verification and technical confirmation before dispatch",
	)

	if n.Policy.ShippingNotes != "" {
		lines = append(lines, "", "Shipping notes", n.Policy.ShippingNotes)
	}

	return strings.Join(lines, "\n")
}

func buildSkeletonCompatibility(subject, brandName, partType, categoryName string, policy models.CommercePolicySetting) string {
	parts := []string{
		fmt.Sprintf("Compatibility for %s must be checked against the original part label, the %s series and the machine builder option code.", subject, brandName),
		partTypeSelectionSentence(partType),
	}
	if categoryName != "" {
		parts = append(parts, fmt.Sprintf("This item is catalogued under %s.", categoryName))
	}
	parts = append(parts,
		"Send a photo of the existing unit or the alarm history and the model will be confirmed before shipment.",
		fmt.Sprintf("Ordering terms: %s warranty, %s lead time, %s return window with %s.", policy.DefaultWarrantyPeriod, policy.DefaultLeadTime, policy.ReturnWindowText, CommercePolicyReturnShippingText(policy)),
	)
	return strings.Join(parts, " ")
}

func buildSkeletonInstallation(subject, partType string) string {
	lower := strings.ToLower(partType)
	lines := []string{
		fmt.Sprintf("Isolate machine power and confirm the exact part number on the original unit before installing %s.", subject),
		"Inspect connectors, mounting points and cable orientation before removal so the replacement follows the same routing.",
	}
	switch {
	case strings.Contains(lower, "motor"):
		lines = append(lines, "Check shaft, flange and encoder coupling alignment before power-up, then verify the axis reference position.")
	case strings.Contains(lower, "amplifier"), strings.Contains(lower, "drive"), strings.Contains(lower, "inverter"), strings.Contains(lower, "servo"):
		lines = append(lines, "Confirm the parameter set and axis assignment match the original drive before enabling the machine.")
	case strings.Contains(lower, "board"), strings.Contains(lower, "pcb"), strings.Contains(lower, "module"), strings.Contains(lower, "i/o"):
		lines = append(lines, "Record DIP switch, jumper and firmware version settings on the original board before transferring them.")
	case strings.Contains(lower, "panel"), strings.Contains(lower, "display"), strings.Contains(lower, "monitor"):
		lines = append(lines, "Verify the display interface, cable type and mounting bracket match before closing the panel.")
	case strings.Contains(lower, "battery"):
		lines = append(lines, "Replace the battery with power applied when the maintenance procedure requires it, to avoid losing absolute position data.")
	default:
		lines = append(lines, "Follow the machine maintenance procedure for the assembly being replaced.")
	}
	lines = append(lines,
		"After replacement, verify alarms, safety interlocks and axis or process response before returning the machine to production.",
		"If commissioning, parameter backup or calibration is required, have a qualified maintenance technician complete it.",
	)
	return strings.Join(lines, "\n")
}

func buildSkeletonMaintenance(subject, partType string) string {
	lower := strings.ToLower(partType)
	lines := []string{
		fmt.Sprintf("Keep %s clean and dry, and protect it from conductive dust, oil mist and unstable supply voltage.", subject),
	}
	switch {
	case strings.Contains(lower, "fan"), strings.Contains(lower, "filter"), strings.Contains(lower, "cooling"):
		lines = append(lines, "Clean or replace cabinet filters on schedule so airflow and internal cabinet temperature stay within specification.")
	case strings.Contains(lower, "battery"):
		lines = append(lines, "Record the installation date and replace the battery on the recommended interval to protect parameter and position memory.")
	case strings.Contains(lower, "board"), strings.Contains(lower, "pcb"), strings.Contains(lower, "module"):
		lines = append(lines, "Use anti-static handling and store spare boards in protective packaging away from humidity.")
	default:
		lines = append(lines, "Check cabinet ventilation, grounding and connector condition during routine maintenance.")
	}
	lines = append(lines,
		"Record alarm history and replacement dates so later troubleshooting is faster.",
		"For long-term storage, keep spare parts in anti-static and moisture-protection packaging.",
	)
	return strings.Join(lines, "\n")
}

func buildSkeletonKeywords(brandName, model, partType, categoryName string) string {
	parts := []string{
		strings.TrimSpace(strings.Join(filterEmptyStrings([]string{brandName, model}), " ")),
		model,
		partType,
		categoryName,
		strings.TrimSpace(strings.Join(filterEmptyStrings([]string{brandName, partType}), " ")),
		normalizedBrandWord(brandName) + " spare parts",
		"industrial automation parts",
		"CNC replacement parts",
		"Vibocnc",
	}
	return strings.Join(dedupeStrings(parts), ", ")
}

func partTypeApplicationSentence(partType string) string {
	lower := strings.ToLower(partType)
	switch {
	case strings.Contains(lower, "servo") && strings.Contains(lower, "motor"):
		return "It is used for axis motion and feed drive service, where torque, encoder feedback and mechanical fit determine a correct replacement."
	case strings.Contains(lower, "spindle") && strings.Contains(lower, "motor"):
		return "It is used for spindle drive service, where speed range, tool interface and winding data determine a correct replacement."
	case strings.Contains(lower, "servo"), strings.Contains(lower, "amplifier"), strings.Contains(lower, "drive"), strings.Contains(lower, "inverter"):
		return "It is used to restore axis or spindle drive operation, where the amplifier rating, axis assignment and control series determine a correct replacement."
	case strings.Contains(lower, "i/o"), strings.Contains(lower, "io module"):
		return "It is used for machine signal input and output, where the point count, board revision and controller series determine a correct replacement."
	case strings.Contains(lower, "power"), strings.Contains(lower, "supply"):
		return "It is used to restore stable power distribution inside the control cabinet, where input voltage, output rating and connector layout determine a correct replacement."
	case strings.Contains(lower, "pcb"), strings.Contains(lower, "board"):
		return "It is used for board-level repair inside the control cabinet, where the assembly number, software version and connector position determine a correct replacement."
	case strings.Contains(lower, "encoder"), strings.Contains(lower, "feedback"):
		return "It is used for position and speed feedback, where the encoder specification, mounting interface and cable type determine a correct replacement."
	case strings.Contains(lower, "panel"), strings.Contains(lower, "display"), strings.Contains(lower, "monitor"), strings.Contains(lower, "mdi"):
		return "It is used for operator interface and machine control, where the panel revision, display interface and cable type determine a correct replacement."
	case strings.Contains(lower, "cable"), strings.Contains(lower, "connector"), strings.Contains(lower, "harness"):
		return "It is used for signal and power interconnection, where length, terminal type and mating connector reference determine a correct replacement."
	case strings.Contains(lower, "battery"):
		return "It is used to maintain control parameter and absolute position memory during power-off periods."
	case strings.Contains(lower, "fan"), strings.Contains(lower, "filter"), strings.Contains(lower, "cooling"):
		return "It is used to keep the control cabinet within its operating temperature range by maintaining airflow through the enclosure."
	case strings.Contains(lower, "plc"), strings.Contains(lower, "controller"), strings.Contains(lower, "cnc system"):
		return "It is used for machine sequence control and system coordination, where the CPU or control series and option configuration determine a correct replacement."
	default:
		return "It is used for industrial automation maintenance, where the original part number and machine configuration determine a correct replacement."
	}
}

func partTypeSelectionSentence(partType string) string {
	lower := strings.ToLower(partType)
	switch {
	case strings.Contains(lower, "servo") && strings.Contains(lower, "motor"):
		return "Confirm motor series, encoder specification, shaft or flange detail and drive pairing before ordering."
	case strings.Contains(lower, "spindle") && strings.Contains(lower, "motor"):
		return "Confirm motor series, winding data, encoder and tool interface before ordering."
	case strings.Contains(lower, "servo"), strings.Contains(lower, "amplifier"), strings.Contains(lower, "drive"), strings.Contains(lower, "inverter"):
		return "Confirm amplifier rating, axis assignment, control series and connector layout before ordering."
	case strings.Contains(lower, "i/o"), strings.Contains(lower, "io module"):
		return "Confirm I/O point count, board revision and controller series before ordering."
	case strings.Contains(lower, "power"), strings.Contains(lower, "supply"):
		return "Confirm input voltage, output rating, cabinet series and connector layout before ordering."
	case strings.Contains(lower, "pcb"), strings.Contains(lower, "board"):
		return "Confirm board assembly number, software or firmware version and connector position before ordering."
	case strings.Contains(lower, "encoder"), strings.Contains(lower, "feedback"):
		return "Confirm encoder type, pulse specification, shaft or mounting interface and cable type before ordering."
	case strings.Contains(lower, "panel"), strings.Contains(lower, "display"), strings.Contains(lower, "monitor"), strings.Contains(lower, "mdi"):
		return "Confirm panel or display revision, key layout, interface type and mounting dimensions before ordering."
	case strings.Contains(lower, "cable"), strings.Contains(lower, "connector"), strings.Contains(lower, "harness"):
		return "Confirm cable length, connector type and pin assignment before ordering."
	case strings.Contains(lower, "battery"):
		return "Confirm battery chemistry, voltage, connector type and mounting detail before ordering."
	case strings.Contains(lower, "fan"), strings.Contains(lower, "filter"), strings.Contains(lower, "cooling"):
		return "Confirm fan voltage, airflow, dimensions and connector type before ordering."
	default:
		return "Confirm the original part number, control series and machine configuration before ordering."
	}
}

func conditionLabel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "refurbished":
		return "Refurbished (tested)"
	case "used":
		return "Used (tested)"
	case "new", "":
		return "New"
	default:
		return strings.TrimSpace(value)
	}
}

// inferProductTypeLabelForSkeleton mirrors the storefront label so generated copy
// and the visible page agree.
func inferProductTypeLabelForSkeleton(product *models.Product) string {
	if product == nil {
		return "spare part"
	}
	inference := InferProductCategory(product.Brand, firstNonEmpty(product.Model, product.PartNumber, product.SKU))
	if strings.TrimSpace(inference.PartType) != "" {
		return inference.PartType
	}
	return "spare part"
}

func humanizeCategorySlug(slug string) string {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return ""
	}
	parts := strings.FieldsFunc(slug, func(r rune) bool { return r == '-' || r == '_' || r == '/' })
	upperWords := map[string]bool{
		"fanuc": true, "siemens": true, "mitsubishi": true, "abb": true, "omron": true,
		"yaskawa": true, "schneider": true, "keyence": true, "panasonic": true, "delta": true,
		"huawei": true, "plc": true, "cnc": true, "io": true,
	}
	for index, part := range parts {
		lower := strings.ToLower(strings.TrimSpace(part))
		if lower == "" {
			continue
		}
		if upperWords[lower] {
			parts[index] = strings.ToUpper(lower)
			continue
		}
		parts[index] = strings.ToUpper(lower[:1]) + lower[1:]
	}
	return strings.Join(filterEmptyStrings(parts), " ")
}

func normalizedBrandWord(brandName string) string {
	value := strings.TrimSpace(brandName)
	if value == "" {
		return "industrial automation"
	}
	return value
}

func sortedSpecKeys(specs map[string]string) []string {
	keys := make([]string, 0, len(specs))
	for key := range specs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func productString(product *models.Product, getter func(*models.Product) string) string {
	if product == nil {
		return ""
	}
	return strings.TrimSpace(getter(product))
}

func filterEmptyStrings(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func trimTrailingZero(value string) string {
	value = strings.TrimRight(value, "0")
	value = strings.TrimRight(value, ".")
	if value == "" {
		return "0"
	}
	return value
}

// NormalizeWhitespaceCopy collapses repeated whitespace in generated copy.
func NormalizeWhitespaceCopy(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

// shipScopeOf renders the destination phrase used inside generated copy. An
// empty country list means the policy ships worldwide.
func shipScopeOf(policy models.CommercePolicySetting) string {
	if CommercePolicyShipsWorldwide(policy) {
		return "worldwide"
	}
	return "to " + strings.Join(CommercePolicyCountryList(policy), ", ")
}
