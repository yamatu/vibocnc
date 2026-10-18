package controllers

import (
	"errors"
	"net/http"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
)

// isSecretEncryptionKeyError reports whether the failure is the backend's own
// encryption key rather than the value the administrator just typed. The two
// cases need different answers: one is fixed in the environment, the other in
// the form.
func isSecretEncryptionKeyError(err error) bool {
	return errors.Is(err, utils.ErrEncryptionKeyMissing) || errors.Is(err, utils.ErrEncryptionKeyInvalid)
}

// respondSecretEncryptionFailure answers a secret-encryption failure caused by a
// missing or malformed SETTINGS_ENCRYPTION_KEY. It returns false when the error
// has another cause so the caller can keep its own message.
func respondSecretEncryptionFailure(c *gin.Context, what string, err error) bool {
	if !isSecretEncryptionKeyError(err) {
		return false
	}
	c.JSON(http.StatusInternalServerError, models.APIResponse{
		Success: false,
		Message: "无法加密保存" + what + "：后端 SETTINGS_ENCRYPTION_KEY 未配置或无效。" + utils.EncryptionKeyHint +
			" / Cannot encrypt " + what + ": the backend SETTINGS_ENCRYPTION_KEY is missing or invalid. " + utils.EncryptionKeyHint,
		Error: err.Error(),
	})
	return true
}
