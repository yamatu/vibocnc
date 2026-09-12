package services

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ProductCategoryInference struct {
	BrandKey     string `json:"brand_key"`
	BrandName    string `json:"brand_name"`
	PartType     string `json:"part_type"`
	CategorySlug string `json:"category_slug"`
	// ModelFamily is an optional, stable family identifier (for example
	// "MR-J4" or "S7-1500"). Family evidence lets us reuse an existing
	// family node even when its display name does not contain the generic part
	// type (many imported trees call those nodes "Spare Parts").
	ModelFamily string `json:"model_family,omitempty"`
	MatchRule   string `json:"match_rule"`
}

// IsConfirmedProductCategory reports whether the model/part number produced a
// specific, explainable classification. A generic fallback is intentionally
// not considered safe for publication: callers should keep the product
// inactive until an administrator or a trusted source confirms its identity.
func IsConfirmedProductCategory(inference ProductCategoryInference, model string) bool {
	if strings.TrimSpace(NormalizeProductModel(model)) == "" {
		return false
	}
	return isConfirmedInference(inference)
}

func isConfirmedInference(inference ProductCategoryInference) bool {
	if strings.TrimSpace(inference.BrandKey) == "" || strings.EqualFold(strings.TrimSpace(inference.BrandKey), "unknown") {
		return false
	}
	rule := strings.ToLower(strings.TrimSpace(inference.MatchRule))
	if rule == "" || strings.Contains(rule, "fallback") || strings.Contains(rule, "empty-model") {
		return false
	}
	// Free-form words embedded in an uploaded model/name (for example
	// "MOTOR-123" or "POWER-METER") are hints, not manufacturer model-family
	// evidence. They may guide a web search, but cannot publish by themselves.
	if !strings.HasPrefix(rule, "web:") && (strings.HasPrefix(rule, "generic:") || strings.Contains(rule, ":generic:") || strings.Contains(rule, "keyword")) {
		return false
	}
	// A free-form upload brand is not proof of manufacturer identity. Accept
	// the supported brand registry for deterministic rules; custom brands must
	// carry an explicit web-evidence rule before they can publish.
	return isClassificationBrandAllowed(inference.BrandKey, rule)
}

func isClassificationBrandAllowed(brandKey, rule string) bool {
	rule = strings.ToLower(strings.TrimSpace(rule))
	// Web evidence and administrator-approved LLM classifications carry their
	// own verification, so any concrete manufacturer they name is acceptable.
	// This is what lets newly stocked brands outside the deterministic registry
	// below still classify cleanly.
	if strings.HasPrefix(rule, "web:") || strings.HasPrefix(rule, "llm:") {
		return strings.TrimSpace(brandKey) != "" && !strings.EqualFold(strings.TrimSpace(brandKey), "unknown")
	}
	switch NormalizeBrandKey(brandKey) {
	case "fanuc", "mitsubishi", "siemens", "abb", "allen-bradley", "omron", "sick", "tamagawa", "fluke", "schneider", "yaskawa", "panasonic", "keyence", "delta", "bosch-rexroth", "huawei":
		return true
	default:
		return false
	}
}

// ClassificationFailureReason is kept stable so import/API clients can show a
// useful explanation without parsing provider text.
func ClassificationFailureReason(inference ProductCategoryInference, model string) string {
	if strings.TrimSpace(NormalizeProductModel(model)) == "" {
		return "model or part number is missing"
	}
	if strings.TrimSpace(inference.BrandKey) == "" || strings.EqualFold(strings.TrimSpace(inference.BrandKey), "unknown") {
		return "brand could not be verified"
	}
	if !IsConfirmedProductCategory(inference, model) {
		return "product type could not be verified from the model"
	}
	return ""
}

// ResolveExistingCategoryForProduct returns an active leaf category that is
// compatible with the verified brand and product type. The lookup is strictly
// read-only: no category is created or renamed as a side effect.
func ResolveExistingCategoryForProduct(db *gorm.DB, brand, model, hint string) (uint, error) {
	if db == nil {
		return 0, errors.New("database is nil")
	}
	inference := InferProductCategory(brand, model)
	if !IsConfirmedProductCategory(inference, model) {
		return 0, errors.New("product classification is unresolved")
	}
	return ResolveExistingCategoryForInference(db, inference, hint)
}

// ResolveExistingCategoryForInference is the same read-only lookup as
// ResolveExistingCategoryForProduct, but accepts a previously verified
// inference (for example one upgraded by public search evidence). This avoids
// throwing away web evidence and re-running the local fallback classifier.
func ResolveExistingCategoryForInference(db *gorm.DB, inference ProductCategoryInference, hint string) (uint, error) {
	if db == nil {
		return 0, errors.New("database is nil")
	}
	if !isConfirmedInference(inference) {
		return 0, errors.New("product classification is unresolved")
	}
	var categories []models.Category
	if err := db.Order("sort_order ASC, name ASC").Find(&categories).Error; err != nil {
		return 0, err
	}
	byID := make(map[uint]models.Category, len(categories))
	children := make(map[uint]bool)
	for _, category := range categories {
		byID[category.ID] = category
		if category.IsActive && category.ParentID != nil {
			children[*category.ParentID] = true
		}
	}

	hintSlug := strings.TrimSpace(utils.GenerateSlug(strings.TrimSpace(hint)))
	bestID := uint(0)
	bestScore := 0
	for _, category := range categories {
		if !category.IsActive || children[category.ID] {
			continue
		}
		path, ok := activeCategoryPathFromRows(category, byID)
		if !ok {
			continue
		}
		score := CategoryPathMatchScore(path, inference)
		if score == 0 {
			continue
		}
		// An exact inferred slug is useful, but a brand/family path must still
		// win over a duplicate generic node. Keep scoring so the result is
		// deterministic regardless of database sort order.
		if category.Slug == inference.CategorySlug {
			score += 1000
		}
		if hintSlug != "" && (category.Slug == hintSlug || strings.EqualFold(category.Name, strings.TrimSpace(hint))) {
			score += 500
		}
		if score > bestScore {
			bestID = category.ID
			bestScore = score
		}
	}
	if bestID > 0 {
		return bestID, nil
	}
	return 0, fmt.Errorf("no active category matches brand %q and product type %q", inference.BrandName, inference.PartType)
}

