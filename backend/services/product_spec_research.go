package services

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
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
	// Alternatives holds the values other pages gave for the same label. When it
	// is set, the sources disagree and a reviewer has to pick, because silently
	// keeping the first value is how a wrong parameter gets published.
	Alternatives []string `json:"alternatives,omitempty"`
	// Conflict is true when Alternatives is non-empty.
	Conflict bool `json:"conflict,omitempty"`
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
	"ethernet/ip", "ethernet-ip", "ethernet powerlink", "cc-link ie field", "cc-link ie", "cc-link", "profinet", "profibus",
	"fssb", "sscnet iii/h", "sscnet iii", "sscnet", "mechatrolink iii", "mechatrolink ii", "mechatrolink",
	"profisafe", "controlnet", "opc ua", "tcp/ip", "can bus", "canbus", "modbus plus", "analog", "fiber optic",
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

	// Specification windows, not the classification snippet: a datasheet table
	// normally sits well past the first 700 characters of a page.
	evidence, err := SpecResearchEvidence(ctx, brand, model)
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
	positions := map[string]int{}
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
			// One canonical label per parameter, so "Voltage" and "Input voltage"
			// cannot become two rows that contradict each other.
			label := CanonicalSpecLabel(spec.Label)
			matches := spec.Pattern.FindAllStringSubmatchIndex(text, 2)
			for _, match := range matches {
				if len(match) < 4 || match[2] < 0 || match[3] < 0 {
					continue
				}
				value := normalizeSpecValue(text[match[2]:match[3]])
				if !validSpecValue(label, value) {
					continue
				}
				candidate := buildSpecCandidate(label, value, item, text, match[2], match[3])
				position, exists := positions[label]
				if !exists {
					if len(candidates) >= specResearchMaxCandidates {
						continue
					}
					positions[label] = len(candidates)
					candidates = append(candidates, candidate)
					continue
				}
				if strings.EqualFold(candidates[position].Value, value) {
					// Same parameter, same value, another page: keep whichever source
					// ranks higher and merge the alternatives already collected.
					if specSourceIsStronger(item, candidates[position]) {
						candidate.Alternatives = candidates[position].Alternatives
						candidate.Conflict = candidates[position].Conflict
						candidates[position] = candidate
					}
					continue
				}
				// Two sources disagree. Keeping both values under one label would
				// publish a contradiction, so the stronger source is proposed and the
				// other is recorded for the reviewer to resolve.
				if specSourceIsStronger(item, candidates[position]) {
					previous := candidates[position].Value
					candidate.Alternatives = appendUniqueString(candidates[position].Alternatives, previous)
					candidate.Conflict = true
					candidates[position] = candidate
					continue
				}
				candidates[position].Alternatives = appendUniqueString(candidates[position].Alternatives, value)
				candidates[position].Conflict = true
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

// buildSpecCandidate records a pattern match together with the verbatim text
// that proves it. The quote is cut from the same normalised string the pattern
// ran against, which is why the stored evidence always contains the value (the
// previous version searched the raw snippet and often produced an empty quote).
func buildSpecCandidate(label, value string, item ProductWebEvidence, text string, matchStart, matchEnd int) SpecResearchCandidate {
	return SpecResearchCandidate{
		Label:       label,
		Value:       value,
		SourceURL:   item.URL,
		SourceTitle: item.Title,
		SourceType:  firstNonEmpty(item.SourceType, item.EvidenceLevel),
		Evidence:    specEvidenceQuote(text, matchStart, matchEnd),
		Origin:      "extracted",
	}
}

const (
	specEvidenceQuotePad   = 140
	specEvidenceQuoteChars = 320
)

// specEvidenceQuote returns the readable text around a matched value. Byte
// offsets are converted to rune offsets first so a multi-byte character can
// never be split.
func specEvidenceQuote(text string, start, end int) string {
	if end > len(text) {
		end = len(text)
	}
	if start < 0 || start >= end {
		return limitRuneCount(NormalizeWhitespaceCopy(text), specEvidenceQuoteChars)
	}
	runes := []rune(text)
	startRune := utf8.RuneCountInString(text[:start])
	endRune := startRune + utf8.RuneCountInString(text[start:end])
	from := startRune - specEvidenceQuotePad
	if from < 0 {
		from = 0
	}
	to := endRune + specEvidenceQuotePad
	if to > len(runes) {
		to = len(runes)
	}
	return limitRuneCount(strings.TrimSpace(string(runes[from:to])), specEvidenceQuoteChars)
}

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if strings.EqualFold(strings.TrimSpace(existing), value) {
			return values
		}
	}
	return append(values, value)
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
	switch CanonicalSpecLabel(label) {
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
	conflicts := 0
	for _, candidate := range candidates {
		if candidate.Conflict {
			conflicts++
		}
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
	level := "low"
	switch {
	case manufacturerCandidates >= 3 || (manufacturerEvidence >= 1 && len(candidates) >= 5):
		level = "high"
	case manufacturerCandidates >= 1 || len(candidates) >= 3:
		level = "medium"
	}
	// Conflicting sources are never "high": the reviewer has real work to do.
	if conflicts > 0 {
		if level == "high" {
			return "medium"
		}
		return "low"
	}
	return level
}

func specResearchNote(result SpecResearchResult, productName string) string {
	if len(result.Candidates) == 0 {
		return "No verifiable parameter was found in the reachable manufacturer or distributor pages. Enter the parameters manually instead of publishing a guess."
	}
	subject := strings.TrimSpace(productName)
	if subject == "" {
		subject = strings.TrimSpace(result.Brand + " " + result.Model)
	}
	note := fmt.Sprintf("Extracted %d parameter(s) for %s from %d source page(s). Every value is copied verbatim from the cited page and must be reviewed before publishing.",
		len(result.Candidates), subject, len(result.Evidence))
	conflicts := 0
	for _, candidate := range result.Candidates {
		if candidate.Conflict {
			conflicts++
		}
	}
	if conflicts > 0 {
		note += fmt.Sprintf(" %d parameter(s) have conflicting values across sources; the alternatives are listed and must be resolved by hand.", conflicts)
	}
	return note
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
		item  ProductWebEvidence
		text  string
		lower string
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
		sources = append(sources, sourceText{item: item, text: text, lower: strings.ToLower(text)})
	}
	if len(sources) == 0 {
		return nil
	}

	kept := make([]SpecResearchCandidate, 0, len(proposed))
	seen := map[string]bool{}
	for _, candidate := range proposed {
		// The model may answer with any spelling of a known parameter; the
		// published label is always the canonical one.
		label := CanonicalSpecLabel(candidate.Label)
		value := normalizeSpecValue(candidate.Value)
		if label == "" || !validSpecValue(label, value) {
			continue
		}
		needle := strings.ToLower(value)
		keywords := specEvidenceLabelKeywords(label)
		var matched *sourceText
		matchedAt := -1
		for index := range sources {
			position := strings.Index(sources[index].lower, needle)
			if position < 0 {
				continue
			}
			if len(keywords) > 0 && !specQuoteHasKeyword(sources[index].lower, position, len(needle), keywords) {
				// The digits exist on the page but the page never names this
				// parameter near them, so the value may belong to something else.
				continue
			}
			matched = &sources[index]
			matchedAt = position
			break
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
			Evidence:    specEvidenceQuote(matched.text, matchedAt, matchedAt+len(needle)),
			Origin:      "ai",
		})
	}
	return kept
}

