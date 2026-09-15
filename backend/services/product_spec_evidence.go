package services

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Specification research needs more page text than classification does.
//
// Classification only needs to know *what* a page is about, so the existing
// evidence pipeline keeps the first 700 characters of a page. A specification
// table, however, usually sits several screens into a datasheet page, after
// navigation, cookie banners and marketing copy. Extracting parameters from
// those first 700 characters is why research used to report "no verifiable
// parameter found" for models that do publish a datasheet.
//
// This file builds a second, specification-focused evidence view. It is still
// strictly verbatim: it only ever slices the fetched page text into windows, so
// every value a reviewer sees can still be found on the cited page.
const (
	specEvidenceMaxWindows    = 6
	specEvidenceWindowChars   = 700
	specEvidenceTotalChars    = 6000
	specEvidenceMaxPages      = 3
	specEvidencePageFetchTime = 8 * time.Second
	specEvidenceMaxPageBytes  = 1 << 20
)

// specEvidenceSignalWords are the words that mark a block of page text as a
// specification section worth keeping.
var specEvidenceSignalWords = []string{
	"rated", "voltage", "current", "power", "frequency", "torque", "speed", "rpm",
	"weight", "mass", "dimension", "mm", "kg", "protection", "ip ", "insulation",
	"cooling", "mounting", "interface", "protocol", "temperature", "resolution",
	"pulse", "capacity", "input", "output", "specification", "technical data",
	"ambient", "certification", "rohs", "ce ", "ul ", "encoder", "accuracy",
	"supply", "consumption", "efficiency", "ratio", "stroke", "backlash",
}

// SpecResearchEvidence returns the evidence used for parameter research: the
// cached public search results plus specification-focused windows for the
// manufacturer and distributor pages that can actually be fetched.
//
// The classification evidence is deliberately left untouched; callers that need
// identity verification keep using SearchProductEvidence.
func SpecResearchEvidence(ctx context.Context, brand, model string) ([]ProductWebEvidence, error) {
	results, err := SearchProductEvidence(ctx, brand, model)
	if err != nil && len(results) == 0 {
		return nil, err
	}
	enriched := EnrichEvidenceWithSpecWindows(ctx, results, model)
	if len(enriched) == 0 {
		return results, err
	}
	return enriched, nil
}

// EnrichEvidenceWithSpecWindows replaces the truncated snippet of up to
// specEvidenceMaxPages real pages with specification-focused windows. Entries
// that cannot be enriched are returned unchanged, so callers never lose the
// search results they already had.
func EnrichEvidenceWithSpecWindows(ctx context.Context, evidence []ProductWebEvidence, model string) []ProductWebEvidence {
	model = strings.TrimSpace(NormalizeProductModel(model))
	if model == "" || len(evidence) == 0 {
		return evidence
	}
	enriched := make([]ProductWebEvidence, 0, len(evidence))
	replaced := map[string]bool{}
	fetched := 0
	for _, item := range evidence {
		if fetched >= specEvidenceMaxPages {
			enriched = append(enriched, item)
			continue
		}
		if !evidencePageIsFetchable(item) || replaced[item.URL] {
			enriched = append(enriched, item)
			continue
		}
		text, ok := fetchPublicPageText(ctx, item.URL, specEvidenceMaxPageBytes)
		if !ok || !containsExactProductIdentifier(text, model) {
			enriched = append(enriched, item)
			continue
		}
		windows := SpecEvidenceWindows(text, model)
		if strings.TrimSpace(windows) == "" {
			enriched = append(enriched, item)
			continue
		}
		replaced[item.URL] = true
		fetched++
		item.Snippet = windows
		enriched = append(enriched, item)
	}
	return enriched
}

// evidencePageIsFetchable reports whether an evidence entry points at a real
// page that can still be read. Search-engine result pages are excluded because
// they are a summary of other pages, never a datasheet.
func evidencePageIsFetchable(item ProductWebEvidence) bool {
	if item.SourceType == "search-result" || item.EvidenceLevel == "search-result" {
		return false
	}
	if strings.TrimSpace(item.URL) == "" {
		return false
	}
	parsed, err := validatePublicHTTPURL(item.URL)
	if err != nil {
		return false
	}
	if _, level := classifyEvidenceSource(parsed.String(), false); level == "search-result" {
		return false
	}
	return true
}

// fetchPublicPageText reads a public page through the existing SSRF-safe client.
func fetchPublicPageText(ctx context.Context, rawURL string, maxBytes int64) (string, bool) {
	parsed, err := validatePublicHTTPURL(rawURL)
	if err != nil {
		return "", false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", false
	}
	resp, err := NewPublicHTTPClient(specEvidencePageFetchTime).Do(req)
	if err != nil {
		return "", false
	}
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBytes))
	resp.Body.Close()
	if readErr != nil || resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return "", false
	}
	text := strings.Join(strings.Fields(string(body)), " ")
	if text == "" {
		return "", false
	}
	return text, true
}

