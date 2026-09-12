package services

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
)

var productIdentifierTokenPattern = regexp.MustCompile(`[A-Z0-9]+`)

const (
	productWebSearchMaxConcurrent = 4
	productWebSearchSuccessTTL    = 15 * time.Minute
	productWebSearchFailureTTL    = 45 * time.Second
	productWebSearchPruneAt       = 256
	productWebSearchMaxCacheSize  = 2048
)

// ProductWebEvidence is intentionally small and reviewable. Search results are
// evidence for classification only; they are never copied into public product
// content without a separate AI/admin decision.
type ProductWebEvidence struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
	// SourceType distinguishes manufacturer pages from distributor pages and
	// search-engine summaries so callers can require stronger evidence.
	SourceType    string `json:"source_type,omitempty"`
	EvidenceLevel string `json:"evidence_level,omitempty"`
}

type productWebSearchCacheEntry struct {
	results   []ProductWebEvidence
	err       error
	expiresAt time.Time
}

type productWebSearchCall struct {
	done    chan struct{}
	results []ProductWebEvidence
	err     error
}

type productWebSearchRunner func(context.Context, string, string) ([]ProductWebEvidence, error)

type productEvidenceEndpoint struct {
	URL             string
	SiemensOfficial bool
}

// productWebSearchManager keeps public-search traffic bounded across all
// imports and background jobs in this process. It also coalesces identical
// lookups so a batch containing the same part number does not fan out into
// duplicate provider requests.
type productWebSearchManager struct {
	mu         sync.Mutex
	cache      map[string]productWebSearchCacheEntry
	inflight   map[string]*productWebSearchCall
	semaphore  chan struct{}
	successTTL time.Duration
	failureTTL time.Duration
	now        func() time.Time
	runner     productWebSearchRunner
}

func newProductWebSearchManager(maxConcurrent int, successTTL, failureTTL time.Duration, runner productWebSearchRunner) *productWebSearchManager {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	if runner == nil {
		runner = searchProductEvidenceUncached
	}
	return &productWebSearchManager{
		cache:      make(map[string]productWebSearchCacheEntry),
		inflight:   make(map[string]*productWebSearchCall),
		semaphore:  make(chan struct{}, maxConcurrent),
		successTTL: successTTL,
		failureTTL: failureTTL,
		now:        time.Now,
		runner:     runner,
	}
}

var defaultProductWebSearchManager = newProductWebSearchManager(
	productWebSearchMaxConcurrent,
	productWebSearchSuccessTTL,
	productWebSearchFailureTTL,
	searchProductEvidenceUncached,
)

// ResolveProductCategoryWithWebEvidence first uses deterministic local model
// rules and only performs a bounded public search when those rules cannot
// verify the product identity. The evidence is returned separately so callers
// can record it for review without copying untrusted search text into product
// content.
func ResolveProductCategoryWithWebEvidence(ctx context.Context, brand, model string) (ProductCategoryInference, []ProductWebEvidence, error) {
	model = strings.TrimSpace(NormalizeProductModel(model))
	inference := InferProductCategory(brand, model)
	if IsConfirmedProductCategory(inference, model) {
		return inference, nil, nil
	}
	evidence, err := SearchProductEvidence(ctx, brand, model)
	if err != nil {
		return inference, nil, err
	}
	return InferProductCategoryFromEvidence(brand, model, ProductWebEvidenceText(evidence)), evidence, nil
}

// SearchProductEvidence performs one bounded public search when the local model
// rules cannot identify a product. It has no credentials and uses the existing
// SSRF-safe HTTP client, so a product model cannot make the server call private
// network addresses.
func SearchProductEvidence(ctx context.Context, brand, model string) ([]ProductWebEvidence, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	model = strings.TrimSpace(NormalizeProductModel(model))
	if model == "" {
		return nil, fmt.Errorf("model is required for web search")
	}
	brand = strings.TrimSpace(CanonicalBrandName(brand))
	return defaultProductWebSearchManager.search(ctx, brand, model)
}

