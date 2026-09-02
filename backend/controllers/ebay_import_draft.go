package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type EbayImportDraftController struct{}

const maxEbayDraftJSONImportSize = int64(1024 << 20)

func (ec *EbayImportDraftController) Upload(c *gin.Context) {
	var req models.EbayImportDraftUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}

	db := config.GetDB()
	type uploadItemResult struct {
		DraftID      uint     `json:"draft_id,omitempty"`
		Title        string   `json:"title"`
		MatchStatus  string   `json:"match_status"`
		Status       string   `json:"status"`
		Errors       []string `json:"errors,omitempty"`
		ImportedImgs int      `json:"imported_images"`
	}

	results := make([]uploadItemResult, 0, len(req.Items))
	successCount := 0
	errorCount := 0

	for _, item := range req.Items {
		built := services.BuildEbayImportDraftWithContext(c.Request.Context(), db, item)
		draft := built.Draft
		if len(built.Errors) > 0 {
			draft.FailureReason = strings.Join(built.Errors, "; ")
		}
		if err := db.Create(&draft).Error; err != nil {
			results = append(results, uploadItemResult{Title: draft.TitleRaw, MatchStatus: draft.MatchStatus, Status: services.EbayDraftStatusFailed, Errors: append(built.Errors, err.Error())})
			errorCount++
			continue
		}
		results = append(results, uploadItemResult{
			DraftID:      draft.ID,
			Title:        draft.TitleRaw,
			MatchStatus:  draft.MatchStatus,
			Status:       draft.Status,
			Errors:       built.Errors,
			ImportedImgs: len(decodeUintSliceForController(draft.MediaAssetIDs)),
		})
		successCount++
	}

	status := http.StatusCreated
	if successCount == 0 {
		status = http.StatusBadRequest
	} else if errorCount > 0 {
		status = http.StatusPartialContent
	}

	c.JSON(status, models.APIResponse{
		Success: successCount > 0,
		Message: "eBay import drafts processed",
		Data: gin.H{
			"total":         len(req.Items),
			"success_count": successCount,
			"error_count":   errorCount,
			"results":       results,
		},
	})
}

func (ec *EbayImportDraftController) StartJSONImport(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxEbayDraftJSONImportSize+(10<<20))
	contentType := strings.ToLower(strings.TrimSpace(c.GetHeader("Content-Type")))
	filename := strings.TrimSpace(c.Query("filename"))
	fileSize := c.Request.ContentLength
	var source io.Reader = c.Request.Body
	var closeSource func() error

	if strings.HasPrefix(contentType, "multipart/form-data") {
		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing JSON file", Error: err.Error()})
			return
		}
		filename = file.Filename
		fileSize = file.Size
		opened, err := file.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to read JSON file", Error: err.Error()})
			return
		}
		source = opened
		closeSource = opened.Close
	} else if !strings.Contains(contentType, "application/json") && !strings.Contains(contentType, "application/octet-stream") {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "JSON file content type is required", Error: "invalid_content_type"})
		return
	}
	if closeSource != nil {
		defer closeSource()
	}
	if filename == "" {
		filename = "ebay-import-drafts.json"
	}
	if !strings.EqualFold(filepath.Ext(filename), ".json") {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Only .json files are supported", Error: "invalid_file_type"})
		return
	}
	if fileSize == 0 || fileSize > maxEbayDraftJSONImportSize {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "JSON file must be between 1 byte and 1 GB", Error: "invalid_file_size"})
		return
	}
	task, err := services.StartEbayDraftJSONImportTask(config.GetDB(), source, filepath.Base(filename), fileSize)
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to start JSON import", Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "JSON import task started", Data: task})
}

func (ec *EbayImportDraftController) GetJSONImportTask(c *gin.Context) {
	task, ok := services.GetEbayDraftJSONImportTask(c.Param("taskId"))
	if !ok {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "JSON import task not found", Error: "task_not_found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "JSON import task status", Data: task})
}

func (ec *EbayImportDraftController) GetLatestJSONImportTask(c *gin.Context) {
	task, ok := services.GetLatestEbayDraftJSONImportTask()
	if !ok {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "No JSON import task", Data: nil})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Latest JSON import task", Data: task})
}

