package services

import (
	"html"
	"regexp"
	"strings"
	"unicode"
)

// Scraped listing descriptions arrive as HTML, and eBay sellers embed their own
// markup, scripts, tracking pixels and shipping boilerplate. Storing that
// verbatim puts raw tags on a product page, so every description that enters the
// catalogue is reduced to readable text first.
//
// The rules are deliberately conservative: structure that carries meaning
// (paragraph and list boundaries) is preserved as line breaks, and everything
// that is markup, styling or code is removed. Nothing is rewritten, reworded or
// summarised, because the source is third-party text and inventing content from
// it would misrepresent the product.

// descriptionDropBlockNames are blocks whose entire content is never product
// copy. Removing the content as well as the tag matters: dropping only the tag
// would leave a <script> body sitting in the description text.
//
// Go's regexp is RE2, which has no backreferences, so each tag is spelled out
// instead of closing over a captured group name.
var descriptionDropBlockNames = []string{
	"script", "style", "noscript", "iframe", "svg", "canvas", "template",
	"head", "form", "button", "select", "textarea", "object", "map", "applet",
}

var (
	descriptionDropBlocks        []*regexp.Regexp
	descriptionUnterminatedDrops []*regexp.Regexp
	// Self-closing and standalone tags that produce no text.
	descriptionVoidTags = regexp.MustCompile(`(?is)<(br|img|input|hr|meta|link|source|track|wbr|area|base|col|embed|param)\b[^>]*/?>`)
	// Structural tags become line breaks so paragraphs and list items stay apart.
	descriptionBreakTags = regexp.MustCompile(`(?is)</?(p|div|tr|li|ul|ol|table|thead|tbody|h[1-6]|section|article|header|footer|blockquote|pre|figure|figcaption|dl|dt|dd)\b[^>]*>`)
	// Remaining markup, including comments and CDATA.
	descriptionAnyTag = regexp.MustCompile(`(?is)<!--.*?-->|<!\[CDATA\[.*?\]\]>|<[^>]*>`)
	// HTML entity that survived unescaping because the source was double-encoded
	// (`&amp;nbsp;` is common when a scrape is itself HTML-escaped).
	descriptionEscapedEntity = regexp.MustCompile(`&(?:amp;)?#?[a-zA-Z0-9]{2,8};`)
	// CSS and inline style declarations that leak into text when a style block is
	// malformed rather than well-formed markup.
	descriptionCSSLeak = regexp.MustCompile(`(?i)\b(?:mso-[a-z-]+|font-family|font-size|line-height|text-align|background-color|margin|padding|border|color|display|width|height)\s*:\s*[^;{}\n]+;?`)

	descriptionBlankLines = regexp.MustCompile(`\n{3,}`)
	// RE2 spells unicode escapes as \x{...}, not \u....
	descriptionSpaces = regexp.MustCompile(`[ \t\f\v\x{00a0}\x{2000}-\x{200b}\x{2028}\x{2029}\x{3000}]{2,}`)
)

func init() {
	for _, name := range descriptionDropBlockNames {
		descriptionDropBlocks = append(descriptionDropBlocks,
			regexp.MustCompile(`(?is)<`+name+`\b[^>]*>.*?</\s*`+name+`\s*>`))
		// An unterminated block (a truncated scrape) runs to the end of input.
		descriptionUnterminatedDrops = append(descriptionUnterminatedDrops,
			regexp.MustCompile(`(?is)<`+name+`\b[^>]*>.*$`))
	}
}

// boilerplateLines are seller listing artefacts rather than product facts. They
// are dropped line by line so a genuine description that merely mentions
// shipping is not thrown away wholesale.
var descriptionBoilerplateMarkers = []string{
	"add to cart",
	"add to watchlist",
	"buy it now",
	"click here",
	"sign up for",
	"subscribe",
	"all rights reserved",
	"copyright",
	"©",
	"®",
	"terms and conditions",
	"privacy policy",
	"powered by ebay",
	"ebay item number",
	"item number:",
	"get images that",
	"supreme auctiva",
	"inkfrog",
	"template by",
	"listing template",
	"free shipping",
	"we ship worldwide",
	"shipping and handling",
	"return policy",
	"payment methods accepted",
	"paypal",
	"javascript",
	"enable javascript",
	"your browser",
}

