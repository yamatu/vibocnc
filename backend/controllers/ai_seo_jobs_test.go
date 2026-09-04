package controllers

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"fanuc-backend/models"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestApplyAIASEOCandidateStatusScope(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       "user:password@tcp(localhost:3306)/test?charset=utf8mb4&parseTime=True&loc=Local",
		SkipInitializeWithVersion: true,
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatalf("open dry-run database: %v", err)
	}

	tests := []struct {
		name          string
		req           aiSEOCandidateStartRequest
		wantFailed    bool
		wantUnstarted bool
	}{
		{name: "never optimized only", wantUnstarted: true},
		{name: "never optimized and failed", req: aiSEOCandidateStartRequest{IncludeFailed: true}, wantFailed: true, wantUnstarted: true},
		{name: "failed only overrides include failed", req: aiSEOCandidateStartRequest{IncludeFailed: true, FailedOnly: true}, wantFailed: true},
		{name: "explicit optimized status", req: aiSEOCandidateStartRequest{IncludeOptimized: true, SEOStatus: "optimized"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
				query := applyAIASEOCandidateStatusScope(tx.Model(&models.Product{}), test.req)
				return query.Find(&[]models.Product{})
			})
			hasFailed := strings.Contains(sql, "ai_seo_status = 'failed'")
			hasUnstarted := strings.Contains(sql, "ai_seo_status IS NULL") && strings.Contains(sql, "ai_seo_status = ''")
			if hasFailed != test.wantFailed {
				t.Fatalf("failed-product scope mismatch: SQL = %s", sql)
			}
			if hasUnstarted != test.wantUnstarted {
				t.Fatalf("never-optimized scope mismatch: SQL = %s", sql)
			}
		})
	}
}

func TestPinAIAgentSEOJobProfile(t *testing.T) {
	activeID := uint(4)
	setting := &models.AIAgentSetting{ActiveProfileID: &activeID, Model: "legacy-model", APIMode: aiAgentAPIModeStandard}
	profile := &models.AIAgentProfile{ID: 7, Name: "High quality", Model: "provider/custom-model", APIMode: aiAgentAPIModeReasoning}
	job := &models.AIAgentSEOJob{}

	pinAIAgentSEOJobProfile(job, setting, profile)

	if job.AIProfileID == nil || *job.AIProfileID != profile.ID {
		t.Fatalf("job profile ID = %v, want %d", job.AIProfileID, profile.ID)
	}
	if job.AIProfileName != profile.Name || job.AIModel != profile.Model || job.AIAPIMode != profile.APIMode {
		t.Fatalf("job profile snapshot = %#v", job)
	}
}

func TestValidateAISEOJobCapacityAllowsParallelDisjointJobs(t *testing.T) {
	if err := validateAISEOJobCapacity(maxActiveAISEOJobs-1, maxActiveCategoryJobs-1, aiSEOCategorySelectionMode); err != nil {
		t.Fatalf("capacity below limit should be allowed: %v", err)
	}
	if !errors.Is(validateAISEOJobCapacity(maxActiveAISEOJobs, 0, "selected"), errAISEOJobCapacity) {
		t.Fatal("global active-job limit was not enforced")
	}
	if !errors.Is(validateAISEOJobCapacity(2, maxActiveCategoryJobs, aiSEOCategorySelectionMode), errAISEOJobCapacity) {
		t.Fatal("category active-job limit was not enforced")
	}
}

func TestParseAISEOOutputAcceptsDeepSeekWrappedJSON(t *testing.T) {
	raw := "Here is the result:\n```json\n{" +
		"\"result\":{\"title\":\"FANUC servo drive\",\"metaTitle\":\"FANUC Servo Drive | VIBOCNC\",\"metaDescription\":\"Industrial automation servo drive replacement.\",\"description\":\"Verified servo drive reference.\",\"category\":\"Servo Drives\"}}\n```\nDone."
	output, err := parseAISEOOutput(raw)
	if err != nil {
		t.Fatalf("wrapped DeepSeek JSON should parse: %v", err)
	}
	if output.CorrectedName != "FANUC servo drive" || output.Category.Action != "existing" || output.Category.Name != "Servo Drives" {
		t.Fatalf("unexpected parsed output: %#v", output)
	}
}

func TestParseAISEOOutputAcceptsStringWrappedAndCaseInsensitiveJSON(t *testing.T) {
	raw := `{"OUTPUT":"prefix {\"TITLE\":\"A06B servo drive\",\"CATEGORY_NAME\":\"Servo Drives\"} suffix"}`
	output, err := parseAISEOOutput(raw)
	if err != nil {
		t.Fatalf("string-wrapped DeepSeek JSON should parse: %v", err)
	}
	if output.CorrectedName != "A06B servo drive" || output.Category.Name != "Servo Drives" {
		t.Fatalf("unexpected parsed output: %#v", output)
	}
}

func TestParseAISEOOutputTreatsCategoryNameAsExistingSelection(t *testing.T) {
	output, err := parseAISEOOutput(`{"title":"A06B servo drive","category_name":"Servo Drives"}`)
	if err != nil {
		t.Fatalf("category_name JSON should parse: %v", err)
	}
	if output.Category.Action != "existing" || output.Category.Name != "Servo Drives" {
		t.Fatalf("category_name should select an existing category: %#v", output.Category)
	}
}

func TestParseAISEOOutputAcceptsCategoryParentAndArrays(t *testing.T) {
	raw := `{"corrected_name":"A06B drive","meta_title":"A06B drive","meta_description":"Drive replacement","meta_keywords":["FANUC","servo drive"],"short_description":"Drive","description":"Drive description","category":{"action":"create","name":"Servo Drives","description":"Servo drive category","parent_name":"FANUC"}}`
	output, err := parseAISEOOutput(raw)
	if err != nil {
		t.Fatalf("category parent JSON should parse: %v", err)
	}
	if output.Category.Action != "create" || output.Category.ParentName != "FANUC" || output.MetaKeywords != "FANUC, servo drive" {
		t.Fatalf("unexpected category/keywords: %#v", output)
	}
	if _, err := json.Marshal(output); err != nil {
		t.Fatalf("parsed output should remain serializable: %v", err)
	}
}

func TestAISEOFocusMarkerAndCompletion(t *testing.T) {
	prompt := applyAISEOFocusToPrompt("Reclassify by brand parent", []string{"category"})
	scope := aiSEOScopeFromPrompt(prompt)
	if !scope["category"] || scope["all"] {
		t.Fatalf("unexpected scope: %#v", scope)
	}
	product := models.Product{Name: "Original", MetaTitle: "Original title", Description: "Original description", CategoryID: 9}
	output := completeAISEOOutput(aiSEOOutput{Category: aiSEOCategory{Action: "keep"}}, product)
	if output.CorrectedName != product.Name || output.MetaTitle != product.MetaTitle || output.Category.ID != product.CategoryID {
		t.Fatalf("completion did not preserve out-of-scope fields: %#v", output)
	}
}

func TestResolveAISEOCategoryRejectsAutomaticCreation(t *testing.T) {
	if _, err := resolveAISEOCategory(nil, 0, aiSEOCategory{Action: "create", Name: "Automation"}); err == nil {
		t.Fatal("automatic SEO classification must never create a category")
	}
}
