package middleware

import "testing"

func TestMarketIngestScopeIsStrict(t *testing.T) {
	allowed := []struct {
		method string
		path   string
	}{
		{"POST", "/api/v1/admin/ebay-market/ingest"},
		{"GET", "/api/v1/admin/ebay-market/summary"},
	}
	for _, route := range allowed {
		if !integrationTokenScopeAllows("market_ingest", route.method, route.path) {
			t.Errorf("market_ingest unexpectedly denied %s %s", route.method, route.path)
		}
	}

	denied := []struct {
		method string
		path   string
	}{
		{"POST", "/api/v1/admin/ebay-import-drafts/upload"},
		{"POST", "/api/v1/admin/ebay-market/price-sync/apply"},
		{"DELETE", "/api/v1/admin/ebay-market/quotes/1"},
		{"GET", "/api/v1/admin/products"},
		{"POST", "/api/v1/admin/integration-tokens"},
	}
	for _, route := range denied {
		if integrationTokenScopeAllows("market_ingest", route.method, route.path) {
			t.Errorf("market_ingest must deny %s %s", route.method, route.path)
		}
	}
}

func TestEbayIngestScopeAllowsDraftUploadButNotPublishing(t *testing.T) {
	allowed := []struct {
		method string
		path   string
	}{
		{"POST", "/api/v1/admin/ebay-market/ingest"},
		{"GET", "/api/v1/admin/ebay-market/summary"},
		{"POST", "/api/v1/admin/ebay-import-drafts/upload"},
	}
	for _, route := range allowed {
		if !integrationTokenScopeAllows("ebay_ingest", route.method, route.path) {
			t.Errorf("ebay_ingest unexpectedly denied %s %s", route.method, route.path)
		}
	}

	denied := []struct {
		method string
		path   string
	}{
		{"POST", "/api/v1/admin/ebay-market/price-sync/apply"},
		{"POST", "/api/v1/admin/ebay-import-drafts/12/confirm"},
		{"POST", "/api/v1/admin/ebay-import-drafts/bulk-confirm"},
		{"DELETE", "/api/v1/admin/ebay-import-drafts/12"},
		{"POST", "/api/v1/admin/products"},
	}
	for _, route := range denied {
		if integrationTokenScopeAllows("ebay_ingest", route.method, route.path) {
			t.Errorf("ebay_ingest must deny %s %s", route.method, route.path)
		}
	}
}

func TestIntegrationTokenScopeFailsClosed(t *testing.T) {
	if integrationTokenScopeAllows("future_unknown_scope", "GET", "/api/v1/admin/ebay-market/summary") {
		t.Fatal("an unknown scope must fail closed")
	}
	if integrationTokenScopeAllows("ebay_ingest", "GET", "/api/v1/admin/ebay-import-drafts/upload") {
		t.Fatal("the correct path with the wrong method must be denied")
	}
}
