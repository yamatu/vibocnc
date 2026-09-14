package controllers

import (
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
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
	"gorm.io/gorm"
)

type OrderController struct{}

// OrderCreateRequest matches frontend request format
type OrderCreateRequest struct {
	CustomerEmail   string `json:"customer_email" binding:"required,email"`
	CustomerName    string `json:"customer_name" binding:"required"`
	CustomerPhone   string `json:"customer_phone"`
	ShippingAddress string `json:"shipping_address" binding:"required"`
	ShippingCountry string `json:"shipping_country" binding:"required"`
	BillingAddress  string `json:"billing_address" binding:"required"`
	Notes           string `json:"notes"`
	CouponCode      string `json:"coupon_code"` // Optional coupon code
	Items           []struct {
		ProductID uint    `json:"product_id" binding:"required"`
		Quantity  int     `json:"quantity" binding:"required,min=1"`
		UnitPrice float64 `json:"unit_price" binding:"required,min=0"`
	} `json:"items" binding:"required,min=1"`
}

// PaymentRequest matches frontend payment request format
type PaymentRequest struct {
	PaymentMethod string      `json:"payment_method" binding:"required"`
	PaymentData   interface{} `json:"payment_data"`
}

// CreateOrder creates a new order
func (oc *OrderController) CreateOrder(c *gin.Context) {
	var req OrderCreateRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request data",
			"error":   err.Error(),
		})
		return
	}

	// Generate an unguessable order number. A predictable timestamp-based
	// number made the public tracking endpoint enumerable.
	orderNumber, err := generateOrderNumber()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to create order",
		})
		return
	}

	// Calculate total amount and validate products
	var subtotalAmount float64
	var orderItems []models.OrderItem
	var totalWeightKg float64

	for _, item := range req.Items {
		var product models.Product
		if err := config.DB.First(&product, item.ProductID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": fmt.Sprintf("Product with ID %d not found", item.ProductID),
			})
			return
		}

		// Check stock
		if product.StockQuantity < item.Quantity {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": fmt.Sprintf("Insufficient stock for product %s", product.Name),
			})
			return
		}

		if product.Price <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": fmt.Sprintf("Product %s requires a quotation before ordering", product.SKU),
			})
			return
		}

		// Prices are authoritative server-side; never trust a browser-submitted unit price.
		unitPrice := product.Price

		itemTotal := unitPrice * float64(item.Quantity)
		subtotalAmount += itemTotal
		if product.Weight != nil {
			totalWeightKg += float64(item.Quantity) * float64(*product.Weight)
		}

		orderItems = append(orderItems, models.OrderItem{
			ProductID:  item.ProductID,
			Quantity:   item.Quantity,
			UnitPrice:  unitPrice,
			TotalPrice: itemTotal,
		})
	}

	// Initialize amounts
	discountAmount := 0.0
	shippingFee := 0.0
	cc := services.NormalizeCountryCode(req.ShippingCountry)

	// Check free shipping first
	if services.IsFreeShippingCountry(config.DB, cc) {
		shippingFee = 0
	} else if totalWeightKg > 0 {
		// Use same fallback chain as PublicQuote: default template -> carrier template
		quote, shipErr := services.CalculateShippingQuote(config.DB, cc, totalWeightKg)
		if errors.Is(shipErr, gorm.ErrRecordNotFound) {
			// Default template missing; try any carrier template (prioritize FEDEX)
			type pair struct {
				Carrier     string
				ServiceCode string
			}
			var pairs []pair
			qe := config.DB.Model(&models.ShippingCarrierTemplate{}).
				Select("carrier, service_code").
				Where("country_code = ? AND is_active = ?", cc, true).
				Group("carrier, service_code").
				Order("CASE WHEN carrier = 'FEDEX' THEN 0 WHEN carrier = 'DHL' THEN 1 ELSE 9 END, carrier ASC, service_code ASC").
				Scan(&pairs).Error
			if qe == nil && len(pairs) > 0 {
				quote, shipErr = services.CalculateCarrierShippingQuote(config.DB, pairs[0].Carrier, pairs[0].ServiceCode, cc, totalWeightKg)
			}
		}
		if shipErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "Shipping template not configured for country/weight",
				"error":   shipErr.Error(),
			})
			return
		}
		shippingFee = quote.ShippingFee
	}
	totalAmount := subtotalAmount + shippingFee
	var couponID *uint

	// Validate coupon if provided (read-only: no usage recorded yet)
	if req.CouponCode != "" {
		couponController := &CouponController{}
		couponResponse, err := couponController.ValidateCouponCode(config.DB, req.CouponCode, subtotalAmount, req.CustomerEmail)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": "Failed to validate coupon",
			})
			return
		}

		if couponResponse != nil {
			if !couponResponse.Valid {
				c.JSON(http.StatusBadRequest, gin.H{
					"success": false,
					"message": couponResponse.Message,
				})
				return
			}

			discountAmount = couponResponse.DiscountAmount
			totalAmount = couponResponse.FinalAmount + shippingFee
			couponID = &couponResponse.CouponID
		}
	}

	// Create order
	order := models.Order{
		OrderNumber:     orderNumber,
		CustomerEmail:   req.CustomerEmail,
		CustomerName:    req.CustomerName,
		CustomerPhone:   req.CustomerPhone,
		ShippingAddress: req.ShippingAddress,
		ShippingCountry: services.NormalizeCountryCode(req.ShippingCountry),
		ShippingFee:     shippingFee,
		BillingAddress:  req.BillingAddress,
		Status:          "pending",
		PaymentStatus:   "pending",
		PaymentMethod:   "", // Will be set during payment
		SubtotalAmount:  subtotalAmount,
		DiscountAmount:  discountAmount,
		TotalAmount:     totalAmount,
		CouponCode:      req.CouponCode,
		CouponID:        couponID,
		Currency:        "USD",
		Notes:           req.Notes,
		Items:           orderItems,
	}

	// Get customer ID if authenticated as customer
	if customerID, exists := c.Get("customer_id"); exists {
		if cid, ok := customerID.(uint); ok {
			order.CustomerID = &cid
		}
	}

	// Get user ID if authenticated as admin
	if userID, exists := c.Get("user_id"); exists {
		if uid, ok := userID.(uint); ok {
			order.UserID = &uid
		}
	}

	// Create the order and claim the coupon use in one transaction so a
	// concurrent order cannot slip past the coupon's usage limit.
	tx := config.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to create order",
		})
		return
	}

	if err := tx.Create(&order).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to create order",
		})
		return
	}

	// Record coupon usage exactly once, with the real order id.
	if req.CouponCode != "" && couponID != nil {
		couponController := &CouponController{}
		consumeResp, err := couponController.ConsumeCoupon(tx, req.CouponCode, order.ID, subtotalAmount, req.CustomerEmail)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": "Failed to apply coupon",
			})
			return
		}
		if consumeResp != nil && !consumeResp.Valid {
			tx.Rollback()
			c.JSON(http.StatusConflict, gin.H{
				"success": false,
				"message": consumeResp.Message,
			})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to create order",
		})
		return
	}

	// Load order with items, products, and coupon
	config.DB.Preload("Items.Product").Preload("User").Preload("Coupon").First(&order, order.ID)

	// Admin notification: order created (best-effort, async)
	siteURL := os.Getenv("SITE_URL")
	if siteURL == "" {
		proto := c.GetHeader("X-Forwarded-Proto")
		if proto == "" {
			proto = "https"
		}
		host := c.GetHeader("X-Forwarded-Host")
		if host == "" {
			host = c.Request.Host
		}
		if host != "" {
			siteURL = fmt.Sprintf("%s://%s", proto, host)
		}
	}
	go func(orderID uint, baseURL string) {
		if err := services.NotifyAdminOrderCreated(config.DB, baseURL, orderID); err != nil {
			log.Printf("order notification: %v", err)
		}
	}(order.ID, siteURL)

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"message": "Order created successfully",
		"data":    order,
	})
}

