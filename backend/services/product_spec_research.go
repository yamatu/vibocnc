package services

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// This file implements the first half of the "model number in, parameters out"
// pipeline: given only a model number (型号) it gathers public evidence with the
// existing bounded/SSRF-safe search and extracts parameter candidates from that
// evidence.
//
// Safety rules, because a wrong parameter is worse than a missing one:
//   - a candidate is only produced when the exact model identifier occurs in the
//     same evidence text, so a neighbour model's datasheet cannot leak values,
//   - the value must be copied verbatim from the evidence text (no rounding, no
//     unit conversion, no inference),
//   - the source URL/title is stored with every candidate so a reviewer can
//     verify it before it is ever published,
//   - nothing here writes to product content. Drafts are reviewed by an admin.
const specResearchMaxCandidates = 24

// SpecResearchCandidate is one parameter proposed for review.
type SpecResearchCandidate struct {
	Label string `json:"label"`
	Value string `json:"value"`
	// SourceURL/SourceTitle/SourceType let a reviewer open the exact page the
	// value was copied from.
	SourceURL   string `json:"source_url,omitempty"`
	SourceTitle string `json:"source_title,omitempty"`
	SourceType  string `json:"source_type,omitempty"`
	// Evidence is the verbatim surrounding text that proves the value.
	Evidence string `json:"evidence,omitempty"`
	// Origin is "extracted" for pattern matches and "ai" for values proposed by
	// the language model that passed the verbatim check.
	Origin string `json:"origin,omitempty"`
}

// SpecResearchResult is the review input produced for one model number.
type SpecResearchResult struct {
	Brand      string                  `json:"brand"`
	Model      string                  `json:"model"`
	Candidates []SpecResearchCandidate `json:"candidates"`
	Evidence   []ProductWebEvidence    `json:"evidence,omitempty"`
	Confidence string                  `json:"confidence"`
	Notes      string                  `json:"notes,omitempty"`
}

// specPattern describes one recognised parameter family. Patterns run against
// evidence text that already contains the exact model identifier.
type specPattern struct {
	Label   string
	Pattern *regexp.Regexp
}

