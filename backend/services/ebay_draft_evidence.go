package services

import (
	"encoding/json"
	"strings"

	"fanuc-backend/models"
)

// DraftEvidenceFromDraft turns a scraped draft into the evidence a product
// identification pass reads.
//
// Before this existed, a review only ever saw evidence when a market quote had
// already been collected for the model. When it had not — the common case for a
// freshly scraped queue — the payload carried no title, no item specifics and no
// category path, so the model had to classify the part from its model number
// alone. The listing's own category path and attributes were already sitting in
// the draft's raw payload the whole time.
//
// Nothing here is invented: every field comes from what the scraper recorded, and
// the description is sanitized rather than summarised.
func DraftEvidenceFromDraft(draft models.EbayImportDraft) models.EbayMarketEvidenceItem {
	raw := decodeRawPayload(draft.RawPayload)

	evidence := models.EbayMarketEvidenceItem{
		Title:         firstNonEmptyString(draft.NormalizedTitle, draft.TitleRaw),
		URL:           strings.TrimSpace(draft.SourceURL),
		PriceValue:    draft.NormalizedPrice,
		PriceRaw:      strings.TrimSpace(draft.PriceRaw),
		CategoryPath:  FirstNonEmptyTrimmedStrings(rawStringValue(raw["category_breadcrumb"]), rawStringValue(raw["category_leaf"])),
		Description:   SanitizeListingDescription(draft.DescriptionRaw),
		Model:         firstNonEmptyString(draft.NormalizedModel, draft.NormalizedMPN, draft.NormalizedPartNumber),
		Brand:         strings.TrimSpace(draft.NormalizedBrand),
		ItemSpecifics: draftItemSpecifics(raw),
	}
	if condition := rawStringValue(raw["condition"]); condition != "" {
		evidence.Condition = condition
	} else if fullCondition := rawStringValue(raw["condition_full"]); fullCondition != "" {
		evidence.Condition = fullCondition
	}
	return evidence
}

// FirstNonEmptyTrimmedStrings returns the first value that is not blank after
// trimming, or "" when every candidate is.
func FirstNonEmptyTrimmedStrings(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// draftItemSpecifics pulls the marketplace's structured attributes out of a
// scraped payload.
//
// Item specifics are the seller's own key/value pairs ("Brand", "MPN", "Model",
// "Voltage"). They are the most reliable evidence in a listing — far more so
// than the marketing title — and were previously dropped on the floor unless a
// market quote happened to have captured them.
func draftItemSpecifics(raw map[string]any) map[string]any {
	specifics := map[string]any{}

	// The scraper records specifics under several names across plugin versions.
	for _, key := range []string{"item_specifics", "itemSpecifics", "specifics"} {
		value, ok := raw[key]
		if !ok {
			continue
		}
		mergeStringKeyedMap(specifics, value)
	}

	// Some payloads carry them nested under the product data block instead.
	if productData, ok := raw["product_data"]; ok {
		if nested, ok := productData.(map[string]any); ok {
			for _, key := range []string{"item_specifics", "specifics"} {
				if value, ok := nested[key]; ok {
					mergeStringKeyedMap(specifics, value)
				}
			}
		}
	}

	// A flat payload may carry the reliable attributes as top-level keys.
	for _, key := range []string{"brand", "model", "mpn", "part_number", "condition", "voltage", "power", "warranty"} {
		value := rawStringValue(raw[key])
		if value == "" {
			continue
		}
		delete(specifics, key)
		specifics[key] = value
	}

	if len(specifics) == 0 {
		return nil
	}
	return specifics
}

// mergeStringKeyedMap copies a decoded JSON object into the accumulator,
// tolerating the map type a generic JSON decode produces.
func mergeStringKeyedMap(target map[string]any, value any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, entry := range typed {
			name := strings.TrimSpace(key)
			if name == "" {
				continue
			}
			target[name] = entry
		}
	case map[string]string:
		for key, entry := range typed {
			name := strings.TrimSpace(key)
			if name == "" {
				continue
			}
			target[name] = entry
		}
	case []any:
		for _, entry := range typed {
			item, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			name := strings.TrimSpace(rawStringValue(item["name"]))
			if name == "" {
				name = strings.TrimSpace(rawStringValue(item["key"]))
			}
			if name == "" {
				continue
			}
			if _, exists := target[name]; exists {
				continue
			}
			target[name] = firstNonEmptyAny(item["value"], item["content"])
		}
	case string:
		// Some payloads store item specifics as a JSON string.
		trimmed := strings.TrimSpace(typed)
		if !strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[") {
			return
		}
		var decoded any
		if err := json.Unmarshal([]byte(trimmed), &decoded); err != nil {
			return
		}
		mergeStringKeyedMap(target, decoded)
	}
}

// rawStringValue renders a decoded JSON value as text, so a numeric or boolean
// attribute is still usable as evidence. It reuses the payload reader's own
// converter rather than keeping a second, subtly different one.
func rawStringValue(value any) string {
	if value == nil {
		return ""
	}
	if typed, ok := value.(bool); ok {
		if typed {
			return "true"
		}
		return "false"
	}
	return firstLegacyString(value)
}

// firstNonEmptyAny returns the first value that renders to non-empty text.
func firstNonEmptyAny(values ...any) any {
	for _, value := range values {
		if text := rawStringValue(value); text != "" {
			return value
		}
	}
	return nil
}

// isBlankEvidenceListing reports whether an evidence entry would add nothing to a
// review. Appending an empty one would waste the prompt budget and could imply a
// listing was found with no title, so it is skipped.
func isBlankEvidenceListing(item models.EbayMarketEvidenceItem) bool {
	return strings.TrimSpace(item.Title) == "" &&
		strings.TrimSpace(item.CategoryPath) == "" &&
		strings.TrimSpace(item.Description) == "" &&
		len(item.ItemSpecifics) == 0
}
