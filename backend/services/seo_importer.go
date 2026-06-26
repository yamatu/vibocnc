package services

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// ImportedSEO holds extracted SEO/content info from a source page
type ImportedSEO struct {
	SourceURL       string                 `json:"source_url"`
	Title           string                 `json:"title"`
	MetaDescription string                 `json:"meta_description"`
	MetaKeywords    string                 `json:"meta_keywords"`
	H1              string                 `json:"h1"`
	DescriptionHTML string                 `json:"description_html"`
	ProductJSONLD   map[string]interface{} `json:"product_jsonld"`
	CategoryGuess   string                 `json:"category_guess"`
	TriedURLs       []string               `json:"tried_urls"`
}

var skuLike = regexp.MustCompile(`[A-Z]\d{2}[A-Z]-\d{4}-[A-Z]\d{3,}`)

// FindCandidateURL tries common search patterns on a given source base (e.g., https://fanucworld.com)
func ensureScheme(raw string) string {
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	return "https://" + raw
}

func baseVariants(sourceBase string) []string {
	b := strings.TrimRight(sourceBase, "/")
	b = ensureScheme(b)
	u, err := url.Parse(b)
	if err != nil || u.Host == "" {
		return []string{b}
	}
	host := u.Host
	variants := map[string]bool{}
	variants[u.Scheme+"://"+host] = true
	if strings.HasPrefix(host, "www.") {
		variants[u.Scheme+"://"+strings.TrimPrefix(host, "www.")] = true
	} else {
		variants[u.Scheme+"://www."+host] = true
	}
	out := []string{}
	for k := range variants {
		out = append(out, k)
	}
	return out
}

func FindCandidateURL(sourceBase, sku string) (string, []string, error) {
	tried := []string{}
	altsku := strings.ReplaceAll(sku, "-", "")
	lowerSku := strings.ToLower(sku)

	// Build candidate direct URLs and site search per base variant
	for _, base := range baseVariants(sourceBase) {
		base = strings.TrimRight(base, "/")
		direct := []string{
			fmt.Sprintf("%s/products/%s/", base, lowerSku),
			fmt.Sprintf("%s/product/%s/", base, lowerSku),
			fmt.Sprintf("%s/products/%s", base, lowerSku),
			fmt.Sprintf("%s/product/%s", base, lowerSku),
		}
		for _, u := range direct {
			tried = append(tried, u)
			if ok := tryHeadOrGet(u); ok {
				return u, tried, nil
			}
			if ok, _ := existsViaTextProxy(u); ok {
				return u, tried, nil
			}
		}

		searches := []string{
			fmt.Sprintf("%s/?s=%s&post_type=product", base, url.QueryEscape(sku)),
			fmt.Sprintf("%s/?s=%s", base, url.QueryEscape(sku)),
			fmt.Sprintf("%s/?s=%s&post_type=product", base, url.QueryEscape(altsku)),
			fmt.Sprintf("%s/?s=%s", base, url.QueryEscape(altsku)),
		}
		for _, su := range searches {
			tried = append(tried, su)
			if href := firstProductLink(su, base, sku, altsku); href != "" {
				return href, tried, nil
			}
		}
	}
	// Sitemap fallback
	if href := findInSitemaps(sourceBase, lowerSku); href != "" {
		tried = append(tried, href)
		return href, tried, nil
	}
	return "", tried, errors.New("no candidate product URL found from site search")
}

func httpGet(u string) (*http.Response, error) {
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; VIBOCNCBot/1.0; +https://www.vibocnc.com)")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	client := &http.Client{Timeout: 15 * time.Second}
	return client.Do(req)
}

func httpHead(u string) (*http.Response, error) {
	req, _ := http.NewRequest("HEAD", u, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; VIBOCNCBot/1.0; +https://www.vibocnc.com)")
	client := &http.Client{Timeout: 10 * time.Second}
	return client.Do(req)
}

func tryHeadOrGet(u string) bool {
	if resp, err := httpHead(u); err == nil {
		defer resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			return true
		}
	}
	if resp, err := httpGet(u); err == nil {
		defer resp.Body.Close()
		return resp.StatusCode >= 200 && resp.StatusCode < 400
	}
	return false
}