// SpecEvidenceWindows slices page text into windows that are likely to hold
// specifications. Windows are verbatim substrings of the page, and they are
// returned in page order so the reviewer can follow the document.
func SpecEvidenceWindows(text, model string) string {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return ""
	}
	chunks := splitEvidenceChunks(text)
	if len(chunks) == 0 {
		return ""
	}
	type window struct {
		start int
		end   int
		score int
	}
	scored := make([]window, 0, len(chunks))
	for index, chunk := range chunks {
		score := specEvidenceChunkScore(chunk.text, model)
		if score <= 0 {
			continue
		}
		scored = append(scored, window{start: index, end: index, score: score})
	}
	if len(scored) == 0 {
		// Nothing looked like a datasheet. Fall back to the text around the model
		// identifier so the reviewer still sees the part of the page that named
		// the product.
		return modelCentredWindow(text, model)
	}
	// Merge adjacent chunks so a table split across sentences stays readable.
	merged := make([]window, 0, len(scored))
	for _, current := range scored {
		if len(merged) > 0 && current.start-merged[len(merged)-1].end <= 3 {
			merged[len(merged)-1].end = current.end
			merged[len(merged)-1].score += current.score
			continue
		}
		merged = append(merged, current)
	}
	// Keep the highest scoring windows while preserving document order.
	order := make([]int, len(merged))
	for index := range merged {
		order[index] = index
	}
	for i := 1; i < len(order); i++ {
		for j := i; j > 0 && merged[order[j]].score > merged[order[j-1]].score; j-- {
			order[j], order[j-1] = order[j-1], order[j]
		}
	}
	keep := order
	if len(keep) > specEvidenceMaxWindows {
		keep = keep[:specEvidenceMaxWindows]
	}
	selected := make([]bool, len(merged))
	for _, index := range keep {
		selected[index] = true
	}

	var builder strings.Builder
	for index, item := range merged {
		if !selected[index] {
			continue
		}
		window := strings.TrimSpace(strings.Join(chunkTexts(chunks[item.start:item.end+1]), " "))
		window = limitRuneCount(window, specEvidenceWindowChars)
		if window == "" {
			continue
		}
		if builder.Len() > 0 {
			if builder.Len()+3+len(window) > specEvidenceTotalChars {
				break
			}
			builder.WriteString(" … ")
		}
		builder.WriteString(window)
	}
	return NormalizeWhitespaceCopy(builder.String())
}

type specEvidenceChunk struct {
	text string
}

// splitEvidenceChunks breaks page text into sentence-sized chunks. A long run of
// text without punctuation (minified HTML, for example) is still split so no
// single chunk can dominate the window budget.
func splitEvidenceChunks(text string) []specEvidenceChunk {
	raw := strings.FieldsFunc(text, func(r rune) bool {
		switch r {
		case '.', '。', ';', '；', '\n', '\r', '|', '\t':
			return true
		}
		return false
	})
	chunks := make([]specEvidenceChunk, 0, len(raw))
	for _, value := range raw {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len([]rune(value)) <= 400 {
			chunks = append(chunks, specEvidenceChunk{text: value})
			continue
		}
		for _, piece := range splitLongEvidenceChunk(value, 300) {
			chunks = append(chunks, specEvidenceChunk{text: piece})
		}
	}
	return chunks
}

// splitLongEvidenceChunk splits on rune boundaries so a multi-byte character can
// never be cut in half.
func splitLongEvidenceChunk(value string, size int) []string {
	runes := []rune(value)
	pieces := make([]string, 0, len(runes)/size+1)
	for start := 0; start < len(runes); start += size {
		end := start + size
		if end > len(runes) {
			end = len(runes)
		}
		pieces = append(pieces, strings.TrimSpace(string(runes[start:end])))
	}
	return pieces
}

func chunkTexts(chunks []specEvidenceChunk) []string {
	texts := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		if value := strings.TrimSpace(chunk.text); value != "" {
			texts = append(texts, value)
		}
	}
	return texts
}

// specEvidenceChunkScore counts how many specification signals a chunk carries.
// A chunk that names the requested model scores higher, because a datasheet
// almost always labels its own table with the model number.
func specEvidenceChunkScore(chunk, model string) int {
	lower := strings.ToLower(chunk)
	score := 0
	for _, signal := range specEvidenceSignalWords {
		if strings.Contains(lower, signal) {
			score += 2
		}
	}
	// A bare measurement ("3.5 A") without any signal word is not enough on its
	// own, but it raises a chunk that already looks like a specification.
	if specMeasurementPattern.MatchString(chunk) {
		score++
	}
	if model != "" && containsExactProductIdentifier(chunk, model) {
		score += 3
	}
	if score > 0 && len([]rune(chunk)) < 12 {
		score = 0
	}
	return score
}

var specMeasurementPattern = regexp.MustCompile(`\d+(?:\.\d+)?\s*(?:V|A|mA|kW|kVA|VA|W|HP|Hz|kHz|kg|g|mm|cm|Nm|rpm|°C|C\b)`)

// modelCentredWindow returns the page text around the model identifier. It is the
// last resort when no chunk looked like a specification section: the page still
// named the exact product, so the surrounding text is worth reviewing.
func modelCentredWindow(text, model string) string {
	runes := []rune(text)
	upper := []rune(strings.ToUpper(text))
	index := indexOfRunes(upper, []rune(strings.ToUpper(compactProductIdentifier(model))))
	if index < 0 {
		index = indexOfRunes(upper, []rune(strings.ToUpper(strings.TrimSpace(model))))
	}
	if index < 0 {
		return limitRuneCount(text, specEvidenceWindowChars)
	}
	start := index - specEvidenceWindowChars/2
	if start < 0 {
		start = 0
	}
	end := start + specEvidenceWindowChars
	if end > len(runes) {
		end = len(runes)
	}
	return NormalizeWhitespaceCopy(strings.TrimSpace(string(runes[start:end])))
}

// indexOfRunes finds the first occurrence of needle inside haystack on rune
// boundaries, so no window ever starts inside a multi-byte character.
func indexOfRunes(haystack, needle []rune) int {
	if len(needle) == 0 || len(needle) > len(haystack) {
		return -1
	}
	for start := 0; start+len(needle) <= len(haystack); start++ {
		matched := true
		for offset := range needle {
			if haystack[start+offset] != needle[offset] {
				matched = false
				break
			}
		}
		if matched {
			return start
		}
	}
	return -1
}