var specPatterns = []specPattern{
	{Label: "Input voltage", Pattern: regexp.MustCompile(`(?i)\b(?:input\s+)?(?:rated\s+|nominal\s+)?(?:voltage|supply(?:\s+voltage)?|operating\s+voltage)\s*[:\-–]?\s*((?:\d+(?:\.\d+)?\s*(?:-|–|~|to|/)\s*)?\d+(?:\.\d+)?\s*V\s*(?:AC|DC)?)`)},
	{Label: "Rated current", Pattern: regexp.MustCompile(`(?i)\b(?:rated\s+|nominal\s+|output\s+)?current\s*[:\-–]?\s*(\d+(?:\.\d+)?\s*(?:A\s*rms|A|mA))`)},
	{Label: "Rated power", Pattern: regexp.MustCompile(`(?i)\b(?:rated\s+|output\s+|motor\s+)?(?:power|capacity)\s*[:\-–]?\s*(\d+(?:\.\d+)?\s*(?:kW|kVA|VA|W|HP))`)},
	{Label: "Frequency", Pattern: regexp.MustCompile(`(?i)\b(?:frequency|rated\s+frequency|output\s+frequency)\s*[:\-–]?\s*(\d+(?:\.\d+)?(?:\s*[/\-–~]\s*\d+(?:\.\d+)?)?\s*(?:kHz|Hz))`)},
	{Label: "Weight", Pattern: regexp.MustCompile(`(?i)\b(?:net\s+)?weight\s*[:\-–]?\s*(\d+(?:\.\d+)?\s*(?:kg|g|lbs?))`)},
	{Label: "Dimensions", Pattern: regexp.MustCompile(`(?i)\bdimensions?\s*[:\-–]?\s*(\d+(?:\.\d+)?\s*(?:x|×|\*)\s*\d+(?:\.\d+)?(?:\s*(?:x|×|\*)\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|m|in|inch|inches)?)`)},
	{Label: "Max speed", Pattern: regexp.MustCompile(`(?i)\b(?:max(?:imum)?\s+(?:speed|spindle\s+speed)|rated\s+speed)\s*[:\-–]?\s*(\d[\d,\.]*\s*(?:rpm|r/min|min-1|min−1))`)},
	{Label: "Encoder resolution", Pattern: regexp.MustCompile(`(?i)\b(?:resolution|encoder\s+resolution|pulses?)\s*[:\-–]?\s*(\d[\d,\.]*\s*(?:pulses?/rev|pulses?|ppr|p/r|lines?/rev|lines?|bit))`)},
	{Label: "Operating temperature", Pattern: regexp.MustCompile(`(?i)\b(?:operating|ambient)\s+temperature\s*[:\-–]?\s*(-?\d+\s*(?:°|deg)?\s*C?\s*(?:to|-|–|~)\s*\+?-?\d+\s*(?:°|deg)?\s*C)`)},
	{Label: "Protection class", Pattern: regexp.MustCompile(`(?i)\b(?:protection(?:\s+(?:class|rating|degree))?|degree\s+of\s+protection|enclosure)\s*[:\-–]?\s*(IP\s?\d{2}[A-Z]?)`)},
	{Label: "Insulation class", Pattern: regexp.MustCompile(`(?i)\binsulation\s+(?:class|system)\s*[:\-–]?\s*(class\s+[A-H]|[A-H]\s+class)`)},
	{Label: "Cooling method", Pattern: regexp.MustCompile(`(?i)\b(?:cooling|method of cooling)\s*(?:method)?\s*[:\-–]?\s*((?:self[- ]?cooled|forced\s+air|air[- ]cooled|water[- ]cooled|natural\s+cooling|fan[- ]cooled))`)},
	{Label: "Mounting type", Pattern: regexp.MustCompile(`(?i)\bmounting\s+(?:type|method)\s*[:\-–]?\s*((?:panel|wall|din\s*rail|flange|foot|rack|vertical|horizontal|machine)[a-z ]{0,24})`)},
	{Label: "Interface", Pattern: regexp.MustCompile(`(?i)\b(?:communication|interface|fieldbus|bus|protocol)\s*(?:interface|type|port)?\s*[:\-–]?\s*([A-Za-z0-9][A-Za-z0-9 \-\+/]{2,40})`)},
	{Label: "Certifications", Pattern: regexp.MustCompile(`\b(CE|UL|cULus|CSA|RoHS|REACH|CCC|TÜV|ISO\s?\d{4,5})\b`)},
}

// specInterfaceAllowList keeps the free-form interface match from capturing the
// next sentence, which used to make the "interface" row unusable.
var specInterfaceAllowList = []string{
	"ethernet/ip", "ethernet-ip", "cc-link ie field", "cc-link ie", "cc-link", "profinet", "profibus",
	"ethercat", "devicenet", "canopen", "modbus tcp", "modbus rtu", "modbus", "rs-232c", "rs-232",
	"rs-422", "rs-485", "usb", "hdmi", "sercos", "melsecnet", "io-link", "powerlink", "bacnet",
	"lin bus", "ethernet", "spi", "i2c", "pwm",
}

// specValueNoise rejects values that matched a pattern but carry no measurement.
var specValueNoise = regexp.MustCompile(`(?i)^(?:n/?a|none|not\s+specified|see\s+.*|varies|tbd|unknown|optional)$`)

// ResearchProductSpecs gathers public evidence for a model number and proposes
// parameter candidates for admin review. It never writes product content.
func ResearchProductSpecs(ctx context.Context, brand, model, productName string) (SpecResearchResult, error) {
	model = strings.TrimSpace(NormalizeProductModel(model))
	if model == "" {
		return SpecResearchResult{}, fmt.Errorf("model is required for specification research")
	}
	result := SpecResearchResult{
		Brand:      CanonicalBrandName(brand),
		Model:      model,
		Candidates: []SpecResearchCandidate{},
		Confidence: "low",
	}

	evidence, err := SearchProductEvidence(ctx, brand, model)
	if err != nil {
		return result, err
	}
	result.Evidence = evidence
	result.Candidates = ExtractSpecCandidates(model, evidence)
	result.Confidence = specResearchConfidence(result.Candidates, evidence)
	result.Notes = specResearchNote(result, productName)
	return result, nil
}

