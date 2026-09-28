package utils

import (
	"regexp"
	"strings"
)

// ExtractTitleIdentifier recovers the part number a marketplace listing title
// names, and reports whether the match is confirmed.
//
// The family table in image_parser.go is a whitelist, and a whitelist is wrong
// by default. A listing whose part-number family nobody has written a pattern
// for yet is not "a listing without a part number"; it is a listing the table has
// never seen. Treating the two the same is what refused an entire batch with
// "no model or part number" while every one of those titles named its part in
// the first eight words.
//
// Extraction therefore runs in three passes:
//
//  1. the families this catalogue buys, written out with their real shapes
//     (see titleModelFamilies);
//  2. the legacy table, unchanged, so nothing that parsed before stops parsing;
//  3. a guarded scan for a catalogue-shaped token no table claimed (see
//     titleCandidateFromText).
//
// The third pass is a guess and is reported as one. Callers may use it to decide
// a draft is worth reviewing - the model reads the listing, and its own answer is
// authoritative - but must not persist it as the listing's identity: a wrong
// model recorded on a draft is what makes a correct identification look like a
// mismatch.
func ExtractTitleIdentifier(text string) (string, bool) {
	cleaned := stripMarkupForExtraction(text)
	if strings.TrimSpace(cleaned) == "" {
		return "", false
	}
	upper := strings.ToUpper(cleaned)

	// The catalogue's own families are tried first. The legacy table truncates
	// some of them at the first hyphen-separated group, and a truncated model
	// then disagrees with the fuller model the AI reads out of the same listing.
	for _, pattern := range titleModelFamilies {
		if match := pattern.FindString(upper); match != "" {
			return match, true
		}
	}
	for _, pattern := range titleModelFamiliesSpaced {
		if match := pattern.FindString(upper); match != "" {
			if hyphenated := hyphenateSpacedModel(match); hyphenated != "" {
				return hyphenated, true
			}
		}
	}
	if match := extractModelFromText(cleaned, false); match != "" {
		return match, true
	}
	if match := titleCandidateFromText(upper); match != "" {
		return match, false
	}
	return "", false
}

// titleModelFamilies lists the part-number families the storefront buys, most
// specific first. Patterns are matched against upper-cased input, so every result
// comes back in upper case.
//
// Each entry was added because a real listing in the import queue failed to parse
// without it; the queue is the specification. The list is deliberately not
// exhaustive: pass 3 exists so an unseen family is reviewable rather than
// invisible.
var titleModelFamilies = []*regexp.Regexp{
	// Omron servos and drives: R88M-G40030H-S2, R88M-G75030H-S2-Z, R88D-GP08H.
	// Three suffix groups are normal, and the legacy pattern stopped after the
	// first, leaving a model the AI's fuller reading disagreed with.
	regexp.MustCompile(`\bR88[MD]-[A-Z0-9]{3,12}(?:-[A-Z0-9]{1,6}){0,3}`),
	// Omron NX-series I/O, safety and temperature units: NX-SOD400, NX-RS1201,
	// NX-AD2603, NX-TS3101.
	regexp.MustCompile(`\bNX-[A-Z0-9]{2,10}(?:-[A-Z0-9]{1,6}){0,2}`),
	// Omron PLC families: CJ1W-DA08C, CS1W-ID211, CP1H-X40DT1-D, CPM2A-60CDR-A.
	regexp.MustCompile(`\b(?:CJ|CQM|CPM|CP|CS)\d[A-Z]{0,3}(?:-[A-Z0-9]{1,12}){1,3}`),
	// Omron bus terminals, safety relays, door switches and power supplies:
	// SRT2-ID16-1, DRT2-OD32ML, CRT1-OD16, G7SA-2A2B, G9SA-321-T075, F3SP-B1P,
	// D4NL-1DFA-B, W4S1-03B, S8VK-C12024, V600-CA5D02.
	regexp.MustCompile(`\b(?:SRT2|DRT2|CRT1|G7S[A-Z]?|G9S[A-Z]?|F3S[A-Z]?|D4N[A-Z]?|W4S\d?|S8VK|V6\d{2})(?:-[A-Z0-9]{1,10}){1,3}`),
	// Omron sensors and controllers: E3FA-DN12, E3X-NA41, E3S-CL2, E3NX-FA11,
	// E5CSV-R1T, E5CK-AA1, E5GN-R1TD.
	regexp.MustCompile(`\b(?:E3|E5)[A-Z]{0,3}(?:-[A-Z0-9]{1,8}){1,3}`),
	// Omron timers, counters, panels and inverters: H3CA-A, H3CR-A8, H5CX-L8D-N,
	// H5S-WFB2, NB3Q-TW00B, NB10W-TW01B, NS10-TV01B-V2, NT31-ST123-EV3,
	// NJ501-1300, 3G3JZ-A4015.
	regexp.MustCompile(`\b(?:H3C[A-Z]?|H5C[A-Z]?|H5S|NB\d{0,2}[A-Z]?|NS\d{1,2}|NT\d{1,2}|NJ\d{3}|3G3[A-Z]{0,2})(?:-[A-Z0-9]{1,8}){1,3}`),
}

