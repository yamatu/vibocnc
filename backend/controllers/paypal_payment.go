package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"fanuc-backend/utils"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PayPalPaymentController owns the server-side PayPal checkout flow:
//
//	create  -> we create a PayPal order for the authoritative order amount
//	capture -> we capture it with PayPal and verify amount/currency/reference
//	webhook -> we reconcile asynchronous capture events by signature
//
// The browser never decides whether an order is paid.
type PayPalPaymentController struct{}

const maxWebhookBodyBytes = 1 << 20 // 1 MiB

// CreatePayPalOrder creates (or reuses) a PayPal order for an internal order.
// POST /api/v1/orders/:id/paypal/create
func (pc *PayPalPaymentController) CreatePayPalOrder(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var order models.Order
	if err := db.First(&order, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Order not found"})
		return
	}
	if strings.EqualFold(order.PaymentStatus, "paid") {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Order is already paid"})
		return
	}
	if strings.EqualFold(order.Status, "cancelled") {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Order is cancelled"})
		return
	}

	client, setting, err := services.NewPayPalAPIClientFromSettings(db)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "PayPal is not configured", Error: err.Error()})
		return
	}
	if !setting.Enabled {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "PayPal is disabled"})
		return
	}

	amount := roundMoney(order.TotalAmount)
	if amount <= 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Order total is not payable online"})
		return
	}
	currency := strings.ToUpper(strings.TrimSpace(order.Currency))
	if currency == "" {
		currency = strings.ToUpper(strings.TrimSpace(setting.Currency))
	}
	if currency == "" {
		currency = "USD"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	// Reuse an existing, still-payable PayPal order to avoid clobbering a
	// payment the customer may already be approving in another tab.
	if existing := strings.TrimSpace(order.PaymentID); existing != "" {
		if details, getErr := client.GetOrder(ctx, existing); getErr == nil &&
			details.OrderID == existing &&
			(strings.EqualFold(details.ReferenceID, order.OrderNumber) || details.ReferenceID == "") &&
			(details.Status == "CREATED" || details.Status == "APPROVED" || details.Status == "SAVED") {
			pc.respondCreated(c, order, existing, amount, currency)
			return
		}
	}

	paypalOrderID, _, err := client.CreateOrder(ctx, amount, currency, order.OrderNumber, "create-"+order.OrderNumber+"-"+uuid.NewString())
	if err != nil {
		log.Printf("paypal create order failed for %s: %v", order.OrderNumber, err)
		c.JSON(http.StatusBadGateway, models.APIResponse{Success: false, Message: "Failed to start PayPal payment", Error: utils.PublicError(err, "internal_error")})
		return
	}

	if err := db.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]interface{}{
		"payment_id":     paypalOrderID,
		"payment_method": "paypal",
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to store payment session"})
		return
	}
	order.PaymentID = paypalOrderID
	order.PaymentMethod = "paypal"

	pc.respondCreated(c, order, paypalOrderID, amount, currency)
}

func (pc *PayPalPaymentController) respondCreated(c *gin.Context, order models.Order, paypalOrderID string, amount float64, currency string) {
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "PayPal order ready",
		Data: gin.H{
			"order_id":        order.ID,
			"order_number":    order.OrderNumber,
			"paypal_order_id": paypalOrderID,
			"amount":          amount,
			"currency":        currency,
		},
	})
}

type capturePayPalRequest struct {
	PayPalOrderID string `json:"paypal_order_id" binding:"required"`
}

