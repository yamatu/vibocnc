package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"
)

// This file integrates the Datasheets.com product search API
// (GET /api/v1/search) as a read-only reference source for the admin catalogue.
//
// What this integration is *not*: a bulk enrichment pipeline. Measured against
// this catalogue it matches roughly one part number in five, and the parts it
// matches are the electronic ones (Omron sensors, Phoenix Contact terminals,
// relays); FANUC/Siemens/Yaskawa assembly part numbers are absent. The account
// quota is 5,000 calls a month against hundreds of thousands of SKUs. So the
// only defensible design is: an administrator looks up one part number on
// demand, reads what the provider says, and applies what they trust by hand.
//
// Two safety rules, both inherited from the existing spec-research pipeline:
//   - nothing here writes to a product. Callers build a review draft.
//   - a provider record whose MPN is not identical to the requested part number
//     is never treated as a match. The API returns fuzzy neighbours (a search
//     for 3RV1742-5LD10 also returns 3RV1742-5FD10), and publishing a
//     neighbour's parameters under this SKU would be a silent data error.
const (
	datasheetAPIBaseURL   = "https://www.datasheets.com/api/v1/search"
	datasheetAPIUserAgent = "vibocnc-admin/1.0 (+https://vibocnc.com)"
	datasheetCallTimeout  = 15 * time.Second
	// datasheetSpecsPerRecordCap keeps one provider record from flooding the
	// review queue; some semiconductor records carry several dozen parameters.
	datasheetSpecsPerRecordCap = 40
)

// ErrDatasheetNotConfigured means no API key is available at all.
var ErrDatasheetNotConfigured = errors.New("Datasheets.com API key is not configured")

// ErrDatasheetQuotaWaiting means the local guard refused the call: either the
// per-minute/per-hour window is saturated or the monthly budget is spent.
// Callers surface it to the administrator instead of retrying.
type ErrDatasheetQuotaWaiting struct {
	Reason     string
	RetryAfter time.Duration
}

func (e *ErrDatasheetQuotaWaiting) Error() string { return e.Reason }

// DatasheetRecord is one provider result, trimmed to the fields the review UI
// shows and the values it can copy.
type DatasheetRecord struct {
	MPN          string `json:"mpn"`
	Manufacturer string `json:"manufacturer"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	URL          string `json:"url"`
	Category1    string `json:"category1,omitempty"`
	Category2    string `json:"category2,omitempty"`
	Category3    string `json:"category3,omitempty"`
	Category4    string `json:"category4,omitempty"`
	PackageType  string `json:"package_type,omitempty"`
	Lifecycle    string `json:"lifecycle_status,omitempty"`
	DatasheetURL string `json:"datasheet_url,omitempty"`
	ImageURL     string `json:"primary_image_url,omitempty"`
	Specs        []DatasheetSpec `json:"specs,omitempty"`
	// ExactMatch reports that MPN equals the requested part number after
	// normalisation. Only exact matches may become product parameters.
	ExactMatch bool `json:"exact_match"`
}

// DatasheetSpec is one name/value pair as published by the provider.
type DatasheetSpec struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// DatasheetLookup is the answer for one part number, cache or network.
type DatasheetLookup struct {
	Query    string            `json:"query"`
	QueryKey string            `json:"query_key"`
	Page     int               `json:"page"`
	Limit    int               `json:"limit"`
	Count    int               `json:"count"`
	Records  []DatasheetRecord `json:"records"`
	// CacheHit is true when no provider call was made.
	CacheHit bool       `json:"cache_hit"`
	CacheAge string     `json:"cache_age,omitempty"`
	CachedAt *time.Time `json:"cached_at,omitempty"`
	// ExactCount is how many records are exact matches for the part number.
	ExactCount int `json:"exact_count"`
	// QuotaRemaining/QuotaLimit expose the local budget so an administrator can
	// see the cost of what they are about to click.
	QuotaRemaining int    `json:"quota_remaining"`
	QuotaLimit     int    `json:"quota_limit"`
	QuotaMonth     string `json:"quota_month,omitempty"`
	// Notice explains a degraded but successful answer (quota guard, stale
	// cache, provider warning).
	Notice string `json:"notice,omitempty"`
	// Attribution is required by the provider terms: any surface that shows
	// this data must keep the link back to Datasheets.com.
	Attribution string `json:"attribution"`
	FetchedAt   time.Time `json:"fetched_at"`
}

const datasheetAttribution = "Data from Datasheets.com"

// datasheetRawResponse mirrors the provider JSON (docs: Sample Response).
type datasheetRawResponse struct {
	Query   string `json:"query"`
	Page    int    `json:"page"`
	Limit   int    `json:"limit"`
	Count   int    `json:"count"`
	Results []struct {
		MPN              string `json:"mpn"`
		Manufacturer     string `json:"manufacturer"`
		Title            string `json:"title"`
		Description      string `json:"description"`
		URL              string `json:"url"`
		Category1        string `json:"category1"`
		Category2        string `json:"category2"`
		Category3        string `json:"category3"`
		Category4        string `json:"category4"`
		PackageType      string `json:"packageType"`
		LifecycleStatus  string `json:"lifecycleStatus"`
		DatasheetURL     string `json:"datasheetUrl"`
		PrimaryImageURL  string `json:"primaryImageUrl"`
		Specs            []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"specs"`
	} `json:"results"`
}

