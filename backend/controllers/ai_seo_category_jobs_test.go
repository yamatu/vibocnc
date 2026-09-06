package controllers

import (
	"strings"
	"testing"

	"fanuc-backend/models"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestAISEOCategoryJobOptionsRoundTrip(t *testing.T) {
	want := aiSEOCategoryJobOptions{UseWebSearch: true, CreateMissingCategories: true, ActivateResolved: false, RepairContent: true}
	prompt, err := encodeAISEOCategoryJobOptions(want)
	if err != nil {
		t.Fatalf("encode options: %v", err)
	}
	got, err := decodeAISEOCategoryJobOptions(prompt)
	if err != nil {
		t.Fatalf("decode options: %v", err)
	}
	if got != want {
		t.Fatalf("decoded options = %#v, want %#v", got, want)
	}
}

func TestSortedLimitedProductIDsDeduplicatesBeforeStableLimit(t *testing.T) {
	got := sortedLimitedProductIDs([]uint{9, 3, 9, 7, 1, 0, 3}, 3)
	want := []uint{1, 3, 7}
	if len(got) != len(want) {
		t.Fatalf("sorted IDs = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("sorted IDs = %v, want %v", got, want)
		}
	}
}

func TestValidAISEOJobLimit(t *testing.T) {
	for _, test := range []struct {
		limit int
		valid bool
	}{{-1, false}, {0, true}, {1, true}, {30000, true}, {30001, true}, {150000, true}} {
		if got := validAISEOJobLimit(test.limit); got != test.valid {
			t.Fatalf("validAISEOJobLimit(%d) = %v, want %v", test.limit, got, test.valid)
		}
	}
}

func TestFindCategoryOptimizationCandidatesHonorsExplicitStatus(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       "user:password@tcp(localhost:3306)/test?charset=utf8mb4&parseTime=True&loc=Local",
		SkipInitializeWithVersion: true,
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatalf("open dry-run database: %v", err)
	}

	querySQL := func(status string, includeInactive bool) string {
		return db.ToSQL(func(tx *gorm.DB) *gorm.DB {
			query := applyCategoryOptimizationProductStatus(tx.Model(&models.Product{}), status, includeInactive)
			return query.Limit(25).Find(&[]models.Product{})
		})
	}

	activeSQL := querySQL("active", true)
	if !strings.Contains(activeSQL, "is_active = true") {
		t.Fatalf("explicit active status must not be widened by include_inactive: %s", activeSQL)
	}
	inactiveSQL := querySQL("inactive", false)
	if !strings.Contains(inactiveSQL, "is_active = false") {
		t.Fatalf("inactive status SQL = %s", inactiveSQL)
	}
	allSQL := querySQL("all", false)
	if strings.Contains(allSQL, "is_active") {
		t.Fatalf("all status should not filter is_active: %s", allSQL)
	}
}
