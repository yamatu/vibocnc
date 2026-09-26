// Package services — AI product identification from marketplace evidence.
//
// The problem this solves: many catalogue models have no local information at
// all. The deterministic brand/model rules cannot recognise them, web search
// often returns nothing useful, and the resulting title, category and
// description are therefore generic.
//
// The crawler, however, has already seen real listings for the exact model. This
// service feeds that evidence (titles, item specifics, eBay category path,
// description snippets) to the AI and asks a single question: what IS this
// part? The answer — brand, product type, functions, applications, specs — then
// drives the title, category, description and SEO generation.
//
// Nothing here publishes. It produces a ProductProfile that must be approved
// through the existing review queue, exactly like the spec research drafts.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"

	"fanuc-backend/models"
)

// MaxIdentificationEvidence caps how many listings are shown to the AI.
const MaxIdentificationEvidence = 8

// identificationEvidenceRunes bounds each listing description in the prompt.
const identificationEvidenceRunes = 1200

// ProductIdentificationEvidence is everything known about the unknown part.
type ProductIdentificationEvidence struct {
	BrandHint   string
	Model       string
	ProductName string
	SKU         string
	PartNumber  string
	// Listings come from the eBay market quote (MarketEvidenceItems).
	Listings []models.EbayMarketEvidenceItem
	// WebEvidence is the manufacturer/distributor lookup already performed by
	// the classification pipeline. Optional.
	WebEvidence []ProductWebEvidence
	// EbayCategoryPath is the most common category path across listings.
	EbayCategoryPath string
}

// ProductProfileSpec is one parameter with the evidence it came from.
type ProductProfileSpec struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Source string `json:"source_url,omitempty"`
}

// ProductProfile is the AI's answer to "what is this part?".
//
// Every field is either derived from supplied evidence or empty. The model is
// instructed never to invent a value, and ValidateProductProfile enforces that
// (a spec without a source is dropped, a generic type is rejected).
type ProductProfile struct {
	Brand           string               `json:"brand"`
	PartType        string               `json:"part_type"`
	ModelFamily     string               `json:"model_family"`
	ProductCategory string               `json:"product_category"`
	WhatItIs        string               `json:"what_it_is"`
	KeyFunctions    []string             `json:"key_functions"`
	Applications    []string             `json:"applications"`
	Specs           []ProductProfileSpec `json:"specs"`
	CompatibleWith  []string             `json:"compatible_with"`
	Confidence      float64              `json:"confidence"`
	Reason          string               `json:"reason"`
	EvidenceCount   int                  `json:"evidence_count"`
	SourceURLs      []string             `json:"source_urls"`
	Model           string               `json:"model"`
}

// IdentificationClient is the AI call used to identify a product. It is an
// interface so the service can be exercised without a provider, and so the
// controller keeps ownership of which AI profile is active.
type IdentificationClient func(ctx context.Context, systemPrompt, userPrompt string) (string, error)

// productIdentificationPrompt asks the model to explain what the part is before
// it names anything, which is what makes the generated copy specific instead of
// generic. It is deliberately separate from the classification prompt: that one
// only picks a taxonomy slot, this one builds a usable product picture.
const productIdentificationPrompt = `You identify one industrial automation part from real eBay listings that were matched to its exact model number.

You are given: the model number, an optional brand hint, the item specifics, titles, short description snippets and the eBay category path of several real listings, and optionally manufacturer web evidence.

Work in this order:

1. Decide what the part IS. Base this on the item specifics and category path first, the listing titles second, and marketing text last. If the listings disagree, say so in "reason" and lower "confidence".
2. Name the manufacturer and one specific English product type in singular Title Case.
3. Describe what it does and where it is used, using only what the evidence supports.

Return JSON only, without Markdown, with exactly these fields:

{
  "brand": "manufacturer proper name, e.g. FANUC",
  "part_type": "one specific type, e.g. Servo Amplifier",
  "model_family": "stable series identifier or empty string, e.g. MR-J4",
  "product_category": "plain-English category, e.g. Servo Drives",
  "what_it_is": "one or two sentences a technician would recognise, no marketing fluff",
  "key_functions": ["short factual phrases"],
  "applications": ["where this part is used, e.g. CNC machine tool spindle axis"],
  "specs": [{"label": "Rated Output", "value": "3.7 kW", "source_url": "the listing or page URL the value came from"}],
  "compatible_with": ["other model numbers named in the evidence"],
  "confidence": 0.0,
  "reason": "one short sentence naming the evidence you relied on"
}

Hard rules:
- Never invent a value. If a spec is not present in the evidence, omit it. A spec without a source_url is discarded.
- Only use listings whose title contains the exact model number.
- Item specifics and the eBay category path outrank generic marketing phrases.
- brand and part_type must not be generic ("Spare Part", "Part", "Component", "Equipment", "Product", "Other", "Industrial").
- confidence is a number from 0 to 1. Use 0.8 or higher only when manufacturer evidence exists or at least three listings agree.
- If the evidence is too weak to name the part, return an empty brand and part_type, confidence 0, and explain in "reason" what is missing.
- Do not add any field besides the ones listed.`

