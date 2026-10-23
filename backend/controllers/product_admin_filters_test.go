package controllers

import (
	"strings"
	"testing"

	"fanuc-backend/models"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestApplyIndexingAndPriceFilters(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "u:p@tcp(127.0.0.1:1)/d", SkipInitializeWithVersion: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		noIndex, price string
		want           []string
		notWant        []string
	}{
		{"", "", nil, []string{"seo_noindex", "price"}},
		{"true", "", []string{"seo_noindex = true"}, []string{"price"}},
		{"false", "priced", []string{"seo_noindex = false", "price > 0"}, nil},
		{"", "inquiry", []string{"price <= 0"}, []string{"seo_noindex"}},
		{"bogus", "bogus", nil, []string{"seo_noindex", "price"}},
	}
	for _, tc := range cases {
		sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
			var out []models.Product
			return applyIndexingAndPriceFilters(tx.Model(&models.Product{}), tc.noIndex, tc.price).Select("id").Find(&out)
		})
		where := sql[strings.Index(sql, "FROM"):]
		for _, w := range tc.want {
			if !strings.Contains(where, w) {
				t.Errorf("(%q,%q): %q missing in %s", tc.noIndex, tc.price, w, where)
			}
		}
		for _, w := range tc.notWant {
			if strings.Contains(where, w) {
				t.Errorf("(%q,%q): unexpected %q in %s", tc.noIndex, tc.price, w, where)
			}
		}
	}
}

func TestSelectionOrderMirrorsAdminList(t *testing.T) {
	cases := map[[2]string]string{
		{"", ""}:                    "id ASC",
		{"created_at", "desc"}:      "created_at DESC, id DESC",
		{"price", "asc"}:            "price ASC, id ASC",
		{"name", ""}:                "name DESC, id DESC",
		{"id; DROP TABLE x", "asc"}: "id ASC",
		{"updated_at", "ASC"}:       "updated_at ASC, id ASC",
	}
	for in, want := range cases {
		if got := selectionOrder(in[0], in[1]); got != want {
			t.Errorf("selectionOrder(%q,%q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}
