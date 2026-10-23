package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	neturl "net/url"
	"os"
	"strings"
	"time"

	"fanuc-backend/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var indexNowHTTPClient = &http.Client{Timeout: 20 * time.Second}

type IndexNowService struct {
	db *gorm.DB
}

type IndexNowSubmitResult struct {
	Host           string    `json:"host"`
	KeyLocation    string    `json:"key_location"`
	SubmittedURLs  int       `json:"submitted_urls"`
	URLListPreview []string  `json:"url_list_preview,omitempty"`
	StatusCode     int       `json:"status_code"`
	ResponseBody   string    `json:"response_body,omitempty"`
	SubmittedAt    time.Time `json:"submitted_at"`
}

type indexNowRequest struct {
	Host        string   `json:"host"`
	Key         string   `json:"key"`
	KeyLocation string   `json:"keyLocation"`
	URLList     []string `json:"urlList"`
}

func NewIndexNowService(db *gorm.DB) *IndexNowService {
	return &IndexNowService{db: db}
}

func getDefaultSiteURL() string {
	if v := strings.TrimSpace(os.Getenv("SITE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	if v := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_SITE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://vibocnc.com"
}

func normalizeSiteURL(input string) string {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return getDefaultSiteURL()
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		raw = "https://" + raw
	}
	return strings.TrimRight(raw, "/")
}

func getOrCreateIndexNowSetting(db *gorm.DB) (*models.IndexNowSetting, error) {
	var s models.IndexNowSetting
	if err := db.First(&s, 1).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s = models.IndexNowSetting{
				ID:                       1,
				Enabled:                  false,
				SiteURL:                  getDefaultSiteURL(),
				AutoSubmitProductUpdates: true,
			}
			if e := db.Create(&s).Error; e != nil {
				return nil, e
			}
			return &s, nil
		}
		return nil, err
	}
	if strings.TrimSpace(s.SiteURL) == "" {
		s.SiteURL = getDefaultSiteURL()
	}
	return &s, nil
}

func (s *IndexNowService) GetOrCreateSetting() (*models.IndexNowSetting, error) {
	return getOrCreateIndexNowSetting(s.db)
}

func BuildIndexNowResponse(setting *models.IndexNowSetting) models.IndexNowSettingResponse {
	siteURL := normalizeSiteURL(setting.SiteURL)
	host := ""
	if u, err := neturl.Parse(siteURL); err == nil {
		host = u.Hostname()
	}
	keyLocation := ""
	key := strings.TrimSpace(setting.Key)
	if key != "" {
		keyLocation = fmt.Sprintf("%s/%s.txt", siteURL, key)
	}
	return models.IndexNowSettingResponse{
		ID:                       setting.ID,
		Enabled:                  setting.Enabled,
		Key:                      key,
		SiteURL:                  siteURL,
		AutoSubmitProductUpdates: setting.AutoSubmitProductUpdates,
		KeyLocation:              keyLocation,
		Host:                     host,
		LastSubmittedAt:          setting.LastSubmittedAt,
		LastSubmissionHost:       setting.LastSubmissionHost,
		LastSubmissionURLs:       setting.LastSubmissionURLs,
		LastSubmissionCode:       setting.LastSubmissionCode,
		LastSubmissionNote:       setting.LastSubmissionNote,
		CreatedAt:                setting.CreatedAt,
		UpdatedAt:                setting.UpdatedAt,
	}
}

