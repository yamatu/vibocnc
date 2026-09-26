package controllers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
)

// IntegrationTokenController issues and revokes machine credentials.
//
// The plaintext token is returned exactly once, by Create. No other endpoint
// can return it, because only its SHA-256 hash is stored. If an administrator
// loses a token, the correct recovery is to create a new one and revoke the
// old one, not to look the old one up.
type IntegrationTokenController struct{}

const (
	maxIntegrationTokensPerUser = 20
	minIntegrationTokenNameLen  = 2
	maxIntegrationTokenNameLen  = 120
	maxIntegrationTokenExpiry   = 3650 // 10 years, a sanity bound
)

// validIntegrationScopes maps a scope to the role it requires. An empty scope
// means the token simply inherits its role.
var validIntegrationScopes = map[string]string{
	// Legacy scope: aggregated model/price research only.
	"market_ingest": "editor",
	// Browser extension and Python crawler: aggregated market research plus
	// individual listings sent to the eBay draft review queue.
	"ebay_ingest": "editor",
}

// List returns every token for the admin UI. Hashes are never serialised
// because the model marks TokenHash as `json:"-"`.
// GET /api/v1/admin/integration-tokens
func (tc *IntegrationTokenController) List(c *gin.Context) {
	db := config.GetDB()

	var tokens []models.IntegrationToken
	if err := db.Order("created_at DESC").Find(&tokens).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to load API tokens",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	now := time.Now().UTC()
	type row struct {
		models.IntegrationToken
		IsExpired bool `json:"is_expired"`
	}
	rows := make([]row, 0, len(tokens))
	for _, token := range tokens {
		rows = append(rows, row{
			IntegrationToken: token,
			IsExpired:        token.ExpiresAt != nil && now.After(*token.ExpiresAt),
		})
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: rows})
}

// Create issues a new token and returns its plaintext value once.
// POST /api/v1/admin/integration-tokens
func (tc *IntegrationTokenController) Create(c *gin.Context) {
	var req models.IntegrationTokenCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid token request",
			Error:   err.Error(),
		})
		return
	}

	name := strings.TrimSpace(req.Name)
	if len([]rune(name)) < minIntegrationTokenNameLen || len([]rune(name)) > maxIntegrationTokenNameLen {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Token name must be between 2 and 120 characters",
		})
		return
	}

	role := strings.TrimSpace(strings.ToLower(req.Role))
	if role == "" {
		role = "editor"
	}
	if role != "admin" && role != "editor" && role != "viewer" {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Role must be admin, editor or viewer",
		})
		return
	}

	scope := strings.TrimSpace(strings.ToLower(req.Scope))
	if scope != "" {
		requiredRole, known := validIntegrationScopes[scope]
		if !known {
			c.JSON(http.StatusBadRequest, models.APIResponse{
				Success: false,
				Message: "Unknown token scope",
			})
			return
		}
		// A scope must not exceed what its role allows, and the role must be
		// strong enough for the scope. This keeps "market_ingest" from being
		// issued as a viewer token that then fails at the endpoint.
		if !roleAtLeast(role, requiredRole) {
			role = requiredRole
		}
	}

	if req.ExpiresInDays < 0 || req.ExpiresInDays > maxIntegrationTokenExpiry {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Expiry must be between 0 (never) and 3650 days",
		})
		return
	}

	db := config.GetDB()
	creatorID := currentUserID(c)
	creatorName := ""
	if value, exists := c.Get("username"); exists {
		if typed, ok := value.(string); ok {
			creatorName = typed
		}
	}

	// Bound live credentials per issuing administrator so one account cannot
	// flood the table without blocking unrelated administrators.
	var activeCount int64
	if err := db.Model(&models.IntegrationToken{}).
		Where("created_by = ? AND is_active = ? AND revoked_at IS NULL", creatorID, true).
		Count(&activeCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to verify existing tokens",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}
	if activeCount >= maxIntegrationTokensPerUser {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Too many active API tokens; revoke one first",
		})
		return
	}

	plainToken, err := utils.GenerateIntegrationToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to generate token",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	record := models.IntegrationToken{
		Name:          name,
		TokenHash:     utils.HashIntegrationToken(plainToken),
		TokenPrefix:   utils.IntegrationTokenDisplayPrefix(plainToken),
		Role:          role,
		Scope:         scope,
		IsActive:      true,
		CreatedBy:     creatorID,
		CreatedByName: creatorName,
	}
	if req.ExpiresInDays > 0 {
		expiresAt := time.Now().UTC().AddDate(0, 0, req.ExpiresInDays)
		record.ExpiresAt = &expiresAt
	}

	if err := db.Create(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to store token",
			Error:   utils.PublicError(err, "internal_error"),
		})
		return
	}

	c.JSON(http.StatusCreated, models.APIResponse{
		Success: true,
		Message: "API token created. Copy it now — it cannot be shown again.",
		Data: models.IntegrationTokenCreated{
			Token:      record,
			PlainToken: plainToken,
			UsageHint:  "Authorization: Bearer " + plainToken,
		},
	})
}

// Update toggles a token's active state.
// PATCH /api/v1/admin/integration-tokens/:id
func (tc *IntegrationTokenController) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}

	var req models.IntegrationTokenUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Invalid request",
			Error:   err.Error(),
		})
		return
	}
	if req.IsActive == nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Nothing to update",
		})
		return
	}

	db := config.GetDB()
	result := db.Model(&models.IntegrationToken{}).
		Where("id = ?", id).
		Update("is_active", *req.IsActive)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to update token",
			Error:   utils.PublicError(result.Error, "internal_error"),
		})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Token not found"})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Token updated"})
}

// Revoke permanently disables a token. The row is kept for the audit trail.
// POST /api/v1/admin/integration-tokens/:id/revoke
func (tc *IntegrationTokenController) Revoke(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}

	db := config.GetDB()
	now := time.Now().UTC()
	result := db.Model(&models.IntegrationToken{}).
		Where("id = ? AND revoked_at IS NULL", id).
		Updates(map[string]any{"revoked_at": now, "is_active": false})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to revoke token",
			Error:   utils.PublicError(result.Error, "internal_error"),
		})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.APIResponse{
			Success: false,
			Message: "Token not found or already revoked",
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Token revoked"})
}

// Delete removes a revoked token row permanently.
// DELETE /api/v1/admin/integration-tokens/:id
func (tc *IntegrationTokenController) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid ID"})
		return
	}

	db := config.GetDB()
	// Only an already-revoked token may be deleted, so an accidental click
	// cannot destroy a live credential without an explicit revoke first.
	result := db.Where("id = ? AND revoked_at IS NOT NULL", id).
		Delete(&models.IntegrationToken{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{
			Success: false,
			Message: "Failed to delete token",
			Error:   utils.PublicError(result.Error, "internal_error"),
		})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{
			Success: false,
			Message: "Revoke the token before deleting it",
		})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Token deleted"})
}

// roleAtLeast reports whether `role` is at least as privileged as `required`.
func roleAtLeast(role, required string) bool {
	rank := map[string]int{"viewer": 1, "editor": 2, "admin": 3}
	return rank[role] >= rank[required]
}
