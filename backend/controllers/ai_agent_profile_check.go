package controllers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"

	"github.com/gin-gonic/gin"
)

const aiAgentTestMaxTimeoutSeconds = 60

type aiAgentProfileTestRequest struct {
	ProfileID       uint   `json:"profile_id"`
	BaseURL         string `json:"base_url"`
	APIKey          string `json:"api_key"`
	Model           string `json:"model"`
	APIMode         string `json:"api_mode"`
	ReasoningEffort string `json:"reasoning_effort"`
	TimeoutSeconds  int    `json:"timeout_seconds"`
}

type aiAgentProfileTestResponse struct {
	OK        bool   `json:"ok"`
	LatencyMS int64  `json:"latency_ms"`
	Model     string `json:"model"`
	Provider  string `json:"provider"`
	Reply     string `json:"reply,omitempty"`
	Error     string `json:"error,omitempty"`
}

// aiAgentTestFailure carries the HTTP status and the (already sanitised)
// message for a rejected test/probe request.
type aiAgentTestFailure struct {
	Status  int
	Message string
	Detail  string
}

func (e *aiAgentTestFailure) Error() string { return e.Message }

// savedKeyAllowedForHost reports whether a stored API key may be sent to the
// requested provider. It compares origins, so a tampered base URL cannot
// exfiltrate the credential to another server.
func savedKeyAllowedForHost(profileBaseURL, requestedBaseURL string) bool {
	return aiAgentProviderOrigin(profileBaseURL) == aiAgentProviderOrigin(requestedBaseURL)
}

// resolveAIAgentTestCredentials validates an admin test request and returns a
// throwaway provider setting plus the API key to use. A saved key is only reused
// against its own provider host, so a tampered base URL cannot exfiltrate the
// credential to another server. The stored secret never reaches the browser.
func resolveAIAgentTestCredentials(req aiAgentProfileTestRequest) (*models.AIAgentSetting, string, error) {
	baseURL, err := normalizeAIAgentBaseURL(req.BaseURL)
	if err != nil {
		return nil, "", &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "Invalid AI test request", Detail: err.Error()}
	}
	model, err := normalizeAIAgentModel(req.Model)
	if err != nil {
		return nil, "", &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "Invalid AI test request", Detail: err.Error()}
	}
	apiMode, err := normalizeAIAgentAPIMode(req.APIMode)
	if err != nil {
		return nil, "", &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "Invalid AI test request", Detail: err.Error()}
	}
	effort, err := normalizeAIAgentReasoningEffort(req.ReasoningEffort)
	if err != nil {
		return nil, "", &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "Invalid AI test request", Detail: err.Error()}
	}
	apiKey, err := normalizeAIAgentAPIKey(req.APIKey)
	if err != nil {
		return nil, "", &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "Invalid AI test request", Detail: err.Error()}
	}

	if apiKey == "" && req.ProfileID > 0 {
		var profile models.AIAgentProfile
		if dbErr := config.GetDB().First(&profile, req.ProfileID).Error; dbErr != nil {
			return nil, "", &aiAgentTestFailure{Status: http.StatusNotFound, Message: "AI profile not found"}
		}
		if strings.TrimSpace(profile.APIKeyEnc) == "" {
			return nil, "", &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "This profile has no saved API key; enter one to test"}
		}
		// A saved key may only be exercised against its own provider host.
		if !savedKeyAllowedForHost(profile.BaseURL, baseURL) {
			return nil, "", &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "Save the profile first: the saved key can only be tested against its own provider host"}
		}
		decrypted, decErr := utils.DecryptSecret(profile.APIKeyEnc)
		if decErr != nil {
			return nil, "", &aiAgentTestFailure{Status: http.StatusInternalServerError, Message: "Could not decrypt the saved API key", Detail: decErr.Error()}
		}
		apiKey = decrypted
	}
	if apiKey == "" {
		return nil, "", &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "Provide an API key or reference a profile with a saved key"}
	}

	timeout := req.TimeoutSeconds
	if timeout < 15 {
		timeout = 15
	}
	if timeout > aiAgentTestMaxTimeoutSeconds {
		timeout = aiAgentTestMaxTimeoutSeconds
	}
	setting := &models.AIAgentSetting{
		BaseURL:         baseURL,
		Model:           model,
		APIMode:         apiMode,
		ReasoningEffort: effort,
		TimeoutSeconds:  timeout,
	}
	return setting, apiKey, nil
}

// TestProfileConnection performs one tiny chat completion against the supplied
// provider settings so administrators can validate a profile before saving or
// activating it. A blank API key falls back to the key already stored on the
// referenced profile; the stored secret itself never reaches the browser.
func (ac *AIAgentController) TestProfileConnection(c *gin.Context) {
	var req aiAgentProfileTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid AI test request", Error: err.Error()})
		return
	}

	setting, apiKey, err := resolveAIAgentTestCredentials(req)
	if err != nil {
		failure := &aiAgentTestFailure{Status: http.StatusBadRequest, Message: "Invalid AI test request"}
		if errors.As(err, &failure) {
			c.JSON(failure.Status, models.APIResponse{Success: false, Message: failure.Message, Error: failure.Detail})
			return
		}
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid AI test request", Error: err.Error()})
		return
	}
	baseURL, model := setting.BaseURL, setting.Model

	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(setting.TimeoutSeconds)*time.Second)
	defer cancel()
	messages := []aiChatMessage{
		{Role: "system", Content: "You are a connectivity check. Reply with the single word OK."},
		{Role: "user", Content: "ping"},
	}
	started := time.Now()
	reply, err := requestAIAgentCompletion(ctx, setting, apiKey, messages, 512)
	latency := time.Since(started).Milliseconds()

	result := aiAgentProfileTestResponse{
		LatencyMS: latency,
		Model:     model,
		Provider:  aiAgentProviderOrigin(baseURL),
	}
	if err != nil {
		result.Error = truncateRunes(err.Error(), 500)
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "AI connection test failed", Data: result})
		return
	}
	result.OK = true
	result.Reply = truncateRunes(strings.TrimSpace(reply), 200)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "AI connection test succeeded", Data: result})
}
