package services

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"fanuc-backend/models"
)

func imagePayload() map[string]any {
	return map[string]any{
		"product_title":    "FANUC A06B-6079-H208 Servo Amplifier",
		"model":            "A06B-6079-H208",
		"brand":            "FANUC",
		"current_price":    "1234.00",
		"main_image":       "https://i.ebayimg.com/a.jpg",
		"image_urls":       []any{"https://i.ebayimg.com/a.jpg", "https://i.ebayimg.com/b.jpg"},
		"product_url":      "https://www.ebay.com/itm/123456789012",
		"description_html": "<p>Servo amplifier</p>",
	}
}

// Defaulting to keeping the photos preserves what the crawler has always done;
// dropping them has to be an explicit choice.
func TestUploadRequestKeepsImagesByDefault(t *testing.T) {
	var absent models.EbayImportDraftUploadRequest
	if !absent.WantsImages() {
		t.Error("an upload that says nothing about images must keep them")
	}

	yes := true
	if !(models.EbayImportDraftUploadRequest{IncludeImages: &yes}).WantsImages() {
		t.Error("include_images=true must keep images")
	}

	no := false
	if (models.EbayImportDraftUploadRequest{IncludeImages: &no}).WantsImages() {
		t.Error("include_images=false must drop images")
	}
}

func TestBuildDraftDropsImagesWhenAsked(t *testing.T) {
	// The image-free draft keeps its content, so it can still be reviewed,
	// approved and published; only the photos are gone.
	without := BuildEbayImportDraftWithOptions(context.Background(), nil, imagePayload(), EbayImportDraftBuildOptions{IncludeImages: false})
	if ids := decodeStringSlice(without.Draft.ImageSourceURLs); len(ids) != 0 {
		t.Errorf("image-free draft kept %v", ids)
	}
	if strings.TrimSpace(without.Draft.MainImageSourceURL) != "" {
		t.Errorf("image-free draft kept a main image: %q", without.Draft.MainImageSourceURL)
	}
	if strings.TrimSpace(without.Draft.NormalizedTitle) == "" {
		t.Error("image-free draft lost its title")
	}
	if strings.TrimSpace(without.Draft.NormalizedModel) == "" {
		t.Error("image-free draft lost its model")
	}
	if strings.TrimSpace(without.Draft.DescriptionRaw) == "" {
		t.Error("image-free draft lost its description")
	}
	// At least one identifier must survive, or the draft can never be imported.
	if strings.TrimSpace(without.Draft.NormalizedModel) == "" &&
		strings.TrimSpace(without.Draft.NormalizedPartNumber) == "" &&
		strings.TrimSpace(without.Draft.NormalizedMPN) == "" {
		t.Error("image-free draft lost every identifier, so it could never be imported")
	}

	with := BuildEbayImportDraftWithOptions(context.Background(), nil, imagePayload(), EbayImportDraftBuildOptions{IncludeImages: true})
	if ids := decodeStringSlice(with.Draft.ImageSourceURLs); len(ids) == 0 {
		t.Error("images were dropped even though they were requested")
	}
}

// The wrapper every existing caller uses must behave exactly as before.
func TestBuildDraftWithContextStillKeepsImages(t *testing.T) {
	built := BuildEbayImportDraftWithContext(context.Background(), nil, imagePayload())
	if ids := decodeStringSlice(built.Draft.ImageSourceURLs); len(ids) == 0 {
		t.Error("the legacy builder stopped keeping images")
	}
}

// An image-free product must not silently grow images again during import.
func TestImageFreeDraftImportsWithoutImages(t *testing.T) {
	built := BuildEbayImportDraftWithOptions(context.Background(), nil, imagePayload(), EbayImportDraftBuildOptions{IncludeImages: false})
	request := BuildProductRequestFromDraft(nil, built.Draft)
	if len(request.Images) != 0 {
		encoded, _ := json.Marshal(request.Images)
		t.Errorf("import attached images to an image-free draft: %s", encoded)
	}
	if strings.TrimSpace(request.Name) == "" {
		t.Error("image-free import produced a product with no name")
	}
}