// ValidateExistingCategoryForInference checks one administrator-selected
// category against the same taxonomy contract used by automatic imports. It
// returns the full active path for diagnostics and rejects inactive categories,
// parent nodes, broken parent chains, and unrelated brand/type leaves.
func ValidateExistingCategoryForInference(db *gorm.DB, categoryID uint, inference ProductCategoryInference) (string, error) {
	if db == nil {
		return "", errors.New("database is nil")
	}
	if categoryID == 0 {
		return "", errors.New("category is required")
	}
	if !isConfirmedInference(inference) {
		return "", errors.New("product classification is unresolved")
	}
	// Lock the selected row and its parent chain when this helper is called in
	// a transaction. This closes the window where an administrator disables or
	// reparents a category after classification but before the product write.
	var category models.Category
	if err := db.Clauses(clause.Locking{Strength: "SHARE"}).First(&category, categoryID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", fmt.Errorf("category %d was not found", categoryID)
		}
		return "", err
	}
	if !category.IsActive {
		return "", fmt.Errorf("category %d is inactive", categoryID)
	}
	var childCount int64
	if err := db.Model(&models.Category{}).Where("parent_id = ? AND is_active = ?", categoryID, true).Count(&childCount).Error; err != nil {
		return "", err
	}
	if childCount > 0 {
		return "", fmt.Errorf("category %d is a parent category; choose an active leaf", categoryID)
	}
	parts := []string{category.Name}
	parentID := category.ParentID
	visited := map[uint]bool{category.ID: true}
	for parentID != nil && *parentID > 0 && !visited[*parentID] {
		var parent models.Category
		if err := db.Clauses(clause.Locking{Strength: "SHARE"}).First(&parent, *parentID).Error; err != nil {
			return "", fmt.Errorf("category %d has a broken parent path: %w", categoryID, err)
		}
		if !parent.IsActive {
			return "", fmt.Errorf("category %d has inactive parent %d", categoryID, parent.ID)
		}
		visited[parent.ID] = true
		parts = append([]string{parent.Name}, parts...)
		parentID = parent.ParentID
	}
	if parentID != nil && *parentID > 0 && visited[*parentID] {
		return "", fmt.Errorf("category %d has a cyclic parent path", categoryID)
	}
	path := strings.Join(parts, " > ")
	if !CategoryPathMatchesInference(path, inference) {
		return "", fmt.Errorf("category %q does not match brand %q and product type %q", path, inference.BrandName, inference.PartType)
	}
	return path, nil
}

func activeCategoryPathFromRows(category models.Category, byID map[uint]models.Category) (string, bool) {
	if !category.IsActive {
		return "", false
	}
	parts := []string{category.Name}
	parentID := category.ParentID
	visited := map[uint]bool{category.ID: true}
	for parentID != nil && *parentID > 0 && !visited[*parentID] {
		parent, ok := byID[*parentID]
		if !ok || !parent.IsActive {
			return "", false
		}
		visited[parent.ID] = true
		parts = append([]string{parent.Name}, parts...)
		parentID = parent.ParentID
	}
	if parentID != nil && *parentID > 0 && visited[*parentID] {
		return "", false
	}
	return strings.Join(parts, " > "), true
}

// CategoryPathMatchesInference enforces the brand-parent/type-child taxonomy.
// It intentionally uses distinctive type groups instead of a loose single-word
// match (for example, Servo Motor must not match Servo Amplifier). Generic
// top-level type roots are never automatic targets; a brand-specific path or
// an exact model-family path is required.
func CategoryPathMatchesInference(path string, inference ProductCategoryInference) bool {
	return CategoryPathMatchScore(path, inference) > 0
}

// CategoryPathMatchScore returns a deterministic compatibility score. It is
// exported for callers that need to choose among duplicate legacy categories.
// The score is deliberately not a probability; only zero/non-zero is a
// compatibility decision, while larger values indicate stronger evidence.
func CategoryPathMatchScore(path string, inference ProductCategoryInference) int {
	path = strings.TrimSpace(path)
	if path == "" || strings.TrimSpace(inference.BrandKey) == "" || strings.EqualFold(strings.TrimSpace(inference.BrandKey), "unknown") {
		return 0
	}

	pathNorm := taxonomyNormalize(path)
	pathTokens := taxonomyTokens(path)
	brandKey := NormalizeBrandKey(inference.BrandKey)
	pathBrand := categoryPathBrandKey(path)
	if pathBrand != "" && pathBrand != brandKey {
		// A Siemens category must never be selected for an ABB product merely
		// because both have a child named "Servo Drives".
		return 0
	}

	brandScore := 0
	if brandMatchesCategoryPath(path, brandKey, inference.BrandName) {
		brandScore = 100
	}
	familyScore := 0
	if modelFamilyMatchesPath(pathNorm, inference.ModelFamily) {
		familyScore = 80
	}
	typeScore := categoryTypeMatchScore(pathNorm, pathTokens, inference.PartType)

	// A model-family node (e.g. "S7-1500 Spare Parts") is authoritative even
	// when its name omits the generic type. It still needs either the matching
	// brand or an unambiguous family token.
	if familyScore > 0 {
		if brandScore > 0 {
			return brandScore + familyScore + typeScore
		}
		if pathBrand == "" {
			return familyScore + typeScore
		}
		return 0
	}
	if typeScore == 0 {
		return 0
	}
	if brandScore > 0 {
		return brandScore + typeScore
	}
	// Generic top-level type nodes are intentionally not automatic targets. The
	// product must land below its brand (or an exact, unambiguous model-family
	// node); otherwise it remains inactive for review instead of being silently
	// mixed into a cross-brand bucket.
	return 0
}

// taxonomyNormalize converts display names, slugs and paths into comparable
// words. It handles the punctuation variants commonly found in spreadsheet
// exports (ASCII hyphen, en/em dash, slash, ampersand and full-width forms).
func taxonomyNormalize(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.NewReplacer(
		"–", " ", "—", " ", "‑", " ", "－", " ",
		"/", " ", "&", " ", "_", " ", "-", " ",
		"(", " ", ")", " ", ",", " ", ".", " ", ":", " ",
	).Replace(value)
	return strings.Join(strings.Fields(value), " ")
}

func taxonomyTokens(value string) []string {
	normalized := taxonomyNormalize(value)
	if normalized == "" {
		return nil
	}
	return strings.Fields(normalized)
}

func taxonomyTokenSet(value string) map[string]bool {
	set := map[string]bool{}
	for _, token := range taxonomyTokens(value) {
		set[token] = true
		// Category names are often pluralized while inferred types are not.
		if len(token) > 4 && strings.HasSuffix(token, "ies") {
			set[strings.TrimSuffix(token, "ies")+"y"] = true
		} else if len(token) > 4 && strings.HasSuffix(token, "es") && (strings.HasSuffix(token, "ches") || strings.HasSuffix(token, "shes") || strings.HasSuffix(token, "xes") || strings.HasSuffix(token, "sses")) {
			set[strings.TrimSuffix(token, "es")] = true
		} else if len(token) > 3 && strings.HasSuffix(token, "s") {
			set[strings.TrimSuffix(token, "s")] = true
		}
	}
	return set
}

func taxonomyHasToken(tokens map[string]bool, values ...string) bool {
	for _, value := range values {
		if tokens[taxonomyNormalize(value)] {
			return true
		}
		for _, token := range taxonomyTokens(value) {
			if tokens[token] {
				return true
			}
		}
	}
	return false
}