// specEvidenceLabelKeywords returns the words that prove a page is describing a
// parameter. For labels outside the known families the label's own words are
// used, so a reviewer's free-form label still has to be mentioned on the page.
func specEvidenceLabelKeywords(label string) []string {
	if keywords := SpecLabelKeywords(label); len(keywords) > 0 {
		return keywords
	}
	keywords := make([]string, 0, 4)
	for _, word := range strings.Fields(strings.ToLower(label)) {
		if len([]rune(word)) >= 3 {
			keywords = append(keywords, word)
		}
	}
	return keywords
}

// specQuoteHasKeyword reports whether any keyword of the parameter family occurs
// in the text around the matched value.
func specQuoteHasKeyword(text string, position, length int, keywords []string) bool {
	from := position - specEvidenceQuotePad
	if from < 0 {
		from = 0
	}
	to := position + length + specEvidenceQuotePad
	if to > len(text) {
		to = len(text)
	}
	window := text[from:to]
	for _, keyword := range keywords {
		if strings.Contains(window, keyword) {
			return true
		}
	}
	return false
}

// MergeSpecCandidateLists merges extracted and AI-verified candidates, keeping
// the extracted (pattern-matched) value when both describe the same label. A
// value that disagrees with the kept one is preserved as an alternative instead
// of being dropped, so the reviewer still sees the disagreement.
func MergeSpecCandidateLists(primary, secondary []SpecResearchCandidate) []SpecResearchCandidate {
	merged := make([]SpecResearchCandidate, 0, len(primary)+len(secondary))
	index := map[string]int{}
	appendList := func(list []SpecResearchCandidate) {
		for _, candidate := range list {
			candidate.Label = CanonicalSpecLabel(candidate.Label)
			candidate.Value = normalizeSpecValue(candidate.Value)
			if candidate.Label == "" || candidate.Value == "" {
				continue
			}
			key := strings.ToLower(candidate.Label)
			if position, ok := index[key]; ok {
				if !strings.EqualFold(merged[position].Value, candidate.Value) {
					merged[position].Alternatives = appendUniqueString(merged[position].Alternatives, candidate.Value)
					merged[position].Conflict = true
				}
				continue
			}
			index[key] = len(merged)
			merged = append(merged, candidate)
		}
	}
	appendList(primary)
	appendList(secondary)
	return merged
}

// SpecCandidatesToMap converts reviewed candidates into the specification table
// stored on the product, keyed by the published label.
func SpecCandidatesToMap(candidates []SpecResearchCandidate) map[string]string {
	return CanonicalizeSpecMap(SpecCandidateMap(candidates))
}

// SpecCandidateMap keeps the reviewer's own labels. It is the unchecked variant
// of SpecCandidatesToMap, used where a conflict report must show the two
// spellings before canonicalisation folds them together.
func SpecCandidateMap(candidates []SpecResearchCandidate) map[string]string {
	specs := map[string]string{}
	for _, candidate := range candidates {
		label := NormalizeWhitespaceCopy(candidate.Label)
		value := NormalizeWhitespaceCopy(candidate.Value)
		if label == "" || value == "" {
			continue
		}
		if existing, ok := specs[label]; ok && strings.TrimSpace(existing) != "" {
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
