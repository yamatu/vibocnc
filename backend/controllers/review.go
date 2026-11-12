package controllers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ReviewController struct{}

const (
	reviewNameMaxLen    = 100
	reviewTitleMaxLen   = 200
	reviewContentMinLen = 10
	reviewContentMaxLen = 3000
)

// An order qualifies for a review once it is paid or has shipped, and stops
// qualifying when it is cancelled or fully refunded.
func eligibleReviewOrdersQuery(db *gorm.DB, customer models.Customer, productID uint) *gorm.DB {
	return db.Model(&models.Order{}).
		Where("(orders.customer_id = ? OR orders.customer_email = ?)", customer.ID, customer.Email).
		Where("orders.status <> ?", "cancelled").
		Where("orders.payment_status <> ?", "refunded").
		Where("(orders.payment_status IN ? OR orders.status IN ?)",
			[]string{"paid", "partially_refunded", "refund_pending"},
			[]string{"shipped", "delivered"}).
		Where("EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND oi.product_id = ?)", productID)
}

func applyReviewStatus(r *models.ProductReview, status string) {
	r.Status = status
	r.IsApproved = status == models.ReviewStatusApproved
	if r.IsApproved {
		if r.ApprovedAt == nil {
			now := time.Now()
			r.ApprovedAt = &now
		}
	} else {
		r.ApprovedAt = nil
	}
}

func validReviewStatus(s string) bool {
	return s == models.ReviewStatusPending || s == models.ReviewStatusApproved || s == models.ReviewStatusRejected
}

func validateReviewFields(name, title, content string, rating int) string {
	switch {
	case rating < 1 || rating > 5:
		return "rating must be between 1 and 5"
	case name == "":
		return "name is required"
	case utf8.RuneCountInString(name) > reviewNameMaxLen:
		return "name is too long"
	case utf8.RuneCountInString(title) > reviewTitleMaxLen:
		return "title is too long"
	case utf8.RuneCountInString(content) < reviewContentMinLen:
		return "review must be at least 10 characters"
	case utf8.RuneCountInString(content) > reviewContentMaxLen:
		return "review is too long"
	}
	return ""
}

// refreshReviewedProducts clears origin/CDN caches and Next.js ISR pages for
// products whose public review list may have changed.
func refreshReviewedProducts(ctx context.Context, db *gorm.DB, productIDs []uint) {
	if len(productIDs) == 0 {
		return
	}
	var products []models.Product
	if err := db.Select("id", "sku").Where("id IN ?", productIDs).Find(&products).Error; err != nil || len(products) == 0 {
		return
	}
	paths := make([]string, 0, len(products))
	skus := make([]string, 0, len(products))
	for _, p := range products {
		if path := services.BuildProductPublicPath(p.SKU); path != "" {
			paths = append(paths, path)
		}
		skus = append(skus, p.SKU)
	}
	services.InvalidatePublicCaches(ctx, "review:update", paths)
	services.TriggerNextRevalidate(skus, paths, false)
}

func loadCurrentCustomer(c *gin.Context) (models.Customer, bool) {
	var customer models.Customer
	id, ok := c.Get("customer_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, models.APIResponse{Success: false, Message: "Unauthorized"})
		return customer, false
	}
	if err := config.GetDB().First(&customer, id).Error; err != nil || !customer.IsActive {
		c.JSON(http.StatusUnauthorized, models.APIResponse{Success: false, Message: "Unauthorized"})
		return customer, false
	}
	return customer, true
}

type reviewEligibilityOrder struct {
	ID          uint      `json:"id"`
	OrderNumber string    `json:"order_number"`
	CreatedAt   time.Time `json:"created_at"`
}

type reviewEligibilityResponse struct {
	ProductID   uint                     `json:"product_id"`
	Eligible    bool                     `json:"eligible"`
	Reason      string                   `json:"reason,omitempty"`
	DefaultName string                   `json:"default_name"`
	Orders      []reviewEligibilityOrder `json:"orders"`
	Review      *models.ProductReview    `json:"review,omitempty"`
}

// Customer: GET /api/v1/customer/reviews/eligibility?product_id=
func (rc *ReviewController) GetEligibility(c *gin.Context) {
	customer, ok := loadCurrentCustomer(c)
	if !ok {
		return
	}
	productID, err := strconv.ParseUint(c.Query("product_id"), 10, 32)
	if err != nil || productID == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid product_id"})
		return
	}
	db := config.GetDB()
	resp := reviewEligibilityResponse{ProductID: uint(productID), DefaultName: customer.FullName, Orders: []reviewEligibilityOrder{}}

	var existing models.ProductReview
	if err := db.Where("customer_id = ? AND product_id = ?", customer.ID, productID).First(&existing).Error; err == nil {
		resp.Review = &existing
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load review", Error: utils.PublicError(err, "internal_error")})
		return
	}

	if err := eligibleReviewOrdersQuery(db, customer, uint(productID)).
		Select("orders.id", "orders.order_number", "orders.created_at").
		Order("orders.created_at DESC").
		Scan(&resp.Orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load orders", Error: utils.PublicError(err, "internal_error")})
		return
	}

	switch {
	case len(resp.Orders) == 0:
		resp.Reason = "no_purchase"
	case resp.Review != nil && resp.Review.Status != models.ReviewStatusRejected:
		resp.Reason = "already_reviewed"
	default:
		resp.Eligible = true
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: resp})
}