func (ec *EbayImportDraftController) PauseJSONImportTask(c *gin.Context) {
	task, err := services.PauseEbayDraftJSONImportTask(c.Param("taskId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to pause JSON import task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "JSON import task pause requested", Data: task})
}

func (ec *EbayImportDraftController) ResumeJSONImportTask(c *gin.Context) {
	task, err := services.ResumeEbayDraftJSONImportTask(c.Param("taskId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to resume JSON import task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "JSON import task resumed", Data: task})
}

func (ec *EbayImportDraftController) List(c *gin.Context) {
	db := config.GetDB()
	page, pageSize := utils.ParsePaginationWithMax(c.Query("page"), c.Query("page_size"), 100)
	res, err := services.ListEbayImportDrafts(db, services.EbayImportDraftFilters{
		Page:        page,
		PageSize:    pageSize,
		Search:      c.Query("search"),
		Status:      c.Query("status"),
		MatchStatus: c.Query("match_status"),
		Brand:       c.Query("brand"),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load eBay import drafts", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "eBay import drafts retrieved successfully", Data: res})
}

func (ec *EbayImportDraftController) SelectionIDs(c *gin.Context) {
	var req models.EbayImportDraftSelectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	ids, err := services.ListEbayImportDraftIDs(config.GetDB(), services.EbayImportDraftFilters{
		Search:      req.Search,
		Status:      req.Status,
		MatchStatus: req.MatchStatus,
		Brand:       req.Brand,
	}, req.EligibleOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to fetch draft selection", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Draft selection retrieved successfully",
		Data:    models.EbayImportDraftSelectionResponse{IDs: ids, Total: int64(len(ids))},
	})
}

func (ec *EbayImportDraftController) Get(c *gin.Context) {
	id, err := parseUintParam(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID", Error: "invalid_id"})
		return
	}
	res, err := services.GetEbayImportDraftDetail(config.GetDB(), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Draft not found", Error: "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load draft", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft retrieved successfully", Data: res})
}

func (ec *EbayImportDraftController) Update(c *gin.Context) {
	id, err := parseUintParam(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID", Error: "invalid_id"})
		return
	}

	var req models.EbayImportDraftUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}

	db := config.GetDB()
	var draft models.EbayImportDraft
	if err := db.First(&draft, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Draft not found", Error: "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load draft", Error: err.Error()})
		return
	}

	updates := map[string]any{}
	if req.NormalizedTitle != nil {
		updates["normalized_title"] = strings.TrimSpace(*req.NormalizedTitle)
	}
	if req.NormalizedBrand != nil {
		updates["normalized_brand"] = services.CanonicalBrandName(*req.NormalizedBrand)
	}
	if req.NormalizedModel != nil {
		updates["normalized_model"] = services.NormalizeProductModel(*req.NormalizedModel)
	}
	if req.NormalizedPartNumber != nil {
		updates["normalized_part_number"] = services.NormalizeProductModel(*req.NormalizedPartNumber)
	}
	if req.NormalizedMPN != nil {
		updates["normalized_mpn"] = services.NormalizeProductModel(*req.NormalizedMPN)
	}
	if req.NormalizedPrice != nil {
		updates["normalized_price"] = *req.NormalizedPrice
	}
	if req.SuggestedCategoryID != nil {
		updates["suggested_category_id"] = req.SuggestedCategoryID
		var category models.Category
		if err := db.Select("id", "name", "is_active").First(&category, *req.SuggestedCategoryID).Error; err == nil && category.IsActive {
			updates["suggested_category_name"] = category.Name
		} else {
			updates["taxonomy_status"] = services.EbayDraftTaxonomyNeedsReview
		}
	}
	if req.ImportAction != nil {
		updates["import_action"] = strings.TrimSpace(*req.ImportAction)
	}
	if req.MetaTitle != nil {
		updates["meta_title"] = strings.TrimSpace(*req.MetaTitle)
	}
	if req.MetaDescription != nil {
		updates["meta_description"] = strings.TrimSpace(*req.MetaDescription)
	}
	if req.MetaKeywords != nil {
		updates["meta_keywords"] = strings.TrimSpace(*req.MetaKeywords)
	}
	if req.DisableAutoSEO != nil {
		updates["disable_auto_seo"] = *req.DisableAutoSEO
	}
	if req.ReviewNote != nil {
		updates["review_note"] = strings.TrimSpace(*req.ReviewNote)
	}
	if req.Status != nil {
		updates["status"] = strings.TrimSpace(*req.Status)
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "No fields to update", Error: "no_updates"})
		return
	}

	if err := db.Model(&models.EbayImportDraft{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update draft", Error: err.Error()})
		return
	}
	_ = db.First(&draft, id).Error
	_ = services.RecheckEbayImportDraftWithContext(c.Request.Context(), db, &draft)
	res, err := services.GetEbayImportDraftDetail(db, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Draft updated but failed to reload", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft updated successfully", Data: res})
}

func (ec *EbayImportDraftController) Recheck(c *gin.Context) {
	id, err := parseUintParam(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID", Error: "invalid_id"})
		return
	}

	db := config.GetDB()
	var draft models.EbayImportDraft
	if err := db.First(&draft, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Draft not found", Error: "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load draft", Error: err.Error()})
		return
	}

	if err := services.RecheckEbayImportDraftWithContext(c.Request.Context(), db, &draft); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to recheck draft", Error: err.Error()})
		return
	}
	res, err := services.GetEbayImportDraftDetail(db, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Draft rechecked but failed to reload", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft rechecked successfully", Data: res})
}

