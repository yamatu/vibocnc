package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	defaultCategorySEOBatch = 8
	maxCategorySEOBatch     = 20
	categorySEOWorkers      = 3
)

type aiCategorySEORequest struct {
	Limit   int  `json:"limit"`
	AfterID uint `json:"after_id"`
	// Force rewrites descriptions that already look complete.
	Force bool `json:"force"`
}

type aiCategorySEOResult struct {
	CategoryID  uint   `json:"category_id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Status      string `json:"status"` // updated | skipped | failed
	Message     string `json:"message,omitempty"`
	Description string `json:"description,omitempty"`
}

type aiCategorySEOResponse struct {
	Processed   int                   `json:"processed"`
	Updated     int                   `json:"updated"`
	Skipped     int                   `json:"skipped"`
	Failed      int                   `json:"failed"`
	HasMore     bool                  `json:"has_more"`
	NextAfterID uint                  `json:"next_after_id"`
	Results     []aiCategorySEOResult `json:"results"`
}

const aiCategorySEOPrompt = `You write the SEO and GEO landing-page description for Vibocnc (vibocnc.com), a multi-brand industrial automation distributor focused on plant MRO procurement and legacy/discontinued lifecycle continuity. Return JSON only, without Markdown, with exactly one field: description.

description is 2-3 crisp plain-text sentences (180-350 characters). Lead with the manufacturer and product group from a factory MRO and lifecycle sourcing angle, mention active and phased-out series coverage plus consolidated international courier fulfillment, and weave in 2-3 example models naturally. Never use robotic phrases like "testing and warranty context typical of an industrial parts supplier", never invent specs or certifications, and avoid HTML or quotes.`

// aiCategorySEONeedsDescription reports whether an existing description is a
// placeholder worth replacing: empty, too short, or the auto-generated
// "<Brand> industrial automation parts" boilerplate.
func aiCategorySEONeedsDescription(description string) bool {
	description = strings.TrimSpace(description)
	if len(description) < 60 {
		return true
	}
	lower := strings.ToLower(description)
	return strings.HasSuffix(lower, "industrial automation parts") && len(description) < 100
}

// OptimizeCategorySEO batch-writes AI SEO descriptions for active categories.
// The endpoint pages by category ID so the admin panel can loop until every
// category is covered; each call handles a small batch of LLM requests.
func (ac *AIAgentController) OptimizeCategorySEO(c *gin.Context) {
	var req aiCategorySEORequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid category SEO request", Error: err.Error()})
		return
	}
	limit := req.Limit
	if limit <= 0 {
		limit = defaultCategorySEOBatch
	}
	if limit > maxCategorySEOBatch {
		limit = maxCategorySEOBatch
	}

	setting, _, apiKey, err := loadAIAgentConfigWithProfile()
	if err != nil || !setting.Enabled || apiKey == "" {
		message := "AI assistant is not configured. An administrator must configure and enable it first."
		if err != nil {
			message = "AI settings could not be read: " + err.Error()
		}
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: message})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database connection failed"})
		return
	}

	var allCategories []models.Category
	if err := db.Order("id ASC").Find(&allCategories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load categories", Error: err.Error()})
		return
	}
	byID := make(map[uint]models.Category, len(allCategories))
	childNames := make(map[uint][]string)
	for _, category := range allCategories {
		byID[category.ID] = category
		if category.ParentID != nil && category.IsActive {
			childNames[*category.ParentID] = append(childNames[*category.ParentID], category.Name)
		}
	}
	pathOf := func(id uint) string {
		segments := []string{}
		for depth := 0; depth < 12; depth++ {
			category, ok := byID[id]
			if !ok {
				break
			}
			segments = append([]string{category.Name}, segments...)
			if category.ParentID == nil {
				break
			}
			id = *category.ParentID
		}
		return strings.Join(segments, " > ")
	}

	var batch []models.Category
	if err := db.Where("is_active = ? AND id > ?", true, req.AfterID).
		Order("id ASC").
		Limit(limit + 1).
		Find(&batch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to select categories", Error: err.Error()})
		return
	}
	hasMore := len(batch) > limit
	if hasMore {
		batch = batch[:limit]
	}

	response := aiCategorySEOResponse{NextAfterID: req.AfterID, HasMore: hasMore, Results: make([]aiCategorySEOResult, len(batch))}
	requestCtx := c.Request.Context()
	var wg sync.WaitGroup
	work := make(chan int)
	for worker := 0; worker < categorySEOWorkers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range work {
				response.Results[index] = processCategorySEOItem(requestCtx, db, setting, apiKey, batch[index], pathOf(batch[index].ID), childNames[batch[index].ID], req.Force)
			}
		}()
	}
	for index := range batch {
		work <- index
	}
	close(work)
	wg.Wait()

	for _, result := range response.Results {
		if result.CategoryID > response.NextAfterID {
			response.NextAfterID = result.CategoryID
		}
		switch result.Status {
		case "updated":
			response.Updated++
		case "skipped":
			response.Skipped++
		default:
			response.Failed++
		}
	}
	response.Processed = len(response.Results)
	if response.Updated > 0 {
		go services.InvalidatePublicCaches(context.Background(), "category:seo-descriptions", []string{"/categories"})
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Category SEO batch completed", Data: response})
}

func processCategorySEOItem(ctx context.Context, db *gorm.DB, setting *models.AIAgentSetting, apiKey string, category models.Category, path string, children []string, force bool) aiCategorySEOResult {
	result := aiCategorySEOResult{CategoryID: category.ID, Name: category.Name, Path: path, Status: "failed"}
	if !force && !aiCategorySEONeedsDescription(category.Description) {
		result.Status = "skipped"
		result.Message = "description already looks complete"
		return result
	}

	var sampleNames []string
	if err := db.Model(&models.Product{}).
		Where("category_id = ? AND is_active = ?", category.ID, true).
		Order("id ASC").
		Limit(6).
		Pluck("name", &sampleNames).Error; err != nil {
		result.Message = "failed to load sample products: " + err.Error()
		return result
	}

	payload := map[string]any{
		"category_path":        path,
		"category_name":        category.Name,
		"child_categories":     children,
		"example_products":     sampleNames,
		"existing_description": strings.TrimSpace(category.Description),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		result.Message = err.Error()
		return result
	}

	timeoutSeconds := setting.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 75
	}
	llmCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
	defer cancel()
	reply, err := requestAIAgentCompletion(llmCtx, setting, apiKey, []aiChatMessage{
		{Role: "system", Content: aiCategorySEOPrompt},
		{Role: "user", Content: "CATEGORY:\n" + string(encoded)},
	}, 1024)
	if err != nil {
		result.Message = truncateRunes(err.Error(), 400)
		return result
	}

	description, err := parseAICategorySEODescription(reply)
	if err != nil {
		result.Message = err.Error()
		return result
	}
	if err := db.Model(&models.Category{}).Where("id = ?", category.ID).Updates(map[string]any{
		"description": description,
		"updated_at":  time.Now(),
	}).Error; err != nil {
		result.Message = err.Error()
		return result
	}
	result.Status = "updated"
	result.Description = description
	return result
}

func parseAICategorySEODescription(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	for start := 0; start < len(raw); start++ {
		if raw[start] != '{' {
			continue
		}
		decoder := json.NewDecoder(strings.NewReader(raw[start:]))
		var parsed struct {
			Description string `json:"description"`
		}
		if err := decoder.Decode(&parsed); err != nil {
			continue
		}
		description := strings.Join(strings.Fields(strings.TrimSpace(parsed.Description)), " ")
		if len(description) < 40 {
			continue
		}
		if len([]rune(description)) > 500 {
			description = strings.TrimSpace(string([]rune(description)[:500]))
		}
		return description, nil
	}
	return "", errors.New("AI reply did not contain a usable description")
}
