package controllers

// ---------------------------------------------------------------------------
// Prompt library for the admin AI assistant.
//
// The assistant used to ship four hard-coded suggestions and nothing else: every
// long instruction (bulk model import, recurring SEO audit wording, a fixed
// translation brief) had to be retyped or kept in a text file outside the
// product. These handlers back a small per-installation library of named
// prompts with tags, pinning and a usage counter, served to the chat widget.
// ---------------------------------------------------------------------------

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	aiPromptNameMaxRunes    = 120
	aiPromptContentMaxRunes = 8000
	aiPromptTagsMaxRunes    = 200
	aiPromptLibraryMaxRows  = 500
)

type aiPromptPresetRequest struct {
	Name       *string `json:"name"`
	Content    *string `json:"content"`
	Tags       *string `json:"tags"`
	SortOrder  *int    `json:"sort_order"`
	IsFavorite *bool   `json:"is_favorite"`
}

// aiPromptLibraryDefaults is what a fresh installation starts with. They are the
// instructions the assistant is most often asked for, so the library is useful
// before the administrator has saved anything of their own.
func aiPromptLibraryDefaults() []models.AIAgentPromptPreset {
	return []models.AIAgentPromptPreset{
		{
			Name:      "批量型号入库",
			Tags:      "product,import",
			SortOrder: 10,
			Content: "请为下面这些型号创建产品并直接上架：自动归类到正确的品牌>产品类型分类（分类不存在就创建），" +
				"用 AI 补全标题、简短描述、详细描述、meta 标题、meta 描述、meta 关键词；价格、质保、交期用系统默认值。" +
				"AI 生成的全部内容必须是英文（美式英语），并按搜索收录要求优化。\n\n" +
				"型号列表：\n",
		},
		{
			Name:      "英文 SEO 内容生成",
			Tags:      "seo,english,content",
			SortOrder: 15,
			Content: "为下面这些商品生成英文（美式英语）内容：产品名称、简短描述、详细描述、meta 标题、meta 描述、meta 关键词。" +
				"要求利于搜索收录：标题与首句带上产品类型、品牌和完整型号，使用买家真实搜索的用词；不堆砌关键词、不重复句子；" +
				"meta 标题不超过 60 字符，meta 描述不超过 160 字符。\n\n商品：\n",
		},
		{
			Name:      "未分类商品批量归类",
			Tags:      "category,cleanup",
			SortOrder: 20,
			Content:   "列出所有未分类商品，按品牌和型号判断正确分类，逐一给出归类建议；无法确定的单独列出并说明原因。",
		},
		{
			Name:      "分类 SEO 批量优化",
			Tags:      "seo,category",
			SortOrder: 30,
			Content:   "检查全部分类的 SEO 情况，列出缺失 meta 标题/描述/关键词的分类，并给出可直接采用的英文优化文案。",
		},
		{
			Name:      "商品 SEO 缺口审计",
			Tags:      "seo,audit",
			SortOrder: 40,
			Content:   "统计当前商品里缺少 meta 标题、meta 描述、meta 关键词、详细描述的数量，列出最需要优先处理的 20 个商品及原因。",
		},
		{
			Name:      "商品英文内容重写",
			Tags:      "content,english,rewrite",
			SortOrder: 50,
			Content: "把下面这些商品的中文或混乱内容重写为英文（美式英语）并做 SEO 优化：产品名称、简短描述、详细描述、meta 信息；" +
				"不要编造价格、库存、认证、兼容性等无法从型号验证的信息。\n\n商品：\n",
		},
	}
}

// ListPromptPresets returns the library, seeded once on a fresh installation.
func (ac *AIAgentController) ListPromptPresets(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "Database is not available"})
		return
	}
	if err := seedAIAgentPromptPresets(db); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to prepare the prompt library", Error: err.Error()})
		return
	}
	search := strings.TrimSpace(c.Query("search"))
	query := db.Model(&models.AIAgentPromptPreset{})
	if search != "" {
		like := "%" + search + "%"
		query = query.Where("name LIKE ? OR content LIKE ? OR tags LIKE ?", like, like, like)
	}
	var presets []models.AIAgentPromptPreset
	if err := query.
		Order("is_favorite DESC, sort_order ASC, usage_count DESC, id ASC").
		Limit(aiPromptLibraryMaxRows).
		Find(&presets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to list prompts", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{"prompts": presets, "total": len(presets)}})
}