func (ec *EbayImportDraftController) Confirm(c *gin.Context) {
	id, err := parseUintParam(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID", Error: "invalid_id"})
		return
	}

	var req models.EbayImportDraftConfirmRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
			return
		}
	}

	result, statusCode, err := ec.confirmDraftImport(c.Request.Context(), id, req.Action, currentAdminUserID(c))
	if err != nil {
		c.JSON(statusCode, models.APIResponse{Success: false, Message: err.Error(), Error: draftErrorCode(statusCode, err)})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft imported successfully", Data: result})
}

func (ec *EbayImportDraftController) BulkConfirm(c *gin.Context) {
	var req models.EbayImportDraftBulkConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}

	userID := currentAdminUserID(c)

	confirmFn := func(id uint, action string, uid *uint) (int, string, error) {
		return ec.confirmDraftForBackground(context.Background(), id, action, uid)
	}

	ids := normalizeBulkDraftIDs(req.IDs)
	snapshot, err := services.StartEbayBulkConfirmTask(ids, req.Action, userID, confirmFn)
	if err != nil {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Failed to start bulk confirm task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.APIResponse{Success: true, Message: "Bulk confirm task started", Data: snapshot})
}

func (ec *EbayImportDraftController) GetLatestBulkConfirmTask(c *gin.Context) {
	snapshot, ok := services.GetLatestEbayBulkConfirmTaskSnapshot()
	if !ok {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "No bulk confirm task", Data: nil})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Latest bulk confirm task", Data: snapshot})
}

func (ec *EbayImportDraftController) PauseBulkConfirmTask(c *gin.Context) {
	snapshot, err := services.PauseEbayBulkConfirmTask(c.Param("taskId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to pause bulk confirm task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Bulk confirm task pause requested", Data: snapshot})
}

func (ec *EbayImportDraftController) ResumeBulkConfirmTask(c *gin.Context) {
	snapshot, err := services.ResumeEbayBulkConfirmTask(c.Param("taskId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to resume bulk confirm task", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Bulk confirm task resumed", Data: snapshot})
}

func (ec *EbayImportDraftController) GetBulkConfirmTask(c *gin.Context) {
	taskID := strings.TrimSpace(c.Param("taskId"))
	if taskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing task ID", Error: "missing_task_id"})
		return
	}

	snapshot, ok := services.GetEbayBulkConfirmTaskSnapshot(taskID)
	if !ok {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Task not found", Error: "task_not_found"})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Task status", Data: snapshot})
}

