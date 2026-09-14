package middleware

import (
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// bearerOrCookieToken extracts the session JWT from the Authorization header
// when present, and otherwise falls back to the HttpOnly session cookie.
// Non-browser clients keep working via the header; browsers no longer need to
// expose the token to JavaScript.
func bearerOrCookieToken(c *gin.Context, cookieName string) string {
	if authHeader := c.GetHeader("Authorization"); authHeader != "" {
		tokenParts := strings.SplitN(authHeader, " ", 2)
		if len(tokenParts) == 2 && strings.EqualFold(tokenParts[0], "Bearer") {
			if token := strings.TrimSpace(tokenParts[1]); token != "" {
				return token
			}
		}
	}
	if cookieName == "" {
		return ""
	}
	if cookie, err := c.Cookie(cookieName); err == nil {
		return strings.TrimSpace(cookie)
	}
	return ""
}

// AuthMiddleware validates JWT token and sets user context
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerOrCookieToken(c, utils.AdminAuthCookieName)
		if token == "" {
			c.JSON(http.StatusUnauthorized, models.APIResponse{
				Success: false,
				Message: "Authorization header required",
				Error:   "missing_auth_header",
			})
			c.Abort()
			return
		}

		claims, err := utils.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, models.APIResponse{
				Success: false,
				Message: "Invalid or expired token",
				Error:   utils.PublicError(err, "invalid_token"),
			})
			c.Abort()
			return
		}

		// Set user information in context
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)

		c.Next()
	}
}

// RequireRole middleware checks if user has required role
func RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userRole, exists := c.Get("role")
		if !exists {
			c.JSON(http.StatusForbidden, models.APIResponse{
				Success: false,
				Message: "User role not found",
				Error:   "missing_role",
			})
			c.Abort()
			return
		}

		roleStr := userRole.(string)
		for _, role := range roles {
			if roleStr == role {
				c.Next()
				return
			}
		}

		c.JSON(http.StatusForbidden, models.APIResponse{
			Success: false,
			Message: "Insufficient permissions",
			Error:   "insufficient_permissions",
		})
		c.Abort()
	}
}

// AdminOnly middleware allows only admin users
func AdminOnly() gin.HandlerFunc {
	return RequireRole("admin")
}

// EditorOrAdmin middleware allows editor and admin users
func EditorOrAdmin() gin.HandlerFunc {
	return RequireRole("admin", "editor")
}

// CustomerAuthMiddleware validates customer JWT token and sets customer context
func CustomerAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerOrCookieToken(c, utils.CustomerAuthCookieName)
		if token == "" {
			c.JSON(http.StatusUnauthorized, models.APIResponse{
				Success: false,
				Message: "Authorization header required",
				Error:   "missing_auth_header",
			})
			c.Abort()
			return
		}

		claims, err := utils.ValidateCustomerToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, models.APIResponse{
				Success: false,
				Message: "Invalid or expired token",
				Error:   utils.PublicError(err, "invalid_token"),
			})
			c.Abort()
			return
		}

		// Set customer information in context
		c.Set("customer_id", claims.CustomerID)
		c.Set("customer_email", claims.Email)

		c.Next()
	}
}
