package controllers

import (
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type refundOrderRequest struct {
	Amount *float64 `json:"amount"`
	Reason string   `json:"reason"`
}

// RefundOrder creates a real PayPal capture refund. Omitting amount refunds the
// full remaining balance; a smaller amount creates a partial refund.
func (oc *OrderController) RefundOrder(c *gin.Context) {
	var req refundOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid refund request", Error: err.Error()})
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if len(req.Reason) > 500 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Refund reason must be 500 characters or fewer"})
		return
	}

	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}
	payPalClient, err := services.NewPayPalRefundClientFromSettings(db)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "PayPal refunds are not configured", Error: utils.PublicError(err, "internal_error")})
		return
	}

	var refund models.Refund
	var order models.Order
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("Items").First(&order, c.Param("id")).Error; err != nil {
			return err
		}
		if !strings.EqualFold(order.PaymentMethod, "paypal") {
			return fmt.Errorf("only PayPal orders can be refunded with this endpoint")
		}
		if order.PaymentStatus != "paid" && order.PaymentStatus != "partially_refunded" {
			return fmt.Errorf("order payment status %q cannot be refunded", order.PaymentStatus)
		}

		var pending int64
		if err := tx.Model(&models.Refund{}).Where("order_id = ? AND status = ?", order.ID, "pending").Count(&pending).Error; err != nil {
			return err
		}
		if pending > 0 {
			return fmt.Errorf("a refund for this order is already pending")
		}

		remaining := roundMoney(order.TotalAmount - order.RefundedAmount)
		amount := remaining
		if req.Amount != nil {
			amount = roundMoney(*req.Amount)
		}
		if remaining <= 0 || amount <= 0 || amount > remaining {
			return fmt.Errorf("refund amount must be greater than 0 and no more than %.2f", remaining)
		}

		var payment models.PaymentTransaction
		if err := tx.Where("order_id = ? AND payment_method = ? AND status = ?", order.ID, "paypal", "completed").
			Order("created_at DESC").First(&payment).Error; err != nil {
			return fmt.Errorf("PayPal capture transaction not found: %w", err)
		}
		if strings.TrimSpace(payment.TransactionID) == "" {
			return fmt.Errorf("PayPal capture ID is missing")
		}

		currency := strings.ToUpper(strings.TrimSpace(order.Currency))
		if currency == "" {
			currency = "USD"
		}
		refund = models.Refund{
			OrderID:              order.ID,
			PaymentTransactionID: &payment.ID,
			CaptureID:            payment.TransactionID,
			Amount:               amount,
			Currency:             currency,
			Reason:               req.Reason,
			Status:               "pending",
		}
		if userID := c.GetUint("user_id"); userID != 0 {
			refund.RequestedBy = &userID
		}
		return tx.Create(&refund).Error
	})
	if err != nil {
		status := http.StatusBadRequest
		if err == gorm.ErrRecordNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, models.APIResponse{Success: false, Message: "Refund could not be started", Error: err.Error()})
		return
	}

	requestID := fmt.Sprintf("vibocnc-refund-%d-%d", order.ID, refund.ID)
	result, refundErr := payPalClient.RefundCapture(c.Request.Context(), refund.CaptureID, refund.Amount, refund.Currency, requestID)
	if refundErr != nil {
		db.Model(&refund).Updates(map[string]interface{}{
			"status":            "failed",
			"provider_response": result.RawJSON,
		})
		c.JSON(http.StatusBadGateway, models.APIResponse{Success: false, Message: "PayPal rejected the refund", Error: refundErr.Error()})
		return
	}

	providerStatus := strings.ToLower(strings.TrimSpace(result.Status))
	if providerStatus == "" {
		providerStatus = "pending"
	}
	if providerStatus != "completed" && providerStatus != "pending" {
		db.Model(&refund).Updates(map[string]interface{}{
			"provider_refund_id": result.ID,
			"provider_response":  result.RawJSON,
			"status":             providerStatus,
		})
		c.JSON(http.StatusBadGateway, models.APIResponse{Success: false, Message: "PayPal did not complete the refund", Error: "refund status: " + providerStatus})
		return
	}

	if err := applyPayPalRefundResult(db, refund.ID, result.ID, providerStatus, result.RawJSON); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "PayPal refunded the payment, but the local order needs reconciliation", Error: utils.PublicError(err, "internal_error")})
		return
	}
	if err := db.Preload("Items.Product").Preload("Refunds").First(&order, order.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Refund completed but the updated order could not be loaded", Error: utils.PublicError(err, "internal_error")})
		return
	}
	if err := db.First(&refund, refund.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Refund completed but the refund record could not be loaded", Error: utils.PublicError(err, "internal_error")})
		return
	}

	status := http.StatusOK
	message := "Refund completed"
	if refund.Status == "pending" {
		status = http.StatusAccepted
		message = "Refund submitted to PayPal and is pending"
	}
	c.JSON(status, models.APIResponse{Success: true, Message: message, Data: gin.H{
		"order":             order,
		"refund":            refund,
		"refundable_amount": roundMoney(order.TotalAmount - order.RefundedAmount),
	}})
}

