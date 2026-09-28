package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

func isShopifyImportPayload(raw map[string]any) bool {
	if raw == nil {
		return false
	}
	platform := strings.ToLower(firstLegacyString(raw["platform"]))
	sourceType := strings.ToLower(firstLegacyString(raw["source_type"]))
	if platform == "shopify" || strings.Contains(sourceType, "shopify") || raw["shopify_product"] != nil {
		return true
	}
	_, hasHandle := raw["handle"]
	_, hasVariants := raw["variants"]
	return hasHandle && hasVariants
}

// normalizeShopifyImportPayload maps Shopify's products.json shape to the
// draft fields while preserving the complete source product in RawPayload.
func normalizeShopifyImportPayload(normalized map[string]any, raw map[string]any) {
	product := legacyMap(raw["shopify_product"])
	if len(product) == 0 && isShopifyImportPayload(raw) {
		product = raw
	}
	if len(product) == 0 {
		return
	}
	variant := firstShopifyMap(product["variants"])
	tags := shopifyTags(firstLegacyValue(raw["tags"], product["tags"]))
	handle := firstLegacyString(raw["handle"], product["handle"], product["id"])
	baseURL := firstLegacyString(raw["source_base_url"], raw["source_origin"], "https://www.b-automationservice.com")
	productURL := firstLegacyString(raw["product_url"], raw["source_url"], product["product_url"])
	if productURL == "" && handle != "" {
		productURL = strings.TrimRight(baseURL, "/") + "/products/" + url.PathEscape(handle)
	}

	setCanonicalString(normalized, "source_type", "shopify_collection")
	setCanonicalString(normalized, "source_site", "b-automationservice")
	setCanonicalString(normalized, "platform", "shopify")
	setCanonicalString(normalized, "plugin_schema", "gycharm-ebay-v3-shopify-2026")
	setCanonicalString(normalized, "product_url", productURL)
	setCanonicalString(normalized, "source_url", productURL)
	setCanonicalString(normalized, "product_title", firstLegacyString(raw["product_title"], raw["title"], product["title"], handle))
	setCanonicalString(normalized, "description_full", firstLegacyText(raw["description_full"], raw["description_html"], raw["description"], product["body_html"], product["body_text"], product["description"]))
	setCanonicalString(normalized, "current_price", firstLegacyString(raw["current_price"], raw["price"], variant["price"], product["price"]))
	setCanonicalString(normalized, "compare_price", firstLegacyString(raw["compare_price"], variant["compare_at_price"], product["compare_at_price"]))
	setCanonicalString(normalized, "currency", firstLegacyString(raw["currency"], raw["currency_raw"], variant["currency"], variant["currency_code"], shopifyPresentmentCurrency(product), "EUR"))
	setCanonicalString(normalized, "vendor", firstLegacyString(raw["vendor"], product["vendor"]))
	setCanonicalString(normalized, "brand", firstLegacyString(raw["brand"], raw["vendor"], product["vendor"]))
	setCanonicalString(normalized, "product_type", firstLegacyString(raw["product_type"], product["product_type"]))
	productID := firstLegacyString(raw["product_id"], raw["ebay_item_id"], product["id"])
	setCanonicalString(normalized, "product_id", productID)
	setCanonicalString(normalized, "listing_id", firstLegacyString(raw["listing_id"], normalized["product_id"]))

	sku := firstLegacyString(raw["sku"], variant["sku"], shopifyTagValue(tags, "sku"), shopifyTagValue(tags, "mpn"), shopifyTagValue(tags, "part"), productID)
	setCanonicalString(normalized, "sku", sku)
	setCanonicalString(normalized, "model", firstLegacyString(raw["model"], shopifyTagValue(tags, "model"), sku))
	setCanonicalString(normalized, "mpn", firstLegacyString(raw["mpn"], shopifyTagValue(tags, "mpn"), sku))
	setCanonicalString(normalized, "part_number", firstLegacyString(raw["part_number"], shopifyTagValue(tags, "part"), shopifyTagValue(tags, "part_number"), sku))
	setCanonicalString(normalized, "condition", firstLegacyString(raw["condition"], shopifyCondition(product, variant), shopifyTagValue(tags, "condition")))
	setCanonicalString(normalized, "category_breadcrumb", firstLegacyString(raw["category_breadcrumb"], raw["collection_name"], product["product_type"]))
	// The BAS store's collection also gets its own key, so it can never be read
	// out of the same field as an eBay category breadcrumb.
	setCanonicalString(normalized, rawKeyBasCategory, firstLegacyString(raw["collection_name"], product["product_type"], raw["category_breadcrumb"]))
	setCanonicalString(normalized, "collection_handle", firstLegacyString(raw["collection_handle"]))
	setCanonicalString(normalized, "published_at", firstLegacyString(raw["published_at"], product["published_at"]))
	setCanonicalString(normalized, "created_at", firstLegacyString(raw["created_at"], product["created_at"]))
	setCanonicalString(normalized, "updated_at", firstLegacyString(raw["updated_at"], product["updated_at"]))

	if _, exists := normalized["tags"]; !exists || len(shopifyTags(normalized["tags"])) == 0 {
		normalized["tags"] = tags
	}
	if _, exists := normalized["variants"]; !exists {
		normalized["variants"] = product["variants"]
	}
	if _, exists := normalized["options"]; !exists {
		normalized["options"] = product["options"]
	}
	if _, exists := normalized["images"]; !exists {
		normalized["images"] = product["images"]
	}
	if _, exists := normalized["shopify_product"]; !exists {
		normalized["shopify_product"] = product
	}
	if _, exists := normalized["stock_quantity"]; !exists {
		normalized["stock_quantity"] = shopifyStockQuantity(product)
	}

	images := make([]string, 0)
	seen := map[string]bool{}
	for _, value := range []any{raw["main_image"], raw["image"], raw["image_urls"], product["images"], product["image"], product["featured_image"], product["variants"]} {
		appendShopifyImageURLs(&images, seen, value, 0)
	}
	if firstLegacyString(normalized["main_image"]) == "" && len(images) > 0 {
		normalized["main_image"] = images[0]
	}
	if _, exists := normalized["image_urls"]; !exists || len(collectLegacyURLValues(normalized["image_urls"])) == 0 {
		normalized["image_urls"] = images
	}
	if _, exists := normalized["item_specifics"]; !exists {
		normalized["item_specifics"] = shopifyItemSpecifics(product, variant, tags)
	}
}

