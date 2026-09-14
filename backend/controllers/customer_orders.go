package controllers

import (
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// GetMyOrders returns all orders for the current customer
func (oc *OrderController) GetMyOrders(c *gin.Context) {
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	db := config.GetDB()

	// Get customer email for matching orders placed before registration
	var customer models.Customer
	if err := db.First(&customer, customerID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to retrieve customer data",
		})
		return
	}

	var orders []models.Order

	// Match orders by customer_id OR customer_email (for orders placed before registration)
	query := db.Where("customer_id = ? OR customer_email = ?", customerID, customer.Email).
		Preload("Items").
		Preload("Items.Product").
		Preload("Items.Product.Images").
		Order("created_at DESC")

	// Optional status filter
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to retrieve orders",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    orders,
	})
}

// GetMyOrderDetails returns detailed information for a specific customer order
func (oc *OrderController) GetMyOrderDetails(c *gin.Context) {
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	orderID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid order ID",
		})
		return
	}

	db := config.GetDB()

	// Get customer email for matching orders placed before registration
	var customer models.Customer
	if err := db.First(&customer, customerID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to retrieve customer data",
		})
		return
	}

	var order models.Order

	// Find order and verify ownership (by customer_id OR customer_email)
	if err := db.Where("id = ? AND (customer_id = ? OR customer_email = ?)", orderID, customerID, customer.Email).
		Preload("Items").
		Preload("Items.Product").
		Preload("Items.Product.Images").
		Preload("Customer").
		First(&order).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Order not found",
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    order,
	})
}