// SanitizeListingDescription reduces scraped listing HTML to plain text.
//
// It is safe to call on a description that is already plain text: the function
// is idempotent, so a draft can be sanitized more than once without changing the
// result.
func SanitizeListingDescription(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	text := raw

	// Order matters: drop blocks before unwrapping the rest, otherwise a script
	// body would be exposed as text.
	for _, pattern := range descriptionDropBlocks {
		text = pattern.ReplaceAllString(text, "\n")
	}
	for _, pattern := range descriptionUnterminatedDrops {
		text = pattern.ReplaceAllString(text, "\n")
	}
	text = descriptionVoidTags.ReplaceAllString(text, "\n")
	text = descriptionBreakTags.ReplaceAllString(text, "\n")
	text = descriptionAnyTag.ReplaceAllString(text, "")

	// Unescape twice: scraped markup is often escaped once by eBay and again by
	// whatever wrapper captured it.
	text = html.UnescapeString(text)
	text = html.UnescapeString(text)
	text = descriptionEscapedEntity.ReplaceAllStringFunc(text, func(entity string) string {
		// After two rounds, anything still shaped like an entity is a literal the
		// seller typed. Keep short ones ("&amp;" spelled out), drop numeric noise.
		if len(entity) > 8 {
			return " "
		}
		return entity
	})

	text = descriptionCSSLeak.ReplaceAllString(text, " ")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")

	lines := make([]string, 0, 32)
	previousBlank := false
	for _, line := range strings.Split(text, "\n") {
		cleaned := strings.Join(strings.Fields(strings.TrimSpace(line)), " ")
		cleaned = strings.TrimSpace(descriptionSpaces.ReplaceAllString(cleaned, " "))
		if cleaned == "" {
			// Collapse runs of blank lines; a single blank line separates
			// paragraphs.
			if previousBlank || len(lines) == 0 {
				continue
			}
			previousBlank = true
			lines = append(lines, "")
			continue
		}
		previousBlank = false
		if isDescriptionBoilerplate(cleaned) {
			continue
		}
		lines = append(lines, cleaned)
	}

	result := strings.TrimSpace(strings.Join(lines, "\n"))
	result = descriptionBlankLines.ReplaceAllString(result, "\n\n")
	return strings.TrimSpace(result)
}

// isDescriptionBoilerplate reports whether a line is listing furniture rather
// than product copy.
func isDescriptionBoilerplate(line string) bool {
	lower := strings.ToLower(strings.TrimSpace(line))
	if lower == "" {
		return true
	}
	// A line that is only punctuation, a horizontal rule, or a short all-caps
	// heading of one word carries no product information.
	if isDescriptionDecoration(lower) {
		return true
	}
	for _, marker := range descriptionBoilerplateMarkers {
		if strings.Contains(lower, marker) {
			// Only drop the line when it is dominated by the marker; a paragraph
			// that happens to mention payment is still description text.
			if len(lower) <= len(marker)+60 || strings.HasPrefix(lower, marker) {
				return true
			}
		}
	}
	return false
}

// isDescriptionDecoration reports whether a line is visual furniture.
func isDescriptionDecoration(line string) bool {
	trimmed := strings.TrimFunc(line, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	if trimmed == "" {
		return true
	}
	// A run of decoration characters (----, ====, ****, ####) is a separator.
	if len(trimmed) < len(line)/2 {
		for _, r := range trimmed {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				return false
			}
		}
		return true
	}
	return false
}

// ShortenListingDescription produces the short description from a sanitized long
// one, cutting on a sentence boundary so it does not end mid-word.
func ShortenListingDescription(description string, limit int) string {
	cleaned := strings.Join(strings.Fields(description), " ")
	if limit <= 0 || len([]rune(cleaned)) <= limit {
		return cleaned
	}
	runes := []rune(cleaned)
	head := runes[:limit]
	for index := len(head) - 1; index > limit/2; index-- {
		switch head[index] {
		case '.', '!', '?', ';':
			return strings.TrimSpace(string(head[:index+1]))
		}
	}
	for index := len(head) - 1; index > limit/2; index-- {
		if head[index] == ' ' || head[index] == ',' {
			return strings.TrimSpace(string(head[:index])) + "…"
		}
	}
	return strings.TrimSpace(string(head)) + "…"
}

// SanitizeListingTitle cleans a scraped listing title.
//
// Sellers put HTML in titles too (a "<br>" that survived, an entity, stray
// whitespace). A title is a single line, so any tag is removed rather than
// turned into a break.
func SanitizeListingTitle(raw string) string {
	cleaned := SanitizeListingDescription(raw)
	cleaned = strings.ReplaceAll(cleaned, "\n", " ")
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	// Only strip separators that cannot begin a part number: a leading "-" may be
	// the start of a model ("-A06B-6079-H208" in a malformed title), so only
	// trailing punctuation and leading/trailing pipes and commas are removed.
	cleaned = strings.Trim(cleaned, "|,;")
	cleaned = strings.TrimRight(cleaned, " -")
	return strings.TrimSpace(cleaned)
}
