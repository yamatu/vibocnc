package services

import (
	"html"
	"strings"
	"unicode"
	"unicode/utf8"

	"fanuc-backend/models"
)

const (
	ContentIssueMissing       = "missing_description"
	ContentIssueThin          = "thin_description"
	ContentIssueModelMissing  = "description_model_missing"
	ContentIssueBrandMismatch = "description_brand_mismatch"
	ContentIssueRepetitive    = "repetitive_description"
)

// EvaluateProductContentQuality identifies descriptions that are obviously
// missing, too thin, internally repetitive, or inconsistent with the product's
// verified identifiers. It is intentionally deterministic: the expensive AI
// request is reserved for products this fast audit flags.
func EvaluateProductContentQuality(product models.Product) (string, string) {
	description := normalizeProductContentText(product.Description)
	shortDescription := normalizeProductContentText(product.ShortDescription)
	if description == "" {
		return ContentIssueMissing, "long product description is empty"
	}
	if shortDescription == "" {
		return ContentIssueMissing, "short product description is empty"
	}

	if hasProductContentBrandMismatch(product.Brand, description) {
		return ContentIssueBrandMismatch, "description lead names a different manufacturer"
	}
	model := compactModel(productClassificationModel(product))
	if len(model) >= 5 && !strings.Contains(compactModel(description), model) {
		return ContentIssueModelMissing, "long description does not contain the product model or part number"
	}
	if hasRepeatedProductContent(description) {
		return ContentIssueRepetitive, "long description repeats the same sentence or paragraph"
	}

	runeCount := utf8.RuneCountInString(description)
	wordCount := len(strings.Fields(description))
	nameText := normalizeProductContentText(product.Name)
	if description == nameText || description == shortDescription || runeCount < 220 || (wordCount < 30 && runeCount < 450) {
		return ContentIssueThin, "long product description is too brief to be useful"
	}
	if utf8.RuneCountInString(shortDescription) < 45 {
		return ContentIssueThin, "short product description is too brief"
	}
	return "", ""
}

func normalizeProductContentText(value string) string {
	var builder strings.Builder
	inTag := false
	for _, r := range value {
		switch r {
		case '<':
			inTag = true
			builder.WriteByte(' ')
		case '>':
			inTag = false
			builder.WriteByte(' ')
		default:
			if !inTag {
				builder.WriteRune(r)
			}
		}
	}
	return strings.Join(strings.Fields(html.UnescapeString(builder.String())), " ")
}

func hasProductContentBrandMismatch(productBrand, description string) bool {
	productBrandKey := NormalizeBrandKey(productBrand)
	if productBrandKey == "" {
		return false
	}
	leadRunes := []rune(description)
	if len(leadRunes) > 360 {
		leadRunes = leadRunes[:360]
	}
	leadTokens := taxonomyTokenSet(string(leadRunes))
	productMentioned := true
	for _, token := range taxonomyTokens(productBrand) {
		if !leadTokens[token] {
			productMentioned = false
			break
		}
	}
	if productMentioned {
		return false
	}
	for _, brand := range registrySEOBrands {
		if NormalizeBrandKey(brand) == productBrandKey {
			continue
		}
		mentioned := true
		for _, token := range taxonomyTokens(brand) {
			if !leadTokens[token] {
				mentioned = false
				break
			}
		}
		if mentioned {
			return true
		}
	}
	return false
}

func hasRepeatedProductContent(value string) bool {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == '\n' || r == '\r' || r == '.' || r == '!' || r == '?' || r == '。' || r == '！' || r == '？'
	})
	seen := make(map[string]bool)
	for _, part := range parts {
		normalized := strings.Map(func(r rune) rune {
			if unicode.IsLetter(r) || unicode.IsNumber(r) {
				return unicode.ToLower(r)
			}
			return -1
		}, part)
		if utf8.RuneCountInString(normalized) < 35 {
			continue
		}
		if seen[normalized] {
			return true
		}
		seen[normalized] = true
	}
	return false
}