func firstShopifyMap(value any) map[string]any {
	if values, ok := value.([]any); ok {
		for _, item := range values {
			if mapped := legacyMap(item); len(mapped) > 0 {
				return mapped
			}
		}
	}
	if values, ok := value.([]map[string]any); ok && len(values) > 0 {
		return values[0]
	}
	if encoded, ok := value.(string); ok && strings.HasPrefix(strings.TrimSpace(encoded), "[") {
		var values []map[string]any
		if json.Unmarshal([]byte(encoded), &values) == nil && len(values) > 0 {
			return values[0]
		}
	}
	return map[string]any{}
}

func shopifyTags(value any) []string {
	values := []string{}
	switch typed := value.(type) {
	case []string:
		values = append(values, typed...)
	case []any:
		for _, item := range typed {
			if text := firstLegacyString(item); text != "" {
				values = append(values, text)
			}
		}
	case string:
		trimmed := strings.TrimSpace(typed)
		if strings.HasPrefix(trimmed, "[") {
			var decoded []any
			if err := decodeJSONValue(trimmed, &decoded); err == nil {
				return shopifyTags(decoded)
			}
		}
		values = strings.Split(trimmed, ",")
	case []map[string]any:
		for _, item := range typed {
			if text := firstLegacyString(item["name"], item["value"], item["label"]); text != "" {
				values = append(values, text)
			}
		}
	}
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[strings.ToUpper(value)] {
			seen[strings.ToUpper(value)] = true
			out = append(out, value)
		}
	}
	return out
}