func (manager *productWebSearchManager) search(ctx context.Context, brand, model string) ([]ProductWebEvidence, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	model = strings.TrimSpace(NormalizeProductModel(model))
	if model == "" {
		return nil, fmt.Errorf("model is required for web search")
	}
	brand = strings.TrimSpace(CanonicalBrandName(brand))
	cacheKey := strings.ToLower(brand) + "\x00" + model
	now := manager.now()

	manager.mu.Lock()
	if len(manager.cache) >= productWebSearchPruneAt {
		manager.pruneExpiredCacheLocked(now)
	}
	if cached, ok := manager.cache[cacheKey]; ok {
		if now.Before(cached.expiresAt) {
			manager.mu.Unlock()
			return cloneProductWebEvidence(cached.results), cached.err
		}
		delete(manager.cache, cacheKey)
	}
	if call, ok := manager.inflight[cacheKey]; ok {
		manager.mu.Unlock()
		select {
		case <-call.done:
			return cloneProductWebEvidence(call.results), call.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	call := &productWebSearchCall{done: make(chan struct{})}
	manager.inflight[cacheKey] = call
	manager.mu.Unlock()

	if err := ctx.Err(); err != nil {
		call.err = err
	} else {
		select {
		case manager.semaphore <- struct{}{}:
			call.results, call.err = manager.runner(ctx, brand, model)
			<-manager.semaphore
		case <-ctx.Done():
			call.err = ctx.Err()
		}
	}

	manager.mu.Lock()
	delete(manager.inflight, cacheKey)
	// Do not let one canceled caller poison later attempts. Provider failures,
	// including the manager's bounded search timeout, are cached briefly to
	// prevent a large import from repeatedly hammering an unavailable service.
	if ctx.Err() == nil {
		ttl := manager.successTTL
		if call.err != nil {
			ttl = manager.failureTTL
		}
		if ttl > 0 {
			manager.makeCacheSpaceLocked(manager.now())
			manager.cache[cacheKey] = productWebSearchCacheEntry{
				results:   cloneProductWebEvidence(call.results),
				err:       call.err,
				expiresAt: manager.now().Add(ttl),
			}
		}
	}
	close(call.done)
	manager.mu.Unlock()

	return cloneProductWebEvidence(call.results), call.err
}

func (manager *productWebSearchManager) pruneExpiredCacheLocked(now time.Time) {
	for key, cached := range manager.cache {
		if !now.Before(cached.expiresAt) {
			delete(manager.cache, key)
		}
	}
}

func (manager *productWebSearchManager) makeCacheSpaceLocked(now time.Time) {
	if len(manager.cache) < productWebSearchMaxCacheSize {
		return
	}
	manager.pruneExpiredCacheLocked(now)
	if len(manager.cache) < productWebSearchMaxCacheSize {
		return
	}

	// This cache is deliberately small and dependency-free. When it is full,
	// discard the entry due to expire first; frequently refreshed lookups then
	// naturally stay resident without needing a heavier LRU implementation.
	var oldestKey string
	var oldestExpiry time.Time
	for key, cached := range manager.cache {
		if oldestKey == "" || cached.expiresAt.Before(oldestExpiry) {
			oldestKey = key
			oldestExpiry = cached.expiresAt
		}
	}
	if oldestKey != "" {
		delete(manager.cache, oldestKey)
	}
}

func cloneProductWebEvidence(results []ProductWebEvidence) []ProductWebEvidence {
	if results == nil {
		return nil
	}
	cloned := make([]ProductWebEvidence, len(results))
	copy(cloned, results)
	return cloned
}

func searchProductEvidenceUncached(ctx context.Context, brand, model string) ([]ProductWebEvidence, error) {
	endpoints := productEvidenceEndpoints(brand, model)

	searchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var lastErr error
	allResults := make([]ProductWebEvidence, 0, 12)
	seen := map[string]bool{}
	for _, endpoint := range endpoints {
		parsed, err := validatePublicHTTPURL(endpoint.URL)
		if err != nil {
			lastErr = err
			continue
		}
		req, err := http.NewRequestWithContext(searchCtx, http.MethodGet, parsed.String(), nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; VIBOCNCBot/1.0; +https://vibocnc.com)")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")
		var resp *http.Response
		for attempt := 0; attempt < 3; attempt++ {
			resp, err = NewPublicHTTPClient(9 * time.Second).Do(req)
			if err == nil && resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < 500 {
				break
			}
			if resp != nil {
				resp.Body.Close()
			}
			if attempt < 2 {
				select {
				case <-time.After(time.Duration(150*(1<<attempt)) * time.Millisecond):
				case <-searchCtx.Done():
					break
				}
			}
		}
		if resp == nil || resp.StatusCode < 200 || resp.StatusCode >= 400 {
			if resp != nil {
				resp.Body.Close()
			}
			lastErr = fmt.Errorf("search provider unavailable")
			continue
		}
		if err != nil {
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 400 {
			lastErr = fmt.Errorf("search provider returned HTTP %d", resp.StatusCode)
			continue
		}
		var results []ProductWebEvidence
		if endpoint.SiemensOfficial {
			results = parseSiemensOfficialProductEvidence(string(body), endpoint.URL, model)
		} else {
			results = parseProductWebEvidence(string(body), endpoint.URL)
		}
		for i := range results {
			results[i].SourceType, results[i].EvidenceLevel = classifyEvidenceSource(results[i].URL, endpoint.SiemensOfficial)
			key := strings.ToLower(strings.TrimSpace(results[i].URL + "|" + results[i].Title + "|" + results[i].Snippet))
			if key != "" && !seen[key] {
				seen[key] = true
				allResults = append(allResults, results[i])
			}
		}
		lastErr = fmt.Errorf("search provider returned no usable product results")
	}
	if len(allResults) > 0 {
		allResults = append(allResults, fetchManufacturerPageEvidence(searchCtx, allResults, model)...)
		return rankProductEvidence(allResults), nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no product search results")
	}
	return nil, lastErr
}

func fetchManufacturerPageEvidence(ctx context.Context, results []ProductWebEvidence, model string) []ProductWebEvidence {
	seen := map[string]bool{}
	for _, result := range results {
		seen[result.URL] = true
	}
	verified := make([]ProductWebEvidence, 0, 3)
	for _, result := range results {
		if (result.SourceType != "search-result" && result.SourceType != "manufacturer") || result.URL == "" || len(verified) >= 3 {
			continue
		}
		parsed, err := validatePublicHTTPURL(result.URL)
		if err != nil {
			continue
		}
		if _, level := classifyEvidenceSource(parsed.String(), false); level != "manufacturer" {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
		if err != nil {
			continue
		}
		resp, err := NewPublicHTTPClient(6 * time.Second).Do(req)
		if err != nil {
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if readErr != nil || resp.StatusCode < 200 || resp.StatusCode >= 400 {
			continue
		}
		text := strings.Join(strings.Fields(string(body)), " ")
		if !containsExactProductIdentifier(text, model) {
			continue
		}
		if seen[parsed.String()+"#manufacturer"] {
			continue
		}
		seen[parsed.String()+"#manufacturer"] = true
		verified = append(verified, ProductWebEvidence{Title: result.Title, URL: parsed.String(), Snippet: limitLen(text, 700), SourceType: "manufacturer", EvidenceLevel: "manufacturer"})
	}
	return verified
}

func classifyEvidenceSource(rawURL string, official bool) (string, string) {
	if official {
		return "manufacturer", "manufacturer"
	}
	lower := strings.ToLower(rawURL)
	for _, marker := range []string{"fanuc.com", "abb.com", "siemens.com", "rockwellautomation.com", "mitsubishielectric.com", "omron.com", "sick.com", "tamagawa-seiki.com", "fluke.com"} {
		if strings.Contains(lower, marker) {
			return "manufacturer", "manufacturer"
		}
	}
	for _, marker := range []string{"duckduckgo.com", "bing.com", "google.com"} {
		if strings.Contains(lower, marker) {
			return "search-result", "search-result"
		}
	}
	for _, marker := range []string{"distributor", "automation24", "radwell", "galco", "ebay", "amazon"} {
		if strings.Contains(lower, marker) {
			return "distributor", "distributor"
		}
	}
	return "web-page", "distributor"
}

func rankProductEvidence(results []ProductWebEvidence) []ProductWebEvidence {
	weight := map[string]int{"manufacturer": 3, "distributor": 2, "search-result": 1}
	sort.SliceStable(results, func(i, j int) bool { return weight[results[i].EvidenceLevel] > weight[results[j].EvidenceLevel] })
	return results
}

func productEvidenceEndpoints(brand, model string) []productEvidenceEndpoint {
	query := fmt.Sprintf("\"%s\" %s industrial automation", model, brand)
	if brand == "" {
		query = fmt.Sprintf("\"%s\" industrial automation part", model)
	}
	endpoints := make([]productEvidenceEndpoint, 0, 6)
	compact := compactProductIdentifier(model)
	if NormalizeBrandKey(brand) == "siemens" || strings.HasPrefix(compact, "6SE") {
		// Siemens Industry Mall accepts the market-facing article number without
		// punctuation in the product URL. Query it before public search engines so
		// discontinued/spare-part pages remain discoverable even when they rank
		// poorly in general web search.
		if compact != "" {
			endpoints = append(endpoints, productEvidenceEndpoint{
				URL:             "https://mall.industry.siemens.com/mall/en/ww/Catalog/Product/" + url.PathEscape(compact),
				SiemensOfficial: true,
			})
		}
		officialQuery := fmt.Sprintf("(\"%s\" OR \"%s\") Siemens (site:mall.industry.siemens.com OR site:support.industry.siemens.com)", model, compact)
		endpoints = append(endpoints,
			productEvidenceEndpoint{URL: "https://html.duckduckgo.com/html/?q=" + url.QueryEscape(officialQuery)},
			productEvidenceEndpoint{URL: "https://www.bing.com/search?q=" + url.QueryEscape(officialQuery)},
		)
	}
	if domain := manufacturerDomain(brand); domain != "" {
		officialQuery := fmt.Sprintf("\"%s\" site:%s", model, domain)
		endpoints = append(endpoints, productEvidenceEndpoint{URL: "https://www.bing.com/search?q=" + url.QueryEscape(officialQuery)})
	}
	endpoints = append(endpoints,
		productEvidenceEndpoint{URL: "https://html.duckduckgo.com/html/?q=" + url.QueryEscape(query)},
		productEvidenceEndpoint{URL: "https://www.bing.com/search?q=" + url.QueryEscape(query)},
	)
	return endpoints
}

func manufacturerDomain(brand string) string {
	switch NormalizeBrandKey(brand) {
	case "fanuc":
		return "fanuc.com"
	case "abb":
		return "abb.com"
	case "siemens":
		return "siemens.com"
	case "allen-bradley":
		return "rockwellautomation.com"
	case "mitsubishi":
		return "mitsubishielectric.com"
	case "omron":
		return "omron.com"
	case "sick":
		return "sick.com"
	case "fluke":
		return "fluke.com"
	default:
		return ""
	}
}

func parseSiemensOfficialProductEvidence(html, sourceURL, model string) []ProductWebEvidence {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	bodyText := strings.Join(strings.Fields(doc.Find("body").Text()), " ")
	if !containsExactProductIdentifier(bodyText, model) {
		return nil
	}
	title := strings.TrimSpace(doc.Find("title").First().Text())
	if title == "" {
		title = "Siemens Industry Mall"
	} else if !strings.Contains(strings.ToLower(title), "siemens") {
		title = "Siemens Industry Mall - " + title
	}
	description, _ := doc.Find(`meta[name="description"]`).First().Attr("content")
	description = strings.Join(strings.Fields(description), " ")
	if !containsExactProductIdentifier(description, model) {
		description = model + " - " + limitLen(bodyText, 640)
	}
	return []ProductWebEvidence{{
		Title:   limitLen(title, 300),
		URL:     limitLen(sourceURL, 1000),
		Snippet: limitLen(description, 700),
	}}
}

func parseProductWebEvidence(html, sourceURL string) []ProductWebEvidence {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	results := make([]ProductWebEvidence, 0, 5)
	seen := map[string]bool{}
	selectors := []string{".result", "li.b_algo"}
	for _, selector := range selectors {
		doc.Find(selector).EachWithBreak(func(_ int, item *goquery.Selection) bool {
			if len(results) >= 5 {
				return false
			}
			link := item.Find("a.result__a, h2 a").First()
			title := strings.TrimSpace(link.Text())
			href, _ := link.Attr("href")
			snippet := strings.TrimSpace(item.Find(".result__snippet, .b_caption p").First().Text())
			if title == "" {
				title = strings.TrimSpace(item.Text())
			}
			if href == "" {
				href = sourceURL
			}
			key := strings.ToLower(strings.TrimSpace(title + "|" + href))
			if key == "" || seen[key] {
				return true
			}
			seen[key] = true
			results = append(results, ProductWebEvidence{Title: limitLen(title, 300), URL: limitLen(href, 1000), Snippet: limitLen(snippet, 700)})
			return true
		})
		if len(results) >= 5 {
			break
		}
	}
	return results
}

func ProductWebEvidenceText(results []ProductWebEvidence) string {
	parts := make([]string, 0, len(results))
	for _, result := range results {
		text := strings.TrimSpace(strings.Join([]string{result.Title, result.Snippet}, " - "))
		if text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}

// InferProductCategoryFromEvidence upgrades a local fallback only when the
// search text contains a recognizable brand/type signal. It never turns a bare
// search hit into a publishable category by itself.
func InferProductCategoryFromEvidence(brand, model, evidence string) ProductCategoryInference {
	base := InferProductCategory(brand, model)
	if IsConfirmedProductCategory(base, model) {
		return base
	}
	// Search engines often place several similar products on one page. Only
	// trust result lines that contain the complete requested identifier. A bare
	// substring (for example X12 inside X123) is not sufficient evidence.
	matchedEvidence := evidenceLinesContainingModel(evidence, model)
	if matchedEvidence == "" {
		return base
	}
	brandKey := NormalizeBrandKey(brand)
	if brandKey == "" || brandKey == "unknown" {
		brandKey = inferBrandKeyFromEvidence(matchedEvidence)
	}
	if brandKey == "" || brandKey == "unknown" || !evidenceContainsBrand(matchedEvidence, brandKey) {
		// The same exact-model result must mention the brand. This applies even
		// when the upload supplied a known brand: imported brand fields can be
		// stale or wrong, and a search hit for a bare model is not verification.
		return base
	}
	combined := strings.TrimSpace(strings.Join([]string{model, matchedEvidence}, " "))
	var inferred ProductCategoryInference
	if brandKey == "fanuc" {
		// Keep the model classifier focused on the requested identifier. Feeding
		// arbitrary search prose into FANUC prefix rules can turn the word
		// "FANUC" itself into a false fan/cooling signal.
		inferred = inferFanucCategoryInference(model)
		if strings.Contains(strings.ToLower(inferred.MatchRule), "fallback") || strings.Contains(strings.ToLower(inferred.MatchRule), "keyword") {
			inferred = inferGenericCategoryInference(brandKey, combined)
			inferred.BrandKey = "fanuc"
			inferred.BrandName = "FANUC"
			inferred.CategorySlug = fanucCategorySlugForPartType(inferred.PartType)
		}
	} else {
		inferred = inferGenericCategoryInference(brandKey, combined)
	}
	if !strings.Contains(strings.ToLower(inferred.MatchRule), "fallback") && !strings.Contains(strings.ToLower(inferred.MatchRule), "empty-model") {
		inferred.MatchRule = "web:" + inferred.MatchRule
		return inferred
	}
	return base
}

func evidenceLinesContainingModel(evidence, model string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	lines := strings.FieldsFunc(evidence, func(r rune) bool { return r == '\n' || r == '\r' })
	matched := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" && containsExactProductIdentifier(line, model) {
			matched = append(matched, line)
		}
	}
	return strings.Join(matched, "\n")
}

func containsExactProductIdentifier(text, model string) bool {
	target := compactProductIdentifier(model)
	if target == "" {
		return false
	}
	upperText := strings.ToUpper(text)
	indices := productIdentifierTokenPattern.FindAllStringIndex(upperText, -1)
	tokens := make([]string, 0, len(indices))
	for _, index := range indices {
		tokens = append(tokens, upperText[index[0]:index[1]])
	}
	for start := range tokens {
		combined := ""
		for end := start; end < len(tokens) && len(combined) <= len(target); end++ {
			combined += tokens[end]
			if combined == target {
				// A model that is only a prefix of an option-coded identifier is
				// ambiguous. Treat a following `-`/`#` component as part of that
				// identifier rather than accepting a neighboring variant.
				if end+1 < len(indices) {
					separator := upperText[indices[end][1]:indices[end+1][0]]
					if len(separator) > 0 && (separator[0] == '-' || separator[0] == '#') {
						break
					}
				}
				return true
			}
			if len(combined) >= len(target) {
				break
			}
		}
	}
	return false
}

func compactProductIdentifier(value string) string {
	tokens := productIdentifierTokenPattern.FindAllString(strings.ToUpper(value), -1)
	return strings.Join(tokens, "")
}

func isRecognizedBrandKey(key string) bool {
	return isClassificationBrandAllowed(NormalizeBrandKey(key), "local:recognized-brand") || NormalizeBrandKey(key) == "huawei"
}

func evidenceContainsBrand(evidence, brandKey string) bool {
	text := strings.ToLower(evidence)
	aliases := map[string][]string{
		"fanuc":         {"fanuc"},
		"abb":           {"abb"},
		"allen-bradley": {"allen-bradley", "allen bradley", "rockwell", "ab"},
		"siemens":       {"siemens", "simatic"},
		"mitsubishi":    {"mitsubishi", "melsec"},
		"omron":         {"omron"},
		"sick":          {"sick"},
		"tamagawa":      {"tamagawa"},
		"fluke":         {"fluke"},
		"huawei":        {"huawei"},
	}
	values := aliases[NormalizeBrandKey(brandKey)]
	if len(values) == 0 {
		values = []string{strings.ToLower(strings.TrimSpace(brandKey))}
	}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len([]rune(value)) <= 3 {
			for _, token := range strings.FieldsFunc(text, func(r rune) bool {
				return r < 'a' || r > 'z'
			}) {
				if token == value {
					return true
				}
			}
			continue
		}
		valueNorm := taxonomyNormalize(value)
		textNorm := taxonomyNormalize(text)
		if valueNorm != "" && (textNorm == valueNorm || strings.Contains(" "+textNorm+" ", " "+valueNorm+" ")) {
			return true
		}
	}
	return false
}

func fanucCategorySlugForPartType(partType string) string {
	return inferFanucCategorySlugFromPartType(partType)
}

func inferBrandKeyFromEvidence(evidence string) string {
	text := strings.ToLower(evidence)
	brands := []struct {
		key    string
		values []string
	}{
		{key: "fanuc", values: []string{"fanuc"}},
		{key: "abb", values: []string{"abb", "acs800", "ach"}},
		{key: "allen-bradley", values: []string{"allen-bradley", "allen bradley", "rockwell"}},
		{key: "siemens", values: []string{"siemens", "simatic"}},
		{key: "mitsubishi", values: []string{"mitsubishi", "melsec"}},
		{key: "omron", values: []string{"omron"}},
		{key: "sick", values: []string{"sick sensor intelligence", "sick ag", "sick"}},
		{key: "tamagawa", values: []string{"tamagawa seiki", "tamagawa"}},
		{key: "fluke", values: []string{"fluke"}},
	}
	for _, brand := range brands {
		for _, value := range brand.values {
			if strings.Contains(text, value) {
				return brand.key
			}
		}
	}
	return ""
}
