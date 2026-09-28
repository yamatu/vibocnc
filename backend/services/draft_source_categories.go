package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// Two importers fill ebay_import_drafts and each classifies an item in its own
// taxonomy: eBay publishes a category breadcrumb, and the
// b-automationservice ("BAS") store publishes a Shopify collection / product
// type. Both used to be written into the one shared `category_breadcrumb` key,
// so the drafts list showed them side by side under a single unlabelled column:
// an eBay taxonomy path read like a storefront category, and an eBay row could
// be displayed with the BAS store's wording.
//
// The canonical keys below keep the two apart. Rows imported before the split
// are still read through the shared key and attributed from source_site, so no
// payload backfill is needed.
const (
	// DraftSourceSiteEbay and DraftSourceSiteBas are the source_site values the
	// two importers write. For a legacy row this is the only evidence of which
	// site the shared category key belonged to.
	DraftSourceSiteEbay = "ebay"
	DraftSourceSiteBas  = "b-automationservice"

	rawKeyEbayCategory   = "ebay_category_breadcrumb"
	rawKeyBasCategory    = "bas_category_breadcrumb"
	rawKeySharedCategory = "category_breadcrumb"

	// draftSourceCategoryLimit matches the width suggested_category_name is
	// stored and displayed with, so a scraped breadcrumb cannot outgrow the
	// column it sits next to.
	draftSourceCategoryLimit = 255
)

// DraftSourceCategories is one draft's classification per source site. One
// field per site, so a caller cannot merge the two by accident.
type DraftSourceCategories struct {
	// EbayCategory is the eBay taxonomy breadcrumb; empty for a non-eBay row.
	EbayCategory string
	// BasCategory is the b-automationservice collection / product type; empty
	// for a non-BAS row.
	BasCategory string
}

// IsEmpty reports whether neither source site classified the draft.
func (c DraftSourceCategories) IsEmpty() bool {
	return c.EbayCategory == "" && c.BasCategory == ""
}

// ResolveDraftSourceCategories attributes the category fields of a stored raw
// payload to the site each belongs to.
//
// Explicit keys win, because an importer writes them knowing its own site. The
// site recorded on the draft then decides which shape-specific keys may be
// read: an eBay row is never read for a Shopify collection and a BAS row is
// never read for an eBay category, so a payload that happens to carry both
// cannot be relabelled by the other site's wording. Only a row with no recorded
// site falls back to inspecting the payload shape.
func ResolveDraftSourceCategories(sourceSite string, raw map[string]any) DraftSourceCategories {
	if len(raw) == 0 {
		return DraftSourceCategories{}
	}
	site := normalizeDraftSourceSite(sourceSite)
	var categories DraftSourceCategories

	switch site {
	case DraftSourceSiteEbay:
		if hasDraftSourceCategoryKey(raw, rawKeyEbayCategory) {
			categories.EbayCategory = firstLegacyString(raw[rawKeyEbayCategory])
		} else {
			// Legacy eBay rows have no split key; source_site is what authorizes
			// reading the old shared breadcrumb/eBay-shaped fields.
			categories.EbayCategory = firstLegacyString(
				raw[rawKeySharedCategory],
				raw["category_breadcrumb"],
				legacyMap(raw["_product_data"])["_shangjia_category"],
				raw["category_leaf"],
			)
		}
	case DraftSourceSiteBas:
		if hasDraftSourceCategoryKey(raw, rawKeyBasCategory) {
			categories.BasCategory = firstLegacyString(raw[rawKeyBasCategory])
		} else {
			// Legacy BAS rows use product_type/collection fields or the old
			// shared key. No eBay-shaped field is consulted here.
			categories.BasCategory = firstLegacyString(
				raw["collection_name"],
				raw["collection_handle"],
				raw["product_type"],
				raw[rawKeySharedCategory],
			)
		}
	case "":
		// Without source attribution, only explicit split keys are safe. Never
		// assign a legacy shared value to both sites.
		if hasDraftSourceCategoryKey(raw, rawKeyEbayCategory) {
			categories.EbayCategory = firstLegacyString(raw[rawKeyEbayCategory])
		}
		if hasDraftSourceCategoryKey(raw, rawKeyBasCategory) {
			categories.BasCategory = firstLegacyString(raw[rawKeyBasCategory])
		}
	}
	return categories.clamp()
}

