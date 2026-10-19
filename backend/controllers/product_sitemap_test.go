package controllers

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseSitemapPaginationRejectsInsteadOfClamping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		query      string
		page, size int
		ok         bool
	}{
		{"", 1, 1000, true},
		{"page=3&page_size=1000", 3, 1000, true},
		{"page_size=5000", 1, 5000, true},
		{"page_size=5001", 0, 0, false},
		{"page=0", 0, 0, false},
		{"page_size=abc", 0, 0, false},
	}
	for _, tc := range cases {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/api/v1/public/products/sitemap?"+tc.query, nil)
		page, size, ok := parseSitemapPagination(c)
		if ok != tc.ok || page != tc.page || size != tc.size {
			t.Errorf("%q => (%d,%d,%v), want (%d,%d,%v)", tc.query, page, size, ok, tc.page, tc.size, tc.ok)
		}
	}
}
