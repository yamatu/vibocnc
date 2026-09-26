package routes

import (
	"testing"

	"github.com/gin-gonic/gin"
)

// Credential management must exist at stable paths and stay admin-gated: a
// token can outlive the account that created it, so an editor must not be able
// to mint one.
func TestIntegrationTokenRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetupRoutes(engine)

	wanted := map[string]bool{
		"GET /api/v1/admin/integration-tokens":             false,
		"POST /api/v1/admin/integration-tokens":            false,
		"PATCH /api/v1/admin/integration-tokens/:id":       false,
		"POST /api/v1/admin/integration-tokens/:id/revoke": false,
		"DELETE /api/v1/admin/integration-tokens/:id":      false,
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
