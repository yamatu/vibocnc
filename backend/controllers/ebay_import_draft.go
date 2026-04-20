package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
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
		built := services.BuildEbayImportDraft(db, item)
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
		if err := db.Select("id", "name").First(&category, *req.SuggestedCategoryID).Error; err == nil {
			updates["suggested_category_name"] = category.Name
			updates["taxonomy_status"] = services.EbayDraftTaxonomyMatched
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
	_ = services.RecheckEbayImportDraft(db, &draft)
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

	if err := services.RecheckEbayImportDraft(db, &draft); err != nil {
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

	results := make([]gin.H, 0, len(req.IDs))
	successCount := 0
	userID := currentAdminUserID(c)
	for _, id := range req.IDs {
		result, statusCode, err := ec.confirmDraftImport(c.Request.Context(), id, req.Action, userID)
		if err != nil {
			results = append(results, gin.H{"id": id, "success": false, "status_code": statusCode, "error": err.Error()})
			continue
		}
		successCount++
		results = append(results, gin.H{"id": id, "success": true, "status_code": http.StatusOK, "data": result})
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: successCount > 0, Message: "Bulk confirm processed", Data: gin.H{"success_count": successCount, "total": len(req.IDs), "results": results}})
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
			if err := services.RecheckEbayImportDraft(db, &draft); err == nil {
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
	if err := config.GetDB().Where("id IN ?", req.IDs).Delete(&models.EbayImportDraft{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete drafts", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Drafts deleted successfully", Data: gin.H{"deleted": len(req.IDs)}})
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

	if err := services.RecheckEbayImportDraft(db, &draft); err != nil {
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

	productReq := services.BuildProductRequestFromDraft(db, draft)
	if strings.TrimSpace(productReq.SKU) == "" {
		return nil, http.StatusBadRequest, errors.New("Draft requires SKU / MPN / Part Number before import")
	}

	confirmTime := time.Now().UTC()
	_ = db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(map[string]any{
		"confirmed_at":  &confirmTime,
		"confirmed_by":  userID,
		"status":        services.EbayDraftStatusConfirmed,
		"import_action": action,
		"updated_at":    confirmTime,
	}).Error

	var upsertResult *services.ProductUpsertResult
	var upsertErr *services.ProductUpsertError
	if action == "update_existing" || (draft.MatchStatus == services.EbayDraftMatchExact && draft.MatchedProductID != nil && action != "create_new") {
		if draft.MatchedProductID == nil {
			return nil, http.StatusBadRequest, errors.New("No matched product available for update")
		}
		upsertResult, upsertErr = services.UpdateProductFromRequest(db, *draft.MatchedProductID, productReq)
	} else {
		upsertResult, upsertErr = services.CreateProductFromRequest(db, productReq)
	}
	if upsertErr != nil {
		_ = db.Model(&models.EbayImportDraft{}).Where("id = ?", draft.ID).Updates(map[string]any{
			"status":         services.EbayDraftStatusFailed,
			"failure_reason": upsertErr.Error(),
			"updated_at":     time.Now().UTC(),
		}).Error
		return nil, productUpsertStatusCode(upsertErr), errors.New(upsertErr.Message)
	}

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