// DatasheetServiceSettings is a resolved, decrypted view of DatasheetSetting.
type DatasheetServiceSettings struct {
	Enabled          bool
	APIKey           string
	PerMinuteLimit   int
	PerHourLimit     int
	MonthlyLimit     int
	AutoStopPercent  int
	CacheTTLDays     int
	DefaultPageLimit int
}

// LoadDatasheetSettings reads the settings row, falling back to
// DATASHEETS_API_KEY when no key was saved through the UI. The returned row may
// be nil when the table is empty; the settings are then defaults.
func LoadDatasheetSettings(db *gorm.DB) (DatasheetServiceSettings, *models.DatasheetSetting, error) {
	resolved := DatasheetServiceSettings{
		PerMinuteLimit:   60,
		PerHourLimit:     500,
		MonthlyLimit:     5000,
		AutoStopPercent:  90,
		CacheTTLDays:     90,
		DefaultPageLimit: 10,
	}
	if db == nil {
		return resolved, nil, errors.New("database connection failed")
	}
	var setting models.DatasheetSetting
	err := db.Order("id ASC").First(&setting).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return resolved, nil, err
	}
	hasRow := err == nil

	key := ""
	if hasRow && strings.TrimSpace(setting.APIKeyEnc) != "" {
		if plain, decErr := utils.DecryptSecret(setting.APIKeyEnc); decErr == nil {
			key = strings.TrimSpace(plain)
		} else {
			// A rotated SETTINGS_ENCRYPTION_KEY makes old secrets undecryptable.
			// Say so instead of silently behaving as if no key was configured.
			log.Printf("datasheet api: stored key cannot be decrypted: %v", decErr)
		}
	}
	fromEnv := false
	if key == "" {
		if envKey := strings.TrimSpace(os.Getenv("DATASHEETS_API_KEY")); envKey != "" {
			key = envKey
			fromEnv = true
		}
	}

	resolved.APIKey = key
	if hasRow {
		resolved.Enabled = setting.Enabled
		if setting.PerMinuteLimit > 0 {
			resolved.PerMinuteLimit = setting.PerMinuteLimit
		}
		if setting.PerHourLimit > 0 {
			resolved.PerHourLimit = setting.PerHourLimit
		}
		if setting.MonthlyLimit > 0 {
			resolved.MonthlyLimit = setting.MonthlyLimit
		}
		if setting.AutoStopPercent > 0 && setting.AutoStopPercent <= 100 {
			resolved.AutoStopPercent = setting.AutoStopPercent
		}
		if setting.CacheTTLDays >= 0 {
			resolved.CacheTTLDays = setting.CacheTTLDays
		}
		if setting.DefaultPageLimit > 0 {
			resolved.DefaultPageLimit = setting.DefaultPageLimit
		}
	}
	if fromEnv && hasRow {
		setting.APIKeyFromEnv = true
	}
	return resolved, &setting, nil
}

