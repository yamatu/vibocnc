package controllers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// aiAgentToolsProbeMaxTokens keeps the probe cheap: it only needs the model to
// emit a tool call, not to answer.
const aiAgentToolsProbeMaxTokens = 256

type aiAgentToolsProbeResponse struct {
	// OK is true only when the provider accepted the tools field *and* the model
	// actually called a tool.
	OK bool `json:"ok"`
	// AgentToolsEnabled mirrors AI_AGENT_TOOLS: when false the chat assistant
	// never sends tools, so a provider capability result is moot.
	AgentToolsEnabled bool `json:"agent_tools_enabled"`
	// ToolsSupported is true when the provider accepted the request that carried
	// the tools field (regardless of whether the model chose to call one).
	ToolsSupported bool `json:"tools_supported"`
	// ToolCallReturned is true when the model answered with a tool call.
	ToolCallReturned bool     `json:"tool_call_returned"`
	ToolsCalled      []string `json:"tools_called,omitempty"`
	// Turns counts the assistant<->tool exchanges observed during the probe.
	Turns     int    `json:"turns"`
	LatencyMS int64  `json:"latency_ms"`
	Model     string `json:"model"`
	Provider  string `json:"provider"`
	// Reply is the plain-text answer, only populated when the model ignored the
	// tool call instruction (useful when tuning a weak model).
	Reply string `json:"reply,omitempty"`
	Hint  string `json:"hint,omitempty"`
	Error string `json:"error,omitempty"`
}

// TestToolCalling probes whether the configured provider supports tool calling.
//
// It exists because the chat assistant sends a read-only tool schema by default
// (AI_AGENT_TOOLS=true) and otherwise only discovers an incompatible provider
// when a real request fails. This endpoint makes that check explicit, so a
// provider can be validated before it is switched on in production. It performs
// at most one provider request.
func (ac *AIAgentController) TestToolCalling(c *gin.Context) {
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

	result := aiAgentToolsProbeResponse{
		AgentToolsEnabled: aiAgentToolsEnabled(),
		Model:             setting.Model,
		Provider:          aiAgentProviderOrigin(setting.BaseURL),
	}
	if !result.AgentToolsEnabled {
		result.Hint = "AI_AGENT_TOOLS is off for this deployment, so the assistant never sends tools and uses the single-shot request instead."
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Tool calling is disabled by configuration", Data: result})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(setting.TimeoutSeconds)*time.Second)
	defer cancel()

	client := services.NewAIProviderHTTPClient(time.Duration(setting.TimeoutSeconds) * time.Second)
	result = probeAIAgentToolCalling(ctx, setting, apiKey, client, config.GetDB(), result)

	message := "AI tool-calling probe finished"
	if result.OK {
		message = "AI provider supports tool calls"
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: message, Data: result})
}

// probeAIAgentToolCalling runs the probe against a provider using the supplied
// client. It never returns an HTTP status: a provider that cannot call tools is a
// normal, expected outcome that production code handles by falling back.
func probeAIAgentToolCalling(ctx context.Context, setting *models.AIAgentSetting, apiKey string, client *http.Client, db *gorm.DB, result aiAgentToolsProbeResponse) aiAgentToolsProbeResponse {
	messages := []aiChatMessage{
		{Role: "system", Content: "You are a tool-calling capability probe. Call exactly one tool and do not answer in text."},
		{Role: "user", Content: `Call the ` + aiToolCountProducts + ` tool with {"only_active":false} now.`},
	}

	started := time.Now()
	content, trace, runErr := runAIAgentConversation(ctx, setting, apiKey, messages, aiAgentToolsProbeMaxTokens, client, db)
	result.LatencyMS = time.Since(started).Milliseconds()
	result.Turns = len(trace)

	switch {
	case errors.Is(runErr, errAIAgentToolsUnsupported):
		// The provider rejected the tools field. Production behaviour is a silent
		// downgrade, so report it as an informational result rather than an error.
		result.Error = "the provider rejected the tools field"
		result.Hint = "The assistant detects this automatically and falls back to the single-shot request, so nothing has to be changed; set AI_AGENT_TOOLS=false to skip the failed first attempt."
	case runErr != nil:
		result.Error = truncateRunes(runErr.Error(), 500)
		result.Hint = aiAgentProbeFailureHint(runErr)
	default:
		result.ToolsSupported = true
		// A successful probe clears any remembered downgrade, so switching to a
		// tool-capable provider takes effect immediately instead of after a restart.
		ResetAIToolsUnsupportedCache()
		if len(trace) > 0 {
			result.ToolsCalled = make([]string, 0, len(trace))
			for _, entry := range trace {
				result.ToolsCalled = append(result.ToolsCalled, entry.Tool)
			}
			result.ToolCallReturned = true
			result.OK = true
		} else {
			result.Hint = "The provider accepted the tools field but the model answered in text; the assistant still works, its answers may rely on the catalogue snapshot instead of live lookups."
			result.Reply = truncateRunes(content, 200)
		}
	}
	return result
}

// aiAgentProbeFailureHint turns a provider error into an actionable next step.
// The SSRF guard is the one failure that looks like a configuration mistake but
// is in fact a deliberate policy, so it gets its own explanation.
func aiAgentProbeFailureHint(err error) string {
	if err == nil {
		return ""
	}
	lowered := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lowered, "resolved to a private address"),
		strings.Contains(lowered, "resolves to a private address"):
		return "The provider hostname resolved to a private or reserved address. That is usually a local proxy or fake-IP DNS answer (198.18.0.0/15 and similar), which the outbound guard refuses. Verify DNS from inside the container, or set AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES=true when the endpoint really is internal."
	case strings.Contains(lowered, "private"):
		return "Outbound requests may only reach public addresses, so a LAN or localhost model server (for example Ollama) is refused by the SSRF guard. Use a hosted provider, expose the server through a public HTTPS domain, or set AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES=true."
	case strings.Contains(lowered, "no such host"),
		strings.Contains(lowered, "connection refused"),
		strings.Contains(lowered, "timeout"),
		strings.Contains(lowered, "deadline exceeded"),
		strings.Contains(lowered, "tls"):
		return "The provider could not be reached. Check the base URL, outbound network access and any firewall or proxy in front of the server."
	default:
		return "The provider request failed before the tools capability could be determined. Check the API key, base URL and model."
	}
}