// normalizeDraftSourceSite lowercases the recorded site so " B-AutomationService "
// and "b-automationservice" are recognized as the same store.
// hasDraftSourceCategoryKey reports whether a payload records a category for a
// site at all, which is what tells "no category" apart from "written before the
// split". A JSON null counts as present for the same reason an empty string
// does: the key was written deliberately.
func hasDraftSourceCategoryKey(raw map[string]any, key string) bool {
	_, present := raw[key]
	return present
}

func normalizeDraftSourceSite(sourceSite string) string {
	return strings.ToLower(strings.TrimSpace(sourceSite))
}

// draftPayloadFromEbay decides whether eBay-shaped keys may be read as the eBay
// category. A recorded site wins over payload shape, so a store that happens to
// send a category_leaf key is not relabelled as eBay.
func draftPayloadFromEbay(raw map[string]any, site string) bool {
	switch site {
	case DraftSourceSiteEbay:
		return true
	case "":
		return len(legacyMap(raw["_product_data"])) > 0 || firstLegacyString(raw["_shangjia_category"]) != ""
	default:
		return false
	}
}

// draftPayloadFromBas is the same guard for Shopify-shaped keys.
func draftPayloadFromBas(raw map[string]any, site string) bool {
	switch site {
	case DraftSourceSiteBas:
		return true
	case "":
		return isShopifyImportPayload(raw)
	default:
		return false
	}
}

func (c DraftSourceCategories) clamp() DraftSourceCategories {
	return DraftSourceCategories{
		EbayCategory: clampDraftSourceCategory(c.EbayCategory),
		BasCategory:  clampDraftSourceCategory(c.BasCategory),
	}
}

// clampDraftSourceCategory collapses scraped whitespace and bounds the length,
// so a malformed payload cannot push a multi-kilobyte line into the list.
func clampDraftSourceCategory(value string) string {
	collapsed := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	switch strings.ToLower(collapsed) {
	case "", "null", "none", "n/a", "na", "unknown", "uncategorized", "unclassified", "undefined", "-":
		return ""
	}
	runes := []rune(collapsed)
	if len(runes) <= draftSourceCategoryLimit {
		return collapsed
	}
	return strings.TrimSpace(string(runes[:draftSourceCategoryLimit]))
}

// draftSourceCategoryOptionLimit bounds the picker a source site can offer. The
// vocabulary is scraped, so it is unbounded in principle and a page cannot
// render a thousand options.
const draftSourceCategoryOptionLimit = 200

// DraftSourceCategoryOption is one selectable category for a source site.
type DraftSourceCategoryOption struct {
	Value string `json:"value"`
	Count int64  `json:"count"`
}

// draftSourceCategoryKey maps a source site onto the payload key its category
// belongs in. An unknown site is refused rather than guessed: writing an eBay
// breadcrumb under the BAS key is exactly the mix-up the split keys exist to
// prevent.
func draftSourceCategoryKey(site string) (string, error) {
	switch normalizeDraftSourceSite(site) {
	case DraftSourceSiteEbay:
		return rawKeyEbayCategory, nil
	case DraftSourceSiteBas:
		return rawKeyBasCategory, nil
	default:
		return "", fmt.Errorf("unknown source site %q", strings.TrimSpace(site))
	}
}

// SetDraftSourceCategory records the category chosen for one source site on a
// draft, under that site's own payload key - the same key the importer writes,
// so the list and detail API keep attributing the value to the site it came
// from. An empty value clears the key, because a wrongly picked category has to
// be removable.
func SetDraftSourceCategory(db *gorm.DB, draft *models.EbayImportDraft, site string, value string) error {
	if db == nil || draft == nil || draft.ID == 0 {
		return errors.New("a stored draft is required to record a source category")
	}
	requestedSite := normalizeDraftSourceSite(site)
	recordedSite := normalizeDraftSourceSite(draft.SourceSite)
	if recordedSite != "" && requestedSite != recordedSite {
		return fmt.Errorf("cannot write %s category on a %s draft", requestedSite, recordedSite)
	}
	encoded, err := applyDraftSourceCategory(draft.RawPayload, requestedSite, value)
	if err != nil {
		return err
	}
	result := db.Model(&models.EbayImportDraft{}).
		Where("id = ? AND status NOT IN ? AND COALESCE(ai_review_status, '') NOT IN ?", draft.ID,
			[]string{EbayDraftStatusImported, EbayDraftStatusSkipped}, []string{EbayAIReviewQueued, EbayAIReviewProcessing}).
		Updates(map[string]any{"raw_payload": encoded, "ai_review_status": "", "ai_review_error": "",
			"ai_review_notes": "Source category changed; rerun AI optimization before publishing"})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("draft is busy or already processed; reload before changing its source category")
	}
	draft.RawPayload = encoded
	draft.AIReviewStatus = ""
	return nil
}

