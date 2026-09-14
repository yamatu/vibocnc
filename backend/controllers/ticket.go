package controllers

import (
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TicketController struct{}

// CreateTicket creates a new support ticket (customer only)
func (tc *TicketController) CreateTicket(c *gin.Context) {
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	var req models.TicketCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Generate unique ticket number
	ticketNumber := fmt.Sprintf("TKT-%d-%d", time.Now().Unix(), customerID)

	// Set defaults
	if req.Category == "" {
		req.Category = "general"
	}
	if req.Priority == "" {
		req.Priority = "normal"
	}

	ticket := models.Ticket{
		TicketNumber: ticketNumber,
		CustomerID:   customerID.(uint),
		Subject:      req.Subject,
		Message:      req.Message,
		Category:     req.Category,
		Priority:     req.Priority,
		Status:       "open",
		OrderNumber:  req.OrderNumber,
	}

	if err := db.Create(&ticket).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to create ticket",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Load customer relation
	db.Preload("Customer").First(&ticket, ticket.ID)

	c.JSON(http.StatusCreated, models.APIResponse{
		Success: true,
		Message: "Ticket created successfully",
		Data:    ticket,
	})
}

// GetMyTickets returns all tickets for the current customer
func (tc *TicketController) GetMyTickets(c *gin.Context) {
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	db := config.GetDB()
	var tickets []models.Ticket

	query := db.Where("customer_id = ?", customerID).
		Preload("Customer").
		Preload("Replies").
		Order("created_at DESC")

	// Optional filters
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Find(&tickets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to retrieve tickets",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    tickets,
	})
}

// GetTicketDetails returns a single ticket with all replies
func (tc *TicketController) GetTicketDetails(c *gin.Context) {
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	ticketID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid ticket ID",
		})
		return
	}

	db := config.GetDB()
	var ticket models.Ticket

	// Find ticket and verify ownership
	if err := db.Where("id = ? AND customer_id = ?", ticketID, customerID).
		Preload("Customer").
		Preload("Replies", func(db *gorm.DB) *gorm.DB {
			return db.Where("is_internal = ?", false).Order("created_at ASC")
		}).
		Preload("Replies.Customer").
		Preload("Replies.AdminUser").
		Preload("AssignedTo").
		First(&ticket).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Ticket not found",
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    ticket,
	})
}

// ReplyToTicket adds a reply to a ticket
func (tc *TicketController) ReplyToTicket(c *gin.Context) {
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	ticketID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid ticket ID",
		})
		return
	}

	var req models.TicketReplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Verify ticket ownership
	var ticket models.Ticket
	if err := db.Where("id = ? AND customer_id = ?", ticketID, customerID).First(&ticket).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Ticket not found",
		})
		return
	}

	// Check if ticket is closed
	if ticket.Status == "closed" {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Cannot reply to a closed ticket",
		})
		return
	}

	// Create reply
	custID := customerID.(uint)
	reply := models.TicketReply{
		TicketID:   uint(ticketID),
		CustomerID: &custID,
		Message:    req.Message,
		IsStaff:    false, // Customer reply
		IsInternal: false, // Customer replies are never internal
	}

	if err := db.Create(&reply).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to create reply",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Update ticket status to waiting for response if it was resolved
	if ticket.Status == "resolved" {
		ticket.Status = "open"
		db.Save(&ticket)
	}

	// Load relations
	db.Preload("Customer").First(&reply, reply.ID)

	c.JSON(http.StatusCreated, models.APIResponse{
		Success: true,
		Message: "Reply added successfully",
		Data:    reply,
	})
}

// Admin functions (simplified - you can expand these)

// GetAllTickets returns all tickets (admin only)
func (tc *TicketController) GetAllTickets(c *gin.Context) {
	db := config.GetDB()
	var tickets []models.Ticket

	query := db.Preload("Customer").Preload("AssignedTo")

	// Filters
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if priority := c.Query("priority"); priority != "" {
		query = query.Where("priority = ?", priority)
	}

	if err := query.Order("created_at DESC").Find(&tickets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to retrieve tickets",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    tickets,
	})
}

// UpdateTicketStatus updates ticket status/priority (admin only)
func (tc *TicketController) UpdateTicketStatus(c *gin.Context) {
	ticketID := c.Param("id")

	var req models.TicketUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	var ticket models.Ticket

	if err := db.First(&ticket, ticketID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Ticket not found",
		})
		return
	}

	// Update fields
	if req.Status != "" {
		ticket.Status = req.Status
		if req.Status == "resolved" {
			now := time.Now()
			ticket.ResolvedAt = &now
		}
		if req.Status == "closed" {
			now := time.Now()
			ticket.ClosedAt = &now
		}
	}
	if req.Priority != "" {
		ticket.Priority = req.Priority
	}
	if req.AssignedToID != nil {
		ticket.AssignedToID = req.AssignedToID
	}

	if err := db.Save(&ticket).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update ticket",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Ticket updated successfully",
		Data:    ticket,
	})
}

// AdminReplyToTicket adds an admin reply to a ticket
func (tc *TicketController) AdminReplyToTicket(c *gin.Context) {
	// Get admin user ID from context
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	ticketID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid ticket ID",
		})
		return
	}

	var req models.TicketReplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Verify ticket exists
	var ticket models.Ticket
	if err := db.First(&ticket, ticketID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Ticket not found",
		})
		return
	}

	// Create admin reply
	adminID := userID.(uint)
	reply := models.TicketReply{
		TicketID:    uint(ticketID),
		AdminUserID: &adminID,
		Message:     req.Message,
		IsStaff:     true, // Admin reply
		IsInternal:  req.IsInternal,
	}

	if err := db.Create(&reply).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to create reply",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Update ticket status to in-progress if it was open
	if ticket.Status == "open" {
		ticket.Status = "in-progress"
		db.Save(&ticket)
	}

	c.JSON(http.StatusCreated, models.APIResponse{
		Success: true,
		Message: "Reply added successfully",
		Data:    reply,
	})
}

// GetAdminTicketDetails returns a specific ticket (admin only)
func (tc *TicketController) GetAdminTicketDetails(c *gin.Context) {
	ticketID := c.Param("id")

	db := config.GetDB()
	var ticket models.Ticket

	if err := db.Preload("Customer").
		Preload("Replies").
		Preload("Replies.Customer").
		Preload("Replies.AdminUser").
		Preload("AssignedTo").
		First(&ticket, ticketID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Ticket not found",
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    ticket,
	})
}
