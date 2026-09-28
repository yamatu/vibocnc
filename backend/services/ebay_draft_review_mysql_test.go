//go:build integration

package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"fanuc-backend/models"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Run ONLY inside the isolated test container sharing the test MySQL network
// namespace. It has no published port, no production volumes or credentials.
func TestMySQLDraftOptimizationPipeline(t *testing.T) {
	db := newDraftIntegrationDB(t)
	var err error
	parent := models.Category{Name: "OMRON", Slug: "omron", IsActive: true}
	if err = db.Create(&parent).Error; err != nil {
		t.Fatal(err)
	}
	wrong := models.Category{Name: "Control Board", Slug: "omron-control-board", ParentID: &parent.ID, IsActive: true}
	if err = db.Create(&wrong).Error; err != nil {
		t.Fatal(err)
	}
	draft := models.EbayImportDraft{
		SourceSite: "ebay", TitleRaw: "1PC New OMRON E3S-CL2 Photoelectric Sensor Fast Shipping", NormalizedTitle: "1PC New OMRON E3S-CL2 Photoelectric Sensor Fast Shipping",
		NormalizedModel: "E3S-CL2", NormalizedBrand: "OMRON", RawPayload: `{"ebay_category_breadcrumb":"Sensors > Photoelectric Sensors","category_breadcrumb":"Old > PLCs"}`,
		Status: EbayDraftStatusNeedsReview, AIReviewStatus: EbayAIReviewQueued, TaxonomyStatus: EbayDraftTaxonomyMatched, SuggestedCategoryID: &wrong.ID,
		ImageSourceURLs: "[]", MediaAssetIDs: "[]", ProposedImages: "[]",
	}
	if err = db.Create(&draft).Error; err != nil {
		t.Fatal(err)
	}
	client := func(_ context.Context, _, prompt string) (string, error) {
		var payload struct {
			Category string `json:"ebay_category_path"`
			Name     string `json:"product_name"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(prompt, "EVIDENCE:\n")), &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Category != "Sensors > Photoelectric Sensors" || !strings.Contains(payload.Name, "E3S-CL2 Photoelectric Sensor") {
			t.Error("listing evidence lost")
		}
		return `{"brand":"OMRON","part_type":"Photoelectric Sensor","product_category":"Sensors","confidence":0.95,"what_it_is":"Photoelectric sensor for object detection."}`, nil
	}
	reviewed, result, err := reviewDraftWithDB(context.Background(), db, EbayDraftReviewInput{Draft: draft}, client)
	if err != nil || result.Status != EbayAIReviewReady {
		t.Fatalf("review: %+v, %v", result, err)
	}
	if reviewed.ProposedName != "OMRON E3S-CL2 Photoelectric Sensor" {
		t.Fatalf("name not optimized: %q", reviewed.ProposedName)
	}
	if reviewed.ProposedCategoryID == nil || *reviewed.ProposedCategoryID == wrong.ID || !reviewed.ProposedCategoryCreated {
		t.Fatalf("old wrong category survived or missing category not created: %+v", result)
	}
	if strings.Contains(reviewed.ProposedDescription, "##") {
		t.Fatal("generated markdown leaked into plain-text description")
	}
	if err = StoreDraftReview(db, reviewed); err != nil {
		t.Fatal(err)
	}
	var stored models.EbayImportDraft
	if err = db.First(&stored, draft.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status == EbayDraftStatusImported || stored.ImportedProductID != nil || stored.AIReviewStatus != EbayAIReviewReady {
		t.Fatal("optimization published a product")
	}
	if stored.TitleRaw != draft.TitleRaw {
		t.Fatal("source title was overwritten")
	}
	item := summarizeDraft(stored, DraftSourceCategories{})
	if item.ProposedName != reviewed.ProposedName || !item.ProposedCategoryCreated {
		t.Fatal("list dropped AI output")
	}
	detail, err := GetEbayImportDraftDetail(db, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.ProposedName != reviewed.ProposedName || detail.ProposedCategoryID == nil || detail.AIReviewStatus != EbayAIReviewReady {
		t.Fatal("detail dropped AI output")
	}
	// A repeat run reuses the same category instead of minting a duplicate.
	_, repeat, err := reviewDraftWithDB(context.Background(), db, EbayDraftReviewInput{Draft: draft}, client)
	if err != nil || repeat.Status != EbayAIReviewReady || repeat.CategoryCreated {
		t.Fatalf("repeat created a duplicate: %+v %v", repeat, err)
	}
	for _, tc := range []struct{ model, partType string }{
		{"CP1E-N40DR-D", "Programmable Logic Controller"},
		{"W4S1-03B", "Industrial Ethernet Switch"},
		{"H3CR-A8", "Timer Relay"},
		{"CJ1W-PA205R", "PLC Power Supply Module"},
		{"G7SA-2A2B", "Safety Relay"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			input := draft
			input.NormalizedModel = tc.model
			input.TitleRaw = "OMRON " + tc.model + " " + tc.partType
			input.NormalizedTitle = input.TitleRaw
			reading := func(context.Context, string, string) (string, error) {
				encoded, _ := json.Marshal(ProductProfile{Brand: "OMRON", PartType: tc.partType, Confidence: 0.95})
				return string(encoded), nil
			}
			proposal, result, err := reviewDraftWithDB(context.Background(), db, EbayDraftReviewInput{Draft: input}, reading)
			if err != nil || result.Status != EbayAIReviewReady || proposal.ProposedCategoryID == nil || *proposal.ProposedCategoryID == wrong.ID {
				t.Fatalf("wrong old category survived: %+v %v", result, err)
			}
			if !strings.Contains(proposal.ProposedName, CanonicalizeProductTypeFromText(tc.partType)) {
				t.Fatal("title and type vocabulary disagree")
			}
		})
	}
	// This is the same preparation now called by single AND bulk manual import.
	if err = PrepareEbayDraftForManualImport(db, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.NormalizedTitle != reviewed.ProposedName || stored.SuggestedCategoryID == nil || *stored.SuggestedCategoryID != *reviewed.ProposedCategoryID {
		t.Fatal("manual import ignored the AI result")
	}
	if _, _, err = VerifyEbayImportDraftCategory(context.Background(), db, stored); err != nil {
		t.Fatalf("approved category revalidation: %v", err)
	}
	req := BuildProductRequestFromDraft(db, stored)
	if req.Name != reviewed.ProposedName || req.CategoryID != *reviewed.ProposedCategoryID {
		t.Fatalf("product request lost title/category: %q %d", req.Name, req.CategoryID)
	}
	if req.Description == "" || req.MetaTitle == "" {
		t.Fatal("product request lost description/SEO")
	}
	if req.Description != reviewed.ProposedDescription || req.ShortDescription != reviewed.ProposedShortDescription {
		t.Fatal("AI description replaced by original listing")
	}
	// The classification must remain consistent all the way to the import gate.
	if stored.AIReviewStatus != EbayAIReviewApproved || stored.Status == EbayDraftStatusImported {
		t.Fatal("preparation itself published a product")
	}
	if err := SetDraftSourceCategory(db, &stored, "ebay", "Sensors > Corrected category"); err != nil {
		t.Fatal(err)
	}
	if stored.AIReviewStatus != "" {
		t.Fatal("changed category kept stale approval")
	}
	if err := db.First(&stored, stored.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AIReviewStatus != "" || DraftEvidenceFromDraft(stored).CategoryPath != "Sensors > Corrected category" {
		t.Fatal("changed category not persisted as new evidence")
	}
}

// The caller shares only the network namespace of the --network none test
// MySQL container. A unique disposable schema makes reruns independent.
func newDraftIntegrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	cfg := &gorm.Config{DisableForeignKeyConstraintWhenMigrating: true, Logger: logger.Default.LogMode(logger.Silent)}
	root, err := gorm.Open(mysql.Open("root@tcp(127.0.0.1:3306)/?charset=utf8mb4&parseTime=True&loc=UTC"), cfg)
	if err != nil {
		t.Fatal("isolated MySQL unavailable")
	}
	schema := fmt.Sprintf("vibocnc_ai_review_test_%d", time.Now().UnixNano())
	if err = root.Exec("CREATE DATABASE " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP DATABASE " + schema); sqlDB, _ := root.DB(); sqlDB.Close() })
	db, err := gorm.Open(mysql.Open("root@tcp(127.0.0.1:3306)/"+schema+"?charset=utf8mb4&parseTime=True&loc=UTC"), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB, _ := db.DB(); sqlDB.Close() })
	if err = db.Migrator().CreateTable(&models.Category{}, &models.EbayImportDraft{}, &models.Product{}, &models.ProductAttribute{}, &models.ProductImageTrustedURL{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestMySQLCJ1WEditableFieldsAndImageFreePublication(t *testing.T) {
	db := newDraftIntegrationDB(t)
	draft := editableCJ1WDraft()
	draft.AIReviewStatus = EbayAIReviewQueued
	draft.MediaAssetIDs = "[]"
	draft.SourceSite = "ebay"
	draft.RawPayload = `{"product_title":"One New Omron CJ1W-DA08C PLC Module In Box Fast Shipping","ebay_category_breadcrumb":"Business & Industrial > PLC Input & Output Modules"}`
	draft.SuggestedCategoryID = nil
	draft.ProposedCategoryID = nil
	if err := db.Create(&draft).Error; err != nil {
		t.Fatal(err)
	}
	client := func(context.Context, string, string) (string, error) {
		return `{"brand":"OMRON","part_type":"Analog Output Module","product_category":"PLC Input & Output Modules","confidence":0.95,"what_it_is":"Analog output module for an industrial control system."}`, nil
	}
	reviewed, result, err := reviewDraftWithDB(context.Background(), db, EbayDraftReviewInput{Draft: draft}, client)
	if err != nil || result.Status != EbayAIReviewReady || !result.CategoryCreated {
		t.Fatalf("review did not create missing category: %+v %v", result, err)
	}
	if err = StoreDraftReview(db, reviewed); err != nil {
		t.Fatal(err)
	}
	var stored models.EbayImportDraft
	if err = db.First(&stored, draft.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.NormalizedTitle != reviewed.ProposedName || stored.NormalizedDescription != reviewed.ProposedDescription || stored.MetaDescription != reviewed.ProposedMetaDescription || stored.NormalizedBrand != "OMRON" || stored.TaxonomyStatus != EbayDraftTaxonomyMatched {
		t.Fatal("AI result never reached editable database fields")
	}
	var count int64
	db.Model(&models.Product{}).Count(&count)
	if count != 0 {
		t.Fatal("optimization published automatically")
	}
	detail, err := GetEbayImportDraftDetail(db, draft.ID)
	if err != nil || detail.NormalizedTitle != reviewed.ProposedName || detail.NormalizedDescription != reviewed.ProposedDescription || detail.MetaKeywords != reviewed.ProposedMetaKeywords {
		t.Fatalf("detail still returns old fields: %v", err)
	}
	noImages := false
	edited := "OMRON CJ1W-DA08C analog output module. Edited before publishing."
	updates, err := DraftEditableUpdates(db, stored, models.EbayImportDraftUpdateRequest{IncludeImages: &noImages, NormalizedDescription: &edited})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&stored).Updates(updates).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.First(&stored, draft.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AIReviewStatus != EbayAIReviewReady || !stored.ExcludeSourceImages {
		t.Fatal("saving discarded AI result or image preference")
	}
	if err = PrepareEbayDraftForManualImport(db, &stored); err != nil {
		t.Fatal(err)
	}
	if _, _, err = VerifyEbayImportDraftCategory(context.Background(), db, stored); err != nil {
		t.Fatal(err)
	}
	req := BuildProductRequestFromDraft(db, stored)
	if len(req.Images) != 0 || req.Description != edited || req.Price != 251.34 {
		t.Fatal("manual publish lost edit, price or image preference")
	}
	published, publishErr := CreateProductFromRequest(db, req)
	if publishErr != nil {
		t.Fatalf("product create: %v (%v)", publishErr, publishErr.Unwrap())
	}
	if published.Product.Name != reviewed.ProposedName || published.Product.ImageURLs != "[]" || published.Product.CategoryID != *reviewed.ProposedCategoryID || published.Product.MetaDescription != reviewed.ProposedMetaDescription || published.Product.Description != edited {
		t.Fatal("database product differs from the editable AI result")
	}
	// A late worker must never replace approved fields.
	if err = StoreDraftReview(db, reviewed); err == nil {
		t.Fatal("late worker overwrote an approved result")
	}
	t.Logf("published test product: %s; category=%s; images=%s", published.Product.Name, result.CategoryName, published.Product.ImageURLs)
}
