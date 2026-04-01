package services

import "strings"

const (
	MetaTitleMinLength       = 20
	MetaTitleMaxLength       = 69
	MetaDescriptionMinLength = 25
	MetaDescriptionMaxLength = 160
)

func NormalizeMetaTitle(input string) string {
	title := normalizeWhitespace(input)
	if title == "" {
		return ""
	}
	if len(title) <= MetaTitleMaxLength {
		return title
	}

	cut := title[:MetaTitleMaxLength]
	if idx := strings.LastIndex(cut, " "); idx >= 24 {
		cut = cut[:idx]
	}
	return strings.TrimSpace(cut)
}

func NormalizeMetaDescription(input string) string {
	desc := normalizeWhitespace(input)
	if desc == "" {
		return ""
	}
	if len(desc) <= MetaDescriptionMaxLength {
		return desc
	}

	cut := desc[:MetaDescriptionMaxLength]
	if idx := strings.LastIndex(cut, " "); idx >= 60 {
		cut = cut[:idx]
	}
	cut = strings.TrimSpace(cut)
	if strings.HasSuffix(cut, ".") || strings.HasSuffix(cut, "!") || strings.HasSuffix(cut, "?") {
		return cut
	}
	if len(cut) >= MetaDescriptionMaxLength-1 {
		cut = strings.TrimSpace(cut[:MetaDescriptionMaxLength-1])
	}
	return cut + "."
}

func BuildSafeMetaTitle(candidates ...string) string {
	for _, candidate := range candidates {
		title := NormalizeMetaTitle(candidate)
		if len(title) >= MetaTitleMinLength {
			return title
		}
	}
	for _, candidate := range candidates {
		title := NormalizeMetaTitle(candidate)
		if title != "" {
			return title
		}
	}
	return ""
}

func BuildSafeMetaDescription(candidates ...string) string {
	for _, candidate := range candidates {
		desc := NormalizeMetaDescription(candidate)
		if len(desc) >= MetaDescriptionMinLength {
			return desc
		}
	}
	for _, candidate := range candidates {
		desc := NormalizeMetaDescription(candidate)
		if desc != "" {
			return desc
		}
	}
	return ""
}

func normalizeWhitespace(input string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(input)), " ")
}