// LookupDatasheetPart resolves one part number, using the cache first and the
// provider second. It is the only function that spends provider quota, so every
// caller goes through the local rate guard here.
func LookupDatasheetPart(ctx context.Context, db *gorm.DB, rawQuery string, page, limit int, refresh bool) (*DatasheetLookup, error) {
	query := strings.TrimSpace(rawQuery)
	if query == "" {
		return nil, errors.New("a part number is required")
	}
	queryKey := DatasheetQueryKey(query)
	if queryKey == "" {
		return nil, fmt.Errorf("part number %q has no searchable characters", query)
	}

	settings, settingRow, err := LoadDatasheetSettings(db)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(settings.APIKey) == "" {
		return nil, ErrDatasheetNotConfigured
	}
	// Enabled is the master switch: with it off, no request leaves the server,
	// whatever button was pressed.
	if !settings.Enabled {
		return nil, errors.New("Datasheets.com lookups are disabled in the admin settings")
	}
	// A manual lookup is one an administrator started and is watching. It is
	// allowed past the automatic-stop threshold but never past the hard monthly
	// limit or the per-minute/per-hour window.
	manual := isDatasheetLookupPrivileged(ctx)
	if limit <= 0 {
		limit = settings.DefaultPageLimit
	}
	if limit > 10 {
		// The provider caps a page at 10 records.
		limit = 10
	}
	if page <= 0 {
		page = 1
	}

	remaining := settings.MonthlyLimit - datasheetMonthlyUsed(settingRow)
	if remaining < 0 {
		remaining = 0
	}

	// Cache first: an identical lookup costs nothing.
	if !refresh {
		if cached, _, ok := readDatasheetCache(db, queryKey, page, limit, settings.CacheTTLDays); ok {
			cached.QuotaRemaining = remaining
			cached.QuotaLimit = settings.MonthlyLimit
			return cached, nil
		}
	}

	// Local quota/rate guard before any network call.
	if err := datasheetRateGuard(ctx, settings, remaining, manual); err != nil {
		// A spent budget still answers with stale cache when one exists: the
		// data is old, but refusing outright teaches the administrator nothing.
		if stale, age, ok := readDatasheetCacheIgnoreTTL(db, queryKey, page, limit); ok {
			stale.CacheHit = true
			stale.CacheAge = age
			stale.QuotaRemaining = remaining
			stale.QuotaLimit = settings.MonthlyLimit
			stale.Notice = fmt.Sprintf("%v Cached copy from %s is shown instead.", err, age)
			return stale, nil
		}
		return nil, err
	}

	records, count, callErr := callDatasheetSearch(ctx, settings.APIKey, query, page, limit)
	now := time.Now()
	datasheetRecordCall(db, settingRow, query, callErr, count)
	if callErr != nil {
		if stale, age, ok := readDatasheetCacheIgnoreTTL(db, queryKey, page, limit); ok {
			stale.CacheHit = true
			stale.CacheAge = age
			stale.QuotaRemaining = maxInt(remaining-1, 0)
			stale.QuotaLimit = settings.MonthlyLimit
			stale.Notice = fmt.Sprintf("Datasheets.com call failed (%v). Cached copy from %s is shown instead.", callErr, age)
			return stale, nil
		}
		return nil, callErr
	}

	lookup := &DatasheetLookup{
		Query:          query,
		QueryKey:       queryKey,
		Page:           page,
		Limit:          limit,
		Count:          count,
		Records:        records,
		Attribution:    datasheetAttribution,
		FetchedAt:      now,
		QuotaLimit:     settings.MonthlyLimit,
		QuotaRemaining: maxInt(remaining-1, 0),
	}
	for _, record := range records {
		if record.ExactMatch {
			lookup.ExactCount++
		}
	}
	if lookup.ExactCount == 0 && len(records) > 0 {
		lookup.Notice = "Datasheets.com returned only similar part numbers, none of which matches this part number exactly. Their values are shown for reference only."
	}

	writeDatasheetCache(db, queryKey, query, page, limit, lookup, settings.CacheTTLDays)
	return lookup, nil
}

