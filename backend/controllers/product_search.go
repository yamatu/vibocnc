package controllers

import (
	"os"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Product search
//
// The catalogue search historically used `%term%` LIKE across five columns,
// including the LONGTEXT `description` column. That guarantees a full table
// scan: no index can satisfy a leading-wildcard match, so every search reads
// every product row.
//
// `PRODUCT_SEARCH_MODE=fulltext` switches to the FULLTEXT index declared in
// backend/migrations/20260910_add_product_search_fulltext.sql. It is opt-in
// because FULLTEXT cannot reproduce `%substring%` semantics (token length and
// word-boundary rules apply), which is a product decision rather than a purely
// technical one.
// ---------------------------------------------------------------------------

const (
	productSearchModeLike     = "like"
	productSearchModeFulltext = "fulltext"

	// Mirrors InnoDB's default innodb_ft_min_token_size. Shorter tokens are not
	// present in the FULLTEXT index at all, so a query containing one must fall
	// back to LIKE to stay correct.
	fulltextMinTokenRunes = 3
)

// productSearchMode returns the configured search strategy, defaulting to the
// historical LIKE behaviour so upgrades never change search results silently.
func productSearchMode() string {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("PRODUCT_SEARCH_MODE")), productSearchModeFulltext) {
		return productSearchModeFulltext
	}
	return productSearchModeLike
}

// productSearchLikeFilter builds the legacy substring filter.
func productSearchLikeFilter(search string) (string, []interface{}) {
	like := "%" + search + "%"
	return "sku LIKE ? OR name LIKE ? OR description LIKE ? OR part_number LIKE ? OR model LIKE ?",
		[]interface{}{like, like, like, like, like}
}

// buildBooleanFulltextQuery converts a user query into a MySQL BOOLEAN MODE
// expression. Each term is required (+) and prefix-matched (*) so typing a
// partial part number still finds products.
//
// It returns "" when any term is too short for the FULLTEXT index, signalling
// that the caller must fall back to LIKE.
func buildBooleanFulltextQuery(search string) string {
	// Boolean operators must not be interpreted when they come from user input.
	const booleanOperators = `+-<>()~*"@`

	terms := make([]string, 0, 4)
	for _, field := range strings.Fields(search) {
		cleaned := strings.Map(func(r rune) rune {
			if strings.ContainsRune(booleanOperators, r) {
				return -1
			}
			return r
		}, field)
		if cleaned == "" {
			continue
		}
		if utf8.RuneCountInString(cleaned) < fulltextMinTokenRunes {
			// Not indexed by InnoDB's tokenizer; LIKE is the only correct answer.
			return ""
		}
		terms = append(terms, "+"+cleaned+"*")
	}
	if len(terms) == 0 {
		return ""
	}
	return strings.Join(terms, " ")
}

// applyProductSearchFilter appends the product search condition to a query.
// It is shared by every list endpoint so the strategy can be changed in one
// place, and so a bug in one endpoint cannot silently bypass search.
func applyProductSearchFilter(query *gorm.DB, search string) *gorm.DB {
	search = strings.TrimSpace(search)
	if search == "" {
		return query
	}

	if productSearchMode() == productSearchModeFulltext {
		if expr := buildBooleanFulltextQuery(search); expr != "" {
			// MATCH uses the FULLTEXT index. The OR exact-equality branches keep
			// authoritative identifiers (SKU / part number) findable even when
			// the tokenizer splits or drops them.
			return query.Where(
				"MATCH(sku, name, part_number, model) AGAINST (? IN BOOLEAN MODE) OR sku = ? OR part_number = ? OR model = ?",
				expr, search, search, search,
			)
		}
	}

	condition, args := productSearchLikeFilter(search)
	return query.Where(condition, args...)
}