func (ec *EbayImportDraftController) ConfirmDraftFn() services.EbayDraftConfirmFunc {
	return func(id uint, action string, userID *uint) (int, string, error) {
		return ec.confirmDraftForBackground(context.Background(), id, action, userID)
	}
}

func (ec *EbayImportDraftController) confirmDraftForBackground(ctx context.Context, id uint, action string, userID *uint) (int, string, error) {
	var draft models.EbayImportDraft
	if err := config.GetDB().Select(
		"id", "status", "taxonomy_status", "suggested_category_id", "match_status", "normalized_model", "normalized_part_number", "normalized_mpn",
	).First(&draft, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return http.StatusNotFound, "", errors.New("Draft not found")
		}
		return http.StatusInternalServerError, "", err
	}
	if draft.Status == services.EbayDraftStatusImported || draft.Status == services.EbayDraftStatusSkipped {
		return http.StatusOK, "already_processed", nil
	}
	if draft.SuggestedCategoryID == nil || *draft.SuggestedCategoryID == 0 || draft.TaxonomyStatus != services.EbayDraftTaxonomyMatched {
		return http.StatusOK, "needs_review", nil
	}
	if strings.TrimSpace(draft.NormalizedModel) == "" && strings.TrimSpace(draft.NormalizedPartNumber) == "" && strings.TrimSpace(draft.NormalizedMPN) == "" {
		return http.StatusOK, "missing_identifier", nil
	}
	normalizedAction := strings.ToLower(strings.TrimSpace(action))
	if draft.MatchStatus == services.EbayDraftMatchPossibleDup && normalizedAction != "update_existing" && normalizedAction != "create_new" {
		return http.StatusOK, "needs_review", nil
	}
	result, statusCode, err := ec.confirmDraftImport(ctx, id, action, userID)
	return statusCode, draftConfirmSkipReason(result), err
}

func (ec *EbayImportDraftController) BulkRecheck(c *gin.Context) {
	var req models.EbayImportDraftBulkRecheckRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}

	db := config.GetDB()
	updated := 0
	for _, id := range req.IDs {
		var draft models.EbayImportDraft
		if err := db.First(&draft, id).Error; err == nil {
			if err := services.RecheckEbayImportDraftWithContext(c.Request.Context(), db, &draft); err == nil {
				updated++
			}
		}
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Bulk recheck processed", Data: gin.H{"updated": updated, "total": len(req.IDs)}})
}

func (ec *EbayImportDraftController) Delete(c *gin.Context) {
	id, err := parseUintParam(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID", Error: "invalid_id"})
		return
	}
	if err := config.GetDB().Delete(&models.EbayImportDraft{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete draft", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Draft deleted successfully"})
}

func (ec *EbayImportDraftController) BulkDelete(c *gin.Context) {
	var req models.EbayImportDraftBulkDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data", Error: err.Error()})
		return
	}
	ids := normalizeBulkDraftIDs(req.IDs)
	if len(ids) == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "At least one valid draft ID is required", Error: "ids_required"})
		return
	}
	result := config.GetDB().Where("id IN ?", ids).Delete(&models.EbayImportDraft{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete drafts", Error: result.Error.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Drafts deleted successfully", Data: gin.H{"deleted": result.RowsAffected, "requested": len(ids)}})
}

