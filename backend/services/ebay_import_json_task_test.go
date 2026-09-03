package services

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

func TestDecodeEbayDraftJSONArrayStreamsItems(t *testing.T) {
	decoder := json.NewDecoder(strings.NewReader(`[{"id":1,"title":"A"},{"id":2,"title":"B"}]`))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('[') {
		t.Fatalf("expected array token, got %v, err=%v", token, err)
	}
	ids := make([]string, 0, 2)
	err = decodeEbayDraftJSONArray(decoder, func(item map[string]any) error {
		ids = append(ids, firstLegacyString(item["id"]))
		return nil
	})
	if err != nil {
		t.Fatalf("decodeEbayDraftJSONArray returned error: %v", err)
	}
	if len(ids) != 2 || ids[0] != "1" || ids[1] != "2" {
		t.Fatalf("unexpected ids: %#v", ids)
	}
}

func TestEbayDraftImportKeysNormalizeDuplicates(t *testing.T) {
	listingKey, sourceURL := ebayDraftImportKeys(map[string]any{
		"source_site": " B-AutomationService ",
		"listing_id":  json.Number("12345"),
		"source_url":  "HTTPS://EXAMPLE.COM/Products/Test/",
	})
	if listingKey != "b-automationservice|12345" {
		t.Fatalf("unexpected listing key: %q", listingKey)
	}
	if sourceURL != "https://example.com/products/test" {
		t.Fatalf("unexpected source URL: %q", sourceURL)
	}
}

func TestEbayDraftJSONTaskPauseAndResume(t *testing.T) {
	task := &ebayDraftJSONImportTask{Status: EbayDraftJSONTaskProcessing}
	task.cond = sync.NewCond(&task.mu)
	paused, err := task.pause()
	if err != nil {
		t.Fatalf("pause returned error: %v", err)
	}
	if paused.Status != EbayDraftJSONTaskPaused {
		t.Fatalf("pause status = %q", paused.Status)
	}
	resumed, err := task.resume()
	if err != nil {
		t.Fatalf("resume returned error: %v", err)
	}
	if resumed.Status != EbayDraftJSONTaskProcessing {
		t.Fatalf("resume status = %q", resumed.Status)
	}
}

func TestDecodeEbayDraftJSONDocumentSupportsNestedDataAndUnknownValues(t *testing.T) {
	decoder := json.NewDecoder(strings.NewReader(`{"meta":{"count":2,"tags":["a","b"]},"data":[{"id":"a"},{"id":"b"}]}`))
	var got []string
	err := decodeEbayDraftJSONDocument(decoder, func(item map[string]any) error {
		got = append(got, firstLegacyString(item["id"]))
		return nil
	})
	if err != nil {
		t.Fatalf("decode nested document returned error: %v", err)
	}
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("decoded ids = %#v", got)
	}
}

func TestDecodeEbayDraftJSONDocumentSupportsProductsArray(t *testing.T) {
	decoder := json.NewDecoder(strings.NewReader(`{"meta":{"source":"ebay","flags":[1,2,3]},"products":[{"id":1}]}`))
	count := 0
	if err := decodeEbayDraftJSONDocument(decoder, func(item map[string]any) error {
		count++
		return nil
	}); err != nil {
		t.Fatalf("decode products document returned error: %v", err)
	}
	if count != 1 {
		t.Fatalf("decoded %d products, want 1", count)
	}
}

func TestDecodeEbayDraftJSONDocumentRejectsTrailingData(t *testing.T) {
	decoder := json.NewDecoder(strings.NewReader(`[{"id":1}] {"id":2}`))
	err := decodeEbayDraftJSONDocument(decoder, func(map[string]any) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "trailing") {
		t.Fatalf("expected trailing-data error, got %v", err)
	}
}

func TestEbayDraftImportFingerprintIsStableForEquivalentMaps(t *testing.T) {
	left := map[string]any{"id": "123", "title": "Servo"}
	right := map[string]any{"title": "Servo", "id": "123"}
	if ebayDraftImportFingerprint(left) == "" || ebayDraftImportFingerprint(left) != ebayDraftImportFingerprint(right) {
		t.Fatalf("fingerprints are not stable: %q vs %q", ebayDraftImportFingerprint(left), ebayDraftImportFingerprint(right))
	}
}

func TestEbayJSONUploadValidation(t *testing.T) {
	if !validEbayJSONFingerprint("") || !validEbayJSONFingerprint(strings.Repeat("a", 64)) {
		t.Fatal("valid fingerprints were rejected")
	}
	if validEbayJSONFingerprint("not-a-fingerprint") {
		t.Fatal("invalid fingerprint was accepted")
	}
	if got := normalizeEbayJSONFilename(`..\\nested\\products.json`); got != "products.json" {
		t.Fatalf("normalized filename = %q", got)
	}
}