func (s *IndexNowService) SubmitURLs(ctx context.Context, inputURLs []string) (*IndexNowSubmitResult, error) {
	setting, err := s.GetOrCreateSetting()
	if err != nil {
		return nil, err
	}
	if !setting.Enabled {
		return nil, errors.New("indexnow is disabled")
	}

	key := strings.TrimSpace(setting.Key)
	if key == "" {
		return nil, errors.New("indexnow key is not set")
	}

	siteURL := normalizeSiteURL(setting.SiteURL)
	u, err := neturl.Parse(siteURL)
	if err != nil || strings.TrimSpace(u.Hostname()) == "" {
		return nil, errors.New("invalid site_url")
	}
	host := u.Hostname()
	keyLocation := fmt.Sprintf("%s/%s.txt", siteURL, key)

	seen := make(map[string]bool)
	urlList := make([]string, 0, len(inputURLs))
	for _, raw := range inputURLs {
		item := strings.TrimSpace(raw)
		if item == "" {
			continue
		}
		parsed, err := neturl.Parse(item)
		if err != nil {
			return nil, fmt.Errorf("invalid url: %s", item)
		}
		if !strings.EqualFold(parsed.Hostname(), host) {
			return nil, fmt.Errorf("url host mismatch: %s", item)
		}
		normalized := parsed.String()
		if !seen[normalized] {
			seen[normalized] = true
			urlList = append(urlList, normalized)
		}
	}
	if len(urlList) == 0 {
		return nil, errors.New("no urls to submit")
	}

	body := indexNowRequest{
		Host:        host,
		Key:         key,
		KeyLocation: keyLocation,
		URLList:     urlList,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.indexnow.org/IndexNow", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := indexNowHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var responseBody bytes.Buffer
	_, _ = responseBody.ReadFrom(resp.Body)
	result := &IndexNowSubmitResult{
		Host:           host,
		KeyLocation:    keyLocation,
		SubmittedURLs:  len(urlList),
		URLListPreview: buildURLPreview(urlList, 5),
		StatusCode:     resp.StatusCode,
		ResponseBody:   strings.TrimSpace(responseBody.String()),
		SubmittedAt:    time.Now().UTC(),
	}

	note := result.ResponseBody
	if note == "" {
		note = http.StatusText(resp.StatusCode)
	}
	_ = s.db.Model(&models.IndexNowSetting{}).Where("id = ?", setting.ID).Updates(map[string]any{
		"last_submitted_at":    result.SubmittedAt,
		"last_submission_host": host,
		"last_submission_urls": len(urlList),
		"last_submission_code": resp.StatusCode,
		"last_submission_note": note,
	}).Error

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if result.ResponseBody == "" {
			result.ResponseBody = http.StatusText(resp.StatusCode)
		}
		return result, fmt.Errorf("indexnow request failed: %d %s", resp.StatusCode, strings.TrimSpace(result.ResponseBody))
	}

	return result, nil
}

func (s *IndexNowService) VerifyKeyFile(ctx context.Context) (map[string]any, error) {
	setting, err := s.GetOrCreateSetting()
	if err != nil {
		return nil, err
	}

	key := strings.TrimSpace(setting.Key)
	if key == "" {
		return nil, errors.New("indexnow key is not set")
	}

	siteURL := normalizeSiteURL(setting.SiteURL)
	keyLocation := fmt.Sprintf("%s/%s.txt", siteURL, key)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, keyLocation, nil)
	if err != nil {
		return nil, err
	}

	resp, err := indexNowHTTPClient.Do(req)
	if err != nil {
		return map[string]any{
			"key_location": keyLocation,
			"status_code":  0,
			"body":         "",
			"valid":        false,
		}, err
	}
	defer resp.Body.Close()

	var body bytes.Buffer
	_, _ = body.ReadFrom(resp.Body)
	text := strings.TrimSpace(body.String())
	valid := resp.StatusCode >= 200 && resp.StatusCode < 300 && text == key

	result := map[string]any{
		"key_location": keyLocation,
		"status_code":  resp.StatusCode,
		"body":         text,
		"valid":        valid,
	}

	if !valid {
		return result, fmt.Errorf("key file verification failed: status=%d body=%q", resp.StatusCode, text)
	}

	return result, nil
}

func BuildProductCanonicalURL(siteURL, sku string) string {
	base := normalizeSiteURL(siteURL)
	publicPath := BuildProductPublicPath(sku)
	if publicPath == "" {
		return base
	}
	return base + publicPath
}

var supportedPublicLocaleCodes = map[string]bool{
	"zh": true, "es": true, "de": true, "fr": true, "it": true,
	"pt": true, "ja": true, "ko": true, "ru": true, "ar": true,
}

func normalizePublicLocaleCode(code string) string {
	code = strings.ToLower(strings.TrimSpace(code))
	if idx := strings.IndexAny(code, "-_"); idx >= 0 {
		code = code[:idx]
	}
	if supportedPublicLocaleCodes[code] {
		return code
	}
	return ""
}

func localizedPublicURL(siteURL, publicPath, locale string) string {
	base := normalizeSiteURL(siteURL)
	path := strings.TrimSpace(publicPath)
	if path == "" {
		path = "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if normalizedLocale := normalizePublicLocaleCode(locale); normalizedLocale != "" {
		path = "/" + normalizedLocale + path
	}
	if path == "/" {
		return base + "/"
	}
	return base + path
}

