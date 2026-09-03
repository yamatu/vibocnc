package services

import (
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"
)

type oneByteJSONReader struct {
	data  []byte
	index int
}

func (reader *oneByteJSONReader) Read(destination []byte) (int, error) {
	if len(destination) == 0 {
		return 0, nil
	}
	if reader.index >= len(reader.data) {
		return 0, io.EOF
	}
	destination[0] = reader.data[reader.index]
	reader.index++
	return 1, nil
}

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

func TestEbayJSONRepairReaderAddsMissingArrayObjectSeparators(t *testing.T) {
	repairReader := newEbayJSONRepairReader(strings.NewReader(`{"products":[{"id":1}{"id":2}]}`))
	decoder := json.NewDecoder(repairReader)
	var ids []string
	if err := decodeEbayDraftJSONDocument(decoder, func(item map[string]any) error {
		ids = append(ids, firstLegacyString(item["id"]))
		return nil
	}); err != nil {
		t.Fatalf("repaired document returned error: %v", err)
	}
	if len(ids) != 2 || ids[0] != "1" || ids[1] != "2" {
		t.Fatalf("decoded ids = %#v", ids)
	}
	if repairReader.RepairedSeparators() != 1 {
		t.Fatalf("repair count = %d, want 1", repairReader.RepairedSeparators())
	}
}

func TestEbayJSONRepairReaderDoesNotChangeStringsOrRootConcatenation(t *testing.T) {
	valid := newEbayJSONRepairReader(strings.NewReader(`[{"text":"}{"}]`))
	validDecoder := json.NewDecoder(valid)
	if err := decodeEbayDraftJSONDocument(validDecoder, func(map[string]any) error { return nil }); err != nil {
		t.Fatalf("valid string document returned error: %v", err)
	}
	if valid.RepairedSeparators() != 0 {
		t.Fatalf("string content was repaired: %d", valid.RepairedSeparators())
	}
	root := newEbayJSONRepairReader(strings.NewReader(`{} {}`))
	rootDecoder := json.NewDecoder(root)
	if err := decodeEbayDraftJSONDocument(rootDecoder, func(map[string]any) error { return nil }); err == nil {
		t.Fatal("concatenated root documents should still fail")
	}
	if root.RepairedSeparators() != 0 {
		t.Fatalf("root concatenation was repaired: %d", root.RepairedSeparators())
	}
}

func TestEbayJSONRepairReaderHandlesOneByteReads(t *testing.T) {
	// A one-byte source exercises state transitions at every possible chunk
	// boundary, including the missing-comma boundary itself.
	repairReader := newEbayJSONRepairReader(&oneByteJSONReader{data: []byte(`[{"id":1}{"id":2}]`)})
	decoder := json.NewDecoder(repairReader)
	count := 0
	if err := decodeEbayDraftJSONDocument(decoder, func(map[string]any) error { count++; return nil }); err != nil {
		t.Fatalf("one-byte-style document returned error: %v", err)
	}
	if count != 2 || repairReader.RepairedSeparators() != 1 {
		t.Fatalf("count=%d repairs=%d", count, repairReader.RepairedSeparators())
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