func categoryTypeMatchScore(pathNorm string, pathTokens []string, partType string) int {
	if strings.TrimSpace(partType) == "" {
		return 0
	}
	pathSet := taxonomyTokenSet(pathNorm)
	typeNorm := taxonomyNormalize(partType)
	typeSet := taxonomyTokenSet(typeNorm)
	hasPath := func(values ...string) bool { return taxonomyHasToken(pathSet, values...) }
	hasType := func(values ...string) bool { return taxonomyHasToken(typeSet, values...) }
	hasAllType := func(values ...string) bool {
		for _, value := range values {
			if !hasType(value) {
				return false
			}
		}
		return true
	}

	switch {
	case hasAllType("line", "reactor") || hasAllType("input", "choke"):
		if hasPath("line", "input") && hasPath("reactor", "choke") {
			return 38
		}
	case hasAllType("output", "reactor") || hasAllType("output", "choke"):
		if hasPath("output") && hasPath("reactor", "choke") {
			return 38
		}
	case hasAllType("output", "lc", "filter") || hasAllType("sine", "wave", "filter"):
		if hasPath("filter") && ((hasPath("output") && hasPath("lc")) || (hasPath("sine") && hasPath("wave"))) {
			return 38
		}
	case hasAllType("cable") || hasAllType("connector") || hasAllType("harness"):
		if hasPath("cable", "connector", "harness", "plug", "socket") {
			return 30
		}
	case hasAllType("variable", "frequency") || hasType("vfd"):
		if hasPath("variable", "frequency") && hasPath("drive", "inverter") || hasPath("vfd") {
			return 32
		}
	case hasAllType("circuit", "breaker"):
		if hasPath("circuit") && hasPath("breaker") {
			return 34
		}
	case hasAllType("power", "meter") || hasAllType("panel", "meter"):
		if hasPath("meter") && hasPath("power", "panel") {
			return 34
		}
	case hasAllType("power", "module"):
		if hasPath("power") && hasPath("module") && !hasPath("supply", "meter") {
			return 34
		}
	case hasAllType("temperature", "input"):
		if hasPath("temperature") && hasPath("input") && hasPath("module") {
			return 36
		}
	case hasType("communication"):
		if hasPath("communication") && hasPath("processor", "interface", "module", "adapter") {
			return 34
		}
	case hasType("supply"):
		if hasPath("supply", "psu") && !hasPath("meter") {
			return 30
		}
	case hasType("fuse"):
		if hasPath("fuse") {
			return 30
		}
	case hasType("power"):
		if hasPath("power") && !hasPath("meter", "analyzer", "monitor") {
			return 30
		}
	case hasType("i/o") || hasAllType("io", "module") || hasType("input") || hasType("output"):
		if hasPath("temperature", "communication", "positioning", "counter", "motion", "power", "bus") {
			return 0
		}
		if hasPath("i", "io", "input", "output") && hasPath("module") {
			return 30
		}
	case hasType("spindle") && hasType("amplifier") || hasType("spindle") && hasType("drive"):
		if hasPath("spindle") && hasPath("amplifier", "drive") {
			return 34
		}
	case hasType("servo") && (hasType("amplifier") || hasType("drive")):
		if hasPath("servo") && hasPath("amplifier", "drive") {
			return 34
		}
	case hasType("spindle") && hasType("motor"):
		if hasPath("spindle") && hasPath("motor") {
			return 34
		}
	case hasType("servo") && hasType("motor"):
		if hasPath("servo") && hasPath("motor") {
			return 34
		}
	case hasType("encoder") || hasType("feedback") || hasType("resolver"):
		if hasPath("encoder", "feedback", "resolver", "synchro") {
			return 30
		}
	case hasType("pcb") || hasType("board") || hasType("cpu") || hasType("card"):
		if hasPath("pcb", "board", "cpu", "card") {
			return 30
		}
	case hasType("memory") || hasType("storage"):
		if hasPath("memory", "storage") {
			return 30
		}
	case hasType("battery"):
		if hasPath("battery") {
			return 30
		}
	case hasType("fan") || hasType("cooling"):
		if hasPath("fan", "cooling") {
			return 30
		}
	case hasType("filter"):
		if hasPath("filter") {
			return 30
		}
	case hasType("operator") || hasType("panel") || hasType("mdi") || hasType("hmi") || hasType("pendant"):
		if hasPath("operator", "panel", "mdi", "hmi", "pendant") {
			return 30
		}
	case hasType("display") || hasType("monitor"):
		if hasPath("display", "monitor", "crt", "lcd") {
			return 30
		}
	case hasType("cnc") || hasType("control") || hasType("system") || hasType("controller"):
		if hasPath("cnc", "control", "system", "controller") {
			return 30
		}
	case hasType("plc") || hasAllType("programmable", "logic"):
		if hasPath("plc", "programmable", "controller") {
			return 30
		}
	case hasAllType("photoelectric", "sensor"):
		if hasPath("photoelectric") && hasPath("sensor") {
			return 36
		}
	case hasAllType("proximity", "sensor"):
		if hasPath("proximity") && hasPath("sensor") {
			return 36
		}
	case hasAllType("distance", "sensor"):
		if hasPath("distance") && hasPath("sensor") {
			return 36
		}
	case hasAllType("vision", "sensor"):
		if hasPath("vision") && hasPath("sensor") {
			return 36
		}
	case hasType("lidar"):
		if hasPath("lidar") {
			return 36
		}
	case hasAllType("safety", "light", "curtain"):
		if hasPath("safety") && hasPath("light") && hasPath("curtain") {
			return 38
		}
	case hasAllType("safety", "laser", "scanner"):
		if hasPath("safety") && hasPath("laser") && hasPath("scanner") {
			return 38
		}
	case hasAllType("safety", "door", "switch"):
		if hasPath("safety") && hasPath("door") && hasPath("switch") {
			return 38
		}
	case hasAllType("barcode", "scanner"):
		if hasPath("barcode") && hasPath("scanner") {
			return 36
		}
	case hasType("sensor"):
		if hasPath("sensor") && !hasPath("photoelectric", "proximity", "distance", "vision", "safety", "curtain", "scanner", "lidar", "barcode", "power", "supply", "meter", "filter") {
			return 25
		}
	case hasType("rfid"):
		if hasPath("rfid") {
			return 30
		}
	case hasType("spare") || hasType("accessory"):
		if hasPath("spare", "accessory", "replacement", "other") {
			return 20
		}
	default:
		// For a new type, require at least two meaningful words. This keeps a
		// one-word hint such as "Drive" from matching unrelated categories.
		matched := 0
		for token := range typeSet {
			if len(token) >= 4 && pathSet[token] {
				matched++
			}
		}
		if matched >= 2 {
			return 20
		}
	}
	return 0
}

// brandAliasTable is intentionally kept in one place so input normalization
// and category-path matching agree. The category tree supplied by the store
// uses both legal names and short labels (for example "AB"), while imports
// commonly contain vendor suffixes such as "Siemens AG".
var brandAliasTable = map[string][]string{
	"fanuc":         {"fanuc", "fanuc cnc", "ge fanuc"},
	"mitsubishi":    {"mitsubishi", "mitsubishi electric", "melsec", "melservo", "mitsubishi automation"},
	"siemens":       {"siemens", "siemens ag", "siemens industry", "sipro tec", "siprotec"},
	"abb":           {"abb", "abb ltd", "abb limited", "asea brown boveri", "abb robotics"},
	"allen-bradley": {"ab", "a b", "a-b", "allen bradley", "allen-bradley", "rockwell", "rockwell automation"},
	"omron":         {"omron", "omron electronics", "omron automation"},
	"sick":          {"sick", "sick ag", "sick sensor intelligence"},
	"tamagawa":      {"tamagawa", "tamagawa seiki", "tamagawa seiki co"},
	"fluke":         {"fluke", "fluke corporation", "fluke biomedical"},
	"schneider":     {"schneider", "schneider electric", "telemecanique"},
	"yaskawa":       {"yaskawa", "yaskawa electric", "sigma"},
	"panasonic":     {"panasonic", "matsushita"},
	"keyence":       {"keyence"},
	"delta":         {"delta", "delta electronics"},
	"bosch-rexroth": {"bosch rexroth", "rexroth", "bosch"},
}

