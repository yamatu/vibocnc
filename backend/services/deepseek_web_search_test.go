package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func withDeepSeekSearchServer(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	previousURL, previousClient := deepSeekSearchURL, deepSeekSearchClient
	deepSeekSearchURL = server.URL + "/v1/tools/search"
	deepSeekSearchClient = func() *http.Client { return server.Client() }
	t.Cleanup(func() {
		deepSeekSearchURL, deepSeekSearchClient = previousURL, previousClient
		SetDeepSeekSearchKeyProvider(nil)
		server.Close()
	})
}

func TestDeepSeekSearchFeedsProductEvidence(t *testing.T) {
	const model = "A06B-6114-H105"
	var mu sync.Mutex
	var requests []deepSeekSearchRequest
	withDeepSeekSearchServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer sk-test" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected request: %s auth=%q type=%q", r.Method, r.Header.Get("Authorization"), r.Header.Get("Content-Type"))
		}
		var body deepSeekSearchRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		mu.Lock()
		requests = append(requests, body)
		mu.Unlock()
		if strings.Contains(body.Query, "site:fanuc.com") {
			_, _ = w.Write([]byte(`{"results":[{"rerank_score":2.8,"title":"FANUC servo amplifier","url":"https://www.fanuc.com/products/a06b-6114-h105","summary":"Official page.","content":"Product A06B-6114-H105 servo amplifier. Rated voltage 200 V. Rated current 40 A.","authority":4}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"results":[
			{"rerank_score":1.2,"title":"","site_name":"Parts Shop","url":"https://parts.example.com/a06b-6114-h105","snippet":"short","summary":"A06B-6114-H105   FANUC\nalpha i servo amplifier module","content":""},
			{"rerank_score":2.1,"title":"Datasheet","url":"https://docs.example.com/ds","summary":"","snippet":"FANUC A06B-6114-H105 datasheet","content":"x"},
			{"rerank_score":3.0,"title":"bad","url":"javascript:alert(1)","summary":"skip me"},
			{"rerank_score":0.4,"title":"dup","url":"https://www.fanuc.com/products/a06b-6114-h105/","summary":"duplicate"}
		]}`))
	})
	SetDeepSeekSearchKeyProvider(func(context.Context) (string, bool) { return " sk-test ", true })

	evidence, err := searchProductEvidenceUncached(context.Background(), "FANUC", model)
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(requests) != 2 {
		t.Fatalf("expected generic and official queries, got %+v", requests)
	}
	for _, request := range requests {
		if !request.NeedContent || request.Count < 1 || len([]rune(request.Query)) > deepSeekSearchQueryMaxRunes || !strings.Contains(request.Query, `"`+model+`"`) {
			t.Fatalf("unexpected request %+v", request)
		}
	}

	byURL := map[string][]ProductWebEvidence{}
	for _, item := range evidence {
		byURL[item.URL] = append(byURL[item.URL], item)
		if strings.HasPrefix(item.URL, "javascript:") {
			t.Fatalf("unsafe URL kept: %+v", item)
		}
	}
	official := byURL["https://www.fanuc.com/products/a06b-6114-h105"]
	if len(official) != 2 {
		t.Fatalf("expected search result plus verified manufacturer evidence, got %+v", official)
	}
	if evidence[0].EvidenceLevel != "manufacturer" {
		t.Fatalf("manufacturer evidence should rank first: %+v", evidence[0])
	}
	if official[0].PageContent == "" {
		t.Fatalf("page body should be kept for spec research: %+v", official[0])
	}
	shop := byURL["https://parts.example.com/a06b-6114-h105"]
	if len(shop) != 1 || shop[0].Title != "Parts Shop" || shop[0].Snippet != "A06B-6114-H105 FANUC alpha i servo amplifier module" {
		t.Fatalf("summary/site name mapping wrong: %+v", shop)
	}
	if ds := byURL["https://docs.example.com/ds"]; len(ds) != 1 || ds[0].Snippet != "FANUC A06B-6114-H105 datasheet" {
		t.Fatalf("snippet fallback wrong: %+v", ds)
	}
}

func TestDeepSeekSearchReportsProviderErrors(t *testing.T) {
	withDeepSeekSearchServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"error":{"message":"Insufficient Balance","type":"invalid_request_error","param":null}}`))
	})
	results, err := searchDeepSeekProductEvidence(context.Background(), "sk-test", "", "6SE7031-0EF60")
	var searchErr *DeepSeekSearchError
	if len(results) != 0 || !errors.As(err, &searchErr) || searchErr.StatusCode != http.StatusPaymentRequired || !strings.Contains(err.Error(), "Insufficient Balance") {
		t.Fatalf("expected 402 error, got results=%v err=%v", results, err)
	}
	if strings.Contains(err.Error(), "sk-test") {
		t.Fatalf("error leaked the API key: %v", err)
	}
}

func TestDeepSeekSearchKeyRequiresProvider(t *testing.T) {
	SetDeepSeekSearchKeyProvider(nil)
	if _, ok := deepSeekSearchKey(context.Background()); ok {
		t.Fatal("no provider must disable DeepSeek search")
	}
	SetDeepSeekSearchKeyProvider(func(context.Context) (string, bool) { return "  ", true })
	defer SetDeepSeekSearchKeyProvider(nil)
	if _, ok := deepSeekSearchKey(context.Background()); ok {
		t.Fatal("blank key must disable DeepSeek search")
	}
}

func TestDeepSeekQueriesStayWithinLimits(t *testing.T) {
	model := strings.Repeat("A1-", 60)
	for _, request := range deepSeekProductSearchRequests("Siemens", model) {
		if len([]rune(request.Query)) > deepSeekSearchQueryMaxRunes || len([]rune(request.OriQuestion)) > deepSeekSearchQueryMaxRunes {
			t.Fatalf("query exceeds DeepSeek limit: %+v", request)
		}
	}
	if requests := deepSeekProductSearchRequests("", "ABC-123"); len(requests) != 1 || !strings.Contains(requests[0].Query, "industrial automation") {
		t.Fatalf("brandless search should use one generic query: %+v", requests)
	}
}

func TestSpecWindowsUseProviderPageContent(t *testing.T) {
	const model = "A06B-6114-H105"
	evidence := []ProductWebEvidence{{
		Title:         "Datasheet",
		URL:           "https://unreachable.invalid/ds",
		Snippet:       "short summary",
		SourceType:    "web-page",
		EvidenceLevel: "distributor",
		PageContent:   "Menu Home. " + model + " specification: rated voltage 200 V, rated current 40 A, weight 3.5 kg.",
	}}
	enriched := EnrichEvidenceWithSpecWindows(context.Background(), evidence, model)
	if len(enriched) != 1 || !strings.Contains(enriched[0].Snippet, "40 A") {
		t.Fatalf("spec windows should come from the provider page body: %+v", enriched)
	}
}