// ExtractSpecCandidates copies parameter values verbatim out of the collected
// evidence. Only evidence whose text contains the exact model identifier is
// used, and only real pages (manufacturer or distributor) are trusted.
func ExtractSpecCandidates(model string, evidence []ProductWebEvidence) []SpecResearchCandidate {
	model = strings.TrimSpace(NormalizeProductModel(model))
	if model == "" {
		return []SpecResearchCandidate{}
	}
	seen := map[string]int{}
	candidates := make([]SpecResearchCandidate, 0, specResearchMaxCandidates)

	for _, item := range evidence {
		if item.SourceType == "search-result" || item.EvidenceLevel == "search-result" {
			// Search-engine summaries can be rewritten by the engine and often
			// mix several products, so they are not a specification source.
			continue
		}
		text := NormalizeWhitespaceCopy(strings.Join([]string{item.Title, item.Snippet}, " "))
		if text == "" || !containsExactProductIdentifier(text, model) {
			continue
		}
		for _, spec := range specPatterns {
			matches := spec.Pattern.FindAllStringSubmatchIndex(text, 2)
			for _, match := range matches {
				if len(match) < 4 || match[2] < 0 || match[3] < 0 {
					continue
				}
				value := strings.TrimSpace(text[match[2]:match[3]])
				value = normalizeSpecValue(value)
				if !validSpecValue(spec.Label, value) {
					continue
				}
				key := strings.ToLower(spec.Label) + "\x00" + strings.ToLower(value)
				if index, ok := seen[key]; ok {
					// Prefer the manufacturer copy of the same value.
					if !specSourceIsStronger(item, candidates[index]) {
						continue
					}
					candidates[index] = buildSpecCandidate(spec.Label, value, item, text[match[2]:match[3]])
					continue
				}
				if len(candidates) >= specResearchMaxCandidates {
					continue
				}
				seen[key] = len(candidates)
				candidates = append(candidates, buildSpecCandidate(spec.Label, value, item, text[match[2]:match[3]]))
			}
		}
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := specLabelOrder(candidates[i].Label), specLabelOrder(candidates[j].Label)
		if left != right {
			return left < right
		}
		return candidates[i].SourceURL < candidates[j].SourceURL
	})
	return candidates
}

func buildSpecCandidate(label, value string, item ProductWebEvidence, rawMatch string) SpecResearchCandidate {
	index := strings.Index(strings.ToLower(item.Snippet), strings.ToLower(rawMatch))
	contextText := item.Snippet
	if index >= 0 {
		start := index - 120
		if start < 0 {
			start = 0
		}
		end := index + len(rawMatch) + 120
		if end > len(item.Snippet) {
			end = len(item.Snippet)
		}
		contextText = item.Snippet[start:end]
	}
	return SpecResearchCandidate{
		Label:       label,
		Value:       value,
		SourceURL:   item.URL,
		SourceTitle: item.Title,
		SourceType:  firstNonEmpty(item.SourceType, item.EvidenceLevel),
		Evidence:    limitLen(NormalizeWhitespaceCopy(contextText), 320),
		Origin:      "extracted",
	}
}

func specSourceIsStronger(candidate ProductWebEvidence, existing SpecResearchCandidate) bool {
	if existing.SourceType == "manufacturer" {
		return false
	}
	return candidate.SourceType == "manufacturer" || candidate.EvidenceLevel == "manufacturer"
}

func normalizeSpecValue(value string) string {
	value = NormalizeWhitespaceCopy(value)
	value = strings.Trim(value, " \t,;:.")
	value = strings.ReplaceAll(value, " - ", " - ")
	return value
}