func brandAliases(brandKey string, brandName string) []string {
	key := NormalizeBrandKey(brandKey)
	aliases := append([]string(nil), brandAliasTable[key]...)
	if strings.TrimSpace(brandName) != "" {
		aliases = append(aliases, brandName)
	}
	if len(aliases) == 0 && strings.TrimSpace(brandKey) != "" {
		aliases = append(aliases, brandKey)
	}
	return aliases
}

func brandLabelMatches(label, brandKey string) bool {
	labelNorm := taxonomyNormalize(label)
	if labelNorm == "" {
		return false
	}
	labelTokens := taxonomyTokenSet(labelNorm)
	for _, alias := range brandAliases(brandKey, "") {
		aliasNorm := taxonomyNormalize(alias)
		if aliasNorm == "" {
			continue
		}
		// Short aliases (AB) must be a complete token, otherwise they would
		// match ordinary words such as "cable".
		if len(aliasNorm) <= 3 {
			if labelTokens[aliasNorm] {
				return true
			}
			continue
		}
		if labelNorm == aliasNorm || strings.Contains(" "+labelNorm+" ", " "+aliasNorm+" ") {
			return true
		}
		// A display label may append a role, e.g. "ABB Variable Frequency
		// Drives". Require the alias as a complete word sequence.
		if strings.HasPrefix(labelNorm, aliasNorm+" ") || strings.HasSuffix(labelNorm, " "+aliasNorm) {
			return true
		}
	}
	return false
}

func brandMatchesCategoryPath(path, brandKey, brandName string) bool {
	brandKey = NormalizeBrandKey(brandKey)
	if brandKey == "" || brandKey == "unknown" {
		return false
	}
	// Category paths are normally separated by ">". Checking each segment
	// avoids accidental substring matches and handles a brand embedded in a
	// leaf name (e.g. "Siemens Servo Motors").
	for _, segment := range strings.FieldsFunc(path, func(r rune) bool { return r == '>' || r == '/' || r == '|' }) {
		if brandLabelMatches(segment, brandKey) || brandLabelMatches(segment, brandName) {
			return true
		}
	}
	return brandLabelMatches(path, brandKey) || brandLabelMatches(path, brandName)
}

func categoryPathBrandKey(path string) string {
	for _, segment := range strings.FieldsFunc(path, func(r rune) bool { return r == '>' || r == '/' || r == '|' }) {
		label := taxonomyNormalize(segment)
		for key := range brandAliasTable {
			if brandLabelMatches(label, key) {
				return key
			}
		}
	}
	return ""
}

func modelFamilyMatchesPath(pathNorm, family string) bool {
	familyNorm := taxonomyNormalize(family)
	if familyNorm == "" {
		return false
	}
	if pathNorm == familyNorm || strings.Contains(" "+pathNorm+" ", " "+familyNorm+" ") {
		return true
	}
	// Numeric families are frequently slugged without punctuation (S7-1500
	// -> s7 1500, MR-J4 -> mr j4). Require all family tokens, rather than a
	// loose substring, to avoid MR-J3 matching MR-J4.
	familyTokens := taxonomyTokens(familyNorm)
	pathSet := taxonomyTokenSet(pathNorm)
	if len(familyTokens) == 0 {
		return false
	}
	for _, token := range familyTokens {
		if !pathSet[token] {
			return false
		}
	}
	return true
}

var (
	reLikelyFanucModel = regexp.MustCompile(`(?i)^(A0[234568]B|A1[3467]B|A20B|A230|A250|A290|A300|A370|A[0-9]{2}L|A660|A860|A98L|A980|A990|F0?6B|F660|18-MB)`)
)

func classificationTokenSet(value string) map[string]bool {
	return taxonomyTokenSet(value)
}

func classificationHasToken(tokens map[string]bool, values ...string) bool {
	for _, value := range values {
		if tokens[taxonomyNormalize(value)] {
			return true
		}
	}
	return false
}

func classificationHasAll(tokens map[string]bool, values ...string) bool {
	for _, value := range values {
		if !classificationHasToken(tokens, value) {
			return false
		}
	}
	return true
}

func classificationHasIO(tokens map[string]bool) bool {
	return tokens["io"] || (tokens["i"] && tokens["o"]) || tokens["input"] || tokens["output"]
}

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
	key = strings.NewReplacer("–", "-", "—", "-", "‑", "-", "＆", "&", ".", "", ",", "").Replace(key)
	key = strings.NewReplacer(" ", "", "-", "", "_", "", "/", "").Replace(key)
	switch key {
	case "", "unknown", "unk", "n/a", "na", "none", "null", "未识别", "未知":
		return ""
	case "fanuc", "fanuccnc", "gefanuc", "fanuccorporation", "fanucltd":
		return "fanuc"
	case "mitsubishi", "misubishi", "mitsubishielectric", "mitsubishiautomation", "melsec", "melservo":
		return "mitsubishi"
	case "siemens", "siemensag", "siemensindustry", "sipro", "siprotec":
		return "siemens"
	case "abb", "abbltd", "abblimited", "aseabrownboveri", "abbrobotics":
		return "abb"
	case "allenbradley", "allenbradly", "allenbradleycorporation", "ab", "a b", "rockwell", "rockwellautomation", "abautomation":
		return "allen-bradley"
	case "omron", "omronelectronics", "omronautomation":
		return "omron"
	case "sick", "sickag", "sicksensorintelligence":
		return "sick"
	case "tamagawa", "tamagawaseiki", "tamagawaseikico":
		return "tamagawa"
	case "fluke", "flukecorporation", "flukebiomedical":
		return "fluke"
	case "schneider", "schneiderelectric", "telemecanique":
		return "schneider"
	case "yaskawa", "yaskawaelectric", "sigma":
		return "yaskawa"
	case "panasonic", "matsushita":
		return "panasonic"
	case "keyence":
		return "keyence"
	case "delta", "deltaelectronics":
		return "delta"
	case "boschrexroth", "rexroth", "bosch":
		return "bosch-rexroth"
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
	case "omron":
		return "OMRON"
	case "sick":
		return "SICK"
	case "tamagawa":
		return "Tamagawa"
	case "fluke":
		return "FLUKE"
	case "schneider":
		return "Schneider Electric"
	case "yaskawa":
		return "Yaskawa"
	case "panasonic":
		return "Panasonic"
	case "keyence":
		return "KEYENCE"
	case "delta":
		return "Delta"
	case "bosch-rexroth":
		return "Bosch Rexroth"
	default:
		return strings.TrimSpace(brand)
	}
}

