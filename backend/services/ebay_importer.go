package services

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// ImportFromEbay tries to find the first eBay listing for a SKU and extract title/description
func ImportFromEbay(sku string) (*ImportedSEO, string, error) {
	searchURL := fmt.Sprintf("https://www.ebay.com/sch/i.html?_nkw=%s", url.QueryEscape(strings.TrimSpace(sku)))
	// Try direct; fallback through r.jina.ai for text
	html, _, _, err := fetchWithFallback(searchURL)
	if err != nil {
		textURL := "https://r.jina.ai/https://www.ebay.com/sch/i.html?_nkw=" + url.QueryEscape(strings.TrimSpace(sku))
		if txt, ok := fetchTextOnly(textURL); ok {
			html = "TEXTONLY::" + txt
		} else {
			return nil, "", err
		}
	}

	// Find first item link
	itemURL := findFirstEbayItemURL(html)
	if itemURL == "" {
		textURL := "https://r.jina.ai/http://www.ebay.com/sch/i.html?_nkw=" + url.QueryEscape(strings.TrimSpace(sku))
		if txt, ok := fetchTextOnly(textURL); ok {
			itemURL = findFirstEbayItemURL("TEXTONLY::" + txt)
		}
	}
	if itemURL == "" {
		return nil, "", fmt.Errorf("no ebay item found for %s", sku)
	}

	// Fetch item page
	itemHTML, _, _, err := fetchWithFallback(itemURL)
	if err != nil {
		tURL := "https://r.jina.ai/https://www.ebay.com/itm/" + strings.TrimPrefix(itemURL, "https://www.ebay.com/itm/")
		if txt, ok := fetchTextOnly(tURL); ok {
			itemHTML = "TEXTONLY::" + txt
		} else {
			return nil, "", err
		}
	}

	res := &ImportedSEO{SourceURL: itemURL}
	if strings.HasPrefix(strings.TrimSpace(itemHTML), "TEXTONLY::") {
		text := strings.TrimPrefix(itemHTML, "TEXTONLY::")
		title, body := parseJinaText(text)
		if title == "" {
			title = findJSONFieldString(text, "name")
		}
		res.Title = cleanBrands(strings.TrimSpace(title))
		res.H1 = res.Title
		cleaned := cleanNoise(body)
		if cleaned == "" {
			cleaned = body
		}
		res.MetaDescription = snippet(cleanBrands(cleaned), 160)
		short := snippet(cleanBrands(cleaned), 800)
		res.DescriptionHTML = "<p>" + strings.ReplaceAll(short, "\n", "</p><p>") + "</p>"
		if cat := findJSONCategoryLeaf(text); cat != "" {
			res.CategoryGuess = cat
		} else {
			res.CategoryGuess = guessCategory(strings.ToLower(cleaned))
		}
		return res, itemURL, nil
	}

	// Non-text path: use our HTML extractor
	htmlRes, err := ExtractFromURL(itemURL)
	if err != nil {
		return nil, "", err
	}
	return htmlRes, itemURL, nil
}

func findFirstEbayItemURL(doc string) string {
	// Try to find a full https://www.ebay.com/itm/... URL first
	reFull := regexp.MustCompile(`https?://www\.ebay\.com/itm/[^\s\"]+`)
	if m := reFull.FindString(doc); m != "" {
		return m
	}
	// Try to find path /itm/...
	rePath := regexp.MustCompile(`/itm/[^\s\"]+`)
	if m := rePath.FindString(doc); m != "" {
		return "https://www.ebay.com" + m
	}
	return ""
}