// CapturePayPalOrder captures a PayPal order server-side and only then marks
// the internal order paid. Amount, currency and reference are all re-verified
// against the stored order before any state changes.
// POST /api/v1/orders/:id/paypal/capture
func (pc *PayPalPaymentController) CapturePayPalOrder(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}

	var req capturePayPalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request data"})
		return
	}
	req.PayPalOrderID = strings.TrimSpace(req.PayPalOrderID)

	var order models.Order
	if err := db.First(&order, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Order not found"})
		return
	}

	// Idempotent: already-paid orders simply return the current state.
	if strings.EqualFold(order.PaymentStatus, "paid") {
		db.Preload("Items.Product").Preload("Coupon").First(&order, order.ID)
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Order is already paid", Data: order})
		return
	}

	// The captured PayPal order must be the one we created for this order.
	if stored := strings.TrimSpace(order.PaymentID); stored == "" || stored != req.PayPalOrderID {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Payment session does not match this order"})
		return
	}

	client, _, err := services.NewPayPalAPIClientFromSettings(db)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "PayPal is not configured", Error: err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	details, err := client.CaptureOrder(ctx, req.PayPalOrderID, "capture-"+order.OrderNumber)
	if err != nil {
		log.Printf("paypal capture failed for %s: %v", order.OrderNumber, err)
		c.JSON(http.StatusBadGateway, models.APIResponse{Success: false, Message: "PayPal capture failed", Error: utils.PublicError(err, "internal_error")})
		return
	}

	if err := verifyPayPalPayment(order, details); err != nil {
		log.Printf("paypal capture verification failed for %s: %v", order.OrderNumber, err)
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: err.Error()})
		return
	}

	if err := finalizePaidOrder(db, order.ID, details); err != nil {
		log.Printf("paypal finalize failed for %s: %v", order.OrderNumber, err)
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to record payment"})
		return
	}

	db.Preload("Items.Product").Preload("Coupon").First(&order, order.ID)
	go func(orderID uint, baseURL string) {
		if err := services.NotifyAdminOrderPaid(config.GetDB(), baseURL, orderID); err != nil {
			log.Printf("order notification: %v", err)
		}
	}(order.ID, requestBaseURL(c))

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Payment processed successfully", Data: order})
}