func InferProductCategory(brand string, model string) ProductCategoryInference {
	brandKey := NormalizeBrandKey(brand)
	if brandKey == "" || brandKey == "unknown" {
		if inferredBrand := inferBrandKeyFromModel(model); inferredBrand != "" {
			brandKey = inferredBrand
		}
	}
	switch brandKey {
	case "fanuc":
		return inferFanucCategoryInference(model)
	case "mitsubishi":
		return inferMitsubishiCategoryInference(model)
	case "siemens":
		return inferSiemensCategoryInference(model)
	case "abb":
		return inferABBCategoryInference(model)
	case "allen-bradley":
		return inferAllenBradleyCategoryInference(model)
	case "omron":
		return inferOmronCategoryInference(model)
	case "sick":
		return inferSICKCategoryInference(model)
	case "tamagawa":
		return inferTamagawaCategoryInference(model)
	case "fluke":
		return inferFlukeCategoryInference(model)
	default:
		inference := inferGenericCategoryInference(brand, model)
		if brandKey == "" || brandKey == "unknown" {
			// Keep inferred-brand evidence visible in diagnostics, while still
			// refusing a generic fallback when no model rule is known.
			if inferredBrand := inferBrandKeyFromModel(model); inferredBrand != "" {
				inference.BrandKey = inferredBrand
				inference.BrandName = CanonicalBrandName(inferredBrand)
				inference.MatchRule = "inferred-brand:" + inference.MatchRule
			}
		}
		return inference
	}
}

func inferBrandKeyFromModel(model string) string {
	upper := NormalizeProductModel(model)
	compact := compactModel(upper)
	switch {
	case IsLikelyFanucModel(upper):
		return "fanuc"
	case hasAnyPrefix(upper, "ACS", "ACH", "ACQ", "DCS", "3BSE", "3ABD", "3AUA", "1SFA"):
		return "abb"
	case hasAnyPrefix(upper, "1756", "1769", "1746", "1747", "1794", "1785", "2094", "2711", "1732", "1734", "1761", "1762", "1763", "1764", "1766", "1768", "1771", "1775", "1783", "1791", "1792", "1793", "1797", "2198", "20F", "20A", "20G", "22A", "22B", "25B", "25C", "25D", "40A", "40P", "50A", "1336", "140G", "1489", "1492", "1606", "193"):
		return "allen-bradley"
	case hasAnyPrefix(upper, "6ES", "6GK", "6AV", "6RA", "6SL", "6SE", "6EP", "6FC", "6AG", "3RW", "3RT", "3RV", "7KM", "7SJ", "7UT", "7KT", "1FK", "1FT", "1PH"):
		return "siemens"
	case hasAnyPrefix(upper, "MR-J", "MRJ", "FR-", "FR", "FREQROL", "FX", "Q00", "Q01", "Q02", "Q03", "Q04", "Q06", "L02", "L06", "A1S", "A2C", "HG", "HF", "HC", "HK", "MDS", "GOT"):
		return "mitsubishi"
	case hasAnyPrefix(compact, "CJ1", "CJ2", "CS1", "CP1", "C200H", "CQM1", "NJ", "NX", "R88", "E2E", "E3Z", "F3E", "CJ1W"):
		return "omron"
	case hasAnyPrefix(compact, "WTB", "WLG", "LMS", "LIDAR", "S30A", "S300", "C4000", "C4", "CLV", "RFU", "DFS", "ATM", "AFS", "OD"):
		return "sick"
	case hasAnyPrefix(compact, "ESA612", "FLUKE"):
		return "fluke"
	case hasAnyPrefix(compact, "TAMAGAWA", "TS2640", "TS5213", "TBL", "OSA", "TS"):
		return "tamagawa"
	default:
		return ""
	}
}