// normalizeBulkDraftIDs removes duplicate IDs and ignores zero values before
// issuing a destructive bulk operation. This keeps the response count tied to
// the actual records selected by the administrator.
func normalizeBulkDraftIDs(ids []uint) []uint {
	seen := make(map[uint]struct{}, len(ids))
	result := make([]uint, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func (ec *EbayImportDraftController) confirmDraftImport(ctx context.Context, id uint, requestedAction string, userID *uint) (gin.H, int, error) {
	db := config.GetDB()

	var draft models.EbayImportDraft
	if err := db.Preload("MatchedProduct").Preload("SuggestedCategory").First(&draft, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, http.StatusNotFound, errors.New("Draft not found")
		}
		return nil, http.StatusInternalServerError, err
	}

	classification, err := services.RecheckEbayImportDraftAndClassifyWithContext(ctx, db, &draft)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	if err := db.Preload("MatchedProduct").Preload("SuggestedCategory").First(&draft, id).Error; err != nil {
		return nil, http.StatusInternalServerError, err
	}

	action := strings.TrimSpace(strings.ToLower(requestedAction))
	if action == "" {
		action = strings.TrimSpace(strings.ToLower(draft.ImportAction))
	}
	if action == "" {
		action = defaultDraftActionForController(draft.MatchStatus)
	}

	if draft.MatchStatus == services.EbayDraftMatchPossibleDup && action != "update_existing" && action != "create_new" {
		return nil, http.StatusBadRequest, errors.New("Possible duplicate requires explicit action")
	}
	if draft.SuggestedCategoryID == nil || *draft.SuggestedCategoryID == 0 {
		return nil, http.StatusBadRequest, errors.New("Draft category must be confirmed before import")
	}
	_, classificationErr := services.ValidateEbayImportDraftCategoryWithInference(db, draft, classification)
	if classificationErr != nil {
		_ = db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(map[string]any{
			"status":          services.EbayDraftStatusNeedsReview,
			"taxonomy_status": services.EbayDraftTaxonomyNeedsReview,
			"failure_reason":  classificationErr.Error(),
			"updated_at":      time.Now().UTC(),
		}).Error
		return nil, http.StatusBadRequest, classificationErr
	}
	productReq := services.BuildProductRequestFromDraft(db, draft)
	if strings.TrimSpace(productReq.SKU) == "" {
		return nil, http.StatusBadRequest, errors.New("Draft requires SKU / MPN / Part Number before import")
	}
	// Keep the imported record tied to the verified manufacturer identity. The
	// request fields remain administrator-editable, but a successful category
	// check is the only path that can create or update a publishable draft.
	if services.NormalizeBrandKey(productReq.Brand) == "" && classification.BrandName != "" {
		productReq.Brand = classification.BrandName
	}

	var upsertResult *services.ProductUpsertResult
	var upsertErr *services.ProductUpsertError
	if action == "update_existing" || (draft.MatchStatus == services.EbayDraftMatchExact && draft.MatchedProductID != nil && action != "create_new") {
		if draft.MatchedProductID == nil {
			return nil, http.StatusBadRequest, errors.New("No matched product available for update")
		}
		if draft.MatchedProduct != nil && !draft.MatchedProduct.IsActive {
			// A verified import must not silently override an administrator's
			// existing inactive/publication decision.
			productReq.IsActive = false
		}
		upsertResult, upsertErr = services.UpdateProductFromRequest(db, *draft.MatchedProductID, productReq)
	} else {
		upsertResult, upsertErr = services.CreateProductFromRequest(db, productReq)
	}
	if upsertErr != nil {
		if upsertErr.Code == "sku_exists" {
			var existingProduct models.Product
			if findErr := db.Where("sku = ?", productReq.SKU).First(&existingProduct).Error; findErr == nil {
				skippedAt := time.Now().UTC()
				if updateErr := db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(map[string]any{
					"status":              services.EbayDraftStatusSkipped,
					"match_status":        services.EbayDraftMatchExact,
					"matched_product_id":  existingProduct.ID,
					"match_score":         100,
					"match_reason":        "Skipped because a product with the same SKU already exists",
					"failure_reason":      "",
					"imported_product_id": existingProduct.ID,
					"confirmed_at":        &skippedAt,
					"confirmed_by":        userID,
					"updated_at":          skippedAt,
				}).Error; updateErr != nil {
					return nil, http.StatusInternalServerError, errors.New("Duplicate product found but failed to update draft state")
				}
				res, _ := services.GetEbayImportDraftDetail(db, draft.ID)
				return gin.H{"draft": res, "product": &existingProduct, "created": false, "skipped": true}, http.StatusOK, nil
			}
		}
		_ = db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(map[string]any{
			"status":         services.EbayDraftStatusFailed,
			"failure_reason": upsertErr.Error(),
			"updated_at":     time.Now().UTC(),
		}).Error
		return nil, productUpsertStatusCode(upsertErr), errors.New(upsertErr.Message)
	}
	confirmTime := time.Now().UTC()

	if _, err := optimizeProductAfterSave(db, upsertResult.Product.ID); err != nil {
		_ = db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(map[string]any{
			"status":         services.EbayDraftStatusFailed,
			"failure_reason": err.Error(),
			"updated_at":     time.Now().UTC(),
		}).Error
		return nil, http.StatusInternalServerError, errors.New("Product imported but automatic SEO optimization failed")
	}

	paths := []string{upsertResult.NewPath}
	if strings.TrimSpace(upsertResult.OldPath) != "" && upsertResult.OldPath != upsertResult.NewPath {
		paths = append(paths, upsertResult.OldPath)
	}
	skus := []string{upsertResult.Product.SKU}
	if strings.TrimSpace(upsertResult.OldSKU) != "" && upsertResult.OldSKU != upsertResult.Product.SKU {
		skus = append(skus, upsertResult.OldSKU)
	}
	services.InvalidatePublicCaches(ctx, draftMutationReasonForController(upsertResult.Created), paths)
	services.TriggerNextRevalidate(skus, paths, true)
	go func(sku string) {
		ctx2, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		services.SubmitProductURLBestEffort(ctx2, db, sku)
	}(upsertResult.Product.SKU)

	importedAt := time.Now().UTC()
	if err := db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(map[string]any{
		"status":              services.EbayDraftStatusImported,
		"failure_reason":      "",
		"imported_product_id": upsertResult.Product.ID,
		"imported_at":         &importedAt,
		"confirmed_at":        &confirmTime,
		"confirmed_by":        userID,
		"updated_at":          importedAt,
	}).Error; err != nil {
		return nil, http.StatusInternalServerError, errors.New("Product imported but failed to update draft state")
	}

	res, err := services.GetEbayImportDraftDetail(db, draft.ID)
	if err != nil {
		return gin.H{"product": upsertResult.Product, "created": upsertResult.Created}, http.StatusOK, nil
	}
	return gin.H{"draft": res, "product": upsertResult.Product, "created": upsertResult.Created}, http.StatusOK, nil
}

func draftConfirmSkipReason(result gin.H) string {
	if result == nil {
		return ""
	}
	skipped, _ := result["skipped"].(bool)
	if skipped {
		return "duplicate"
	}
	return ""
}

func parseUintParam(raw string) (uint, error) {
	value, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 32)
	if err != nil || value == 0 {
		return 0, err
	}
	return uint(value), nil
}

