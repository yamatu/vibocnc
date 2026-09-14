package controllers

import (
	"errors"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type CustomerController struct{}

type passwordResetRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// RequestPasswordReset sends a reset code to the email (public)
func (cc *CustomerController) RequestPasswordReset(c *gin.Context) {
	var req passwordResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Email is required", Error: "email_required"})
		return
	}

	db := config.GetDB()
	setting, err := services.GetOrCreateEmailSetting(db)
	if err != nil || !setting.Enabled || !setting.VerificationEnabled {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Password reset via email is currently disabled", Error: "email_verification_disabled"})
		return
	}

	// Do not leak existence; only send if the user exists.
	var customer models.Customer
	if err := db.Where("email = ? AND is_active = ?", email, true).First(&customer).Error; err == nil {
		_ = services.CreateAndSendVerificationCode(db, email, services.PurposeReset)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to process reset request", Error: utils.PublicError(err, "internal_error")})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "If the email exists, a reset code has been sent"})
}

type passwordResetConfirmRequest struct {
	Email           string `json:"email" binding:"required,email"`
	Code            string `json:"code" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=6"`
	ConfirmPassword string `json:"confirm_password" binding:"required,min=6"`
}

// ConfirmPasswordReset verifies code and updates password (public)
func (cc *CustomerController) ConfirmPasswordReset(c *gin.Context) {
	var req passwordResetConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	if req.NewPassword != req.ConfirmPassword {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Passwords do not match", Error: "password_mismatch"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Email is required", Error: "email_required"})
		return
	}

	db := config.GetDB()
	if err := services.VerifyEmailCode(db, email, services.PurposeReset, strings.TrimSpace(req.Code)); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid or expired verification code", Error: "invalid_code"})
		return
	}

	var customer models.Customer
	if err := db.Where("email = ? AND is_active = ?", email, true).First(&customer).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Account not found"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to process password", Error: utils.PublicError(err, "internal_error")})
		return
	}

	customer.Password = string(hashedPassword)
	if customer.IsVerified == false {
		customer.IsVerified = true
	}
	if err := db.Save(&customer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update password", Error: utils.PublicError(err, "internal_error")})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Password updated"})
}

// Register creates a new customer account
func (cc *CustomerController) Register(c *gin.Context) {
	var req models.CustomerRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Email verification (optional, controlled by admin settings)
	if setting, err := services.GetOrCreateEmailSetting(db); err == nil {
		if setting.Enabled && setting.VerificationEnabled {
			if strings.TrimSpace(req.EmailCode) == "" {
				c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Email verification code is required", Error: "email_code_required"})
				return
			}
			if err := services.VerifyEmailCode(db, req.Email, services.PurposeRegister, strings.TrimSpace(req.EmailCode)); err != nil {
				c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid or expired verification code", Error: "invalid_email_code"})
				return
			}
		}
	}

	// Check if email already exists
	var existingCustomer models.Customer
	if err := db.Where("email = ?", req.Email).First(&existingCustomer).Error; err == nil {
		c.JSON(http.StatusConflict, models.APIResponse{
			Success: false,
			Message: "Email already registered",
			Error:   "email_exists",
		})
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to process password",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Create customer
	customer := models.Customer{
		Email:    req.Email,
		Password: string(hashedPassword),
		FullName: req.FullName,
		Phone:    req.Phone,
		Company:  req.Company,
		IsActive: true,
		// If verification is enabled, code above was validated.
		IsVerified: true,
	}

	if err := db.Create(&customer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to create account",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Generate JWT token
	token, err := utils.GenerateCustomerJWT(customer.ID, customer.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Account created but failed to generate token",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	utils.SetAuthCookie(c, utils.CustomerAuthCookieName, token, utils.CustomerJWTTTL())

	c.JSON(http.StatusCreated, models.APIResponse{
		Success: true,
		Message: "Account created successfully",
		Data: models.CustomerLoginResponse{
			Token:    token,
			Customer: customer,
		},
	})
}

// Login authenticates a customer
func (cc *CustomerController) Login(c *gin.Context) {
	var req models.CustomerLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()

	// Find customer by email
	var customer models.Customer
	if err := db.Where("email = ?", req.Email).First(&customer).Error; err != nil {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Invalid email or password",
			Error:   "invalid_credentials",
		})
		return
	}

	// Check if account is active
	if !customer.IsActive {
		c.JSON(http.StatusForbidden, models.APIResponse{
			Success: false,
			Message: "Account is inactive",
			Error:   "account_inactive",
		})
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(customer.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Invalid email or password",
			Error:   "invalid_credentials",
		})
		return
	}

	// Update last login time
	now := time.Now()
	customer.LastLoginAt = &now
	db.Save(&customer)

	// Generate JWT token
	token, err := utils.GenerateCustomerJWT(customer.ID, customer.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Login successful but failed to generate token",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	utils.SetAuthCookie(c, utils.CustomerAuthCookieName, token, utils.CustomerJWTTTL())

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Login successful",
		Data: models.CustomerLoginResponse{
			Token:    token,
			Customer: customer,
		},
	})
}

