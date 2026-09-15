package routes

import (
	"testing"

	"github.com/gin-gonic/gin"
)

// The model-number research endpoints live next to the /products/:id routes, and
// Gin panics when a static segment collides with an existing wildcard. This test
// fails loudly at build time instead of at first boot.
func TestSpecDraftRoutesDoNotConflictWithProductID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetupRoutes(engine)

	wanted := map[string]bool{
		"POST /api/v1/admin/products/spec-research":           false,
		"POST /api/v1/admin/products/spec-research/batch":     false,
		"POST /api/v1/admin/products/:id/spec-research":       false,
		"GET /api/v1/admin/products/spec-drafts":              false,
		"GET /api/v1/admin/products/spec-drafts/:id":          false,
		"POST /api/v1/admin/products/spec-drafts/:id/approve": false,
		"POST /api/v1/admin/products/spec-drafts/:id/reject":  false,
		// Batch and per-product research are AI jobs; the scope-filtered
		// entry point sits next to the other AI job starters.
		"POST /api/v1/admin/ai-agent/seo/spec-jobs": false,
	}
	for _, route := range engine.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := wanted[key]; ok {
			wanted[key] = true
		}
	}
	for key, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", key)
		}
	}
}
