package middleware

import (
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
)

// OptionalCustomerAuth tries to authenticate customer but allows request to continue even if not authenticated
// This is useful for public endpoints that want to associate data with logged-in customers if available
func OptionalCustomerAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerOrCookieToken(c, utils.CustomerAuthCookieName)
		if token == "" {
			// No credentials, continue without setting customer_id
			c.Next()
			return
		}

		claims, err := utils.ValidateCustomerToken(token)
		if err != nil {
			// Invalid token, continue without setting customer_id
			c.Next()
			return
		}

		// Set customer information in context
		c.Set("customer_id", claims.CustomerID)
		c.Set("customer_email", claims.Email)

		c.Next()
	}
}