// GetOrders gets all orders (admin only) with improved filtering
func (oc *OrderController) GetOrders(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	status := c.Query("status")
	paymentStatus := c.Query("payment_status")
	customerEmail := c.Query("customer_email")
	orderNumber := c.Query("order_number")
	dateFrom := c.Query("date_from")
	dateTo := c.Query("date_to")

	offset := (page - 1) * pageSize

	query := config.DB.Model(&models.Order{})

	// Apply filters
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if paymentStatus != "" {
		query = query.Where("payment_status = ?", paymentStatus)
	}
	if customerEmail != "" {
		query = query.Where("customer_email LIKE ?", "%"+customerEmail+"%")
	}
	if orderNumber != "" {
		query = query.Where("order_number LIKE ?", "%"+orderNumber+"%")
	}
	if dateFrom != "" {
		query = query.Where("created_at >= ?", dateFrom)
	}
	if dateTo != "" {
		query = query.Where("created_at <= ?", dateTo)
	}

	var total int64
	query.Count(&total)

	var orders []models.Order
	if err := query.Preload("Items.Product").Preload("User").
		Offset(offset).Limit(pageSize).
		Order("created_at DESC").Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to fetch orders",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Orders retrieved successfully",
		"data": gin.H{
			"data":        orders,
			"page":        page,
			"page_size":   pageSize,
			"total":       total,
			"total_pages": (total + int64(pageSize) - 1) / int64(pageSize),
		},
	})
}