// titleModelFamiliesSpaced covers the same families retyped with a space instead
// of the first hyphen, which is how a seller who cannot be bothered with the
// separator writes them ("NX AD2603").
var titleModelFamiliesSpaced = []*regexp.Regexp{
	regexp.MustCompile(`\bNX\s+[A-Z]{1,2}\d{3,6}\b`),
}

// htmlTagPattern matches a markup tag inside scraped text.
var htmlTagPattern = regexp.MustCompile(`<[^<>]{0,80}>`)

// wordBreakTagPattern matches the word-break hint eBay inserts inside a part
// number ("R88M-G40030H-S<wbr/>2"). It is removed without a space - joining the
// two halves is the entire point of it - while every other tag becomes a space,
// so that two words are never glued into a token that never existed.
var wordBreakTagPattern = regexp.MustCompile(`(?i)<wbr\s*/?>`)

// stripMarkupForExtraction reduces scraped markup to the text a part number can
// be read out of. The sanitizer runs when a payload becomes a draft, but a title
// stored before it existed - and every draft's raw column - has never been
// through it.
func stripMarkupForExtraction(text string) string {
	if !strings.ContainsAny(text, "<&") {
		return text
	}
	cleaned := wordBreakTagPattern.ReplaceAllString(text, "")
	cleaned = htmlTagPattern.ReplaceAllString(cleaned, " ")
	return strings.NewReplacer(
		"&nbsp;", " ", "&amp;", "&", "&quot;", `"`, "&#39;", "'", "&lt;", "<", "&gt;", ">",
	).Replace(cleaned)
}

// titleCandidateToken matches a catalogue-shaped token: letters and digits joined
// by hyphens, which is how every part number that is not simply a word is written
// (G7SA-2A2B, 3G3JZ-A4015, NB10W-TW01B).
var titleCandidateToken = regexp.MustCompile(`[A-Z0-9]+(?:-[A-Z0-9]+)*`)

// titleCandidateMeasureSegment matches one segment of a quantity or measurement
// ("240VAC", "024", "KW"): a number with an optional unit suffix and nothing
// else. No part number has that shape in every segment, which is what separates
// "2A2B" from "240VAC".
var titleCandidateMeasureSegment = regexp.MustCompile(`^\d+[A-Z]{0,4}$`)

// titleCandidateStopWords are the words a scraped title is mostly made of:
// quantity, condition, shipping, place names and units of measure. They are
// compared against a token's letters alone, so "1PCS", "2pcs" and "PCS" all
// reduce to "PCS" and a seller's boilerplate cannot be mistaken for a part.
var titleCandidateStopWords = map[string]bool{
	// Quantity and packaging.
	"PCS": true, "PC": true, "PIECE": true, "PIECES": true,
	"SET": true, "SETS": true, "KIT": true, "KITS": true, "LOT": true, "LOTS": true,
	"QTY": true, "PACK": true, "PACKS": true, "BOX": true, "BOXES": true,
	// Condition.
	"NEW": true, "USED": true, "SEALED": true, "ORIGINAL": true, "ORIG": true,
	"GENUINE": true, "GEN": true, "BRAND": true, "TESTED": true, "WORKING": true,
	"REFURBISHED": true, "OPEN": true, "DAMAGED": true, "ASIS": true,
	// Commerce.
	"FAST": true, "SHIP": true, "SHIPS": true, "SHIPPING": true, "FREE": true,
	"TAX": true, "DUTY": true, "WARRANTY": true, "YEAR": true, "YEARS": true,
	"MONTH": true, "MONTHS": true, "DAY": true, "DAYS": true, "DELIVERY": true,
	"EXPRESS": true, "PRICE": true, "PAYMENT": true, "OEM": true, "ODM": true,
	"MOQ": true, "FITS": true, "FIT": true, "MODULE": true, "MODULES": true,
	// Places and marketplaces sellers quote.
	"US": true, "USA": true, "UK": true, "EU": true, "DE": true, "CN": true,
	"JP": true, "SG": true, "AU": true, "CA": true, "NY": true, "EBAY": true,
	// Units of measure.
	"V": true, "VAC": true, "VDC": true, "AC": true, "DC": true, "W": true,
	"KW": true, "MW": true, "HZ": true, "KHZ": true, "MHZ": true, "RPM": true,
	"AMP": true, "AMPS": true, "A": true, "MA": true, "MM": true, "CM": true,
	"M": true, "KG": true, "G": true, "LB": true, "LBS": true, "TON": true,
	"TONS": true, "INCH": true, "INCHES": true, "PHASE": true, "PH": true,
	"OHM": true, "DEG": true, "SEC": true, "MS": true, "MIN": true,
	// Words that only ever appear in the shipping prose around a part number.
	"IN": true, "OUT": true, "OF": true, "FOR": true, "WITH": true, "AND": true,
	"OR": true, "THE": true, "AS": true, "IS": true, "FROM": true, "TO": true,
	"NO": true, "REF": true, "ID": true, "TYPE": true, "MODEL": true, "NUM": true,
	"SERIAL": true, "SN": true, "TAB": true, "WINDOW": true, "OPENS": true,
	"X": true, "Z": true, "C": true, "F": true, "H": true,
}