func hasIndexableProductTranslation(translation models.ProductTranslation) bool {
	return normalizePublicLocaleCode(translation.LanguageCode) != "" &&
		strings.TrimSpace(translation.Name) != "" &&
		(strings.TrimSpace(translation.Description) != "" || strings.TrimSpace(translation.ShortDescription) != "")
}

func hasIndexableArticleTranslation(translation models.ArticleTranslation) bool {
	return normalizePublicLocaleCode(translation.LanguageCode) != "" &&
		strings.TrimSpace(translation.Title) != "" && strings.TrimSpace(translation.Content) != ""
}

func BuildProductIndexNowURLs(siteURL string, product models.Product) []string {
	publicPath := BuildProductPublicPath(product.SKU)
	urls := []string{
		localizedPublicURL(siteURL, publicPath, ""),
		localizedPublicURL(siteURL, "/products", ""),
		normalizeSiteURL(siteURL) + "/sitemap.xml",
	}
	for _, translation := range product.Translations {
		if !hasIndexableProductTranslation(translation) {
			continue
		}
		locale := normalizePublicLocaleCode(translation.LanguageCode)
		urls = append(urls,
			localizedPublicURL(siteURL, publicPath, locale),
			localizedPublicURL(siteURL, "/products", locale),
		)
	}
	return urls
}

func LoadProductIndexNowURLs(db *gorm.DB, siteURL string, product models.Product) []string {
	if db != nil && product.ID > 0 && len(product.Translations) == 0 {
		_ = db.Where("product_id = ?", product.ID).Find(&product.Translations).Error
	}
	return BuildProductIndexNowURLs(siteURL, product)
}

func BuildArticleIndexNowURLs(siteURL string, article models.Article, publicPath string) []string {
	sectionPath := "/news"
	sitemapPath := "/sitemap-news.xml"
	if strings.EqualFold(strings.TrimSpace(article.ContentType), "blog") {
		sectionPath = "/blog"
		sitemapPath = "/sitemap-blog.xml"
	}
	urls := []string{
		localizedPublicURL(siteURL, publicPath, ""),
		localizedPublicURL(siteURL, sectionPath, ""),
		normalizeSiteURL(siteURL) + sitemapPath,
	}
	for _, translation := range article.Translations {
		if !hasIndexableArticleTranslation(translation) {
			continue
		}
		locale := normalizePublicLocaleCode(translation.LanguageCode)
		urls = append(urls,
			localizedPublicURL(siteURL, publicPath, locale),
			localizedPublicURL(siteURL, sectionPath, locale),
		)
	}
	return urls
}

func LoadArticleIndexNowURLs(db *gorm.DB, siteURL string, article models.Article, publicPath string) []string {
	if db != nil && article.ID > 0 && len(article.Translations) == 0 {
		_ = db.Where("article_id = ?", article.ID).Find(&article.Translations).Error
	}
	return BuildArticleIndexNowURLs(siteURL, article, publicPath)
}

func BuildDefaultIndexNowURLs(siteURL string) []string {
	base := normalizeSiteURL(siteURL)
	return []string{
		base + "/",
		base + "/products",
		base + "/categories",
		base + "/repair-request",
		base + "/news",
		base + "/blog",
		base + "/about",
		base + "/contact",
		base + "/faq",
		base + "/shipping-policy",
		base + "/technical-support",
		base + "/warranty",
		base + "/warranty-policy",
		base + "/returns",
		base + "/privacy",
		base + "/terms",
		base + "/sitemap.xml",
		base + "/sitemap-static.xml",
		base + "/sitemap-categories.xml",
		base + "/sitemap-news.xml",
		base + "/sitemap-blog.xml",
	}
}

func SubmitProductURLBestEffort(ctx context.Context, db *gorm.DB, sku string) {
	if db == nil {
		return
	}
	service := NewIndexNowService(db)
	setting, err := service.GetOrCreateSetting()
	if err != nil {
		return
	}
	if !setting.Enabled || !setting.AutoSubmitProductUpdates || strings.TrimSpace(setting.Key) == "" {
		return
	}
	var product models.Product
	if err := db.Preload("Translations").Where("sku = ?", sku).First(&product).Error; err != nil || product.SEONoIndex {
		return
	}
	result, err := service.SubmitURLs(ctx, BuildProductIndexNowURLs(setting.SiteURL, product))
	if err != nil || result == nil {
		return
	}
	now := result.SubmittedAt
	_ = db.Model(&models.Product{}).
		Where("sku = ?", sku).
		Updates(map[string]any{
			"index_now_last_submitted_at": now,
			"index_now_submit_count":      gorm.Expr("COALESCE(index_now_submit_count, 0) + 1"),
			"index_now_last_submit_code":  result.StatusCode,
		}).Error
}