func currentAdminUserID(c *gin.Context) *uint {
	if c == nil {
		return nil
	}
	value, ok := c.Get("user_id")
	if !ok {
		return nil
	}
	switch v := value.(type) {
	case uint:
		return &v
	case int:
		if v > 0 {
			uid := uint(v)
			return &uid
		}
	case int64:
		if v > 0 {
			uid := uint(v)
			return &uid
		}
	case float64:
		if v > 0 {
			uid := uint(v)
			return &uid
		}
	}
	return nil
}

func productUpsertStatusCode(err *services.ProductUpsertError) int {
	if err == nil {
		return http.StatusInternalServerError
	}
	switch err.Code {
	case "sku_exists":
		return http.StatusConflict
	case "category_required", "category_not_found", "invalid_image_urls", "product_not_found":
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func draftErrorCode(statusCode int, err error) string {
	if err == nil {
		return ""
	}
	switch statusCode {
	case http.StatusBadRequest:
		return "bad_request"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusConflict:
		return "conflict"
	default:
		return "internal_error"
	}
}

func defaultDraftActionForController(matchStatus string) string {
	switch matchStatus {
	case services.EbayDraftMatchExact:
		return "update_existing"
	case services.EbayDraftMatchPossibleDup:
		return "needs_review"
	default:
		return "create_new"
	}
}

func draftMutationReasonForController(created bool) string {
	if created {
		return "ebay-import-draft:create"
	}
	return "ebay-import-draft:update"
}

func decodeUintSliceForController(raw string) []uint {
	var out []uint
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}