func decodeJSONValue(raw string, target any) error {
	return json.Unmarshal([]byte(raw), target)
}

func shopifyTagValue(tags []string, prefix string) string {
	marker := strings.ToUpper(strings.TrimSpace(prefix)) + "-"
	for _, tag := range tags {
		upper := strings.ToUpper(strings.TrimSpace(tag))
		if strings.HasPrefix(upper, marker) {
			return strings.TrimSpace(tag[len(marker):])
		}
	}
	return ""
}

func shopifyCondition(product map[string]any, variant map[string]any) string {
	options := shopifyMapSlice(product["options"])
	for index, mapped := range options {
		if !strings.EqualFold(firstLegacyString(mapped["name"]), "condition") {
			continue
		}
		key := fmt.Sprintf("option%d", index+1)
		if value := firstLegacyString(variant[key]); value != "" {
			return value
		}
		values := shopifyTags(mapped["values"])
		if len(values) > 0 {
			return values[0]
		}
	}
	return firstLegacyString(variant["option1"])
}

func shopifyPresentmentCurrency(product map[string]any) string {
	presentment := shopifyMapSlice(product["presentment_prices"])
	if len(presentment) == 0 {
		return ""
	}
	firstPrice := presentment[0]
	price := legacyMap(firstPrice["price"])
	return firstLegacyString(price["currency_code"], price["currency"])
}

func shopifyStockQuantity(product map[string]any) int {
	variants := shopifyMapSlice(product["variants"])
	total := 0
	known := false
	for _, variant := range variants {
		value := firstLegacyString(variant["inventory_quantity"])
		if value == "" {
			continue
		}
		quantity := int(parsePriceFloat(value))
		if quantity >= 0 {
			total += quantity
			known = true
		}
	}
	if known {
		return total
	}
	return 1
}

func shopifyMapSlice(value any) []map[string]any {
	switch typed := value.(type) {
	case []any:
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if mapped := legacyMap(item); len(mapped) > 0 {
				out = append(out, mapped)
			}
		}
		return out
	case []map[string]any:
		return typed
	case string:
		var out []map[string]any
		if json.Unmarshal([]byte(typed), &out) == nil {
			return out
		}
	}
	return []map[string]any{}
}

func appendShopifyImageURLs(out *[]string, seen map[string]bool, value any, depth int) {
	if value == nil || depth > 7 {
		return
	}
	add := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" || seen[candidate] || !(strings.HasPrefix(candidate, "http://") || strings.HasPrefix(candidate, "https://")) {
			return
		}
		seen[candidate] = true
		*out = append(*out, candidate)
	}
	switch typed := value.(type) {
	case string:
		add(typed)
	case []string:
		for _, item := range typed {
			add(item)
		}
	case []any:
		for _, item := range typed {
			appendShopifyImageURLs(out, seen, item, depth+1)
		}
	case map[string]any:
		add(firstLegacyString(typed["src"], typed["original_src"], typed["url"]))
		for _, key := range []string{"images", "image", "featured_image", "src", "original_src", "url"} {
			if nested, exists := typed[key]; exists {
				appendShopifyImageURLs(out, seen, nested, depth+1)
			}
		}
	}
}

func shopifyItemSpecifics(product map[string]any, variant map[string]any, tags []string) []map[string]string {
	specifics := make([]map[string]string, 0, 6)
	add := func(name string, value string) {
		name = strings.TrimSpace(name)
		value = strings.TrimSpace(value)
		if name != "" && value != "" {
			specifics = append(specifics, map[string]string{"name": name, "value": value})
		}
	}
	add("Vendor", firstLegacyString(product["vendor"]))
	add("Product Type", firstLegacyString(product["product_type"]))
	add("SKU", firstLegacyString(variant["sku"]))
	add("Condition", shopifyCondition(product, variant))
	add("Tags", strings.Join(tags, ", "))
	return specifics
}