// PayPalWebhook reconciles PayPal capture events. It is signature-verified so
// it can be trusted even though it has no other authentication.
// POST /api/v1/paypal/webhook
func (pc *PayPalPaymentController) PayPalWebhook(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false})
		return
	}

	body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxWebhookBodyBytes+1))
	if err != nil || len(body) == 0 || len(body) > maxWebhookBodyBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid webhook body"})
		return
	}

	client, setting, err := services.NewPayPalAPIClientFromSettings(db)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "PayPal is not configured"})
		return
	}
	if strings.TrimSpace(setting.WebhookID) == "" {
		log.Printf("paypal webhook received but no webhook id is configured")
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Webhook not configured"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	if err := client.VerifyWebhookSignature(ctx,
		c.GetHeader("Paypal-Transmission-Id"),
		c.GetHeader("Paypal-Transmission-Time"),
		c.GetHeader("Paypal-Cert-Url"),
		c.GetHeader("Paypal-Auth-Algo"),
		c.GetHeader("Paypal-Transmission-Sig"),
		body,
	); err != nil {
		log.Printf("paypal webhook signature rejected: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid signature"})
		return
	}

	var event struct {
		EventType string `json:"event_type"`
		Resource  struct {
			ID       string `json:"id"`
			Status   string `json:"status"`
			CustomID string `json:"custom_id"`
			Amount   struct {
				Value        string `json:"value"`
				CurrencyCode string `json:"currency_code"`
			} `json:"amount"`
			SupplementaryData struct {
				RelatedIDs struct {
					OrderID string `json:"order_id"`
				} `json:"related_ids"`
			} `json:"supplementary_data"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid event payload"})
		return
	}

	switch strings.ToUpper(strings.TrimSpace(event.EventType)) {
	case "PAYMENT.CAPTURE.COMPLETED":
		if err := pc.reconcileCaptureCompleted(db, event.Resource.ID, event.Resource.CustomID,
			event.Resource.SupplementaryData.RelatedIDs.OrderID, event.Resource.Amount.Value,
			event.Resource.Amount.CurrencyCode, string(body)); err != nil {
			log.Printf("paypal webhook reconcile failed: %v", err)
			// Return 5xx so PayPal retries a transient failure.
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Reconciliation failed"})
			return
		}
	}

	// Always 200 for handled/ignored events so PayPal does not retry them.
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (pc *PayPalPaymentController) reconcileCaptureCompleted(db *gorm.DB, captureID, customID, paypalOrderID, amountValue, currency, raw string) error {
	var order models.Order
	query := db.Model(&models.Order{})
	switch {
	case strings.TrimSpace(customID) != "":
		query = query.Where("order_number = ?", strings.TrimSpace(customID))
	case strings.TrimSpace(paypalOrderID) != "":
		query = query.Where("payment_id = ?", strings.TrimSpace(paypalOrderID))
	default:
		return errors.New("webhook does not identify an order")
	}
	if err := query.First(&order).Error; err != nil {
		return fmt.Errorf("order lookup: %w", err)
	}

	details := &services.PayPalOrderDetails{
		OrderID:     strings.TrimSpace(paypalOrderID),
		Status:      "COMPLETED",
		ReferenceID: strings.TrimSpace(customID),
		CaptureID:   strings.TrimSpace(captureID),
		Currency:    strings.ToUpper(strings.TrimSpace(currency)),
		RawJSON:     raw,
	}
	if v, parseErr := parseAmount(amountValue); parseErr == nil {
		details.Amount = v
	}

	if err := verifyPayPalPayment(order, details); err != nil {
		return fmt.Errorf("verify webhook capture: %w", err)
	}
	return finalizePaidOrder(db, order.ID, details)
}

// verifyPayPalPayment rejects captures whose amount, currency or reference do
// not match the stored internal order.
func verifyPayPalPayment(order models.Order, details *services.PayPalOrderDetails) error {
	if details == nil {
		return errors.New("missing PayPal capture details")
	}
	if !strings.EqualFold(details.Status, "COMPLETED") {
		return fmt.Errorf("PayPal payment is not completed (status %q)", details.Status)
	}
	if strings.TrimSpace(details.CaptureID) == "" {
		return errors.New("PayPal capture id is missing")
	}
	if ref := strings.TrimSpace(details.ReferenceID); ref != "" && !strings.EqualFold(ref, order.OrderNumber) {
		return errors.New("PayPal payment does not belong to this order")
	}
	if roundMoney(details.Amount) != roundMoney(order.TotalAmount) {
		return fmt.Errorf("payment amount %s does not match order total %s", formatAmount(details.Amount), formatAmount(order.TotalAmount))
	}
	orderCurrency := strings.ToUpper(strings.TrimSpace(order.Currency))
	if orderCurrency == "" {
		orderCurrency = "USD"
	}
	if cur := strings.ToUpper(strings.TrimSpace(details.Currency)); cur != "" && cur != orderCurrency {
		return fmt.Errorf("payment currency %s does not match order currency %s", cur, orderCurrency)
	}
	return nil
}

// finalizePaidOrder marks the order paid exactly once. It locks the order row,
// writes a single payment transaction (uniquely keyed by capture id) and
// decrements stock, so a webhook racing a browser capture cannot double-pay.
func finalizePaidOrder(db *gorm.DB, orderID uint, details *services.PayPalOrderDetails) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var order models.Order
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("Items").First(&order, orderID).Error; err != nil {
			return err
		}
		if strings.EqualFold(order.PaymentStatus, "paid") {
			return nil
		}
		if err := verifyPayPalPayment(order, details); err != nil {
			return err
		}

		transaction := models.PaymentTransaction{
			OrderID:       order.ID,
			TransactionID: details.CaptureID,
			PaymentMethod: "paypal",
			Amount:        roundMoney(order.TotalAmount),
			Currency:      order.Currency,
			Status:        "completed",
			PayerID:       details.PayerID,
			PayerEmail:    details.PayerEmail,
			PaymentData:   truncateForDB(details.RawJSON, 60000),
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "transaction_id"}},
			DoNothing: true,
		}).Create(&transaction).Error; err != nil {
			return fmt.Errorf("create payment transaction: %w", err)
		}

		for _, item := range order.Items {
			if err := tx.Model(&models.Product{}).Where("id = ?", item.ProductID).
				UpdateColumn("stock_quantity", gorm.Expr("GREATEST(stock_quantity - ?, 0)", item.Quantity)).Error; err != nil {
				return fmt.Errorf("update stock: %w", err)
			}
		}

		updates := map[string]interface{}{
			"payment_status": "paid",
			"payment_method": "paypal",
			"status":         "confirmed",
		}
		if strings.TrimSpace(order.PaymentID) == "" && strings.TrimSpace(details.OrderID) != "" {
			updates["payment_id"] = details.OrderID
		}
		return tx.Model(&models.Order{}).Where("id = ?", order.ID).Updates(updates).Error
	})
}

func requestBaseURL(c *gin.Context) string {
	if siteURL := strings.TrimSpace(os.Getenv("SITE_URL")); siteURL != "" {
		return siteURL
	}
	proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if proto == "" {
		proto = "https"
	}
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}
	if host == "" {
		return ""
	}
	return fmt.Sprintf("%s://%s", proto, host)
}

func parseAmount(value string) (float64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, errors.New("empty amount")
	}
	return strconv.ParseFloat(value, 64)
}

func formatAmount(v float64) string {
	return fmt.Sprintf("%.2f", v)
}

func truncateForDB(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
