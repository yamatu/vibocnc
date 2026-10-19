package services

import (
	"regexp"
	"strings"
)

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
	// Clipping "Name | Vibocnc" must not leave a dangling separator ("Name |").
	return strings.TrimRight(strings.TrimSpace(cut), " |:,-–—")
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
	// Prefer a candidate that fits whole over clipping a longer one.
	for _, candidate := range candidates {
		title := normalizeWhitespace(candidate)
		if len(title) >= MetaTitleMinLength && len(title) <= MetaTitleMaxLength {
			return title
		}
	}
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
	// Prefer a complete candidate that already fits the limit. This prevents a
	// long first candidate from winning after it has been clipped into fragments
	// such as "and fast." while a complete fallback is available.
	for _, candidate := range candidates {
		raw := normalizeWhitespace(candidate)
		if len(raw) >= MetaDescriptionMinLength && len(raw) <= MetaDescriptionMaxLength && !looksLikeTruncatedMetaDescription(raw) {
			return raw
		}
	}
	for _, candidate := range candidates {
		desc := NormalizeMetaDescription(candidate)
		if len(desc) >= MetaDescriptionMinLength && !looksLikeTruncatedMetaDescription(desc) {
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

var truncatedMetaEndingRe = regexp.MustCompile(`(?i)(?:\band\s+(?:fast|global|worldwide)|[,;:]|\bwith)[.!?]?$`)

func looksLikeTruncatedMetaDescription(value string) bool {
	return truncatedMetaEndingRe.MatchString(strings.TrimSpace(value))
}

func normalizeWhitespace(input string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(input)), " ")
}