func firstProductLink(searchURL, base, sku, alt string) string {
	resp, err := httpGet(searchURL)
	if err != nil || resp.StatusCode >= 400 {
		return ""
	}
	defer resp.Body.Close()
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return ""
	}
	found := ""
	doc.Find("a").EachWithBreak(func(_ int, s *goquery.Selection) bool {
		href, ok := s.Attr("href")
		if !ok || href == "" {
			return true
		}
		// normalize
		href = strings.TrimSpace(href)
		if strings.HasPrefix(href, "/") {
			href = base + href
		}
		if !strings.HasPrefix(href, base) {
			return true
		}
		text := strings.TrimSpace(s.Text())
		// Heuristics: prefer product-like URLs
		if strings.Contains(href, "/product") || strings.Contains(href, "/products/") || strings.Count(href, "/") > 4 {
			if strings.Contains(strings.ToUpper(href), strings.ToUpper(sku)) || strings.Contains(strings.ToUpper(text), strings.ToUpper(sku)) || strings.Contains(strings.ToUpper(href), strings.ToUpper(alt)) || strings.Contains(strings.ToUpper(text), strings.ToUpper(alt)) {
				found = href
				return false
			}
		}
		return true
	})
	return found
}

// ExtractFromURL fetches a URL and extracts SEO fields, JSON-LD and description
func ExtractFromURL(productURL string) (*ImportedSEO, error) {
	html, usedFallback, fallbackURL, err := fetchWithFallback(productURL)
	if err != nil {
		return nil, err
	}

	res := &ImportedSEO{SourceURL: productURL}
	if usedFallback && fallbackURL != "" {
		res.TriedURLs = append(res.TriedURLs, fallbackURL)
	}

	// Fallback returns plain text prefixed with marker
	if strings.HasPrefix(strings.TrimSpace(html), "TEXTONLY::") {
		text := strings.TrimPrefix(html, "TEXTONLY::")
		title, content := parseJinaText(text)
		preciseMeta := findJSONFieldString(text, "meta_description")
		catLeaf := findJSONCategoryLeaf(text)
		if title == "" {
			title = findJSONFieldString(text, "title")
		}
		if title == "" {
			for _, ln := range strings.Split(text, "\n") {
				t := strings.TrimSpace(ln)
				if t != "" {
					title = t
					break
				}
			}
		}
		title = cleanBrands(strings.TrimSpace(title))
		res.Title = title
		res.H1 = title
		var descParts []string
		if preciseMeta != "" {
			descParts = append(descParts, cleanBrands(preciseMeta))
		}
		if len(descParts) == 0 {
			trimmed := strings.TrimSpace(content)
			trimmed = cleanNoise(trimmed)
			descParts = append(descParts, snippet(trimmed, 200))
		}
		htmlParts := []string{}
		for _, p := range descParts {
			if strings.TrimSpace(p) == "" {
				continue
			}
			htmlParts = append(htmlParts, "<p>"+p+"</p>")
		}
		res.DescriptionHTML = strings.Join(htmlParts, "")
		if catLeaf != "" {
			res.CategoryGuess = catLeaf
		} else {
			res.CategoryGuess = guessCategory(strings.ToLower(content))
		}
		res.MetaDescription = snippet(strings.Join(descParts, " "), 160)
		return res, nil
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, err
	}

	// Title
	res.Title = strings.TrimSpace(doc.Find("title").First().Text())
	// Meta
	if v, ok := doc.Find(`meta[name="description"]`).Attr("content"); ok {
		res.MetaDescription = strings.TrimSpace(v)
	}
	if v, ok := doc.Find(`meta[name="keywords"]`).Attr("content"); ok {
		res.MetaKeywords = strings.TrimSpace(v)
	}
	// H1
	res.H1 = strings.TrimSpace(doc.Find("h1").First().Text())

	// JSON-LD Product
	doc.Find("script[type='application/ld+json']").Each(func(_ int, s *goquery.Selection) {
		raw := s.Text()
		var obj interface{}
		if err := json.Unmarshal([]byte(raw), &obj); err == nil {
			// Could be array or object
			switch v := obj.(type) {
			case map[string]interface{}:
				if isProductJSONLD(v) {
					res.ProductJSONLD = v
				}
			case []interface{}:
				for _, it := range v {
					if m, ok := it.(map[string]interface{}); ok && isProductJSONLD(m) {
						res.ProductJSONLD = m
					}
				}
			}
		}
	})

	// Description heuristics: try common WooCommerce/WordPress selectors
	var descHTML string
	trySelectors := []string{
		".woocommerce-product-details__short-description",
		"#tab-description",
		"article .entry-content",
		".product .summary",
		".product .description",
	}
	for _, sel := range trySelectors {
		html, err := doc.Find(sel).First().Html()
		if err == nil && strings.TrimSpace(html) != "" {
			descHTML = strings.TrimSpace(html)
			break
		}
	}
	res.DescriptionHTML = descHTML

	// Category guess from title/H1/JSON-LD
	blob := strings.ToLower(strings.Join([]string{res.Title, res.H1, res.MetaDescription, res.MetaKeywords}, " "))
	res.CategoryGuess = guessCategory(blob)

	return res, nil
}