func (ac *AIAgentController) CreatePromptPreset(c *gin.Context) {
	var req aiPromptPresetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid prompt payload", Error: err.Error()})
		return
	}
	preset, validationErr := buildAIAgentPromptPreset(req, nil)
	if validationErr != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: validationErr.Error()})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "Database is not available"})
		return
	}
	if err := seedAIAgentPromptPresets(db); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to prepare the prompt library", Error: err.Error()})
		return
	}
	if err := db.Create(preset).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save the prompt", Error: err.Error()})
		return
	}
	c.JSON(http.StatusCreated, models.APIResponse{Success: true, Message: "Prompt saved", Data: preset})
}

func (ac *AIAgentController) UpdatePromptPreset(c *gin.Context) {
	id, ok := parseAIAgentPromptID(c)
	if !ok {
		return
	}
	var req aiPromptPresetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid prompt payload", Error: err.Error()})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "Database is not available"})
		return
	}
	var existing models.AIAgentPromptPreset
	if err := db.First(&existing, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Prompt not found"})
		return
	}
	preset, validationErr := buildAIAgentPromptPreset(req, &existing)
	if validationErr != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: validationErr.Error()})
		return
	}
	updates := map[string]any{
		"name":        preset.Name,
		"content":     preset.Content,
		"tags":        preset.Tags,
		"sort_order":  preset.SortOrder,
		"is_favorite": preset.IsFavorite,
	}
	if err := db.Model(&existing).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update the prompt", Error: err.Error()})
		return
	}
	if err := db.First(&existing, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Prompt was updated but could not be reloaded", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Prompt updated", Data: existing})
}

func (ac *AIAgentController) DeletePromptPreset(c *gin.Context) {
	id, ok := parseAIAgentPromptID(c)
	if !ok {
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "Database is not available"})
		return
	}
	result := db.Delete(&models.AIAgentPromptPreset{}, id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete the prompt", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Prompt not found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Prompt deleted"})
}

// MarkPromptPresetUsed bumps the popularity counter. It is best-effort: a failed
// counter must never stop the administrator from using the prompt.
func (ac *AIAgentController) MarkPromptPresetUsed(c *gin.Context) {
	id, ok := parseAIAgentPromptID(c)
	if !ok {
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "Database is not available"})
		return
	}
	if err := db.Model(&models.AIAgentPromptPreset{}).Where("id = ?", id).
		UpdateColumn("usage_count", gorm.Expr("usage_count + 1")).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to record prompt usage", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "ok"})
}

func parseAIAgentPromptID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid prompt id"})
		return 0, false
	}
	return uint(id), true
}

// buildAIAgentPromptPreset validates a create/update payload. On update the
// current row supplies the values the request left out, so a partial payload
// (for example only is_favorite) keeps the rest intact.
func buildAIAgentPromptPreset(req aiPromptPresetRequest, current *models.AIAgentPromptPreset) (*models.AIAgentPromptPreset, error) {
	preset := models.AIAgentPromptPreset{}
	if current != nil {
		preset = *current
	}
	if req.Name != nil {
		preset.Name = truncateRunes(strings.TrimSpace(*req.Name), aiPromptNameMaxRunes)
	}
	if req.Content != nil {
		preset.Content = truncateRunes(strings.TrimSpace(*req.Content), aiPromptContentMaxRunes)
	}
	if req.Tags != nil {
		preset.Tags = normalizeAIAgentPromptTags(*req.Tags)
	}
	if req.SortOrder != nil {
		preset.SortOrder = *req.SortOrder
	}
	if req.IsFavorite != nil {
		preset.IsFavorite = *req.IsFavorite
	}
	if preset.Name == "" {
		return nil, errors.New("提示词名称不能为空 / prompt name is required")
	}
	if preset.Content == "" {
		return nil, errors.New("提示词内容不能为空 / prompt content is required")
	}
	return &preset, nil
}

// normalizeAIAgentPromptTags stores tags as a comma separated list so the UI can
// filter on a plain LIKE without a join table.
func normalizeAIAgentPromptTags(raw string) string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '，' || r == ';' || r == '；' || r == '\n' || r == '\t'
	})
	seen := map[string]bool{}
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		tag := truncateRunes(strings.TrimSpace(part), 40)
		if tag == "" {
			continue
		}
		key := strings.ToLower(tag)
		if seen[key] {
			continue
		}
		seen[key] = true
		cleaned = append(cleaned, tag)
	}
	return truncateRunes(strings.Join(cleaned, ","), aiPromptTagsMaxRunes)
}

// seedAIAgentPromptPresets inserts the starter prompts only when the library has
// never been populated, so deleting every preset does not resurrect it.
func seedAIAgentPromptPresets(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.AIAgentPromptPreset{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	defaults := aiPromptLibraryDefaults()
	return db.Create(&defaults).Error
}
