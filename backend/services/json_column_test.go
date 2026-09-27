package services

import (
	"encoding/json"
	"testing"
)

// MySQL refuses to store an empty string in a `type:json` column:
//
//	Error 3140 (22032): Invalid JSON text: "The document is empty." at position 0
//
// Every draft the extension uploads is built here, so a blank JSON column on the
// built struct takes down the whole batch at INSERT with a driver error that
// names only the column. This asserts the built draft can actually be stored.
func TestBuiltDraftJSONColumnsAreNeverEmpty(t *testing.T) {
	// A minimal payload: no images, no media, no evidence. This is the case that
	// produced an empty proposed_images and rejected every upload.
	raw := map[string]any{
		"product_title": "FANUC A06B-6079-H208 Servo Amplifier",
		"model":         "A06B-6079-H208",
		"brand":         "FANUC",
		"price":         "1250.00",
	}

	result := BuildEbayImportDraft(nil, raw)
	draft := result.Draft
	if len(result.Errors) > 0 {
		t.Fatalf("unexpected build errors: %#v", result.Errors)
	}

	// Every one of these is declared `gorm:"type:json"` on the model.
	columns := map[string]string{
		"image_source_urls": draft.ImageSourceURLs,
		"media_asset_ids":   draft.MediaAssetIDs,
		"proposed_images":   draft.ProposedImages,
	}
	for name, value := range columns {
		if value == "" {
			t.Errorf("%s is empty; MySQL rejects that with error 3140", name)
			continue
		}
		if !json.Valid([]byte(value)) {
			t.Errorf("%s = %q is not valid JSON", name, value)
		}
	}
}

// The AI review pass overwrites proposed_images with the source image list, so
// the placeholder has to stay a list rather than becoming an object.
func TestBuiltDraftProposedImagesShape(t *testing.T) {
	result := BuildEbayImportDraft(nil, map[string]any{
		"product_title": "Mitsubishi Q03UDECPU",
		"model":         "Q03UDECPU",
	})
	var decoded []string
	if err := json.Unmarshal([]byte(result.Draft.ProposedImages), &decoded); err != nil {
		t.Fatalf("proposed_images is not a JSON list: %q (%v)", result.Draft.ProposedImages, err)
	}
}

func TestJSONColumnHelpers(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{name: "blank array becomes an empty document", got: JSONArrayOrEmpty(""), want: "[]"},
		{name: "whitespace array becomes an empty document", got: JSONArrayOrEmpty("  "), want: "[]"},
		{name: "blank object becomes an empty document", got: JSONObjectOrEmpty(""), want: "{}"},
		{name: "whitespace object becomes an empty document", got: JSONObjectOrEmpty("\n\t"), want: "{}"},
		{name: "a real array is passed through", got: JSONArrayOrEmpty(`["a"]`), want: `["a"]`},
		{name: "a real object is passed through", got: JSONObjectOrEmpty(`{"k":"v"}`), want: `{"k":"v"}`},
		// A malformed payload must not be silently rewritten into an empty
		// document: that would hide the real defect behind valid-looking data.
		{name: "a malformed array is not hidden", got: JSONArrayOrEmpty(`["a"`), want: `["a"`},
		{name: "a malformed object is not hidden", got: JSONObjectOrEmpty(`{`), want: `{`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.want {
				t.Fatalf("got %q, want %q", tc.got, tc.want)
			}
		})
	}
}