// DatasheetQueryKey normalises a part number for cache keys and exact matching.
// It deliberately keeps the hyphen/underscore distinction: 3RV1742-5LD10 and
// 3RV17425LD10 are the same part, but 3RV1742-5LD10 and 3RV1742-5FD10 are not,
// and only the second case decides whether values may be copied.
func DatasheetQueryKey(mpn string) string {
	mpn = strings.TrimSpace(strings.ToUpper(mpn))
	if mpn == "" {
		return ""
	}
	replacer := strings.NewReplacer(
		" ", "", "\t", "", "-", "", "_", "", "/", "", ".", "", "#", "",
	)
	key := replacer.Replace(mpn)
	var b strings.Builder
	for _, r := range key {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '+' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// callDatasheetSearch performs one authenticated provider request.
func callDatasheetSearch(ctx context.Context, apiKey, query string, page, limit int) ([]DatasheetRecord, int, error) {
	endpoint := fmt.Sprintf("%s?q=%s&limit=%d&page=%d", datasheetAPIBaseURL, url.QueryEscape(query), limit, page)
	reqCtx, cancel := context.WithTimeout(ctx, datasheetCallTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", datasheetAPIUserAgent)

	resp, err := newPublicHTTPClient(datasheetCallTimeout).Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("Datasheets.com request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, 0, fmt.Errorf("Datasheets.com response could not be read: %w", err)
	}
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, 0, errors.New("Datasheets.com rejected the API key (401/403). Save a valid key in the admin settings")
	case http.StatusTooManyRequests:
		return nil, 0, errors.New("Datasheets.com rate limit reached (429). Wait a minute and try again")
	default:
		return nil, 0, fmt.Errorf("Datasheets.com returned HTTP %d: %s", resp.StatusCode, truncateForMessage(string(body), 200))
	}

	var raw datasheetRawResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, 0, fmt.Errorf("Datasheets.com response was not valid JSON: %w", err)
	}
	queryKey := DatasheetQueryKey(query)
	records := make([]DatasheetRecord, 0, len(raw.Results))
	for _, item := range raw.Results {
		record := DatasheetRecord{
			MPN:          strings.TrimSpace(item.MPN),
			Manufacturer: strings.TrimSpace(item.Manufacturer),
			Title:        strings.TrimSpace(item.Title),
			Description:  strings.TrimSpace(item.Description),
			URL:          strings.TrimSpace(item.URL),
			Category1:    strings.TrimSpace(item.Category1),
			Category2:    strings.TrimSpace(item.Category2),
			Category3:    strings.TrimSpace(item.Category3),
			Category4:    strings.TrimSpace(item.Category4),
			PackageType:  strings.TrimSpace(item.PackageType),
			Lifecycle:    strings.TrimSpace(item.LifecycleStatus),
			DatasheetURL: strings.TrimSpace(item.DatasheetURL),
			ImageURL:     strings.TrimSpace(item.PrimaryImageURL),
			ExactMatch:   queryKey != "" && DatasheetQueryKey(item.MPN) == queryKey,
		}
		for _, spec := range item.Specs {
			name := strings.TrimSpace(spec.Name)
			value := strings.TrimSpace(spec.Value)
			if name == "" || value == "" {
				continue
			}
			record.Specs = append(record.Specs, DatasheetSpec{Name: name, Value: value})
			if len(record.Specs) >= datasheetSpecsPerRecordCap {
				break
			}
		}
		records = append(records, record)
	}
	return records, raw.Count, nil
}

// datasheetRateGuard enforces the local mirror of the provider quota. Redis is
// used when configured so the limit survives a restart and is shared by every
// worker; otherwise an in-process window keeps the process honest.
func datasheetRateGuard(ctx context.Context, settings DatasheetServiceSettings, remaining int, manual bool) error {
	stopAt := settings.MonthlyLimit
	if settings.AutoStopPercent > 0 {
		stopAt = settings.MonthlyLimit * settings.AutoStopPercent / 100
	}
	if remaining <= 0 {
		return &ErrDatasheetQuotaWaiting{
			Reason: fmt.Sprintf("The monthly Datasheets.com budget is spent (%d/%d calls). It resets at the start of next month, or raise the limit in the admin settings.",
				settings.MonthlyLimit-remaining, settings.MonthlyLimit),
		}
	}
	// The soft threshold only stops unattended work. An administrator who is
	// looking at the result may keep going until the hard limit, otherwise the
	// screen would refuse the very click that was supposed to be supervised.
	if !manual && stopAt > 0 && remaining <= settings.MonthlyLimit-stopAt {
		return &ErrDatasheetQuotaWaiting{
			Reason: fmt.Sprintf("Automatic lookups stopped at %d%% of the monthly budget (%d calls left). Raise the limit in the admin settings to continue.",
				settings.AutoStopPercent, remaining),
		}
	}

	rdb := config.GetRedis()
	now := time.Now()
	minuteKey := "datasheets:rl:min:" + now.Format("200601021504")
	hourKey := "datasheets:rl:hour:" + now.Format("2006010215")
	if rdb != nil {
		pipe := rdb.Pipeline()
		minuteCmd := pipe.Incr(ctx, minuteKey)
		pipe.Expire(ctx, minuteKey, 2*time.Minute)
		hourCmd := pipe.Incr(ctx, hourKey)
		pipe.Expire(ctx, hourKey, 2*time.Hour)
		if _, err := pipe.Exec(ctx); err != nil {
			log.Printf("datasheet api: rate window unavailable, allowing one call: %v", err)
			return nil
		}
		if settings.PerMinuteLimit > 0 && int(minuteCmd.Val()) > settings.PerMinuteLimit {
			return &ErrDatasheetQuotaWaiting{
				Reason:     fmt.Sprintf("Local limit of %d lookups/minute reached. Wait a moment and retry.", settings.PerMinuteLimit),
				RetryAfter: 60 * time.Second,
			}
		}
		if settings.PerHourLimit > 0 && int(hourCmd.Val()) > settings.PerHourLimit {
			return &ErrDatasheetQuotaWaiting{
				Reason:     fmt.Sprintf("Local limit of %d lookups/hour reached. Wait and retry.", settings.PerHourLimit),
				RetryAfter: time.Minute,
			}
		}
		return nil
	}

	datasheetLocalWindow.mu.Lock()
	defer datasheetLocalWindow.mu.Unlock()
	if datasheetLocalWindow.minute != now.Format("200601021504") {
		datasheetLocalWindow.minute = now.Format("200601021504")
		datasheetLocalWindow.minuteCount = 0
	}
	if datasheetLocalWindow.hour != now.Format("2006010215") {
		datasheetLocalWindow.hour = now.Format("2006010215")
		datasheetLocalWindow.hourCount = 0
	}
	if settings.PerMinuteLimit > 0 && datasheetLocalWindow.minuteCount >= settings.PerMinuteLimit {
		return &ErrDatasheetQuotaWaiting{
			Reason:     fmt.Sprintf("Local limit of %d lookups/minute reached. Wait a moment and retry.", settings.PerMinuteLimit),
			RetryAfter: 60 * time.Second,
		}
	}
	if settings.PerHourLimit > 0 && datasheetLocalWindow.hourCount >= settings.PerHourLimit {
		return &ErrDatasheetQuotaWaiting{
			Reason:     fmt.Sprintf("Local limit of %d lookups/hour reached. Wait and retry.", settings.PerHourLimit),
			RetryAfter: time.Minute,
		}
	}
	datasheetLocalWindow.minuteCount++
	datasheetLocalWindow.hourCount++
	return nil
}

var datasheetLocalWindow = struct {
	mu          sync.Mutex
	minute      string
	minuteCount int
	hour        string
	hourCount   int
}{}

// datasheetMonthlyUsed reports the counter for the current billing month,
// treating a stale month as zero.
func datasheetMonthlyUsed(setting *models.DatasheetSetting) int {
	if setting == nil {
		return 0
	}
	month := time.Now().Format("2006-01")
	if setting.QuotaMonth != month {
		return 0
	}
	return setting.MonthlyUsed
}

// datasheetRecordCall persists the call outcome and the monthly counter. It
// never returns an error: failing to update usage statistics must not fail a
// lookup the administrator already paid for.
func datasheetRecordCall(db *gorm.DB, setting *models.DatasheetSetting, query string, callErr error, resultCount int) {
	if db == nil || setting == nil || setting.ID == 0 {
		return
	}
	now := time.Now()
	month := now.Format("2006-01")
	updates := map[string]any{
		"last_call_at":     &now,
		"last_call_query":  truncateForMessage(query, 160),
		"last_call_status": 0,
		"quota_month":      month,
	}
	used := setting.MonthlyUsed
	if setting.QuotaMonth != month {
		used = 0
	}
	updates["monthly_used"] = used + 1
	if callErr != nil {
		updates["last_call_status"] = 1
		updates["last_call_message"] = truncateForMessage(callErr.Error(), 400)
	} else {
		updates["last_call_message"] = fmt.Sprintf("%d record(s) returned", resultCount)
	}
	if err := db.Model(&models.DatasheetSetting{}).Where("id = ?", setting.ID).Updates(updates).Error; err != nil {
		log.Printf("datasheet api: cannot update usage counters: %v", err)
	}
}

// readDatasheetCache returns a cached lookup when it is still fresh.
func readDatasheetCache(db *gorm.DB, queryKey string, page, limit, ttlDays int) (*DatasheetLookup, string, bool) {
	if db == nil || ttlDays <= 0 || page != 1 {
		// Only page 1 is cached: paging deeper is rare and would double the rows.
		return nil, "", false
	}
	lookup, age, ok := readDatasheetCacheIgnoreTTL(db, queryKey, page, limit)
	if !ok {
		return nil, "", false
	}
	var row models.DatasheetLookupCache
	if err := db.Where("query_key = ?", queryKey).First(&row).Error; err != nil {
		return nil, "", false
	}
	if row.ExpiresAt != nil && time.Now().After(*row.ExpiresAt) {
		return nil, "", false
	}
	now := time.Now()
	if err := db.Model(&models.DatasheetLookupCache{}).Where("id = ?", row.ID).
		Updates(map[string]any{"last_hit_at": &now, "hit_count": gorm.Expr("hit_count + 1")}).Error; err != nil {
		log.Printf("datasheet api: cannot record cache hit: %v", err)
	}
	return lookup, age, true
}

// readDatasheetCacheIgnoreTTL returns the cached payload regardless of expiry.
// It backs the "budget spent, show what we already have" path.
func readDatasheetCacheIgnoreTTL(db *gorm.DB, queryKey string, page, limit int) (*DatasheetLookup, string, bool) {
	if db == nil || page != 1 {
		return nil, "", false
	}
	var row models.DatasheetLookupCache
	if err := db.Where("query_key = ?", queryKey).First(&row).Error; err != nil {
		return nil, "", false
	}
	if strings.TrimSpace(row.PayloadJSON) == "" {
		return nil, "", false
	}
	var lookup DatasheetLookup
	if err := json.Unmarshal([]byte(row.PayloadJSON), &lookup); err != nil {
		return nil, "", false
	}
	// The cached payload may predate a provider field; recompute the parts that
	// are pure derivation so the UI never shows a stale match count.
	lookup.CacheHit = true
	lookup.CachedAt = &row.FetchedAt
	lookup.ExactCount = 0
	for i := range lookup.Records {
		lookup.Records[i].ExactMatch = lookup.Records[i].MPN != "" && DatasheetQueryKey(lookup.Records[i].MPN) == queryKey
		if lookup.Records[i].ExactMatch {
			lookup.ExactCount++
		}
	}
	age := time.Since(row.FetchedAt)
	ageLabel := humanizeAge(age)
	lookup.CacheAge = ageLabel
	lookup.Attribution = datasheetAttribution
	return &lookup, ageLabel, true
}

// writeDatasheetCache stores the payload so the next identical lookup is free.
func writeDatasheetCache(db *gorm.DB, queryKey, query string, page, limit int, lookup *DatasheetLookup, ttlDays int) {
	if db == nil || page != 1 || lookup == nil {
		return
	}
	payload, err := json.Marshal(lookup)
	if err != nil {
		log.Printf("datasheet api: cannot serialise cache payload: %v", err)
		return
	}
	var expiresAt *time.Time
	if ttlDays > 0 {
		expiry := lookup.FetchedAt.Add(time.Duration(ttlDays) * 24 * time.Hour)
		expiresAt = &expiry
	}
	row := models.DatasheetLookupCache{
		QueryKey:    queryKey,
		MPN:         truncateForMessage(query, 160),
		ResultCount: len(lookup.Records),
		MatchCount:  lookup.ExactCount,
		PayloadJSON: string(payload),
		FetchedAt:   lookup.FetchedAt,
		ExpiresAt:   expiresAt,
	}
	if err := db.Where("query_key = ?", queryKey).Assign(map[string]any{
		"mpn":          row.MPN,
		"result_count": row.ResultCount,
		"match_count":  row.MatchCount,
		"payload_json": row.PayloadJSON,
		"fetched_at":   row.FetchedAt,
		"expires_at":   row.ExpiresAt,
	}).FirstOrCreate(&models.DatasheetLookupCache{QueryKey: queryKey}).Error; err != nil {
		log.Printf("datasheet api: cannot store cache payload: %v", err)
	}
}

// DatasheetLookupToCandidates converts one record's parameters into review
// candidates. The caller decides whether the record is trustworthy enough to
// publish; this function only refuses to lose provenance.
func DatasheetLookupToCandidates(record DatasheetRecord) []SpecResearchCandidate {
	if !record.ExactMatch || len(record.Specs) == 0 {
		return nil
	}
	sourceURL := strings.TrimSpace(record.URL)
	if sourceURL == "" {
		sourceURL = datasheetAPIBaseURL + "?q=" + url.QueryEscape(record.MPN)
	}
	sourceTitle := datasheetAttribution
	if record.Manufacturer != "" {
		sourceTitle = fmt.Sprintf("%s · %s %s", datasheetAttribution, record.Manufacturer, record.MPN)
	}
	candidates := make([]SpecResearchCandidate, 0, len(record.Specs))
	for _, spec := range record.Specs {
		candidates = append(candidates, SpecResearchCandidate{
			Label:       CanonicalSpecLabel(spec.Name),
			Value:       spec.Value,
			SourceURL:   sourceURL,
			SourceTitle: sourceTitle,
			SourceType:  "datasheet-api",
			Evidence:    fmt.Sprintf("%s: %s", spec.Name, spec.Value),
			Origin:      "datasheet",
		})
	}
	return candidates
}

// DatasheetSuggestedProductFields returns the low-risk catalogue fields a
// record can offer, shown as suggestions and never applied automatically.
func DatasheetSuggestedProductFields(record DatasheetRecord) map[string]string {
	suggestions := map[string]string{}
	if !record.ExactMatch {
		return suggestions
	}
	if v := strings.TrimSpace(record.DatasheetURL); v != "" {
		suggestions["datasheet_url"] = v
	}
	if v := strings.TrimSpace(record.Description); v != "" {
		suggestions["short_description"] = truncateForMessage(v, 500)
	}
	if v := strings.TrimSpace(record.Lifecycle); v != "" {
		suggestions["lifecycle_status"] = v
	}
	if v := strings.TrimSpace(record.PackageType); v != "" {
		suggestions["package_type"] = v
	}
	if v := strings.TrimSpace(record.Manufacturer); v != "" {
		suggestions["manufacturer"] = v
	}
	return suggestions
}

// isDatasheetLookupPrivileged reports that the caller explicitly asked for a
// lookup (the administrator pressed a button), which is allowed even when the
// background switch is off. The existing admin endpoints are already behind
// AdminOnly middleware, so the flag only distinguishes automatic runs.
func isDatasheetLookupPrivileged(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	return ctx.Value(datasheetManualLookupKey{}) == true
}

type datasheetManualLookupKey struct{}

// WithManualDatasheetLookup marks a context as an explicit administrator
// lookup, so the Enabled switch (which governs automatic runs) does not block
// the button an administrator just pressed.
func WithManualDatasheetLookup(ctx context.Context) context.Context {
	return context.WithValue(ctx, datasheetManualLookupKey{}, true)
}

func humanizeAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%d minutes ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%d hours ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%d days ago", int(d.Hours()/24))
	}
}

func truncateForMessage(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}

// ParseDatasheetPageQuery reads the paging parameters of an admin lookup.
func ParseDatasheetPageQuery(pageRaw, limitRaw string) (int, int) {
	page, _ := strconv.Atoi(strings.TrimSpace(pageRaw))
	limit, _ := strconv.Atoi(strings.TrimSpace(limitRaw))
	return page, limit
}
