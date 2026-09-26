package routes

import (
	"testing"

	"github.com/gin-gonic/gin"
)

// The market-research endpoints sit under their own /admin/ebay-market group.
// Gin panics when a static segment collides with a wildcard in the same group,
// so this test fails at build time rather than at first boot.
func TestEbayMarketRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetupRoutes(engine)

	wanted := map[string]bool{
		// Crawler push + read side.
		"POST /api/v1/admin/ebay-market/ingest":       false,
		"GET /api/v1/admin/ebay-market/summary":       false,
		"GET /api/v1/admin/ebay-market/quotes":        false,
		"POST /api/v1/admin/ebay-market/quotes/clear": false,
		"GET /api/v1/admin/ebay-market/quotes/:id":    false,
		"DELETE /api/v1/admin/ebay-market/quotes/:id": false,
		// AI identification from marketplace evidence, persisted into a review
		// queue before any catalogue field may change.
		"POST /api/v1/admin/ebay-market/identify":                   false,
		"POST /api/v1/admin/ebay-market/identify/jobs":              false,
		"GET /api/v1/admin/ebay-market/profile-drafts":              false,
		"GET /api/v1/admin/ebay-market/profile-drafts/:id":          false,
		"POST /api/v1/admin/ebay-market/profile-drafts/:id/approve": false,
		"POST /api/v1/admin/ebay-market/profile-drafts/:id/reject":  false,
		// Price suggestions are previewed before they are applied.
		"POST /api/v1/admin/ebay-market/price-sync/preview": false,
		"POST /api/v1/admin/ebay-market/price-sync/apply":   false,
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