// applyDraftSourceCategory returns a payload with one source site's category set
// - or recorded as empty when the value is cleared, so the scraped breadcrumb is
// not read back in its place. It is split from the write so the merge is
// testable without a database.
func applyDraftSourceCategory(rawPayload string, site string, value string) (string, error) {
	key, err := draftSourceCategoryKey(site)
	if err != nil {
		return "", err
	}
	raw := decodeRawPayload(rawPayload)
	if raw == nil {
		raw = map[string]any{}
	}
	raw[key] = clampDraftSourceCategory(value)
	encoded, err := json.Marshal(raw)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// draftSourceCategoryReadKeys splits a source site's payload keys into the one
// key it owns and the legacy keys rows were written with before the split. Only
// this site's keys, so the picker never offers one store's wording for the other.
func draftSourceCategoryReadKeys(site string) (string, []string, string, error) {
	normalized := normalizeDraftSourceSite(site)
	switch normalized {
	case DraftSourceSiteEbay:
		return rawKeyEbayCategory, []string{"category_leaf", "_product_data._shangjia_category", rawKeySharedCategory}, normalized, nil
	case DraftSourceSiteBas:
		return rawKeyBasCategory, []string{"collection_name", "product_type", rawKeySharedCategory}, normalized, nil
	default:
		return "", nil, "", fmt.Errorf("unknown source site %q", strings.TrimSpace(site))
	}
}

// ListDraftSourceCategories reports the category vocabulary the stored drafts of
// one source site actually carry, most used first, so the admin UI can offer a
// picker built from real listings instead of a hand-maintained list.
//
// It touches only the small category keys - never the description blobs - and
// only scalar values: a payload that stored an object there is skipped rather
// than offered as JSON.
func ListDraftSourceCategories(db *gorm.DB, site string) ([]DraftSourceCategoryOption, error) {
	if db == nil {
		return nil, errors.New("database is nil")
	}
	explicitKey, legacyKeys, sourceSite, err := draftSourceCategoryReadKeys(site)
	if err != nil {
		return nil, err
	}
	explicitPath := "$." + explicitKey
	args := []any{explicitPath, explicitPath}
	legacyExpressions := make([]string, 0, len(legacyKeys))
	for _, key := range legacyKeys {
		legacyExpressions = append(legacyExpressions, "NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, ?))), '')")
		args = append(args, "$."+key)
	}
	// The site's own key is read on its own, and only when it exists: a cleared
	// category means this store has no category for the listing, so the scraped
	// breadcrumb the picker would otherwise re-add must not be offered back.
	query := fmt.Sprintf(`SELECT LEFT(
	CASE WHEN JSON_CONTAINS_PATH(raw_payload, 'one', ?)
		THEN NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, ?))), '')
		ELSE COALESCE(%s)
	END, %d) AS value, COUNT(*) AS count
FROM ebay_import_drafts
WHERE source_site = ? AND raw_payload IS NOT NULL AND raw_payload <> ''
GROUP BY value
HAVING value IS NOT NULL AND value <> '' AND CHAR_LENGTH(value) <= %d
ORDER BY count DESC, value ASC
LIMIT ?`,
		strings.Join(legacyExpressions, ", "), draftSourceCategoryLimit, draftSourceCategoryLimit)
	args = append(args, sourceSite, draftSourceCategoryOptionLimit+50)

	options := []DraftSourceCategoryOption{}
	if err := db.Raw(query, args...).Scan(&options).Error; err != nil {
		return nil, err
	}
	kept := make([]DraftSourceCategoryOption, 0, len(options))
	for _, option := range options {
		option.Value = clampDraftSourceCategory(option.Value)
		// A JSON object or array decoded to its source text is not a category
		// name, and neither is a value carrying a control character.
		if option.Value == "" || strings.HasPrefix(option.Value, "{") || strings.HasPrefix(option.Value, "[") || strings.ContainsAny(option.Value, "\x00\n\r") {
			continue
		}
		kept = append(kept, option)
		if len(kept) >= draftSourceCategoryOptionLimit {
			break
		}
	}
	return kept, nil
}

// draftSourceCategorySelect extracts only the handful of small payload keys the
// list needs. A payload also carries the whole description HTML, so parsing it
// per row would make a 100-row page read megabytes of JSON for two labels.
//
// Every extraction is COALESCEd: a missing path returns SQL NULL, which cannot
// be scanned into a string field, and the service also runs against rows whose
// payload predates these keys.
const draftSourceCategorySelect = `id,
	source_site,
	COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.ebay_category_breadcrumb')), '') AS ebay_key,
	JSON_CONTAINS_PATH(raw_payload, 'one', '$.ebay_category_breadcrumb') AS ebay_key_present,
	COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.bas_category_breadcrumb')), '') AS bas_key,
	JSON_CONTAINS_PATH(raw_payload, 'one', '$.bas_category_breadcrumb') AS bas_key_present,
	COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.category_leaf')), '') AS ebay_leaf,
	COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$._product_data._shangjia_category')), '') AS ebay_category,
	COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.collection_name')), '') AS collection_name,
	COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.collection_handle')), '') AS collection_handle,
	COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.product_type')), '') AS product_type,
	COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.category_breadcrumb')), '') AS shared_category`

type draftSourceCategoryRow struct {
	ID               uint
	SourceSite       string `gorm:"column:source_site"`
	EbayKey          string `gorm:"column:ebay_key"`
	EbayKeyPresent   bool   `gorm:"column:ebay_key_present"`
	BasKey           string `gorm:"column:bas_key"`
	BasKeyPresent    bool   `gorm:"column:bas_key_present"`
	EbayLeaf         string `gorm:"column:ebay_leaf"`
	EbayCategory     string `gorm:"column:ebay_category"`
	CollectionName   string `gorm:"column:collection_name"`
	CollectionHandle string `gorm:"column:collection_handle"`
	ProductType      string `gorm:"column:product_type"`
	SharedCategory   string `gorm:"column:shared_category"`
}

// LoadDraftSourceCategories resolves the per-site category of the given drafts
// in one bounded query. Each row is reduced to the same small payload shape
// ResolveDraftSourceCategories expects, so the precedence rules exist once and
// are unit tested without a database.
func LoadDraftSourceCategories(db *gorm.DB, ids []uint) (map[uint]DraftSourceCategories, error) {
	out := make(map[uint]DraftSourceCategories, len(ids))
	if db == nil || len(ids) == 0 {
		return out, nil
	}
	rows := make([]draftSourceCategoryRow, 0, len(ids))
	if err := db.Table("ebay_import_drafts").
		Select(draftSourceCategorySelect).
		Where("id IN ?", ids).
		Scan(&rows).Error; err != nil {
		return out, err
	}
	for _, row := range rows {
		raw := map[string]any{
			rawKeySharedCategory: row.SharedCategory,
			"category_leaf":      row.EbayLeaf,
			"collection_name":    row.CollectionName,
			"collection_handle":  row.CollectionHandle,
			"product_type":       row.ProductType,
		}
		// A recorded key is carried across only when the payload has it, because
		// presence is what tells an explicit "no category" from a row written
		// before the split.
		if row.EbayKeyPresent {
			raw[rawKeyEbayCategory] = row.EbayKey
		}
		if row.BasKeyPresent {
			raw[rawKeyBasCategory] = row.BasKey
		}
		if row.EbayCategory != "" {
			raw["_product_data"] = map[string]any{"_shangjia_category": row.EbayCategory}
		}
		out[row.ID] = ResolveDraftSourceCategories(row.SourceSite, raw)
	}
	return out, nil
}