// Customer: GET /api/v1/customer/reviews
func (rc *ReviewController) GetMyReviews(c *gin.Context) {
	customer, ok := loadCurrentCustomer(c)
	if !ok {
		return
	}
	var reviews []models.ProductReview
	if err := config.GetDB().
		Preload("Product", func(db *gorm.DB) *gorm.DB { return db.Select("id", "sku", "name", "slug") }).
		Where("customer_id = ?", customer.ID).
		Order("created_at DESC").
		Find(&reviews).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load reviews", Error: utils.PublicError(err, "internal_error")})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: reviews})
}

type createReviewRequest struct {
	ProductID      uint   `json:"product_id" binding:"required"`
	Rating         int    `json:"rating" binding:"required"`
	CustomerName   string `json:"customer_name"`
	ReviewTitle    string `json:"review_title"`
	ReviewContent  string `json:"review_content"`
	TurnstileToken string `json:"turnstile_token"`
}

// Customer: POST /api/v1/customer/reviews
// Reviews are accepted only from verified buyers and always start pending.
func (rc *ReviewController) CreateReview(c *gin.Context) {
	customer, ok := loadCurrentCustomer(c)
	if !ok {
		return
	}
	var req createReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	db := config.GetDB()

	if err := services.VerifyTurnstileIfEnabled(c.Request.Context(), db, req.TurnstileToken, c.ClientIP()); err != nil {
		if errors.Is(err, services.ErrTurnstileMissingToken) || errors.Is(err, services.ErrTurnstileRejected) {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Human verification failed, please try again", Error: "captcha_failed"})
			return
		}
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "Human verification is temporarily unavailable", Error: utils.PublicError(err, "captcha_unavailable")})
		return
	}

	name := strings.TrimSpace(req.CustomerName)
	if name == "" {
		name = strings.TrimSpace(customer.FullName)
	}
	title := strings.TrimSpace(req.ReviewTitle)
	content := strings.TrimSpace(req.ReviewContent)
	if msg := validateReviewFields(name, title, content, req.Rating); msg != "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: msg, Error: "invalid_review"})
		return
	}

	var order models.Order
	if err := eligibleReviewOrdersQuery(db, customer, req.ProductID).
		Order("orders.created_at DESC").
		First(&order).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusForbidden, models.APIResponse{Success: false, Message: "Only customers who purchased this product can review it", Error: "no_purchase"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to verify purchase", Error: utils.PublicError(err, "internal_error")})
		return
	}

	var review models.ProductReview
	err := db.Where("customer_id = ? AND product_id = ?", customer.ID, req.ProductID).First(&review).Error
	switch {
	case err == nil && review.Status != models.ReviewStatusRejected:
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "You have already reviewed this product", Error: "already_reviewed"})
		return
	case err != nil && !errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save review", Error: utils.PublicError(err, "internal_error")})
		return
	}

	// A rejected review is resubmitted in place, keeping one review per buyer.
	customerID := customer.ID
	orderID := order.ID
	review.ProductID = req.ProductID
	review.CustomerID = &customerID
	review.OrderID = &orderID
	review.CustomerName = name
	review.CustomerEmail = customer.Email
	review.Rating = req.Rating
	review.ReviewTitle = title
	review.ReviewContent = content
	review.IsVerified = true
	review.IPAddress = c.ClientIP()
	applyReviewStatus(&review, models.ReviewStatusPending)

	if err := db.Save(&review).Error; err != nil {
		if strings.Contains(err.Error(), "Duplicate entry") {
			c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "You have already reviewed this product", Error: "already_reviewed"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save review", Error: utils.PublicError(err, "internal_error")})
		return
	}
	c.JSON(http.StatusCreated, models.APIResponse{Success: true, Message: "Review submitted and awaiting moderation", Data: review})
}

type adminReviewListResponse struct {
	models.PaginationResponse
	StatusCounts map[string]int64 `json:"status_counts"`
}