const maxIndexNowURLsPerRequest = 10000

// SubmitProductBatchURLsBestEffort sends changed product URLs to IndexNow in
// protocol-sized batches. A large AI SEO job can update 30,000 products, and
// translated product URLs can exceed IndexNow's 10,000-URL list limit.
func SubmitProductBatchURLsBestEffort(ctx context.Context, db *gorm.DB, productIDs []uint) {
	if db == nil || len(productIDs) == 0 {
		return
	}
	service := NewIndexNowService(db)
	setting, err := service.GetOrCreateSetting()
	if err != nil || !setting.Enabled || !setting.AutoSubmitProductUpdates || strings.TrimSpace(setting.Key) == "" {
		return
	}
	var products []models.Product
	if err := db.Preload("Translations").Where("id IN ? AND is_active = ? AND seo_noindex = ?", productIDs, true, false).Find(&products).Error; err != nil || len(products) == 0 {
		return
	}
	urls := make([]string, 0, minInt(len(products)*2+2, maxIndexNowURLsPerRequest))
	seen := make(map[string]bool)
	submittedIDs := make([]uint, 0, len(products))
	submitBatch := func() bool {
		if len(urls) == 0 || len(submittedIDs) == 0 {
			return true
		}
		result, submitErr := service.SubmitURLs(ctx, urls)
		if submitErr == nil && result != nil {
			_ = MarkProductsIndexNowSubmitted(db, submittedIDs, result.SubmittedAt, result.StatusCode)
		}
		// Best effort means a failed batch must not prevent later product URLs
		// from being attempted (unless the caller deadline has elapsed).
		urls = make([]string, 0, maxIndexNowURLsPerRequest)
		seen = make(map[string]bool)
		submittedIDs = make([]uint, 0)
		return ctx.Err() == nil
	}
	for _, product := range products {
		productURLs := BuildProductIndexNowURLs(setting.SiteURL, product)
		newURLs := 0
		for _, item := range productURLs {
			if !seen[item] {
				newURLs++
			}
		}
		if len(urls) > 0 && len(urls)+newURLs > maxIndexNowURLsPerRequest {
			if !submitBatch() {
				return
			}
		}
		submittedIDs = append(submittedIDs, product.ID)
		for _, item := range productURLs {
			if !seen[item] {
				seen[item] = true
				urls = append(urls, item)
			}
		}
	}
	_ = submitBatch()
}

func SubmitArticleURLsBestEffort(ctx context.Context, db *gorm.DB, articleID uint, publicPath string) {
	if db == nil || articleID == 0 {
		return
	}
	service := NewIndexNowService(db)
	setting, err := service.GetOrCreateSetting()
	if err != nil || !setting.Enabled || strings.TrimSpace(setting.Key) == "" {
		return
	}
	var article models.Article
	if err := db.Preload("Translations").First(&article, articleID).Error; err != nil || !article.IsPublished {
		return
	}
	_, _ = service.SubmitURLs(ctx, BuildArticleIndexNowURLs(setting.SiteURL, article, publicPath))
}

func MarkProductsIndexNowSubmitted(db *gorm.DB, productIDs []uint, submittedAt time.Time, statusCode int) error {
	if db == nil || len(productIDs) == 0 {
		return nil
	}
	return db.Model(&models.Product{}).
		Where("id IN ?", productIDs).
		Clauses(clause.Returning{}).
		Updates(map[string]any{
			"index_now_last_submitted_at": submittedAt,
			"index_now_submit_count":      gorm.Expr("COALESCE(index_now_submit_count, 0) + 1"),
			"index_now_last_submit_code":  statusCode,
		}).Error
}

func buildURLPreview(urlList []string, limit int) []string {
	if len(urlList) == 0 || limit <= 0 {
		return nil
	}
	if len(urlList) <= limit {
		out := make([]string, len(urlList))
		copy(out, urlList)
		return out
	}
	out := make([]string, limit)
	copy(out, urlList[:limit])
	return out
}

func IsIndexNowOwnershipError(result *IndexNowSubmitResult) bool {
	if result == nil || result.StatusCode != http.StatusForbidden {
		return false
	}
	body := strings.ToLower(strings.TrimSpace(result.ResponseBody))
	return strings.Contains(body, "userforbiddedtoaccesssite") ||
		strings.Contains(body, "user is unauthorized to access the site")
}
