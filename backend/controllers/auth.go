package controllers

import (
	"errors"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AuthController struct{}

type adminPasswordResetRequest struct {
	Email string `json:"email" binding:"required,email"`
}

type adminPasswordResetConfirmRequest struct {
	Email           string `json:"email" binding:"required,email"`
	Code            string `json:"code" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=6"`
	ConfirmPassword string `json:"confirm_password" binding:"required,min=6"`
}

// Login handles user authentication
func (ac *AuthController) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	// Find user by username
	var user models.AdminUser
	db := config.GetDB()
	if err := db.Where("username = ? AND is_active = ?", req.Username, true).First(&user).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusUnauthorized, models.APIResponse{
				Success: false,
				Message: "Invalid username or password",
				Error:   "invalid_credentials",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Database error",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Check password
	if !utils.CheckPasswordHash(req.Password, user.PasswordHash) {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "Invalid username or password",
			Error:   "invalid_credentials",
		})
		return
	}

	// Generate JWT token
	token, expiresAt, err := utils.GenerateToken(user.ID, user.Username, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to generate token",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Update last login time
	now := time.Now()
	user.LastLogin = &now
	db.Save(&user)

	// Keep the JWT out of JavaScript's reach: store it in a hardened,
	// HttpOnly cookie. The response body still returns the token for
	// non-browser API clients that use `Authorization: Bearer`.
	utils.SetAuthCookie(c, utils.AdminAuthCookieName, token, time.Until(expiresAt))

	// Return response
	response := models.LoginResponse{
		Token:     token,
		User:      user,
		ExpiresAt: expiresAt,
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Login successful",
		Data:    response,
	})
}

// RefreshToken issues a fresh JWT for an already-authenticated admin session.
// The account is re-checked against the database so a deactivated user or a
// changed role can never extend a session. Multiple people sharing one
// account each hold their own token; refreshing one never invalidates the
// others.
func (ac *AuthController) RefreshToken(c *gin.Context) {
	userID := c.GetUint("user_id")
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, models.APIResponse{Success: false, Message: "Session is invalid", Error: "invalid_session"})
		return
	}
	db := config.GetDB()
	var user models.AdminUser
	if err := db.Where("id = ? AND is_active = ?", userID, true).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, models.APIResponse{Success: false, Message: "Account is disabled or removed", Error: "account_unavailable"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: utils.PublicError(err, "internal_error")})
		return
	}
	token, expiresAt, err := utils.GenerateToken(user.ID, user.Username, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to generate token", Error: utils.PublicError(err, "internal_error")})
		return
	}
	utils.SetAuthCookie(c, utils.AdminAuthCookieName, token, time.Until(expiresAt))
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Token refreshed",
		Data:    models.LoginResponse{Token: token, User: user, ExpiresAt: expiresAt},
	})
}

// Logout clears the admin session cookie.
func (ac *AuthController) Logout(c *gin.Context) {
	utils.ClearAuthCookie(c, utils.AdminAuthCookieName)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Logged out"})
}

// RequestPasswordReset sends an admin password reset code to email.
// Public endpoint. Returns generic success to avoid account enumeration.
func (ac *AuthController) RequestPasswordReset(c *gin.Context) {
	var req adminPasswordResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	setting, err := services.GetOrCreateEmailSetting(db)
	if err != nil || !setting.Enabled || !setting.VerificationEnabled {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Password reset via email is currently disabled", Error: "email_verification_disabled"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Email is required", Error: "email_required"})
		return
	}

	var user models.AdminUser
	err = db.Where("email = ? AND is_active = ?", email, true).First(&user).Error
	if err == nil {
		_ = services.CreateAndSendVerificationCode(db, email, services.PurposeAdminReset)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to process reset request", Error: utils.PublicError(err, "internal_error")})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "If the email exists, a reset code has been sent"})
}

// ConfirmPasswordReset verifies reset code and sets a new admin password.
// Public endpoint.
func (ac *AuthController) ConfirmPasswordReset(c *gin.Context) {
	var req adminPasswordResetConfirmRequest
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
	if err := services.VerifyEmailCode(db, email, services.PurposeAdminReset, strings.TrimSpace(req.Code)); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid or expired verification code", Error: "invalid_code"})
		return
	}

	var user models.AdminUser
	if err := db.Where("email = ? AND is_active = ?", email, true).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Account not found", Error: "account_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database error", Error: utils.PublicError(err, "internal_error")})
		return
	}

	hashedPassword, err := utils.HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to process password", Error: utils.PublicError(err, "internal_error")})
		return
	}

	user.PasswordHash = hashedPassword
	if err := db.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update password", Error: utils.PublicError(err, "internal_error")})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Password reset successful"})
}

// GetProfile returns current user profile
func (ac *AuthController) GetProfile(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.APIResponse{
			Success: false,
			Message: "User not authenticated",
			Error:   "not_authenticated",
		})
		return
	}

	var user models.AdminUser
	db := config.GetDB()
	if err := db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "User not found",
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Message: "Profile retrieved successfully",
		Data:    user,
	})
}

// UpdateProfile handles user profile update
func (ac *AuthController) UpdateProfile(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Email    string `json:"email" binding:"required,email"`
		FullName string `json:"full_name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request data",
			"error":   err.Error(),
		})
		return
	}

	// Get current user from context
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "User not authenticated",
		})
		return
	}

	// Check if username or email already exists (excluding current user)
	var existingUser models.AdminUser
	if err := config.DB.Where("(username = ? OR email = ?) AND id != ?", req.Username, req.Email, userID).First(&existingUser).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "Username or email already exists",
		})
		return
	}

	// Update user profile
	var user models.AdminUser
	if err := config.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "User not found",
		})
		return
	}

	user.Username = req.Username
	user.Email = req.Email
	user.FullName = req.FullName

	if err := config.DB.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to update profile",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Profile updated successfully",
		"data":    user,
	})
}

// ChangePassword handles password change
func (ac *AuthController) ChangePassword(c *gin.Context) {
	var req struct {
		CurrentPassword string `json:"current_password" binding:"required"`
		NewPassword     string `json:"new_password" binding:"required,min=6"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request data",
			Error:   err.Error(),
		})
		return
	}

	userID, _ := c.Get("user_id")

	var user models.AdminUser
	db := config.GetDB()
	if err := db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "User not found",
			Error:   err.Error(),
		})
		return
	}

	// Verify current password
	if !utils.CheckPasswordHash(req.CurrentPassword, user.PasswordHash) {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Current password is incorrect",
			Error:   "invalid_current_password",
		})
		return
	}

	// Hash new password
	hashedPassword, err := utils.HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to hash password",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	// Update password
	user.PasswordHash = hashedPassword
	if err := db.Save(&user).Error; err != nil {
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