func isProductJSONLD(m map[string]interface{}) bool {
	if t, ok := m["@type"].(string); ok && strings.Contains(strings.ToLower(t), "product") {
		return true
	}
	if g, ok := m["@graph"].([]interface{}); ok {
		for _, it := range g {
			if mm, ok2 := it.(map[string]interface{}); ok2 {
				if isProductJSONLD(mm) {
					return true
				}
			}
		}
	}
	return false
}

func guessCategory(blob string) string {
	// Simple keyword mapping; extend as needed
	pairs := []struct{ Kw, Cat string }{
		{"servo", "Servo Drives"},
		{"amplifier", "Amplifiers"},
		{"motor", "Servo Motors"},
		{"power", "Power Supply"},
		{"pcb", "Fanuc PCBs"},
		{"encoder", "Encoders"},
		{"inverter", "CNC Inverters"},
		{"interface", "Interface Boards"},
		{"i/o", "Interface Boards"},
	}
	for _, p := range pairs {
		if strings.Contains(blob, p.Kw) {
			return p.Cat
		}
	}
	return ""
}

// existsViaTextProxy uses r.jina.ai to test if a URL yields text
func existsViaTextProxy(pageURL string) (bool, string) {
	hostPath := strings.TrimPrefix(strings.TrimPrefix(pageURL, "https://"), "http://")
	fb1 := "https://r.jina.ai/http://" + hostPath
	if txt, ok := fetchTextOnly(fb1); ok && len(strings.TrimSpace(txt)) > 0 {
		return true, fb1
	}
	fb2 := "https://r.jina.ai/https://" + hostPath
	if txt, ok := fetchTextOnly(fb2); ok && len(strings.TrimSpace(txt)) > 0 {
		return true, fb2
	}
	return false, ""
}

// findInSitemaps tries to locate product URL by scanning sitemap endpoints
func findInSitemaps(sourceBase, skuLower string) string {
	bases := baseVariants(sourceBase)
	endpoints := []string{"/sitemap_index.xml", "/product-sitemap.xml", "/products-sitemap.xml", "/sitemap.xml"}
	for _, b := range bases {
		for _, ep := range endpoints {
			u := strings.TrimRight(b, "/") + ep
			if href := findInSitemap(u, skuLower); href != "" {
				return href
			}
		}
	}
	return ""
}

type sitemapURL struct {
	Loc string `xml:"loc"`
}
type sitemapIndex struct {
	Sitemaps []sitemapURL `xml:"sitemap"`
}
type urlSet struct {
	URLs []sitemapURL `xml:"url"`
}

func findInSitemap(sitemapURLStr, skuLower string) string {
	resp, err := httpGet(sitemapURLStr)
	if err != nil || resp.StatusCode >= 400 {
		return ""
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var idx sitemapIndex
	if xml.Unmarshal(body, &idx) == nil && len(idx.Sitemaps) > 0 {
		for _, sm := range idx.Sitemaps {
			href := strings.TrimSpace(sm.Loc)
			if href == "" {
				continue
			}
			if found := findInSitemap(href, skuLower); found != "" {
				return found
			}
		}
		return ""
	}
	var us urlSet
	if xml.Unmarshal(body, &us) == nil && len(us.URLs) > 0 {
		for _, u := range us.URLs {
			loc := strings.TrimSpace(u.Loc)
			if loc == "" {
				continue
			}
			ll := strings.ToLower(loc)
			if strings.Contains(ll, "/products/") && strings.Contains(ll, skuLower) {
				return loc
			}
		}
	}
	return ""
}

// fetchWithFallback: direct GET -> if Cloudflare/blocked, try r.jina.ai text extractor
func fetchWithFallback(pageURL string) (string, bool, string, error) {
	if resp, err := httpGet(pageURL); err == nil {
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		body := string(b)
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			lower := strings.ToLower(body)
			if strings.Contains(lower, "cloudflare") && strings.Contains(lower, "just a moment") {
				// fall through
			} else {
				return body, false, "", nil
			}
		}
	}
	// r.jina.ai fallback (http/https variants)
	hostPath := strings.TrimPrefix(strings.TrimPrefix(pageURL, "https://"), "http://")
	fb1 := "https://r.jina.ai/http://" + hostPath
	if txt, ok := fetchTextOnly(fb1); ok {
		return "TEXTONLY::" + txt, true, fb1, nil
	}
	fb2 := "https://r.jina.ai/https://" + hostPath
	if txt, ok := fetchTextOnly(fb2); ok {
		return "TEXTONLY::" + txt, true, fb2, nil
	}
	return "", false, "", fmt.Errorf("failed to fetch page and fallback: %s", pageURL)
}