// SyncRefund reconciles an asynchronous PayPal refund without creating a new
// provider request. It is safe to call repeatedly from the admin UI.
func (oc *OrderController) SyncRefund(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database not initialized"})
		return
	}
	var refund models.Refund
	if err := db.Where("id = ? AND order_id = ?", c.Param("refundID"), c.Param("id")).First(&refund).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Refund not found", Error: utils.PublicError(err, "internal_error")})
		return
	}
	if refund.Status == "completed" || refund.Status == "failed" {
		var order models.Order
		if orderErr := db.Preload("Items.Product").Preload("Refunds").First(&order, refund.OrderID).Error; orderErr != nil {
			c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Refund found but order could not be loaded", Error: orderErr.Error()})
			return
		}
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Refund already finalized", Data: gin.H{
			"order": order, "refund": refund, "refundable_amount": roundMoney(order.TotalAmount - order.RefundedAmount),
		}})
		return
	}
	if strings.TrimSpace(refund.ProviderRefundID) == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Refund has no PayPal refund ID yet"})
		return
	}
	client, err := services.NewPayPalRefundClientFromSettings(db)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "PayPal refunds are not configured", Error: err.Error()})
		return
	}
	result, err := client.GetRefund(c.Request.Context(), refund.ProviderRefundID)
	if err != nil {
		c.JSON(http.StatusBadGateway, models.APIResponse{Success: false, Message: "Failed to read PayPal refund status", Error: utils.PublicError(err, "internal_error")})
		return
	}
	status := strings.ToLower(strings.TrimSpace(result.Status))
	if status == "" {
		status = "pending"
	}
	if status != "completed" && status != "pending" {
		status = "failed"
	}
	if err := applyPayPalRefundResult(db, refund.ID, result.ID, status, result.RawJSON); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Refund status read but local reconciliation failed", Error: utils.PublicError(err, "internal_error")})
		return
	}
	var order models.Order
	if err := db.Preload("Items.Product").Preload("Refunds").First(&order, refund.OrderID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Refund reconciled but order could not be loaded", Error: utils.PublicError(err, "internal_error")})
		return
	}
	db.First(&refund, refund.ID)
	statusCode := http.StatusOK
	message := "Refund status reconciled"
	if refund.Status == "pending" {
		statusCode = http.StatusAccepted
		message = "Refund is still pending at PayPal"
	}
	c.JSON(statusCode, models.APIResponse{Success: true, Message: message, Data: gin.H{
		"order":             order,
		"refund":            refund,
		"refundable_amount": roundMoney(order.TotalAmount - order.RefundedAmount),
	}})
}

func applyPayPalRefundResult(db *gorm.DB, refundID uint, providerID, providerStatus, rawResponse string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var refund models.Refund
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&refund, refundID).Error; err != nil {
			return err
		}
		if err := tx.Model(&refund).Updates(map[string]interface{}{
			"provider_refund_id": providerID,
			"provider_response":  rawResponse,
			"status":             providerStatus,
		}).Error; err != nil {
			return err
		}

		var order models.Order
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("Items").First(&order, refund.OrderID).Error; err != nil {
			return err
		}
		if providerStatus == "pending" {
			return tx.Model(&order).Update("payment_status", "refund_pending").Error
		}
		if providerStatus != "completed" {
			var refundedAmount float64
			if err := tx.Model(&models.Refund{}).
				Where("order_id = ? AND status = ?", order.ID, "completed").
				Select("COALESCE(SUM(amount), 0)").Scan(&refundedAmount).Error; err != nil {
				return err
			}
			paymentStatus := "paid"
			if roundMoney(refundedAmount) > 0 {
				paymentStatus = "partially_refunded"
			}
			return tx.Model(&order).Update("payment_status", paymentStatus).Error
		}

		var refundedAmount float64
		if err := tx.Model(&models.Refund{}).
			Where("order_id = ? AND status = ?", order.ID, "completed").
			Select("COALESCE(SUM(amount), 0)").Scan(&refundedAmount).Error; err != nil {
			return err
		}
		refundedAmount = roundMoney(refundedAmount)
		now := time.Now()
		updates := map[string]interface{}{
			"refunded_amount": refundedAmount,
			"refunded_at":     &now,
			"payment_status":  "partially_refunded",
		}
		fullyRefunded := refundedAmount >= roundMoney(order.TotalAmount)-0.005
		if fullyRefunded {
			updates["payment_status"] = "refunded"
			if order.Status != "shipped" && order.Status != "delivered" {
				updates["status"] = "cancelled"
				if order.StockRestoredAt == nil {
					for _, item := range order.Items {
						if err := tx.Model(&models.Product{}).Where("id = ?", item.ProductID).
							UpdateColumn("stock_quantity", gorm.Expr("stock_quantity + ?", item.Quantity)).Error; err != nil {
							return err
						}
					}
					updates["stock_restored_at"] = &now
				}
			}
		}
		return tx.Model(&order).Updates(updates).Error
	})
}

func roundMoney(value float64) float64 {
	return math.Round(value*100) / 100
}