func validSpecValue(label, value string) bool {
	if value == "" || len([]rune(value)) > 80 {
		return false
	}
	if specValueNoise.MatchString(value) {
		return false
	}
	switch label {
	case "Input voltage":
		return regexp.MustCompile(`(?i)\d\s*V(\s*(AC|DC))?$`).MatchString(value)
	case "Rated current":
		return regexp.MustCompile(`(?i)\d\s*(A|mA)$`).MatchString(value)
	case "Rated power":
		return regexp.MustCompile(`(?i)\d\s*(kW|kVA|VA|W|HP)$`).MatchString(value)
	case "Frequency":
		return regexp.MustCompile(`(?i)\d\s*(kHz|Hz)$`).MatchString(value)
	case "Weight":
		return regexp.MustCompile(`(?i)\d\s*(kg|g|lbs?)$`).MatchString(value)
	case "Max speed":
		return regexp.MustCompile(`(?i)\d\s*(rpm|r/min|min-1|min−1)$`).MatchString(value)
	case "Protection class":
		return regexp.MustCompile(`(?i)^IP\s?\d{2}[A-Z]?$`).MatchString(value)
	case "Interface":
		return specInterfaceAllowed(value)
	default:
		return true
	}
}

func specInterfaceAllowed(value string) bool {
	lower := strings.ToLower(value)
	for _, allowed := range specInterfaceAllowList {
		if lower == allowed || strings.HasPrefix(lower, allowed+" ") || strings.HasPrefix(lower, allowed+"/") {
			return true
		}
	}
	return false
}

func specLabelOrder(label string) int {
	for index, spec := range specPatterns {
		if spec.Label == label {
			return index
		}
	}
	return len(specPatterns)
}

func specResearchConfidence(candidates []SpecResearchCandidate, evidence []ProductWebEvidence) string {
	if len(candidates) == 0 {
		return "low"
	}
	manufacturerCandidates := 0
	manufacturerEvidence := 0
	for _, candidate := range candidates {
		if candidate.SourceType == "manufacturer" {
			manufacturerCandidates++
		}
	}
	for _, item := range evidence {
		if item.EvidenceLevel == "manufacturer" || item.SourceType == "manufacturer" {
			manufacturerEvidence++
		}
	}
	switch {
	case manufacturerCandidates >= 3 || (manufacturerEvidence >= 1 && len(candidates) >= 5):
		return "high"
	case manufacturerCandidates >= 1 || len(candidates) >= 3:
		return "medium"
	default:
		return "low"
	}
}

func specResearchNote(result SpecResearchResult, productName string) string {
	if len(result.Candidates) == 0 {
		return "No verifiable parameter was found in the reachable manufacturer or distributor pages. Enter the parameters manually instead of publishing a guess."
	}
	subject := strings.TrimSpace(productName)
	if subject == "" {
		subject = strings.TrimSpace(result.Brand + " " + result.Model)
	}
	return fmt.Sprintf("Extracted %d parameter(s) for %s from %d source page(s). Every value is copied verbatim from the cited page and must be reviewed before publishing.",
		len(result.Candidates), subject, len(result.Evidence))
}

// FilterSpecCandidatesByVerbatimEvidence keeps only AI-proposed values that
// literally occur in one of the trusted evidence pages, and attaches the source
// so the review queue can show where the value came from.
func FilterSpecCandidatesByVerbatimEvidence(model string, proposed []SpecResearchCandidate, evidence []ProductWebEvidence) []SpecResearchCandidate {
	model = strings.TrimSpace(NormalizeProductModel(model))
	if model == "" || len(proposed) == 0 {
		return nil
	}
	type sourceText struct {
		item ProductWebEvidence
		text string
	}
	sources := make([]sourceText, 0, len(evidence))
	for _, item := range evidence {
		if item.SourceType == "search-result" || item.EvidenceLevel == "search-result" {
			continue
		}
		text := NormalizeWhitespaceCopy(strings.Join([]string{item.Title, item.Snippet}, " "))
		if text == "" || !containsExactProductIdentifier(text, model) {
			continue
		}
		sources = append(sources, sourceText{item: item, text: strings.ToLower(text)})
	}
	if len(sources) == 0 {
		return nil
	}

	kept := make([]SpecResearchCandidate, 0, len(proposed))
	seen := map[string]bool{}
	for _, candidate := range proposed {
		label := NormalizeWhitespaceCopy(candidate.Label)
		value := normalizeSpecValue(candidate.Value)
		if label == "" || !validSpecValue(label, value) {
			continue
		}
		needle := strings.ToLower(value)
		var matched *sourceText
		for index := range sources {
			if strings.Contains(sources[index].text, needle) {
				matched = &sources[index]
				break
			}
		}
		if matched == nil {
			// The model produced a plausible value that is not on any cited
			// page. Dropping it is the whole point of the verbatim check.
			continue
		}
		key := strings.ToLower(label) + "\x00" + needle
		if seen[key] {
			continue
		}
		seen[key] = true
		kept = append(kept, SpecResearchCandidate{
			Label:       label,
			Value:       value,
			SourceURL:   matched.item.URL,
			SourceTitle: matched.item.Title,
			SourceType:  firstNonEmpty(matched.item.SourceType, matched.item.EvidenceLevel),
			Origin:      "ai",
		})
	}
	return kept
}

