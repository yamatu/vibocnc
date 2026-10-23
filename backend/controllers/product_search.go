package controllers

import (
	"os"
	"strings"
	"unicode"
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
// expression. The input is split on the same delimiters InnoDB's tokenizer uses
// (anything but letters, digits and '_'), so "A06B-6079" becomes the indexed
// words "+A06B* +6079*". Every term is required and prefix-matched. Splitting on
// non-word characters also strips every boolean operator from user input.
//
// Words shorter than the index minimum are not indexed and are skipped; the
// exact-identifier branches still match a full SKU. It returns "" only when no
// indexable word remains, signalling that the caller must fall back to LIKE.
func buildBooleanFulltextQuery(search string) string {
	words := strings.FieldsFunc(search, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_'
	})
	terms := make([]string, 0, len(words))
	seen := make(map[string]bool, len(words))
	for _, word := range words {
		key := strings.ToLower(word)
		if utf8.RuneCountInString(word) < fulltextMinTokenRunes || seen[key] {
			continue
		}
		seen[key] = true
		terms = append(terms, "+"+word+"*")
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
			// The exact-equality branches keep authoritative identifiers findable
			// even when the tokenizer splits or drops them. They are UNIONed in a
			// derived table: OR-ing them with MATCH makes MySQL scan every row.
			return query.Where(
				"id IN (SELECT id FROM ("+
					"SELECT id FROM products WHERE MATCH(sku, name, part_number, model) AGAINST (? IN BOOLEAN MODE)"+
					" UNION SELECT id FROM products WHERE sku = ?"+
					" UNION SELECT id FROM products WHERE part_number = ?"+
					" UNION SELECT id FROM products WHERE model = ?"+
					") AS product_search_ids)",
				expr, search, search, search,
			)
		}
	}

	condition, args := productSearchLikeFilter(search)
	return query.Where(condition, args...)
}