// GetOrder gets a single order
func (oc *OrderController) GetOrder(c *gin.Context) {
	orderID := c.Param("id")

	var order models.Order
	if err := config.DB.Preload("Items.Product").Preload("Refunds").Preload("User").
		First(&order, orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Order not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Order retrieved successfully",
		"data":    order,
	})
}

// UpdateOrderStatus updates order status (admin only)
func (oc *OrderController) UpdateOrderStatus(c *gin.Context) {
	orderID := c.Param("id")

	var req struct {
		Status string `json:"status" binding:"required"`
		Notes  string `json:"notes"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request data",
			"error":   err.Error(),
		})
		return
	}

	// Validate status
	validStatuses := []string{"pending", "confirmed", "processing", "shipped", "delivered", "cancelled"}
	validStatus := false
	for _, status := range validStatuses {
		if req.Status == status {
			validStatus = true
			break
		}
	}

	if !validStatus {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid status. Valid statuses: pending, confirmed, processing, shipped, delivered, cancelled",
		})
		return
	}

	var order models.Order
	if err := config.DB.First(&order, orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Order not found",
		})
		return
	}

	order.Status = req.Status
	if req.Notes != "" {
		order.Notes = req.Notes
	}

	if err := config.DB.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to update order",
		})
		return
	}

	// Load updated order with relationships
	config.DB.Preload("Items.Product").Preload("User").First(&order, order.ID)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Order updated successfully",
		"data":    order,
	})
}

// GetOrderByNumber gets order by order number (public - for order tracking).
// The response is limited to the fields the public tracking page needs so it
// cannot leak internal/admin data or product cost prices.
func (oc *OrderController) GetOrderByNumber(c *gin.Context) {
	orderNumber := strings.TrimSpace(c.Param("orderNumber"))

	if orderNumber == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Order number is required",
		})
		return
	}

	var order models.Order
	if err := config.DB.Where("order_number = ?", orderNumber).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Select("id, order_id, product_id, quantity, unit_price, total_price")
		}).
		Preload("Items.Product", func(db *gorm.DB) *gorm.DB {
			return db.Select("id, name, slug, sku, image_urls")
		}).
		First(&order).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Order not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Order retrieved successfully",
		"data": gin.H{
			"order_number":     order.OrderNumber,
			"customer_name":    order.CustomerName,
			"customer_email":   order.CustomerEmail,
			"customer_phone":   order.CustomerPhone,
			"status":           order.Status,
			"payment_status":   order.PaymentStatus,
			"payment_method":   order.PaymentMethod,
			"shipping_address": order.ShippingAddress,
			"notes":            order.Notes,
			"shipping_carrier": order.ShippingCarrier,
			"tracking_number":  order.TrackingNumber,
			"shipped_at":       order.ShippedAt,
			"subtotal_amount":  order.SubtotalAmount,
			"discount_amount":  order.DiscountAmount,
			"shipping_fee":     order.ShippingFee,
			"total_amount":     order.TotalAmount,
			"currency":         order.Currency,
			"items":            order.Items,
			"created_at":       order.CreatedAt,
			"updated_at":       order.UpdatedAt,
		},
	})
}

// generateOrderNumber returns a high-entropy, human-readable order number.
func generateOrderNumber() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:])
	if len(enc) > 10 {
		enc = enc[:10]
	}
	return fmt.Sprintf("ORD-%s-%s", time.Now().UTC().Format("20060102"), enc), nil
}

// DeleteOrder deletes an order (admin only)
func (oc *OrderController) DeleteOrder(c *gin.Context) {
	orderID := c.Param("id")

	var order models.Order
	if err := config.DB.Preload("Items").Preload("Refunds").First(&order, orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Order not found",
		})
		return
	}
	if len(order.Refunds) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Orders with refund history cannot be deleted",
		})
		return
	}

	// Check if order can be deleted (only pending or cancelled orders can be deleted)
	if order.Status != "pending" && order.Status != "cancelled" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Only pending or cancelled orders can be deleted",
		})
		return
	}

	// If order was paid, restore product stock before deletion
	if order.PaymentStatus == "paid" {
		for _, item := range order.Items {
			config.DB.Model(&models.Product{}).Where("id = ?", item.ProductID).
				UpdateColumn("stock_quantity", config.DB.Raw("stock_quantity + ?", item.Quantity))
		}
	}

	// Delete order items first
	if err := config.DB.Where("order_id = ?", order.ID).Delete(&models.OrderItem{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to delete order items",
		})
		return
	}

	// Delete payment transactions
	config.DB.Where("order_id = ?", order.ID).Delete(&models.PaymentTransaction{})

	// Delete the order
	if err := config.DB.Delete(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to delete order",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Order deleted successfully",
	})
}

// UpdateOrder updates an order (admin only)
func (oc *OrderController) UpdateOrder(c *gin.Context) {
	orderID := c.Param("id")

	var req struct {
		CustomerEmail   string `json:"customer_email"`
		CustomerName    string `json:"customer_name"`
		CustomerPhone   string `json:"customer_phone"`
		ShippingAddress string `json:"shipping_address"`
		BillingAddress  string `json:"billing_address"`
		TrackingNumber  string `json:"tracking_number"`
		ShippingCarrier string `json:"shipping_carrier"`
		NotifyShipped   bool   `json:"notify_shipped"`
		Status          string `json:"status"`
		PaymentStatus   string `json:"payment_status"`
		Notes           string `json:"notes"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request data",
			"error":   err.Error(),
		})
		return
	}

	var order models.Order
	if err := config.DB.First(&order, orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Order not found",
		})
		return
	}

	prevTracking := order.TrackingNumber
	prevCarrier := order.ShippingCarrier
	prevEmailSent := order.ShippedEmailSentAt

	// Update order fields if provided
	if req.CustomerEmail != "" {
		order.CustomerEmail = req.CustomerEmail
	}
	if req.CustomerName != "" {
		order.CustomerName = req.CustomerName
	}
	if req.CustomerPhone != "" {
		order.CustomerPhone = req.CustomerPhone
	}
	if req.ShippingAddress != "" {
		order.ShippingAddress = req.ShippingAddress
	}
	if req.BillingAddress != "" {
		order.BillingAddress = req.BillingAddress
	}
	if req.TrackingNumber != "" || c.Query("allow_clear") == "1" {
		// allow_clear=1 supports clearing the field from admin UI
		order.TrackingNumber = req.TrackingNumber
		if req.TrackingNumber != "" {
			now := time.Now()
			order.ShippedAt = &now
		} else {
			order.ShippedAt = nil
		}
	}
	if req.ShippingCarrier != "" || c.Query("allow_clear") == "1" {
		order.ShippingCarrier = req.ShippingCarrier
	}
	if req.Status != "" {
		// Validate status
		validStatuses := []string{"pending", "confirmed", "processing", "shipped", "delivered", "cancelled"}
		validStatus := false
		for _, status := range validStatuses {
			if req.Status == status {
				validStatus = true
				break
			}
		}
		if !validStatus {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "Invalid status. Valid statuses: pending, confirmed, processing, shipped, delivered, cancelled",
			})
			return
		}
		order.Status = req.Status
	}
	if req.PaymentStatus != "" {
		// Refund states are written only by the PayPal refund endpoint so an
		// admin edit cannot mark an order refunded without a provider result.
		if (req.PaymentStatus == "refunded" || req.PaymentStatus == "partially_refunded" || req.PaymentStatus == "refund_pending") && req.PaymentStatus != order.PaymentStatus {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "Use the refund action to change payment to a refund status",
			})
			return
		}
		validPaymentStatuses := []string{"pending", "paid", "failed", "refund_pending", "partially_refunded", "refunded"}
		validPaymentStatus := false
		for _, status := range validPaymentStatuses {
			if req.PaymentStatus == status {
				validPaymentStatus = true
				break
			}
		}
		if !validPaymentStatus {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "Invalid payment status. Valid statuses: pending, paid, failed, refunded",
			})
			return
		}
		order.PaymentStatus = req.PaymentStatus
	}
	if req.Notes != "" {
		order.Notes = req.Notes
	}

	if err := config.DB.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to update order",
		})
		return
	}

	// Send shipping notification email (optional)
	if req.NotifyShipped {
		// reload setting and check
		setting, err := services.GetOrCreateEmailSetting(config.DB)
		if err == nil && setting.Enabled && setting.ShippingNotificationsEnabled {
			if order.CustomerEmail != "" && order.TrackingNumber != "" {
				shouldSend := false
				if prevEmailSent == nil {
					shouldSend = true
				} else if prevTracking != order.TrackingNumber || prevCarrier != order.ShippingCarrier {
					shouldSend = true
				}
				if shouldSend {
					siteURL := os.Getenv("SITE_URL")
					if siteURL == "" {
						// best effort from request headers
						proto := c.GetHeader("X-Forwarded-Proto")
						if proto == "" {
							proto = "https"
						}
						host := c.GetHeader("X-Forwarded-Host")
						if host == "" {
							host = c.Request.Host
						}
						if host != "" {
							siteURL = fmt.Sprintf("%s://%s", proto, host)
						}
					}

					// Load items/products so the email includes what was shipped.
					sendOrder := order
					_ = config.DB.Preload("Items.Product").First(&sendOrder, order.ID).Error
					subj, txt, html := services.BuildShipmentNotificationEmail(siteURL, sendOrder)
					err := services.SendEmail(config.DB, services.EmailSendOptions{To: order.CustomerEmail, Subject: subj, Text: txt, HTML: html, Headers: map[string]string{"X-Entity-Ref-ID": "shipment:" + order.OrderNumber}})
					if err == nil {
						now := time.Now()
						order.ShippedEmailSentAt = &now
						config.DB.Model(&models.Order{}).Where("id = ?", order.ID).Update("shipped_email_sent_at", &now)
					} else {
						// Keep order saved; just include a warning in response.
						c.Header("X-Email-Warn", err.Error())
					}
				}
			}
		}
	}

	// Load updated order with relationships
	config.DB.Preload("Items.Product").Preload("User").First(&order, order.ID)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Order updated successfully",
		"data":    order,
	})
}