// titleCandidateFromText returns the most catalogue-like token in an upper-cased
// title, or "" when nothing qualifies.
//
// This is the pass that keeps an unseen family reviewable, so it is deliberately
// conservative about what it puts forward and it never claims confidence:
// callers treat the result as a hint that the model's own reading of the listing
// confirms or discards.
func titleCandidateFromText(upper string) string {
	tokens := titleCandidateToken.FindAllString(upper, -1)
	if len(tokens) == 0 {
		return ""
	}
	occurrences := make(map[string]int, len(tokens))
	for _, token := range tokens {
		occurrences[token]++
	}
	best, bestScore := "", 0
	for _, token := range tokens {
		// Strictly greater keeps the earliest of two equally good tokens, and a
		// token that fails the guards scores zero, so it is never chosen.
		if score := titleCandidateScore(token, occurrences[token]); score > bestScore {
			best, bestScore = token, score
		}
	}
	return best
}

// titleCandidateScore weighs one token. A hyphen is the strongest signal that the
// seller wrote a part number rather than a word ("G7SA-2A2B"), and a token the
// title repeats is usually the model it is selling.
func titleCandidateScore(token string, occurrences int) int {
	if !isPlausibleTitleCandidate(token) {
		return 0
	}
	score := 0
	if strings.Contains(token, "-") {
		score += 3
	}
	if len(token) >= 6 {
		score++
	}
	if occurrences > 1 {
		score += 2
	}
	return score
}

// isPlausibleTitleCandidate rejects the tokens that are prose rather than a part
// number. A wrong model is not free - it is what the AI's reading is compared
// against - so every guard here is a rejection a human would also make.
func isPlausibleTitleCandidate(token string) bool {
	if length := len(token); length < 4 || length > 24 {
		return false
	}
	letters := tokenLetters(token)
	if countTokenDigits(token) == 0 || len(letters) < 2 {
		return false
	}
	if titleCandidateStopWords[letters] {
		return false
	}
	segments := strings.Split(token, "-")
	measures := 0
	for _, segment := range segments {
		if titleCandidateMeasureSegment.MatchString(segment) {
			measures++
			continue
		}
		// A word-only segment that is seller boilerplate disqualifies the whole
		// token: "NEW-2024-LOT" and "SHIPS-FROM-USA" pass every shape check, and
		// the titles are full of their two-word shapes.
		if countTokenDigits(segment) == 0 {
			if word := tokenLetters(segment); len(word) >= 2 && titleCandidateStopWords[word] {
				return false
			}
		}
	}
	// A voltage or quantity range ("24-240VAC") is not a part number: every
	// segment is a number with an optional unit and nothing else.
	return measures < len(segments)
}

// tokenLetters reduces a token to its letters only, upper-cased: "1pcs" -> "PCS".
func tokenLetters(token string) string {
	var builder strings.Builder
	builder.Grow(len(token))
	for _, r := range strings.ToUpper(token) {
		if r >= 'A' && r <= 'Z' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

// countTokenDigits counts the digits in a token.
func countTokenDigits(token string) int {
	count := 0
	for _, r := range token {
		if r >= '0' && r <= '9' {
			count++
		}
	}
	return count
}