func fetchTextOnly(u string) (string, bool) {
	resp, err := httpGet(u)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return "", false
	}
	b, _ := io.ReadAll(resp.Body)
	s := string(b)
	if len(strings.TrimSpace(s)) == 0 {
		return "", false
	}
	return s, true
}

func snippet(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	if idx := strings.LastIndex(s[:n], " "); idx > 20 {
		return s[:idx]
	}
	return s[:n]
}

// cleanBrands removes vendor/brand mentions from text snippets
func cleanBrands(s string) string {
	lowers := []string{"fanucworld", "t.i.e.", "tie industrial"}
	out := s
	for _, k := range lowers {
		out = strings.ReplaceAll(out, k, "")
		out = strings.ReplaceAll(out, strings.ToUpper(k), "")
		out = strings.ReplaceAll(out, strings.Title(k), "")
	}
	out = strings.ReplaceAll(out, "(PROD)", "")
	return strings.TrimSpace(out)
}

// parseJinaText strips r.jina.ai headers and returns (title, content)
func parseJinaText(t string) (string, string) {
	lines := strings.Split(t, "\n")
	title := ""
	contentStart := 0
	for i, ln := range lines {
		s := strings.TrimSpace(ln)
		if strings.HasPrefix(strings.ToLower(s), "title:") {
			title = strings.TrimSpace(strings.TrimPrefix(s, "Title:"))
		}
		if strings.HasPrefix(strings.ToLower(s), "markdown content:") {
			contentStart = i + 1
			break
		}
	}
	body := strings.Join(lines[contentStart:], "\n")
	body = strings.TrimSpace(body)
	if strings.HasPrefix(strings.ToLower(body), "url source:") {
		parts := strings.SplitN(body, "\n", 2)
		if len(parts) == 2 {
			body = parts[1]
		} else {
			body = ""
		}
	}
	return strings.TrimSpace(title), strings.TrimSpace(body)
}

// findJSONFieldString extracts a simple string value for a key inside embedded JSON-like text
func findJSONFieldString(t, key string) string {
	needle := "\"" + key + "\":"
	pos := strings.Index(t, needle)
	if pos == -1 {
		return ""
	}
	rem := t[pos+len(needle):]
	q1 := strings.Index(rem, "\"")
	if q1 == -1 {
		return ""
	}
	rem2 := rem[q1+1:]
	q2 := strings.Index(rem2, "\"")
	if q2 == -1 {
		return ""
	}
	return strings.TrimSpace(rem2[:q2])
}

// findJSONCategoryLeaf extracts last segment of first category path
func findJSONCategoryLeaf(t string) string {
	needle := "\"category\":"
	p := strings.Index(t, needle)
	if p == -1 {
		return ""
	}
	after := t[p+len(needle):]
	lb := strings.Index(after, "[")
	if lb == -1 {
		return ""
	}
	after = after[lb+1:]
	dq1 := strings.Index(after, "\"")
	if dq1 == -1 {
		return ""
	}
	after2 := after[dq1+1:]
	dq2 := strings.Index(after2, "\"")
	if dq2 == -1 {
		return ""
	}
	val := after2[:dq2]
	parts := strings.Split(val, "/")
	return strings.TrimSpace(parts[len(parts)-1])
}

// cleanNoise drops obvious navigation/CTA lines from plain text
func cleanNoise(t string) string {
	ban := []string{"Toggle menu", "Quick Quote", "Start your", "Request a Quote", "Back", "All Fanuc", "Shop Parts", "Shop Robots", "Subscribe", "Follow Us", "Privacy Policy", "Terms and Conditions", "©", "bat.bing.com", "Rep Locator", "Training"}
	lines := strings.Split(t, "\n")
	kept := make([]string, 0, len(lines))
	for _, ln := range lines {
		s := strings.TrimSpace(ln)
		if s == "" {
			continue
		}
		skip := false
		ls := strings.ToLower(s)
		for _, b := range ban {
			if strings.Contains(ls, strings.ToLower(b)) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		if strings.HasPrefix(s, "* [") || strings.HasPrefix(s, "[") {
			continue
		}
		kept = append(kept, s)
	}
	return strings.Join(kept, "\n")
}
