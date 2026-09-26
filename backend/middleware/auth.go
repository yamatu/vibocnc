package middleware

import (
	"errors"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"gorm.io/gorm"
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

		// Machine credentials (the crawler) are validated against the
		// integration token table; everything else is a session JWT. The two
		// are told apart by the token prefix, so a malformed JWT can never be
		// silently accepted as an API token or vice versa.
		if utils.IsIntegrationToken(token) {
			principal, err := authenticateIntegrationToken(c, token)
			if err != nil {
				c.JSON(http.StatusUnauthorized, models.APIResponse{
					Success: false,
					Message: "Invalid or revoked API token",
					Error:   err.Error(),
				})
				c.Abort()
				return
			}
			c.Set("user_id", principal.UserID)
			c.Set("username", principal.Username)
			c.Set("role", principal.Role)
			c.Set("auth_method", "integration_token")
			c.Set("token_id", principal.TokenID)
			c.Set("token_scope", principal.Scope)

			// A scoped token is an allow-list credential, not merely a label.
			// Reject it here before any controller runs; otherwise an editor token
			// called "market_ingest" could still reach every editor endpoint.
			if principal.Scope != "" && !integrationTokenScopeAllows(principal.Scope, c.Request.Method, c.FullPath()) {
				c.JSON(http.StatusForbidden, models.APIResponse{
					Success: false,
					Message: "API token is not allowed to call this endpoint",
					Error:   "token_scope_forbidden",
				})
				c.Abort()
				return
			}

			c.Next()
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
		c.Set("auth_method", "session")

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

// integrationPrincipal is the identity established by an API token.
type integrationPrincipal struct {
	UserID   uint
	Username string
	Role     string
	TokenID  uint
	Scope    string
	Name     string
}

// authenticateIntegrationToken resolves a machine token to an identity.
//
// The lookup is by hash, so the plaintext token is never compared or stored.
// A revoked, disabled or expired token fails here. Usage statistics are updated
// at most once per minute so a high-frequency crawler does not turn every push
// into a write.
func authenticateIntegrationToken(c *gin.Context, token string) (integrationPrincipal, error) {
	if err := utils.ValidateIntegrationTokenShape(token); err != nil {
		return integrationPrincipal{}, err
	}

	db := config.GetDB()
	if db == nil {
		return integrationPrincipal{}, errors.New("database unavailable")
	}

	var record models.IntegrationToken
	if err := db.Where("token_hash = ?", utils.HashIntegrationToken(token)).
		First(&record).Error; err != nil {
		return integrationPrincipal{}, errors.New("token not recognised")
	}

	now := time.Now().UTC()
	if !record.IsUsable(now) {
		return integrationPrincipal{}, errors.New("token is revoked or expired")
	}

	recordIntegrationTokenUse(db, &record, c.ClientIP(), now)

	// The token acts as its creator, so an audit trail entry written by the
	// crawler still points at a real administrator account.
	username := record.CreatedByName
	if username == "" {
		username = "api-token"
	}
	return integrationPrincipal{
		UserID:   record.CreatedBy,
		Username: username,
		Role:     record.Role,
		TokenID:  record.ID,
		Scope:    record.Scope,
		Name:     record.Name,
	}, nil
}

// recordIntegrationTokenUse refreshes last-used metadata, throttled to one write
// per minute per token.
func recordIntegrationTokenUse(db *gorm.DB, record *models.IntegrationToken, ip string, now time.Time) {
	if record.LastUsedAt != nil && now.Sub(*record.LastUsedAt) < time.Minute {
		return
	}
	updates := map[string]any{
		"last_used_at": now,
		"last_used_ip": ip,
	}
	// RequestCount is incremented in SQL so concurrent pushes do not lose counts.
	if err := db.Model(&models.IntegrationToken{}).
		Where("id = ?", record.ID).
		Updates(updates).Error; err != nil {
		return
	}
	_ = db.Model(&models.IntegrationToken{}).
		Where("id = ?", record.ID).
		UpdateColumn("request_count", gorm.Expr("request_count + 1")).Error
}

// integrationTokenScopeAllows is the central machine-token allow list.
// Session users never pass through it. Keep paths exact: adding a new admin
// endpoint must not silently broaden an existing token's authority.
func integrationTokenScopeAllows(scope, method, path string) bool {
	key := strings.ToUpper(strings.TrimSpace(method)) + " " + strings.TrimSpace(path)
	marketRoutes := map[string]struct{}{
		"POST /api/v1/admin/ebay-market/ingest": {},
		// Read-only health check used by the extension and scheduled crawler.
		"GET /api/v1/admin/ebay-market/summary": {},
	}

	switch strings.ToLower(strings.TrimSpace(scope)) {
	case "market_ingest":
		_, allowed := marketRoutes[key]
		return allowed
	case "ebay_ingest":
		if _, allowed := marketRoutes[key]; allowed {
			return true
		}
		// Individual browser listings enter the review queue; this never
		// confirms or publishes a product.
		return key == "POST /api/v1/admin/ebay-import-drafts/upload"
	default:
		// Unknown non-empty scopes fail closed.
		return false
	}
}