// MergeSpecCandidateLists merges extracted and AI-verified candidates, keeping
// the extracted (pattern-matched) value when both describe the same label.
func MergeSpecCandidateLists(primary, secondary []SpecResearchCandidate) []SpecResearchCandidate {
	merged := make([]SpecResearchCandidate, 0, len(primary)+len(secondary))
	index := map[string]int{}
	for _, candidate := range primary {
		key := strings.ToLower(candidate.Label)
		if _, ok := index[key]; ok {
			continue
		}
		index[key] = len(merged)
		merged = append(merged, candidate)
	}
	for _, candidate := range secondary {
		key := strings.ToLower(candidate.Label)
		if _, ok := index[key]; ok {
			continue
		}
		index[key] = len(merged)
		merged = append(merged, candidate)
	}
	return merged
}

// SpecCandidatesToMap converts reviewed candidates into the specification table
// stored on the product.
func SpecCandidatesToMap(candidates []SpecResearchCandidate) map[string]string {
	specs := map[string]string{}
	for _, candidate := range candidates {
		label := NormalizeWhitespaceCopy(candidate.Label)
		value := NormalizeWhitespaceCopy(candidate.Value)
		if label == "" || value == "" {
			continue
		}
		specs[label] = value
	}
	return specs
}

// ParseTechnicalSpecs reads the product JSON column back into a map. A malformed
// or empty value yields an empty map rather than an error, because a bad column
// must never block a review action.
func ParseTechnicalSpecs(raw string) map[string]string {
	specs := map[string]string{}
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" || raw == "null" {
		return specs
	}
	decoded := map[string]string{}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		// A non-string value (for example a number) makes the strict decode
		// fail; fall back to a loose decode so no data is silently lost.
		loose := map[string]interface{}{}
		if lenErr := json.Unmarshal([]byte(raw), &loose); lenErr != nil {
			return map[string]string{}
		}
		for key, value := range loose {
			decoded[key] = fmt.Sprintf("%v", value)
		}
	}
	for key, value := range decoded {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		specs[key] = value
	}
	return specs
}

// ReviewedSpecDraft is the durable review payload stored on a draft row.
type ReviewedSpecDraft struct {
	Candidates []SpecResearchCandidate `json:"candidates"`
	Confidence string                  `json:"confidence,omitempty"`
	Notes      string                  `json:"notes,omitempty"`
}

// BuildSpecDraftPayload serialises a research result for the review queue.
func BuildSpecDraftPayload(result SpecResearchResult) string {
	payload := ReviewedSpecDraft{
		Candidates: result.Candidates,
		Confidence: result.Confidence,
		Notes:      result.Notes,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// DecodeSpecDraftPayload reads a stored draft payload.
func DecodeSpecDraftPayload(raw string) ReviewedSpecDraft {
	var payload ReviewedSpecDraft
	if strings.TrimSpace(raw) == "" {
		return payload
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return ReviewedSpecDraft{}
	}
	return payload
}

// SpecEvidenceJSON serialises the source list for audit display.
func SpecEvidenceJSON(evidence []ProductWebEvidence) string {
	if len(evidence) == 0 {
		return ""
	}
	encoded, err := json.Marshal(evidence)
	if err != nil {
		return ""
	}
	return string(encoded)
}
