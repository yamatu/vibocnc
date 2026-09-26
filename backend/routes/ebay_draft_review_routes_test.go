package routes

import (
	"os"
	"strings"
	"testing"
)

// Gin matches routes in registration order, so a request to
// /admin/ebay-import-drafts/ai-review/... only reaches the review handlers if
// they are registered before "/:id". A shadowed route would silently 404 or,
// worse, be handled as a draft id and return a confusing error. This test reads
// the route file because spinning up the whole router needs a database.
func TestEbayDraftReviewRoutesAreRegisteredBeforeIDParam(t *testing.T) {
	source, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("could not read routes.go: %v", err)
	}
	text := string(source)

	reviewIndex := strings.Index(text, `ebayImportDrafts.POST("/ai-review"`)
	idParamIndex := strings.Index(text, `ebayImportDrafts.GET("/:id"`)
	if reviewIndex < 0 {
		t.Fatal("the AI review start route is not registered")
	}
	if idParamIndex < 0 {
		t.Fatal("the draft GET /:id route is not registered")
	}
	if reviewIndex > idParamIndex {
		t.Fatal("AI review routes must be registered before /:id or gin will treat 'ai-review' as a draft id")
	}

	required := []string{
		`ebayImportDrafts.GET("/ai-review/summary"`,
		`ebayImportDrafts.GET("/ai-review/latest"`,
		`ebayImportDrafts.POST("/ai-review"`,
		`ebayImportDrafts.POST("/ai-review/approve"`,
		`ebayImportDrafts.POST("/ai-review/reject"`,
		`ebayImportDrafts.GET("/ai-review/:jobId"`,
		`ebayImportDrafts.POST("/ai-review/:jobId/pause"`,
		`ebayImportDrafts.POST("/ai-review/:jobId/resume"`,
		`ebayImportDrafts.POST("/ai-review/:jobId/cancel"`,
	}
	for _, route := range required {
		if !strings.Contains(text, route) {
			t.Fatalf("missing route registration: %s", route)
		}
		// Every one of them must precede the /:id catch-all.
		if strings.Index(text, route) > idParamIndex {
			t.Fatalf("route %s is registered after /:id and would be shadowed", route)
		}
	}
}
