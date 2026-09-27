package services

import "strings"

// MySQL rejects an empty string in a JSON column:
//
//	Error 3140 (22032): Invalid JSON text: "The document is empty." at position 0
//
// GORM reports that as a raw driver error naming only the column, so an upload
// or an AI job fails with nothing in the application log pointing at the field
// that was left blank. Several columns are declared `gorm:"type:json"` on plain
// Go string fields, which means every write has to carry a JSON document even
// when there is nothing to store.
//
// These helpers make the blank case explicit at the write site instead of
// letting "" reach the driver. They only substitute the empty document; a
// non-empty value is passed through untouched so a genuinely malformed payload
// still fails loudly rather than being silently replaced.

// JSONArrayOrEmpty returns a value safe for a `type:json` column holding a list,
// substituting `[]` for a blank value.
func JSONArrayOrEmpty(encoded string) string {
	if strings.TrimSpace(encoded) == "" {
		return "[]"
	}
	return encoded
}

// JSONObjectOrEmpty returns a value safe for a `type:json` column holding an
// object, substituting `{}` for a blank value.
func JSONObjectOrEmpty(encoded string) string {
	if strings.TrimSpace(encoded) == "" {
		return "{}"
	}
	return encoded
}
