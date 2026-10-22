package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// DeepSeek Search API: https://api-docs.deepseek.com/zh-cn/guides/search
const (
	deepSeekSearchEndpoint        = "https://api.deepseek.com/v1/tools/search"
	deepSeekSearchTimeout         = 20 * time.Second
	deepSeekSearchResultCount     = 8
	deepSeekOfficialResultCount   = 5
	deepSeekSearchMaxResults      = 10
	deepSeekSearchQueryMaxRunes   = 128
	deepSeekSearchMaxBodyBytes    = 4 << 20
	deepSeekPageContentResults    = 4
	deepSeekPageContentMaxRunes   = 20000
	deepSeekSnippetMaxRunes       = 900
	deepSeekFailureLogIntervalSec = 60
)

// DeepSeekSearchKeyProvider returns the DeepSeek API key used for web search,
// or false when no AI profile has DeepSeek web search enabled.
type DeepSeekSearchKeyProvider func(ctx context.Context) (string, bool)

var deepSeekSearchKeyProvider atomic.Pointer[DeepSeekSearchKeyProvider]

// Overridden by tests: the production client refuses loopback addresses.
var (
	deepSeekSearchURL    = deepSeekSearchEndpoint
	deepSeekSearchClient = func() *http.Client { return NewPublicHTTPClient(deepSeekSearchTimeout) }
)

var deepSeekSearchLastFailureLog atomic.Int64

func SetDeepSeekSearchKeyProvider(provider DeepSeekSearchKeyProvider) {
	if provider == nil {
		deepSeekSearchKeyProvider.Store(nil)
		return
	}
	deepSeekSearchKeyProvider.Store(&provider)
}

func deepSeekSearchKey(ctx context.Context) (string, bool) {
	provider := deepSeekSearchKeyProvider.Load()
	if provider == nil || *provider == nil {
		return "", false
	}
	key, ok := (*provider)(ctx)
	key = strings.TrimSpace(key)
	return key, ok && key != ""
}

type deepSeekSearchRequest struct {
	Query       string `json:"query"`
	Count       int    `json:"count"`
	OriQuestion string `json:"ori_question,omitempty"`
	NeedContent bool   `json:"need_content"`
}

type deepSeekSearchResult struct {
	RerankScore float64 `json:"rerank_score"`
	Title       string  `json:"title"`
	URL         string  `json:"url"`
	Snippet     string  `json:"snippet"`
	Summary     string  `json:"summary"`
	Content     string  `json:"content"`
	SiteName    *string `json:"site_name"`
	Authority   int     `json:"authority"`
}

type deepSeekSearchResponse struct {
	Results []deepSeekSearchResult `json:"results"`
}

type DeepSeekSearchError struct {
	StatusCode int
	Message    string
}

func (e *DeepSeekSearchError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("DeepSeek search returned HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("DeepSeek search returned HTTP %d: %s", e.StatusCode, e.Message)
}

// searchDeepSeekProductEvidence runs the generic product query and, when the
// brand has a known manufacturer domain, a site-restricted query in parallel.
// An empty result with a nil error means the search worked but found nothing.
func searchDeepSeekProductEvidence(ctx context.Context, apiKey, brand, model string) ([]ProductWebEvidence, error) {
	requests := deepSeekProductSearchRequests(brand, model)
	searchCtx, cancel := context.WithTimeout(ctx, deepSeekSearchTimeout)
	defer cancel()

	type outcome struct {
		results []deepSeekSearchResult
		err     error
	}
	outcomes := make([]outcome, len(requests))
	var wg sync.WaitGroup
	for index, request := range requests {
		wg.Add(1)
		go func(index int, request deepSeekSearchRequest) {
			defer wg.Done()
			results, err := requestDeepSeekSearch(searchCtx, apiKey, request)
			outcomes[index] = outcome{results: results, err: err}
		}(index, request)
	}
	wg.Wait()

	all := make([]deepSeekSearchResult, 0, deepSeekSearchResultCount+deepSeekOfficialResultCount)
	var firstErr error
	for _, item := range outcomes {
		if item.err != nil {
			if firstErr == nil {
				firstErr = item.err
			}
			continue
		}
		all = append(all, item.results...)
	}
	// Sort before de-duplicating so the copy with the best score survives.
	sort.SliceStable(all, func(i, j int) bool { return all[i].RerankScore > all[j].RerankScore })
	merged := make([]deepSeekSearchResult, 0, len(all))
	seen := map[string]bool{}
	for _, result := range all {
		key := strings.TrimRight(strings.ToLower(strings.TrimSpace(result.URL)), "/")
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		merged = append(merged, result)
	}
	if len(merged) == 0 {
		return nil, firstErr
	}
	if len(merged) > deepSeekSearchMaxResults {
		merged = merged[:deepSeekSearchMaxResults]
	}
	return deepSeekResultsToEvidence(merged), nil
}

func deepSeekProductSearchRequests(brand, model string) []deepSeekSearchRequest {
	brand = strings.TrimSpace(brand)
	model = strings.TrimSpace(model)
	query := fmt.Sprintf("%q %s", model, brand)
	question := fmt.Sprintf("What is the %s %s? Product type, specifications and datasheet.", brand, model)
	if brand == "" {
		query = fmt.Sprintf("%q industrial automation part", model)
		question = fmt.Sprintf("What is the %s industrial automation part? Product type, specifications and datasheet.", model)
	}
	requests := []deepSeekSearchRequest{{
		Query:       deepSeekClampQuery(query),
		Count:       deepSeekSearchResultCount,
		OriQuestion: deepSeekClampQuery(NormalizeWhitespaceCopy(question)),
		NeedContent: true,
	}}
	if domain := manufacturerDomain(brand); domain != "" {
		requests = append(requests, deepSeekSearchRequest{
			Query:       deepSeekClampQuery(fmt.Sprintf("%q site:%s", model, domain)),
			Count:       deepSeekOfficialResultCount,
			NeedContent: true,
		})
	}
	return requests
}

func deepSeekClampQuery(value string) string {
	return strings.TrimSpace(limitRuneCount(strings.TrimSpace(value), deepSeekSearchQueryMaxRunes))
}

func requestDeepSeekSearch(ctx context.Context, apiKey string, request deepSeekSearchRequest) ([]deepSeekSearchResult, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, deepSeekSearchURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := deepSeekSearchClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("DeepSeek search request failed: %w", err)
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, deepSeekSearchMaxBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("DeepSeek search response could not be read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var failure struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(payload, &failure)
		return nil, &DeepSeekSearchError{StatusCode: resp.StatusCode, Message: limitRuneCount(strings.TrimSpace(failure.Error.Message), 200)}
	}
	var decoded deepSeekSearchResponse
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, fmt.Errorf("DeepSeek search returned invalid JSON: %w", err)
	}
	return decoded.Results, nil
}