func compactModel(model string) string {
	upper := strings.ToUpper(strings.TrimSpace(model))
	var b strings.Builder
	for _, r := range upper {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func hasAnyPrefix(value string, prefixes ...string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(value, strings.ToUpper(prefix)) {
			return true
		}
	}
	return false
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
	if brandKey == "abb" && (strings.HasPrefix(upper, "ACS") || strings.HasPrefix(upper, "ACH") || strings.HasPrefix(upper, "ACQ")) {
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Variable Frequency Drive", CategorySlug: "variable-frequency-drives", MatchRule: "abb:model-drive"}
	}
	tokens := classificationTokenSet(upper)
	has := func(values ...string) bool { return classificationHasToken(tokens, values...) }
	hasAll := func(values ...string) bool { return classificationHasAll(tokens, values...) }
	switch {
	case has("output") && has("lc", "sine") && has("filter"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Output LC / Sine-wave Filter", CategorySlug: "output-lc-sine-wave-filters", MatchRule: "generic:output-filter-keyword"}
	case has("output") && has("reactor", "choke"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Output Reactor / Output Choke", CategorySlug: "output-reactors-chokes", MatchRule: "generic:output-reactor-keyword"}
	case (has("line") && has("reactor")) || (has("input") && has("choke")):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Line Reactor / Input Choke", CategorySlug: "line-reactors-input-chokes", MatchRule: "generic:line-reactor-keyword"}
	case (hasAll("variable", "frequency") && has("drive", "inverter")) || has("vfd"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Variable Frequency Drive", CategorySlug: "variable-frequency-drives", MatchRule: "generic:vfd-keyword"}
	case hasAll("circuit", "breaker"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Circuit Breaker", CategorySlug: "circuit-breakers", MatchRule: "generic:circuit-breaker-keyword"}
	case hasAll("power", "meter") || hasAll("panel", "meter"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Power Meter", CategorySlug: "power-meters", MatchRule: "generic:power-meter-keyword"}
	case hasAll("temperature", "input") && has("module"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Temperature Input Module", CategorySlug: "temperature-input-modules", MatchRule: "generic:temperature-input-keyword"}
	case has("communication") && has("processor", "interface", "module", "adapter"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Communication Interface Module", CategorySlug: "communication-interface-modules", MatchRule: "generic:communication-keyword"}
	case has("plc") || hasAll("programmable", "logic"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Programmable Logic Controller", CategorySlug: "programmable-logic-controllers", MatchRule: "generic:plc-keyword"}
	case hasAll("safety", "light", "curtain"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Safety Light Curtain", CategorySlug: "safety-light-curtains", MatchRule: "generic:safety-curtain-keyword"}
	case hasAll("safety", "laser", "scanner"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Safety Laser Scanner", CategorySlug: "safety-laser-scanners", MatchRule: "generic:safety-scanner-keyword"}
	case hasAll("safety", "door", "switch"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Safety Door Switch", CategorySlug: "safety-door-switches", MatchRule: "generic:safety-door-keyword"}
	case hasAll("photoelectric", "sensor"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Photoelectric Sensor", CategorySlug: "photoelectric-sensors", MatchRule: "generic:photoelectric-keyword"}
	case hasAll("proximity", "sensor"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Proximity Sensor", CategorySlug: "proximity-sensors", MatchRule: "generic:proximity-keyword"}
	case hasAll("distance", "sensor"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Distance Sensor", CategorySlug: "distance-sensors", MatchRule: "generic:distance-keyword"}
	case hasAll("vision", "sensor"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Vision Sensor", CategorySlug: "vision-sensors", MatchRule: "generic:vision-keyword"}
	case has("lidar") && has("sensor", "scanner"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "LiDAR Sensor", CategorySlug: "lidar-sensors", MatchRule: "generic:lidar-keyword"}
	case hasAll("barcode", "scanner"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Barcode Scanner", CategorySlug: "barcode-scanners", MatchRule: "generic:barcode-keyword"}
	case has("rfid"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "RFID", CategorySlug: "rfid", MatchRule: "generic:rfid-keyword"}
	case has("encoder", "resolver", "feedback"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Encoder / Feedback", CategorySlug: "encoders-feedback", MatchRule: "generic:encoder-keyword"}
	case has("spindle") && has("amplifier", "drive"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Spindle Amplifier / Drive", CategorySlug: "spindle-amplifiers-drives", MatchRule: "generic:spindle-drive-keyword"}
	case hasAll("spindle", "motor"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Spindle Motor", CategorySlug: "spindle-motors", MatchRule: "generic:spindle-motor-keyword"}
	case has("servo") && has("amplifier", "drive"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Servo Amplifier / Drive", CategorySlug: "servo-amplifiers-drives", MatchRule: "generic:servo-drive-keyword"}
	case hasAll("servo", "motor"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Servo Motor", CategorySlug: "servo-motors", MatchRule: "generic:servo-motor-keyword"}
	case has("cable", "cab", "connector", "conn", "harness", "wire", "plug", "socket"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Cable / Connector", CategorySlug: "cables-connectors", MatchRule: "generic:cable-keyword"}
	case has("supply", "psu", "fuse", "transformer") || (has("power") && has("supply")):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Power Supply Unit", CategorySlug: "power-supplies", MatchRule: "generic:power-keyword"}
	case hasAll("power", "module"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Power Module", CategorySlug: "power-modules", MatchRule: "generic:power-module-keyword"}
	case classificationHasIO(tokens) && has("module"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "I/O Module", CategorySlug: "io-modules", MatchRule: "generic:io-keyword"}
	case has("servo", "spindle", "amplifier", "motor", "drive"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Servo Motor / Drive", CategorySlug: "servo-motors", MatchRule: "generic:servo-keyword"}
	case has("pcb", "board", "cpu", "memory", "card"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "PCB Board", CategorySlug: "pcb-boards", MatchRule: "generic:board-keyword"}
	case has("control", "controller", "pendant", "hmi", "display", "monitor"):
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Control Unit", CategorySlug: "control-units", MatchRule: "generic:control-keyword"}
	default:
		return ProductCategoryInference{BrandKey: brandKey, BrandName: brandName, PartType: "Spare Part", CategorySlug: "control-units", MatchRule: "generic:fallback"}
	}
}

func confirmedInference(brandKey, partType, categorySlug, matchRule, family string) ProductCategoryInference {
	partType = CanonicalProductType(partType)
	return ProductCategoryInference{
		BrandKey:     brandKey,
		BrandName:    CanonicalBrandName(brandKey),
		PartType:     partType,
		CategorySlug: categorySlug,
		ModelFamily:  family,
		MatchRule:    matchRule,
	}
}

func inferAllenBradleyCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	if upper == "" {
		return ProductCategoryInference{BrandKey: "allen-bradley", BrandName: "Allen-Bradley", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "allen-bradley:empty-model"}
	}
	compact := compactModel(upper)
	// These are explicit nodes in the supplied catalog. Keep their family
	// tokens so a model such as 1756-RIO is not mixed into generic I/O.
	switch {
	case strings.HasPrefix(upper, "1756-RIO") || strings.HasPrefix(upper, "1756RIO"):
		return confirmedInference("allen-bradley", "I/O Module", "1756-rio-i-o-modules", "allen-bradley:family-1756-rio", "1756-RIO")
	case strings.HasPrefix(upper, "1769-OG16") || strings.HasPrefix(upper, "1769OG16"):
		return confirmedInference("allen-bradley", "Spare Part", "1769-og16-spare-parts", "allen-bradley:family-1769-og16", "1769-OG16")
	case hasAnyPrefix(compact, "1756IB", "1756IF", "1756IH", "1756IM", "1756IA", "1756OB", "1756OF", "1756OA"):
		return confirmedInference("allen-bradley", "I/O Module", "io-modules", "allen-bradley:model-1756-io", "")
	case hasAnyPrefix(compact, "1756EN", "1756CN", "1756DHR", "1756RM"):
		return confirmedInference("allen-bradley", "Communication Processor", "communication-processors", "allen-bradley:model-1756-communication", "")
	case hasAnyPrefix(compact, "1756L"):
		return confirmedInference("allen-bradley", "Programmable Logic Controller", "programmable-logic-controllers", "allen-bradley:model-1756-controller", "")
	case hasAnyPrefix(compact, "1756PA", "1756PB"):
		return confirmedInference("allen-bradley", "Power Supply Unit", "power-supplies", "allen-bradley:model-1756-power", "")
	case hasAnyPrefix(compact, "1769IA", "1769IF", "1769IM", "1769IQ", "1769OB", "1769OF", "1769OG", "1769OA"):
		return confirmedInference("allen-bradley", "I/O Module", "io-modules", "allen-bradley:model-1769-io", "")
	case hasAnyPrefix(compact, "1769L"):
		return confirmedInference("allen-bradley", "Programmable Logic Controller", "programmable-logic-controllers", "allen-bradley:model-1769-controller", "")
	case hasAnyPrefix(compact, "1769PA", "1769PB"):
		return confirmedInference("allen-bradley", "Power Supply Unit", "power-supplies", "allen-bradley:model-1769-power", "")
	case hasAnyPrefix(compact, "140G", "1489", "1492"):
		return confirmedInference("allen-bradley", "Circuit Breaker", "circuit-breakers", "allen-bradley:model-circuit-breaker", "")
	case strings.HasPrefix(upper, "20F") || strings.HasPrefix(upper, "20A") || strings.HasPrefix(upper, "20G") || strings.HasPrefix(upper, "22A") || strings.HasPrefix(upper, "22B") || strings.HasPrefix(upper, "25B"):
		return confirmedInference("allen-bradley", "Variable Frequency Drive", "variable-frequency-drives", "allen-bradley:model-drive", firstModelFamily(upper))
	default:
		inference := inferGenericCategoryInference("allen-bradley", upper)
		if inference.MatchRule == "generic:fallback" {
			inference.MatchRule = "allen-bradley:fallback"
		}
		return inference
	}
}

func inferABBCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	if upper == "" {
		return ProductCategoryInference{BrandKey: "abb", BrandName: "ABB", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "abb:empty-model"}
	}
	if strings.HasPrefix(upper, "ACS800-104") || strings.HasPrefix(upper, "ACS800104") {
		return confirmedInference("abb", "Variable Frequency Drive", "acs800-104-spare-parts", "abb:family-acs800-104", "ACS800-104")
	}
	if strings.HasPrefix(upper, "ACS800") {
		return confirmedInference("abb", "Variable Frequency Drive", "variable-frequency-drives", "abb:model-drive", "ACS800")
	}
	if hasAnyPrefix(upper, "ACS", "ACH", "ACQ") {
		return confirmedInference("abb", "Variable Frequency Drive", "variable-frequency-drives", "abb:model-drive", firstModelFamily(upper))
	}
	if strings.HasPrefix(upper, "DCS") || strings.HasPrefix(upper, "3BSE") || strings.HasPrefix(upper, "3ABD") || strings.HasPrefix(upper, "3AUA") {
		inference := inferGenericCategoryInference("abb", upper)
		if strings.Contains(strings.ToLower(inference.MatchRule), "fallback") {
			return ProductCategoryInference{BrandKey: "abb", BrandName: "ABB", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "abb:fallback"}
		}
		inference.MatchRule = "abb:identified-family"
		inference.ModelFamily = firstModelFamily(upper)
		return inference
	}
	return ProductCategoryInference{BrandKey: "abb", BrandName: "ABB", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "abb:fallback"}
}

func inferSiemensCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	if upper == "" {
		return ProductCategoryInference{BrandKey: "siemens", BrandName: "Siemens", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "siemens:empty-model"}
	}
	compact := compactModel(upper)
	switch {
	case strings.HasPrefix(compact, "6SE64003CC"):
		return confirmedInference("siemens", "Line Reactor", "line-reactors", "siemens:model-micromaster-line-reactor", "")
	case strings.HasPrefix(compact, "6SE64003TC"):
		return confirmedInference("siemens", "Output Reactor", "output-reactors", "siemens:model-micromaster-output-reactor", "")
	case strings.HasPrefix(compact, "6SE64003TD"):
		return confirmedInference("siemens", "Output LC Filter", "output-lc-filters", "siemens:model-micromaster-output-lc-filter", "")
	case strings.Contains(compact, "S71500") || strings.HasPrefix(upper, "6ES7-15") || strings.HasPrefix(compact, "6ES75"):
		return confirmedInference("siemens", "Programmable Logic Controller", "s7-1500-plc-spare-parts", "siemens:family-s7-1500", "S7-1500")
	case strings.Contains(compact, "S7300") || strings.HasPrefix(compact, "6ES73"):
		return confirmedInference("siemens", "Programmable Logic Controller", "s7-300-plc-spare-parts", "siemens:family-s7-300", "S7-300")
	case strings.Contains(compact, "S7400") || strings.HasPrefix(compact, "6ES74"):
		return confirmedInference("siemens", "Programmable Logic Controller", "s7-400-plc-spare-parts", "siemens:family-s7-400", "S7-400")
	case strings.Contains(compact, "7UT86"):
		return confirmedInference("siemens", "Spare Part", "siprotec-7ut86-spare-parts", "siemens:family-siprotec-7ut86", "SIPROTEC 7UT86")
	case strings.Contains(compact, "7SJ85"):
		return confirmedInference("siemens", "Spare Part", "siprotec-7sj85-spare-parts", "siemens:family-siprotec-7sj85", "SIPROTEC 7SJ85")
	case strings.Contains(compact, "7SJ82"):
		return confirmedInference("siemens", "Spare Part", "siprotec-7sj82-spare-parts", "siemens:family-siprotec-7sj82", "SIPROTEC 7SJ82")
	case strings.HasPrefix(compact, "6AV"):
		return confirmedInference("siemens", "Operator Panel / HMI", "operator-panels-hmi", "siemens:model-hmi", firstModelFamily(upper))
	case strings.Contains(compact, "HMI"):
		return confirmedInference("siemens", "Operator Panel / HMI", "operator-panels-hmi", "siemens:keyword-hmi", "")
	case strings.HasPrefix(compact, "6GK"):
		return confirmedInference("siemens", "Industrial Network Router", "industrial-network-routers", "siemens:model-network", firstModelFamily(upper))
	case strings.HasPrefix(compact, "6ES713"), strings.HasPrefix(compact, "6ES714"), strings.HasPrefix(compact, "6ES715"), strings.HasPrefix(compact, "6ES722"), strings.HasPrefix(compact, "6ES723"):
		return confirmedInference("siemens", "I/O Module", "i-o-modules", "siemens:model-io", firstModelFamily(upper))
	case strings.HasPrefix(compact, "6ES721"):
		return confirmedInference("siemens", "Programmable Logic Controller", "s7-1200-plc-spare-parts", "siemens:family-s7-1200", "S7-1200")
	default:
		return ProductCategoryInference{BrandKey: "siemens", BrandName: "Siemens", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "siemens:fallback"}
	}
}

func inferMitsubishiCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	if upper == "" {
		return ProductCategoryInference{BrandKey: "mitsubishi", BrandName: "Mitsubishi", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "mitsubishi:empty-model"}
	}
	compact := compactModel(upper)
	switch {
	case strings.HasPrefix(upper, "HK-ST") || strings.HasPrefix(compact, "HKST"):
		return confirmedInference("mitsubishi", "Servo Motor", "hk-st-series-servo-motors", "mitsubishi:family-hk-st", "HK-ST")
	case strings.HasPrefix(upper, "MR-J4") || strings.HasPrefix(compact, "MRJ4"):
		return confirmedInference("mitsubishi", "Servo Amplifier / Drive", "melservo-mr-j4", "mitsubishi:family-mr-j4", "MR-J4")
	case strings.HasPrefix(upper, "MR-J3") || strings.HasPrefix(compact, "MRJ3"):
		return confirmedInference("mitsubishi", "Servo Amplifier / Drive", "melservo-mr-j3", "mitsubishi:family-mr-j3", "MR-J3")
	case strings.HasPrefix(upper, "MR-J2") || strings.HasPrefix(compact, "MRJ2"):
		return confirmedInference("mitsubishi", "Servo Amplifier / Drive", "melservo-mr-j2", "mitsubishi:family-mr-j2", "MR-J2")
	case strings.HasPrefix(upper, "HG-SR") || strings.HasPrefix(compact, "HGSR"):
		return confirmedInference("mitsubishi", "Servo Motor", "hg-sr-servo-motors", "mitsubishi:family-hg-sr", "HG-SR")
	case strings.HasPrefix(compact, "HG"):
		return confirmedInference("mitsubishi", "Servo Motor", "hg-series", "mitsubishi:family-hg", "HG")
	case strings.HasPrefix(compact, "HF"):
		return confirmedInference("mitsubishi", "Servo Motor", "hf-series", "mitsubishi:family-hf", "HF")
	case strings.HasPrefix(compact, "HC"):
		return confirmedInference("mitsubishi", "Servo Motor", "melservo-hc", "mitsubishi:family-hc", "HC")
	case strings.HasPrefix(upper, "MDS"):
		return confirmedInference("mitsubishi", "Servo Amplifier / Drive", "mds-servo-drives", "mitsubishi:family-mds", "MDS")
	case strings.HasPrefix(upper, "FX"):
		return confirmedInference("mitsubishi", "Programmable Logic Controller", "fx-series", "mitsubishi:family-fx", "FX")
	case strings.HasPrefix(upper, "Q00") || strings.HasPrefix(upper, "Q01") || strings.HasPrefix(upper, "Q02") || strings.HasPrefix(upper, "Q03") || strings.HasPrefix(upper, "Q04") || strings.HasPrefix(upper, "Q06"):
		return confirmedInference("mitsubishi", "Programmable Logic Controller", "melsec-q", "mitsubishi:family-melsec-q", "Melsec-Q")
	case strings.HasPrefix(compact, "A1S") || strings.HasPrefix(compact, "A2C"):
		return confirmedInference("mitsubishi", "Programmable Logic Controller", "a-series", "mitsubishi:family-a-series", "A Series")
	case strings.HasPrefix(upper, "GOT"):
		return confirmedInference("mitsubishi", "Operator Panel / HMI", "got1000", "mitsubishi:family-got", "GOT1000")
	case strings.HasPrefix(upper, "FR-") || strings.HasPrefix(upper, "FREQROL"):
		return confirmedInference("mitsubishi", "Variable Frequency Drive", "freqrol-fr", "mitsubishi:family-freqrol", "FREQROL FR")
	default:
		return ProductCategoryInference{BrandKey: "mitsubishi", BrandName: "Mitsubishi", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "mitsubishi:fallback"}
	}
}

func inferOmronCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	compact := compactModel(upper)
	switch {
	case hasAnyPrefix(compact, "CJ1WID", "CJ1WOD", "CJ1WAD", "CJ1WDA", "CJ1WMAD", "CS1WID", "CS1WOD", "CS1WAD", "CS1WDA"):
		return confirmedInference("omron", "I/O Module", "i-o-modules", "omron:model-io", firstModelFamily(upper))
	case hasAnyPrefix(compact, "CJ1WPA", "CJ1WPD", "CS1WPA", "CS1WPD"):
		return confirmedInference("omron", "Power Supply Unit", "power-supplies", "omron:model-power", firstModelFamily(upper))
	case hasAnyPrefix(compact, "CJ1G", "CJ1H", "CJ1M", "CJ2H", "CJ2M", "CS1G", "CS1H", "CP1", "C200H", "CQM1", "NJ", "NX"):
		return confirmedInference("omron", "Programmable Logic Controller", "programmable-logic-controllers", "omron:model-plc", firstModelFamily(upper))
	case hasAnyPrefix(compact, "R88"):
		return confirmedInference("omron", "Servo Amplifier / Drive", "servo-drives", "omron:model-servo-drive", firstModelFamily(upper))
	case hasAnyPrefix(compact, "E2E"):
		return confirmedInference("omron", "Proximity Sensor", "proximity-sensors", "omron:model-proximity-sensor", firstModelFamily(upper))
	case hasAnyPrefix(compact, "E3Z"):
		return confirmedInference("omron", "Photoelectric Sensor", "photoelectric-sensors", "omron:model-photoelectric-sensor", firstModelFamily(upper))
	default:
		inference := inferGenericCategoryInference("omron", model)
		if inference.MatchRule == "generic:fallback" {
			inference.MatchRule = "omron:fallback"
		}
		return inference
	}
}

func inferSICKCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	compact := compactModel(upper)
	var partType, slug, rule string
	switch {
	case strings.HasPrefix(compact, "WTB") || strings.HasPrefix(compact, "WLG"):
		partType, slug, rule = "Photoelectric Sensor", "sick-photoelectric-sensors", "sick:model-photoelectric"
	case strings.HasPrefix(compact, "OD"):
		partType, slug, rule = "Distance Sensor", "sick-distance-sensors", "sick:model-distance"
	case strings.HasPrefix(compact, "LMS"):
		partType, slug, rule = "LiDAR Sensor", "sick-lidar-sensors", "sick:model-lidar"
	case strings.HasPrefix(compact, "S300") || strings.HasPrefix(compact, "S30A"):
		partType, slug, rule = "Safety Laser Scanner", "sick-safety-laser-scanners", "sick:model-safety-scanner"
	case strings.HasPrefix(compact, "C4000") || strings.HasPrefix(compact, "C4"):
		partType, slug, rule = "Safety Light Curtain", "sick-safety-light-curtains", "sick:model-safety"
	case strings.HasPrefix(compact, "CLV"):
		partType, slug, rule = "Barcode Scanner", "sick-barcode-scanners", "sick:model-barcode"
	case strings.HasPrefix(compact, "RFU"):
		partType, slug, rule = "RFID", "sick-rfid", "sick:model-rfid"
	case strings.HasPrefix(compact, "ATM") || strings.HasPrefix(compact, "DFS"):
		partType, slug, rule = "Encoder", "sick-encoders", "sick:model-encoder"
	case strings.Contains(compact, "LIDAR"):
		partType, slug, rule = "LiDAR Sensor", "sick-lidar-sensors", "sick:keyword-lidar"
	case strings.Contains(compact, "SAFETY"):
		partType, slug, rule = "Safety Light Curtain", "sick-safety-light-curtains", "sick:keyword-safety"
	case strings.Contains(compact, "BARCODE"):
		partType, slug, rule = "Barcode Scanner", "sick-barcode-scanners", "sick:keyword-barcode"
	case strings.Contains(compact, "RFID"):
		partType, slug, rule = "RFID", "sick-rfid", "sick:keyword-rfid"
	case strings.Contains(compact, "ENC"):
		partType, slug, rule = "Encoder", "sick-encoders", "sick:keyword-encoder"
	default:
		inference := inferGenericCategoryInference("sick", model)
		if inference.MatchRule == "generic:fallback" {
			inference.MatchRule = "sick:fallback"
		}
		return inference
	}
	return confirmedInference("sick", partType, slug, rule, "")
}

func inferTamagawaCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	compact := compactModel(upper)
	switch {
	case strings.HasPrefix(compact, "TS26"):
		return confirmedInference("tamagawa", "Resolver / Synchro", "tamagawa-resolvers-synchros", "tamagawa:model-resolver", "")
	case strings.HasPrefix(compact, "TS52"):
		return confirmedInference("tamagawa", "Rotary Encoder", "tamagawa-rotary-encoders", "tamagawa:model-rotary-encoder", "")
	case strings.Contains(compact, "RESOLVER") || strings.Contains(compact, "SYNCHRO"):
		return confirmedInference("tamagawa", "Resolver / Synchro", "tamagawa-resolvers-synchros", "tamagawa:keyword-resolver", "")
	case strings.Contains(compact, "GYRO") || strings.Contains(compact, "IMU"):
		return confirmedInference("tamagawa", "Gyro / IMU", "tamagawa-gyros-imu", "tamagawa:keyword-gyro", "")
	case strings.Contains(compact, "SERVO") || strings.Contains(compact, "DRIVER"):
		return confirmedInference("tamagawa", "Servo Motor / Driver", "tamagawa-servo-motors-drivers", "tamagawa:keyword-servo", "")
	case strings.Contains(compact, "STEP"):
		return confirmedInference("tamagawa", "Step Motor / Driver", "tamagawa-step-motors-drivers", "tamagawa:keyword-step", "")
	default:
		return ProductCategoryInference{BrandKey: "tamagawa", BrandName: "Tamagawa", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "tamagawa:fallback"}
	}
}

func inferFlukeCategoryInference(model string) ProductCategoryInference {
	upper := NormalizeProductModel(model)
	if strings.HasPrefix(upper, "ESA612") {
		return confirmedInference("fluke", "Spare Part", "esa612-spare-parts", "fluke:family-esa612", "ESA612")
	}
	return ProductCategoryInference{BrandKey: "fluke", BrandName: "FLUKE", PartType: "Spare Part", CategorySlug: "spare-parts", MatchRule: "fluke:fallback"}
}

func firstModelFamily(model string) string {
	upper := NormalizeProductModel(model)
	if upper == "" {
		return ""
	}
	parts := strings.Split(upper, "-")
	if len(parts) >= 2 {
		return strings.Join(parts[:2], "-")
	}
	return parts[0]
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