// Logout clears the customer session cookie. Public: clearing an absent or
// already-expired cookie is a no-op.
func (cc *CustomerController) Logout(c *gin.Context) {
	utils.ClearAuthCookie(c, utils.CustomerAuthCookieName)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Logged out"})
}

// GetProfile returns the current customer's profile
func (cc *CustomerController) GetProfile(c *gin.Context) {
	// Get customer ID from context (set by auth middleware)
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
			Error:   "no_customer_id",
		})
		return
	}

	db := config.GetDB()
	var customer models.Customer
	if err := db.First(&customer, customerID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Customer not found",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    customer,
	})
}

// UpdateProfile updates the current customer's profile
func (cc *CustomerController) UpdateProfile(c *gin.Context) {
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	var req models.CustomerProfileUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	var customer models.Customer
	if err := db.First(&customer, customerID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Customer not found",
		})
		return
	}

	// Update fields
	customer.FullName = req.FullName
	customer.Phone = req.Phone
	customer.Company = req.Company
	customer.Address = req.Address
	customer.City = req.City
	customer.State = req.State
	customer.Country = req.Country
	customer.PostalCode = req.PostalCode

	if err := db.Save(&customer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update profile",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Profile updated successfully",
		Data:    customer,
	})
}

// ChangePassword changes the customer's password
func (cc *CustomerController) ChangePassword(c *gin.Context) {
	customerID, exists := c.Get("customer_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	var req models.CustomerPasswordChangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	var customer models.Customer
	if err := db.First(&customer, customerID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Customer not found",
		})
		return
	}

	// Verify old password
	if err := bcrypt.CompareHashAndPassword([]byte(customer.Password), []byte(req.OldPassword)); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Current password is incorrect",
			Error:   "invalid_old_password",
		})
		return
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to process new password",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	customer.Password = string(hashedPassword)
	if err := db.Save(&customer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update password",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Password changed successfully",
	})
}

// GetAllCustomers returns all customers (admin only)
func (cc *CustomerController) GetAllCustomers(c *gin.Context) {
	db := config.GetDB()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	search := c.Query("search")
	status := c.Query("status")

	offset := (page - 1) * pageSize

	query := db.Model(&models.Customer{})

	// Search filter
	if search != "" {
		query = query.Where("email LIKE ? OR full_name LIKE ? OR phone LIKE ?",
			"%"+search+"%", "%"+search+"%", "%"+search+"%")
	}

	// Status filter
	if status == "active" {
		query = query.Where("is_active = ?", true)
	} else if status == "inactive" {
		query = query.Where("is_active = ?", false)
	}

	var total int64
	query.Count(&total)

	var customers []models.Customer
	if err := query.Offset(offset).Limit(pageSize).
		Order("created_at DESC").Find(&customers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to fetch customers",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Hide passwords
	for i := range customers {
		customers[i].Password = ""
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data: gin.H{
			"data":        customers,
			"page":        page,
			"page_size":   pageSize,
			"total":       total,
			"total_pages": (total + int64(pageSize) - 1) / int64(pageSize),
		},
	})
}

// GetCustomerByID returns a specific customer (admin only)
func (cc *CustomerController) GetCustomerByID(c *gin.Context) {
	customerID := c.Param("id")

	db := config.GetDB()
	var customer models.Customer
	if err := db.First(&customer, customerID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Customer not found",
		})
		return
	}

	// Hide password
	customer.Password = ""

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    customer,
	})
}

// UpdateCustomerStatus updates a customer's active status (admin only)
func (cc *CustomerController) UpdateCustomerStatus(c *gin.Context) {
	customerID := c.Param("id")

	var req struct {
		IsActive bool `json:"is_active"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	db := config.GetDB()
	var customer models.Customer
	if err := db.First(&customer, customerID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Customer not found",
		})
		return
	}

	customer.IsActive = req.IsActive
	if err := db.Save(&customer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update customer status",
		})
		return
	}

	customer.Password = ""

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Customer status updated successfully",
		Data:    customer,
	})
}

// DeleteCustomer deletes a customer (admin only)
func (cc *CustomerController) DeleteCustomer(c *gin.Context) {
	customerID := c.Param("id")

	db := config.GetDB()
	var customer models.Customer
	if err := db.First(&customer, customerID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Customer not found",
		})
		return
	}

	if err := db.Delete(&customer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete customer",
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Customer deleted successfully",
	})
}