// BuildIdentificationPayload renders the evidence into the user prompt.
func BuildIdentificationPayload(evidence ProductIdentificationEvidence) string {
	listings := make([]map[string]any, 0, MaxIdentificationEvidence)
	for index, item := range evidence.Listings {
		if index >= MaxIdentificationEvidence {
			break
		}
		entry := map[string]any{
			"title":         strings.TrimSpace(item.Title),
			"url":           strings.TrimSpace(item.URL),
			"condition":     strings.TrimSpace(item.Condition),
			"category_path": strings.TrimSpace(item.CategoryPath),
			"brand":         strings.TrimSpace(item.Brand),
			"model":         strings.TrimSpace(item.Model),
		}
		if item.PriceValue > 0 {
			entry["price"] = item.PriceValue
		}
		if len(item.ItemSpecifics) > 0 {
			entry["item_specifics"] = item.ItemSpecifics
		}
		if strings.TrimSpace(item.Description) != "" {
			entry["description"] = truncateRunesSafe(item.Description, identificationEvidenceRunes)
		}
		listings = append(listings, entry)
	}

	webEvidence := make([]map[string]string, 0, len(evidence.WebEvidence))
	for _, item := range evidence.WebEvidence {
		webEvidence = append(webEvidence, map[string]string{
			"title":   item.Title,
			"url":     item.URL,
			"snippet": truncateRunesSafe(item.Snippet, identificationEvidenceRunes),
		})
	}

	payload := map[string]any{
		"model":              strings.TrimSpace(evidence.Model),
		"brand_hint":         strings.TrimSpace(evidence.BrandHint),
		"product_name":       strings.TrimSpace(evidence.ProductName),
		"sku":                strings.TrimSpace(evidence.SKU),
		"part_number":        strings.TrimSpace(evidence.PartNumber),
		"ebay_category_path": strings.TrimSpace(evidence.EbayCategoryPath),
		"listings":           listings,
	}
	if len(webEvidence) > 0 {
		payload["manufacturer_evidence"] = webEvidence
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// IdentifyProduct asks the AI what the part is, then validates the answer.
//
// A weak answer is not an error: it is returned as a low-confidence profile so
// the administrator can see what the model concluded and what it was missing.
// An error means the provider could not be reached at all.
func IdentifyProduct(ctx context.Context, evidence ProductIdentificationEvidence, client IdentificationClient) (ProductProfile, error) {
	if client == nil {
		return ProductProfile{}, errors.New("no AI client configured for product identification")
	}
	model := strings.TrimSpace(NormalizeProductModel(evidence.Model))
	if model == "" {
		return ProductProfile{}, errors.New("model or part number is required for product identification")
	}

	profile := ProductProfile{Model: model}
	reply, err := client(ctx, productIdentificationPrompt, "EVIDENCE:\n"+BuildIdentificationPayload(evidence))
	if err != nil {
		return profile, err
	}

	parsed, parseErr := parseProductProfile(reply)
	if parseErr != nil {
		profile.Reason = parseErr.Error()
		profile.SourceURLs = collectedEvidenceURLs(evidence)
		return profile, nil
	}

	parsed.Model = model
	parsed.EvidenceCount = len(evidence.Listings)
	parsed.SourceURLs = collectedEvidenceURLs(evidence)
	validateProductProfile(&parsed, evidence)
	return parsed, nil
}

// parseProductProfile recovers the first JSON object in a reply, tolerating the
// Markdown fences and prefaces providers sometimes add.
func parseProductProfile(raw string) (ProductProfile, error) {
	raw = strings.TrimSpace(raw)
	var lastErr error
	for start := 0; start < len(raw); start++ {
		if raw[start] != '{' {
			continue
		}
		var profile ProductProfile
		decoder := json.NewDecoder(strings.NewReader(raw[start:]))
		if err := decoder.Decode(&profile); err == nil {
			return profile, nil
		} else {
			lastErr = err
		}
	}
	if lastErr != nil {
		return ProductProfile{}, errors.New("AI identification reply was not valid JSON")
	}
	return ProductProfile{}, errors.New("AI identification reply contained no JSON object")
}

// validateProductProfile enforces the prompt's hard rules so a hallucinated
// profile can never reach the review queue looking trustworthy.
func validateProductProfile(profile *ProductProfile, evidence ProductIdentificationEvidence) {
	if math.IsNaN(profile.Confidence) || math.IsInf(profile.Confidence, 0) {
		profile.Confidence = 0
	}
	if profile.Confidence > 1 {
		profile.Confidence = 1
	}
	if profile.Confidence < 0 {
		profile.Confidence = 0
	}

	// A generic type is treated as "could not identify".
	if IsGenericProductType(profile.PartType) {
		profile.PartType = ""
		if profile.Confidence > 0.2 {
			profile.Confidence = 0.2
		}
	}
	// Canonicalise so a new answer lands on an existing taxonomy node rather
	// than spawning a near-duplicate ("Servo Drive" -> "Servo Amplifier / Drive").
	if canonical := CanonicalProductType(profile.PartType); canonical != "" && !IsGenericProductType(canonical) {
		profile.PartType = canonical
	}

	profile.Brand = CanonicalBrandName(strings.TrimSpace(profile.Brand))
	if NormalizeBrandKey(profile.Brand) == "" {
		profile.Brand = ""
	}

	// Drop specs without a traceable source: the whole point is that the value
	// can be checked by a human before it is published.
	trustedSpecs := make([]ProductProfileSpec, 0, len(profile.Specs))
	for _, spec := range profile.Specs {
		label := strings.TrimSpace(spec.Label)
		value := strings.TrimSpace(spec.Value)
		if label == "" || value == "" || len([]rune(label)) > 80 || len([]rune(value)) > 200 {
			continue
		}
		if !validSpecValue(label, value) {
			continue
		}
		if strings.TrimSpace(spec.Source) == "" {
			continue
		}
		spec.Label = label
		spec.Value = value
		trustedSpecs = append(trustedSpecs, spec)
	}
	profile.Specs = trustedSpecs

	profile.KeyFunctions = trimStringList(profile.KeyFunctions, 6, 120)
	profile.Applications = trimStringList(profile.Applications, 6, 120)
	profile.CompatibleWith = trimStringList(profile.CompatibleWith, 12, 80)
	profile.WhatItIs = truncateRunesSafe(strings.TrimSpace(profile.WhatItIs), 480)
	profile.ProductCategory = truncateRunesSafe(strings.TrimSpace(profile.ProductCategory), 120)
	profile.ModelFamily = truncateRunesSafe(strings.TrimSpace(profile.ModelFamily), 60)
	profile.Reason = truncateRunesSafe(strings.TrimSpace(profile.Reason), 400)

	// Corroborate a brand claim: if the evidence never mentions the claimed
	// brand, the claim is capped rather than published as fact.
	if profile.Brand != "" && !evidenceMentionsBrand(evidence, profile.Brand) {
		if strings.TrimSpace(evidence.BrandHint) != "" &&
			NormalizeBrandKey(evidence.BrandHint) == NormalizeBrandKey(profile.Brand) {
			return
		}
		if profile.Confidence > 0.5 {
			profile.Confidence = 0.5
		}
	}
}

// evidenceMentionsBrand reports whether the supplied listings or web evidence
// name the claimed brand.
func evidenceMentionsBrand(evidence ProductIdentificationEvidence, brand string) bool {
	brandKey := NormalizeBrandKey(brand)
	if brandKey == "" {
		return false
	}
	for _, item := range evidence.Listings {
		if evidenceContainsBrand(item.Title+" "+item.Brand, brandKey) {
			return true
		}
	}
	for _, item := range evidence.WebEvidence {
		if evidenceContainsBrand(item.Title+" "+item.Snippet, brandKey) {
			return true
		}
	}
	return false
}

func collectedEvidenceURLs(evidence ProductIdentificationEvidence) []string {
	seen := map[string]bool{}
	urls := []string{}
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		urls = append(urls, value)
	}
	for _, item := range evidence.Listings {
		add(item.URL)
	}
	for _, item := range evidence.WebEvidence {
		add(item.URL)
	}
	return urls
}

func trimStringList(values []string, maxItems, maxRunes int) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, truncateRunesSafe(value, maxRunes))
		if len(out) >= maxItems {
			break
		}
	}
	return out
}

// DominantEbayCategory returns the most frequent category path across listings.
// eBay's own taxonomy is a strong prior for where a part belongs.
func DominantEbayCategory(items []models.EbayMarketEvidenceItem) string {
	counts := map[string]int{}
	best := ""
	bestCount := 0
	for _, item := range items {
		path := strings.TrimSpace(item.CategoryPath)
		if path == "" {
			continue
		}
		counts[path]++
		if counts[path] > bestCount {
			bestCount = counts[path]
			best = path
		}
	}
	return best
}

// truncateRunesSafe limits a string by runes, never splitting a multi-byte
// character. Marketplace descriptions are frequently non-ASCII, and a broken
// UTF-8 sequence inside an AI prompt degrades the answer.
func truncateRunesSafe(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit]))
}
