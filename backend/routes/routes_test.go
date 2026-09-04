package routes

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSetupRoutesAcceptsCategoryImpactRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	found := false
	for _, route := range router.Routes() {
		if route.Method == "GET" && route.Path == "/api/v1/admin/categories/:id/deletion-impact" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("category deletion-impact route was not registered")
	}
}

func TestSetupRoutesRegistersProductImageAutofillRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	wanted := map[string]bool{
		"GET /api/v1/admin/products/bulk-default-image/brands":           false,
		"POST /api/v1/admin/products/bulk-default-image/jobs":            false,
		"GET /api/v1/admin/products/bulk-default-image/jobs/latest":      false,
		"POST /api/v1/admin/products/bulk-default-image/jobs/:id/pause":  false,
		"POST /api/v1/admin/products/bulk-default-image/jobs/:id/resume": false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Fatalf("product image autofill route was not registered: %s", route)
		}
	}
}

func TestSetupRoutesRegistersProductImageManagementRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	wanted := map[string]bool{
		"POST /api/v1/admin/products/image-cleanup/preview":         false,
		"GET /api/v1/admin/products/image-cleanup/settings":         false,
		"PUT /api/v1/admin/products/image-cleanup/settings":         false,
		"POST /api/v1/admin/products/image-cleanup/jobs":            false,
		"GET /api/v1/admin/products/image-cleanup/jobs/latest":      false,
		"GET /api/v1/admin/products/image-cleanup/jobs/:id":         false,
		"POST /api/v1/admin/products/image-cleanup/jobs/:id/pause":  false,
		"POST /api/v1/admin/products/image-cleanup/jobs/:id/resume": false,
		"GET /api/v1/admin/media/:id/products":                      false,
		"POST /api/v1/admin/media/sku-archive/jobs":                 false,
		"GET /api/v1/admin/media/sku-archive/jobs/latest":           false,
		"GET /api/v1/admin/media/sku-archive/jobs/:id":              false,
		"PUT /api/v1/admin/media/sku-archive/jobs/:id/chunk":        false,
		"POST /api/v1/admin/media/sku-archive/jobs/:id/complete":    false,
		"POST /api/v1/admin/media/sku-archive/jobs/:id/pause":       false,
		"POST /api/v1/admin/media/sku-archive/jobs/:id/resume":      false,
		"DELETE /api/v1/admin/media/sku-archive/jobs/:id":           false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Fatalf("product image management route was not registered: %s", route)
		}
	}
}

func TestSetupRoutesRegistersResumableEbayJSONImportRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	wanted := map[string]bool{
		"POST /api/v1/admin/ebay-import-drafts/json-import/tasks":                  false,
		"GET /api/v1/admin/ebay-import-drafts/json-import/tasks/latest":            false,
		"GET /api/v1/admin/ebay-import-drafts/json-import/tasks/:taskId":           false,
		"PUT /api/v1/admin/ebay-import-drafts/json-import/tasks/:taskId/chunk":     false,
		"POST /api/v1/admin/ebay-import-drafts/json-import/tasks/:taskId/chunk":    false,
		"POST /api/v1/admin/ebay-import-drafts/json-import/tasks/:taskId/complete": false,
		"POST /api/v1/admin/ebay-import-drafts/json-import/tasks/:taskId/pause":    false,
		"POST /api/v1/admin/ebay-import-drafts/json-import/tasks/:taskId/resume":   false,
		"DELETE /api/v1/admin/ebay-import-drafts/json-import/tasks/:taskId":        false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Fatalf("resumable eBay JSON import route was not registered: %s", route)
		}
	}
}

func TestSetupRoutesRegistersProductCatalogTransferRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	wanted := map[string]bool{
		"GET /api/v1/admin/backup/products/export":                    false,
		"POST /api/v1/admin/backup/products/import/jobs":              false,
		"PUT /api/v1/admin/backup/products/import/jobs/:id/chunk":     false,
		"POST /api/v1/admin/backup/products/import/jobs/:id/complete": false,
		"GET /api/v1/admin/backup/products/import/jobs/:id":           false,
		"GET /api/v1/admin/backup/products/import/jobs/:id/preview":   false,
		"POST /api/v1/admin/backup/products/import/jobs/:id/apply":    false,
		"POST /api/v1/admin/backup/products/import/jobs/:id/pause":    false,
		"POST /api/v1/admin/backup/products/import/jobs/:id/resume":   false,
		"DELETE /api/v1/admin/backup/products/import/jobs/:id":        false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Fatalf("product catalog transfer route was not registered: %s", route)
		}
	}
}
