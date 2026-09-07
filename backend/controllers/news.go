package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type NewsController struct{}

func respondArticleReadError(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Article not found"})
		return
	}
	_ = c.Error(err)
	c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "Articles temporarily unavailable"})
}

func withArticlePreloads(db *gorm.DB) *gorm.DB {
	return db.Preload("Author").Preload("Translations").Preload("FeaturedMedia")
}

var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)
var multiSlashes = regexp.MustCompile(`/+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonSlugChars.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "article"
	}
	return s
}

func normalizeCustomPath(path string) string {
	path = strings.TrimSpace(path)
	path = strings.ReplaceAll(path, "\\", "/")
	path = strings.Trim(path, "/")
	path = multiSlashes.ReplaceAllString(path, "/")
	if path == "" {
		return ""
	}

	parts := strings.Split(path, "/")
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		part = slugify(part)
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}

	return strings.Join(cleaned, "/")
}

func ensureUniqueSlug(db *gorm.DB, slug string, excludeID uint) string {
	base := slug
	suffix := 1
	for {
		var count int64
		q := db.Model(&models.Article{}).Where("slug = ?", slug)
		if excludeID > 0 {
			q = q.Where("id != ?", excludeID)
		}
		q.Count(&count)
		if count == 0 {
			return slug
		}
		suffix++
		slug = base + "-" + strconv.Itoa(suffix)
	}
}

func ensureUniqueCustomPath(db *gorm.DB, path string, excludeID uint) string {
	base := path
	suffix := 1
	for {
		var count int64
		q := db.Model(&models.Article{}).Where("custom_path = ?", path)
		if excludeID > 0 {
			q = q.Where("id != ?", excludeID)
		}
		q.Count(&count)
		if count == 0 {
			return path
		}
		suffix++
		path = base + "-" + strconv.Itoa(suffix)
	}
}

func getArticlePublicPath(article models.Article) string {
	if strings.TrimSpace(article.CustomPath) != "" {
		return "/" + strings.Trim(article.CustomPath, "/")
	}
	contentType := normalizeContentType(article.ContentType)
	return "/" + contentType + "/" + article.Slug
}

// defaultArticleCustomPath keeps the unique custom_path index usable for
// articles that do not request a custom URL. The generated value is the same
// canonical path that getArticlePublicPath would return for an empty field.
func defaultArticleCustomPath(contentType, slug string) string {
	return normalizeContentType(contentType) + "/" + strings.Trim(slug, "/")
}

// isGeneratedArticleCustomPath identifies the path that was automatically
// assigned when an article was created without an explicit custom URL. It is
// important to distinguish this from a deliberate custom path while editing.
func isGeneratedArticleCustomPath(path, contentType, slug string) bool {
	normalized := normalizeCustomPath(path)
	return normalized == defaultArticleCustomPath(contentType, slug) ||
		normalized == defaultArticleCustomPath("news", slug) ||
		normalized == defaultArticleCustomPath("blog", slug)
}

func normalizeContentType(contentType string) string {
	if strings.EqualFold(strings.TrimSpace(contentType), "blog") {
		return "blog"
	}
	return "news"
}

func withContentTypeFilter(q *gorm.DB, contentType string) *gorm.DB {
	normalizedType := normalizeContentType(contentType)
	if normalizedType == "news" {
		return q.Where("content_type = ? OR content_type IS NULL OR content_type = ''", normalizedType)
	}
	return q.Where("content_type = ?", normalizedType)
}

func articleCacheURLs(article models.Article) []string {
	return []string{getArticlePublicPath(article), "/news", "/blog", "/sitemap.xml", "/sitemap-news.xml", "/sitemap-blog.xml"}
}

func parseStringArrayJSON(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	return out
}

func parseUintArrayJSON(raw string) []uint {
	if strings.TrimSpace(raw) == "" {
		return []uint{}
	}
	var out []uint
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []uint{}
	}
	return out
}

func resolveMediaURLs(db *gorm.DB, featuredMediaID *uint, galleryMediaIDs []uint) (string, []string) {
	featuredURL := ""
	if featuredMediaID != nil && *featuredMediaID > 0 {
		var featured models.MediaAsset
		if err := db.First(&featured, *featuredMediaID).Error; err == nil {
			featuredURL = featured.ToResponse().URL
		}
	}

	if len(galleryMediaIDs) == 0 {
		return featuredURL, []string{}
	}

	var assets []models.MediaAsset
	if err := db.Where("id IN ?", galleryMediaIDs).Find(&assets).Error; err != nil {
		return featuredURL, []string{}
	}

	byID := make(map[uint]string, len(assets))
	for _, a := range assets {
		byID[a.ID] = a.ToResponse().URL
	}

	galleryURLs := make([]string, 0, len(galleryMediaIDs))
	for _, id := range galleryMediaIDs {
		if u, ok := byID[id]; ok && strings.TrimSpace(u) != "" {
			galleryURLs = append(galleryURLs, u)
		}
	}

	return featuredURL, galleryURLs
}

func createSEORedirect(db *gorm.DB, oldPath, newPath string) {
	oldPath = strings.TrimSpace(oldPath)
	newPath = strings.TrimSpace(newPath)
	if oldPath == "" || newPath == "" || oldPath == newPath {
		return
	}

	var redirect models.SEORedirect
	err := db.Where("old_url = ?", oldPath).First(&redirect).Error
	if err == nil {
		db.Model(&redirect).Updates(map[string]interface{}{
			"new_url":       newPath,
			"redirect_type": "301",
			"is_active":     true,
		})
		return
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return
	}

	db.Create(&models.SEORedirect{
		OldURL:       oldPath,
		NewURL:       newPath,
		RedirectType: "301",
		IsActive:     true,
	})
}

type ArticleResponse struct {
	ID              uint                        `json:"id"`
	Title           string                      `json:"title"`
	Slug            string                      `json:"slug"`
	CustomPath      string                      `json:"custom_path"`
	PublicPath      string                      `json:"public_path"`
	Summary         string                      `json:"summary"`
	Content         string                      `json:"content"`
	ContentType     string                      `json:"content_type"`
	FeaturedImage   string                      `json:"featured_image"`
	FeaturedMediaID *uint                       `json:"featured_media_id"`
	FeaturedMedia   *models.MediaAsset          `json:"featured_media,omitempty"`
	ImageURLs       []string                    `json:"image_urls"`
	GalleryMediaIDs []uint                      `json:"gallery_media_ids"`
	IsPublished     bool                        `json:"is_published"`
	IsFeatured      bool                        `json:"is_featured"`
	MetaTitle       string                      `json:"meta_title"`
	MetaDescription string                      `json:"meta_description"`
	MetaKeywords    string                      `json:"meta_keywords"`
	AuthorID        uint                        `json:"author_id"`
	Author          models.AdminUser            `json:"author"`
	ViewCount       int                         `json:"view_count"`
	SortOrder       int                         `json:"sort_order"`
	PublishedAt     *time.Time                  `json:"published_at"`
	CreatedAt       time.Time                   `json:"created_at"`
	UpdatedAt       time.Time                   `json:"updated_at"`
	Translations    []models.ArticleTranslation `json:"translations,omitempty"`
}

func toArticleResponse(article models.Article) ArticleResponse {
	return ArticleResponse{
		ID:              article.ID,
		Title:           article.Title,
		Slug:            article.Slug,
		CustomPath:      article.CustomPath,
		PublicPath:      getArticlePublicPath(article),
		Summary:         article.Summary,
		Content:         article.Content,
		ContentType:     normalizeContentType(article.ContentType),
		FeaturedImage:   article.FeaturedImage,
		FeaturedMediaID: article.FeaturedMediaID,
		FeaturedMedia:   article.FeaturedMedia,
		ImageURLs:       parseStringArrayJSON(article.ImageURLs),
		GalleryMediaIDs: parseUintArrayJSON(article.GalleryMediaIDs),
		IsPublished:     article.IsPublished,
		IsFeatured:      article.IsFeatured,
		MetaTitle:       article.MetaTitle,
		MetaDescription: article.MetaDescription,
		MetaKeywords:    article.MetaKeywords,
		AuthorID:        article.AuthorID,
		Author:          article.Author,
		ViewCount:       article.ViewCount,
		SortOrder:       article.SortOrder,
		PublishedAt:     article.PublishedAt,
		CreatedAt:       article.CreatedAt,
		UpdatedAt:       article.UpdatedAt,
		Translations:    article.Translations,
	}
}

func toArticleResponses(articles []models.Article) []ArticleResponse {
	out := make([]ArticleResponse, 0, len(articles))
	for _, article := range articles {
		out = append(out, toArticleResponse(article))
	}
	return out
}

func (nc *NewsController) GetPublicArticles(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "12"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 12
	}

	q := withArticlePreloads(db).Where("is_published = ?", true)
	if contentType := strings.TrimSpace(c.Query("content_type")); contentType != "" {
		q = withContentTypeFilter(q, contentType)
	}

	if search := c.Query("search"); search != "" {
		like := "%" + search + "%"
		q = q.Where("title LIKE ? OR summary LIKE ? OR custom_path LIKE ?", like, like, like)
	}
	if c.Query("is_featured") == "true" {
		q = q.Where("is_featured = ?", true)
	}

	var total int64
	if err := q.Model(&models.Article{}).Count(&total).Error; err != nil {
		respondArticleReadError(c, err)
		return
	}

	var articles []models.Article
	if err := q.Order("sort_order DESC, published_at DESC, created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&articles).Error; err != nil {
		respondArticleReadError(c, err)
		return
	}

	totalPages := int(total) / pageSize
	if int(total)%pageSize > 0 {
		totalPages++
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "OK",
		Data: models.PaginationResponse{
			Data:       toArticleResponses(articles),
			Page:       page,
			PageSize:   pageSize,
			Total:      total,
			TotalPages: totalPages,
		},
	})
}

func (nc *NewsController) GetPublicArticle(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}

	var article models.Article
	if err := withArticlePreloads(db).Where("id = ? AND is_published = ?", id, true).First(&article).Error; err != nil {
		respondArticleReadError(c, err)
		return
	}

	db.Model(&article).UpdateColumn("view_count", gorm.Expr("view_count + 1"))
	article.ViewCount++

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: toArticleResponse(article)})
}

func (nc *NewsController) GetPublicArticleBySlug(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	slug := c.Param("slug")
	var article models.Article
	q := withArticlePreloads(db).Where("slug = ? AND is_published = ?", slug, true)
	if contentType := strings.TrimSpace(c.Query("content_type")); contentType != "" {
		q = withContentTypeFilter(q, contentType)
	}
	if err := q.First(&article).Error; err != nil {
		respondArticleReadError(c, err)
		return
	}

	db.Model(&article).UpdateColumn("view_count", gorm.Expr("view_count + 1"))
	article.ViewCount++

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: toArticleResponse(article)})
}

func (nc *NewsController) GetPublicArticleByPath(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	path := normalizeCustomPath(c.Param("path"))
	if path == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid path"})
		return
	}

	var article models.Article
	if err := withArticlePreloads(db).Where("custom_path = ? AND is_published = ?", path, true).First(&article).Error; err != nil {
		respondArticleReadError(c, err)
		return
	}

	db.Model(&article).UpdateColumn("view_count", gorm.Expr("view_count + 1"))
	article.ViewCount++

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: toArticleResponse(article)})
}

func (nc *NewsController) GetArticles(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	q := withArticlePreloads(db)
	if contentType := strings.TrimSpace(c.Query("content_type")); contentType != "" {
		q = withContentTypeFilter(q, contentType)
	}

	if search := c.Query("search"); search != "" {
		like := "%" + search + "%"
		q = q.Where("title LIKE ? OR summary LIKE ? OR content LIKE ? OR slug LIKE ? OR custom_path LIKE ?", like, like, like, like, like)
	}
	if pub := c.Query("is_published"); pub != "" {
		q = q.Where("is_published = ?", pub == "true" || pub == "1")
	}
	if c.Query("is_featured") == "true" {
		q = q.Where("is_featured = ?", true)
	}

	var total int64
	q.Model(&models.Article{}).Count(&total)

	var articles []models.Article
	q.Order("sort_order DESC, created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&articles)

	totalPages := int(total) / pageSize
	if int(total)%pageSize > 0 {
		totalPages++
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "OK",
		Data: models.PaginationResponse{
			Data:       toArticleResponses(articles),
			Page:       page,
			PageSize:   pageSize,
			Total:      total,
			TotalPages: totalPages,
		},
	})
}

func (nc *NewsController) GetArticle(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}

	var article models.Article
	if err := withArticlePreloads(db).First(&article, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Article not found"})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: toArticleResponse(article)})
}

func (nc *NewsController) CreateArticle(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var req models.ArticleCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	slug := req.Slug
	if slug == "" {
		slug = slugify(req.Title)
	}
	slug = ensureUniqueSlug(db, slugify(slug), 0)

	customPath := normalizeCustomPath(req.CustomPath)
	if customPath != "" {
		customPath = ensureUniqueCustomPath(db, customPath, 0)
	} else {
		customPath = ensureUniqueCustomPath(db, defaultArticleCustomPath(req.ContentType, slug), 0)
	}

	featuredImage := strings.TrimSpace(req.FeaturedImage)
	imageURLs := req.ImageURLs
	mediaFeaturedURL, mediaGalleryURLs := resolveMediaURLs(db, req.FeaturedMediaID, req.GalleryMediaIDs)
	if featuredImage == "" && mediaFeaturedURL != "" {
		featuredImage = mediaFeaturedURL
	}
	if len(imageURLs) == 0 && len(mediaGalleryURLs) > 0 {
		imageURLs = mediaGalleryURLs
	}

	imageURLsJSON := "[]"
	if len(imageURLs) > 0 {
		if b, err := json.Marshal(imageURLs); err == nil {
			imageURLsJSON = string(b)
		}
	}

	galleryMediaIDsJSON := "[]"
	if len(req.GalleryMediaIDs) > 0 {
		if b, err := json.Marshal(req.GalleryMediaIDs); err == nil {
			galleryMediaIDsJSON = string(b)
		}
	}

	userID, _ := c.Get("userID")
	authorID := uint(0)
	switch v := userID.(type) {
	case uint:
		authorID = v
	case float64:
		authorID = uint(v)
	}

	var publishedAt *time.Time
	if req.IsPublished {
		now := time.Now()
		publishedAt = &now
	}

	article := models.Article{
		Title:           req.Title,
		Slug:            slug,
		CustomPath:      customPath,
		Summary:         req.Summary,
		Content:         req.Content,
		ContentType:     normalizeContentType(req.ContentType),
		FeaturedImage:   featuredImage,
		FeaturedMediaID: req.FeaturedMediaID,
		ImageURLs:       imageURLsJSON,
		GalleryMediaIDs: galleryMediaIDsJSON,
		IsPublished:     req.IsPublished,
		IsFeatured:      req.IsFeatured,
		MetaTitle:       req.MetaTitle,
		MetaDescription: req.MetaDescription,
		MetaKeywords:    req.MetaKeywords,
		AuthorID:        authorID,
		SortOrder:       req.SortOrder,
		PublishedAt:     publishedAt,
	}

	if err := db.Create(&article).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to create article", Error: err.Error()})
		return
	}

	for _, tr := range req.Translations {
		if !isCompleteArticleTranslationRequest(tr) {
			continue
		}
		trSlug := tr.Slug
		if trSlug == "" {
			trSlug = slugify(tr.Title)
		}
		trans := models.ArticleTranslation{
			ArticleID:       article.ID,
			LanguageCode:    tr.LanguageCode,
			Title:           tr.Title,
			Slug:            slugify(trSlug),
			Summary:         tr.Summary,
			Content:         tr.Content,
			MetaTitle:       tr.MetaTitle,
			MetaDescription: tr.MetaDescription,
			MetaKeywords:    tr.MetaKeywords,
		}
		db.Create(&trans)
	}

	withArticlePreloads(db).First(&article, article.ID)
	services.InvalidatePublicCaches(c.Request.Context(), "news:create", articleCacheURLs(article))
	if article.IsPublished {
		services.TriggerNextRevalidate(nil, articleCacheURLs(article), false)
		go func(articleID uint, publicPath string) {
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			defer cancel()
			services.SubmitArticleURLsBestEffort(ctx, db, articleID, publicPath)
		}(article.ID, getArticlePublicPath(article))
	}

	c.JSON(http.StatusCreated, models.APIResponse{Success: true, Message: "Article created", Data: toArticleResponse(article)})
}

func (nc *NewsController) UpdateArticle(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}

	var article models.Article
	if err := db.First(&article, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Article not found"})
		return
	}
	oldPath := getArticlePublicPath(article)

	var req models.ArticleCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	slug := req.Slug
	if slug == "" {
		slug = slugify(req.Title)
	}
	slug = ensureUniqueSlug(db, slugify(slug), article.ID)

	requestedCustomPath := normalizeCustomPath(req.CustomPath)
	// The admin form submits the stored path. If that path is the generated
	// default, regenerate it for the new type/slug instead of freezing the old
	// `/news/...` path after a news -> blog edit.
	if requestedCustomPath == "" || isGeneratedArticleCustomPath(requestedCustomPath, article.ContentType, article.Slug) {
		requestedCustomPath = defaultArticleCustomPath(req.ContentType, slug)
	}
	customPath := ensureUniqueCustomPath(db, requestedCustomPath, article.ID)

	featuredImage := strings.TrimSpace(req.FeaturedImage)
	imageURLs := req.ImageURLs
	mediaFeaturedURL, mediaGalleryURLs := resolveMediaURLs(db, req.FeaturedMediaID, req.GalleryMediaIDs)
	if featuredImage == "" && mediaFeaturedURL != "" {
		featuredImage = mediaFeaturedURL
	}
	if len(imageURLs) == 0 && len(mediaGalleryURLs) > 0 {
		imageURLs = mediaGalleryURLs
	}

	imageURLsJSON := "[]"
	if len(imageURLs) > 0 {
		if b, err := json.Marshal(imageURLs); err == nil {
			imageURLsJSON = string(b)
		}
	}

	galleryMediaIDsJSON := "[]"
	if len(req.GalleryMediaIDs) > 0 {
		if b, err := json.Marshal(req.GalleryMediaIDs); err == nil {
			galleryMediaIDsJSON = string(b)
		}
	}

	var publishedAt *time.Time
	if req.IsPublished {
		if article.PublishedAt != nil {
			publishedAt = article.PublishedAt
		} else {
			now := time.Now()
			publishedAt = &now
		}
	}

	updates := map[string]interface{}{
		"title":             req.Title,
		"slug":              slug,
		"custom_path":       customPath,
		"summary":           req.Summary,
		"content":           req.Content,
		"content_type":      normalizeContentType(req.ContentType),
		"featured_image":    featuredImage,
		"featured_media_id": req.FeaturedMediaID,
		"image_urls":        imageURLsJSON,
		"gallery_media_ids": galleryMediaIDsJSON,
		"is_published":      req.IsPublished,
		"is_featured":       req.IsFeatured,
		"meta_title":        req.MetaTitle,
		"meta_description":  req.MetaDescription,
		"meta_keywords":     req.MetaKeywords,
		"sort_order":        req.SortOrder,
		"published_at":      publishedAt,
	}

	if err := db.Model(&article).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update article", Error: err.Error()})
		return
	}

	db.Where("article_id = ?", article.ID).Delete(&models.ArticleTranslation{})
	for _, tr := range req.Translations {
		if !isCompleteArticleTranslationRequest(tr) {
			continue
		}
		trSlug := tr.Slug
		if trSlug == "" {
			trSlug = slugify(tr.Title)
		}
		trans := models.ArticleTranslation{
			ArticleID:       article.ID,
			LanguageCode:    tr.LanguageCode,
			Title:           tr.Title,
			Slug:            slugify(trSlug),
			Summary:         tr.Summary,
			Content:         tr.Content,
			MetaTitle:       tr.MetaTitle,
			MetaDescription: tr.MetaDescription,
			MetaKeywords:    tr.MetaKeywords,
		}
		db.Create(&trans)
	}

	withArticlePreloads(db).First(&article, article.ID)
	newPath := getArticlePublicPath(article)
	if article.IsPublished {
		createSEORedirect(db, oldPath, newPath)
	}
	services.InvalidatePublicCaches(c.Request.Context(), "news:update", []string{"/news", "/blog", oldPath, newPath, "/sitemap.xml", "/sitemap-news.xml", "/sitemap-blog.xml"})
	paths := []string{"/news", "/blog", oldPath, newPath, "/sitemap.xml", "/sitemap-news.xml", "/sitemap-blog.xml"}
	services.TriggerNextRevalidate(nil, paths, false)
	if article.IsPublished {
		go func(articleID uint, publicPath string) {
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			defer cancel()
			services.SubmitArticleURLsBestEffort(ctx, db, articleID, publicPath)
		}(article.ID, newPath)
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Article updated", Data: toArticleResponse(article)})
}

func (nc *NewsController) DeleteArticle(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}

	var article models.Article
	if err := db.First(&article, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Article not found"})
		return
	}

	oldPath := getArticlePublicPath(article)
	db.Where("article_id = ?", article.ID).Delete(&models.ArticleTranslation{})
	db.Delete(&article)
	services.InvalidatePublicCaches(c.Request.Context(), "news:delete", []string{"/news", "/blog", oldPath, "/sitemap.xml", "/sitemap-news.xml", "/sitemap-blog.xml"})
	services.TriggerNextRevalidate(nil, []string{"/news", "/blog", oldPath, "/sitemap.xml", "/sitemap-news.xml", "/sitemap-blog.xml"}, false)

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Article deleted"})
}

func isCompleteArticleTranslationRequest(translation models.ArticleTranslationReq) bool {
	return strings.TrimSpace(translation.LanguageCode) != "" &&
		strings.TrimSpace(translation.Title) != "" && strings.TrimSpace(translation.Content) != ""
}