// Admin: GET /api/v1/admin/reviews
func (rc *ReviewController) AdminListReviews(c *gin.Context) {
	db := config.GetDB()
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	q := db.Model(&models.ProductReview{})
	if s := strings.TrimSpace(c.Query("status")); s != "" && validReviewStatus(s) {
		q = q.Where("status = ?", s)
	}
	if r, err := strconv.Atoi(c.Query("rating")); err == nil && r >= 1 && r <= 5 {
		q = q.Where("rating = ?", r)
	}
	if pid, err := strconv.ParseUint(c.Query("product_id"), 10, 32); err == nil && pid > 0 {
		q = q.Where("product_id = ?", pid)
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + search + "%"
		q = q.Where(
			"customer_name LIKE ? OR customer_email LIKE ? OR review_title LIKE ? OR review_content LIKE ? OR product_id IN (SELECT id FROM products WHERE sku LIKE ? OR name LIKE ?)",
			like, like, like, like, like, like,
		)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to count reviews", Error: utils.PublicError(err, "internal_error")})
		return
	}
	var reviews []models.ProductReview
	if err := q.
		Preload("Product", func(db *gorm.DB) *gorm.DB { return db.Select("id", "sku", "name", "slug") }).
		Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&reviews).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load reviews", Error: utils.PublicError(err, "internal_error")})
		return
	}

	var rows []struct {
		Status string
		Count  int64
	}
	db.Model(&models.ProductReview{}).Select("status, COUNT(*) AS count").Group("status").Scan(&rows)
	counts := map[string]int64{models.ReviewStatusPending: 0, models.ReviewStatusApproved: 0, models.ReviewStatusRejected: 0}
	for _, row := range rows {
		counts[row.Status] = row.Count
	}

	totalPages := int((total + int64(pageSize) - 1) / int64(pageSize))
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: adminReviewListResponse{
		PaginationResponse: models.PaginationResponse{Data: reviews, Page: page, PageSize: pageSize, Total: total, TotalPages: totalPages},
		StatusCounts:       counts,
	}})
}

type adminUpdateReviewRequest struct {
	CustomerName  *string `json:"customer_name"`
	Rating        *int    `json:"rating"`
	ReviewTitle   *string `json:"review_title"`
	ReviewContent *string `json:"review_content"`
	Status        *string `json:"status"`
	IsVerified    *bool   `json:"is_verified"`
}

// Admin: PUT /api/v1/admin/reviews/:id
func (rc *ReviewController) AdminUpdateReview(c *gin.Context) {
	db := config.GetDB()
	var review models.ProductReview
	if err := db.First(&review, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Review not found"})
		return
	}
	var req adminUpdateReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	if req.CustomerName != nil {
		review.CustomerName = strings.TrimSpace(*req.CustomerName)
	}
	if req.Rating != nil {
		review.Rating = *req.Rating
	}
	if req.ReviewTitle != nil {
		review.ReviewTitle = strings.TrimSpace(*req.ReviewTitle)
	}
	if req.ReviewContent != nil {
		review.ReviewContent = strings.TrimSpace(*req.ReviewContent)
	}
	if req.IsVerified != nil {
		review.IsVerified = *req.IsVerified
	}
	if req.Status != nil {
		if !validReviewStatus(*req.Status) {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid status"})
			return
		}
		applyReviewStatus(&review, *req.Status)
	}
	if msg := validateReviewFields(review.CustomerName, review.ReviewTitle, review.ReviewContent, review.Rating); msg != "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: msg, Error: "invalid_review"})
		return
	}
	if err := db.Save(&review).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save review", Error: utils.PublicError(err, "internal_error")})
		return
	}
	refreshReviewedProducts(c.Request.Context(), db, []uint{review.ProductID})
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Saved", Data: review})
}

// Admin: POST /api/v1/admin/reviews/bulk-status
func (rc *ReviewController) AdminBulkStatus(c *gin.Context) {
	var req struct {
		IDs    []uint `json:"ids" binding:"required"`
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 || !validReviewStatus(req.Status) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request"})
		return
	}
	db := config.GetDB()
	var reviews []models.ProductReview
	if err := db.Where("id IN ?", req.IDs).Find(&reviews).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load reviews", Error: utils.PublicError(err, "internal_error")})
		return
	}
	productIDs := make([]uint, 0, len(reviews))
	err := db.Transaction(func(tx *gorm.DB) error {
		for i := range reviews {
			applyReviewStatus(&reviews[i], req.Status)
			if err := tx.Save(&reviews[i]).Error; err != nil {
				return err
			}
			productIDs = append(productIDs, reviews[i].ProductID)
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update reviews", Error: utils.PublicError(err, "internal_error")})
		return
	}
	refreshReviewedProducts(c.Request.Context(), db, productIDs)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Updated", Data: gin.H{"updated": len(reviews)}})
}

// Admin: DELETE /api/v1/admin/reviews/:id
func (rc *ReviewController) AdminDeleteReview(c *gin.Context) {
	db := config.GetDB()
	var review models.ProductReview
	if err := db.First(&review, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Review not found"})
		return
	}
	if err := db.Delete(&review).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete review", Error: utils.PublicError(err, "internal_error")})
		return
	}
	if review.IsApproved {
		refreshReviewedProducts(c.Request.Context(), db, []uint{review.ProductID})
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Deleted"})
}