func deepSeekResultsToEvidence(results []deepSeekSearchResult) []ProductWebEvidence {
	evidence := make([]ProductWebEvidence, 0, len(results))
	withContent := 0
	for _, result := range results {
		parsed, ok := parseDeepSeekResultURL(result.URL)
		if !ok {
			continue
		}
		snippet := NormalizeWhitespaceCopy(result.Summary)
		if snippet == "" {
			snippet = NormalizeWhitespaceCopy(result.Snippet)
		}
		content := NormalizeWhitespaceCopy(result.Content)
		if snippet == "" {
			snippet = content
		}
		title := NormalizeWhitespaceCopy(result.Title)
		if title == "" && result.SiteName != nil {
			title = NormalizeWhitespaceCopy(*result.SiteName)
		}
		if title == "" {
			title = parsed.Hostname()
		}
		item := ProductWebEvidence{
			Title:   limitRuneCount(title, 300),
			URL:     limitLen(parsed.String(), 1000),
			Snippet: limitRuneCount(snippet, deepSeekSnippetMaxRunes),
		}
		item.SourceType, item.EvidenceLevel = classifyEvidenceSource(item.URL, false)
		// Page bodies are capped and kept only for the top results because the
		// search cache holds every result for 15 minutes.
		if content != "" && withContent < deepSeekPageContentResults {
			item.PageContent = limitRuneCount(content, deepSeekPageContentMaxRunes)
			withContent++
		}
		evidence = append(evidence, item)
	}
	return evidence
}

// Result URLs are only cited, never fetched here; any later fetch still goes
// through the SSRF-safe client, so a syntax check is enough.
func parseDeepSeekResultURL(raw string) (*url.URL, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, false
	}
	return parsed, true
}

// deepSeekManufacturerEvidence turns manufacturer pages whose returned body
// names the exact model into verified manufacturer evidence without a second
// fetch; manufacturer pages without a body are fetched the usual way.
func deepSeekManufacturerEvidence(ctx context.Context, results []ProductWebEvidence, model string) []ProductWebEvidence {
	verified := make([]ProductWebEvidence, 0, 3)
	needsFetch := make([]ProductWebEvidence, 0, len(results))
	for _, result := range results {
		if result.EvidenceLevel != "manufacturer" {
			continue
		}
		if result.PageContent == "" {
			needsFetch = append(needsFetch, result)
			continue
		}
		if len(verified) >= 3 || !containsExactProductIdentifier(result.PageContent, model) {
			continue
		}
		verified = append(verified, ProductWebEvidence{
			Title:         result.Title,
			URL:           result.URL,
			Snippet:       modelCentredWindow(result.PageContent, model),
			SourceType:    "manufacturer",
			EvidenceLevel: "manufacturer",
		})
	}
	if len(needsFetch) > 0 && len(verified) < 3 {
		fetchCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		fetched := fetchManufacturerPageEvidence(fetchCtx, needsFetch, model)
		if room := 3 - len(verified); len(fetched) > room {
			fetched = fetched[:room]
		}
		verified = append(verified, fetched...)
	}
	return verified
}

func logDeepSeekSearchFailure(err error) {
	if err == nil || errors.Is(err, context.Canceled) {
		return
	}
	now := time.Now().Unix()
	last := deepSeekSearchLastFailureLog.Load()
	if now-last < deepSeekFailureLogIntervalSec || !deepSeekSearchLastFailureLog.CompareAndSwap(last, now) {
		return
	}
	log.Printf("DeepSeek web search unavailable, falling back to public search pages: %v", err)
}
