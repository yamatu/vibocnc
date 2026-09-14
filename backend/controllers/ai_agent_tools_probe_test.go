package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
)

// probeContext builds a Gin context carrying the probe request body, so the
// handler can be exercised without booting the whole router.
func probeContext(t *testing.T, body string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	req := httptest.NewRequest("POST", "/api/v1/admin/ai-agent/test-tools", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	return c, rec
}

func decodeProbeResponse(t *testing.T, rec *httptest.ResponseRecorder) (int, aiAgentToolsProbeResponse) {
	t.Helper()
	var envelope struct {
		Success bool                      `json:"success"`
		Message string                    `json:"message"`
		Data    aiAgentToolsProbeResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("probe response is not JSON: %v (%s)", err, rec.Body.String())
	}
	return rec.Code, envelope.Data
}

func probeRequestBody(t *testing.T, server *httptest.Server) string {
	t.Helper()
	payload, _ := json.Marshal(map[string]any{
		"base_url": server.URL,
		"api_key":  "sk-test-key",
		"model":    "test-model",
		"api_mode": aiAgentAPIModeStandard,
	})
	return string(payload)
}

// runProbe exercises the probe logic. Production builds the hardened outbound
// client here, but that client refuses loopback addresses on purpose (SSRF
// guard), so tests inject the test server's own client.
func runProbe(t *testing.T, server *httptest.Server) aiAgentToolsProbeResponse {
	t.Helper()
	result := aiAgentToolsProbeResponse{
		AgentToolsEnabled: aiAgentToolsEnabled(),
		Model:             "test-model",
		Provider:          aiAgentProviderOrigin(server.URL),
	}
	return probeAIAgentToolCalling(context.Background(), testAISetting(server.URL), "sk-test-key", server.Client(), dryRunDB(t), result)
}

func TestTestToolCallingReportsToolCallSupport(t *testing.T) {
	ResetAIToolsUnsupportedCache()
	t.Setenv("AI_AGENT_TOOLS", "true")

	server, requests := fakeChatProvider(t, []string{
		toolCallResponse("call_1", aiToolCountProducts, `{"only_active":false}`),
		contentResponse(`{"reply":"done"}`),
	}, http.StatusOK)

	data := runProbe(t, server)
	if !data.OK || !data.ToolsSupported || !data.ToolCallReturned {
		t.Fatalf("provider that answers with a tool call must be reported as capable: %#v", data)
	}
	if len(data.ToolsCalled) != 1 || data.ToolsCalled[0] != aiToolCountProducts {
		t.Fatalf("unexpected tool trace: %#v", data.ToolsCalled)
	}
	if data.Turns != 1 {
		t.Fatalf("expected one recorded tool exchange, got %d", data.Turns)
	}
	if data.Model != "test-model" || data.Provider == "" {
		t.Fatalf("probe must echo the model and provider: %#v", data)
	}
	// The probe must send the real tool schema, not a placeholder.
	if len(*requests) == 0 || !strings.Contains((*requests)[0], `"tools"`) {
		t.Fatalf("probe request must carry tool definitions: %#v", *requests)
	}
	if aiToolsUnsupportedFor(testAISetting(server.URL)) {
		t.Fatal("a capable provider must not be remembered as unsupported")
	}
}

func TestTestToolCallingDetectsUnsupportedProvider(t *testing.T) {
	ResetAIToolsUnsupportedCache()
	t.Setenv("AI_AGENT_TOOLS", "true")

	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"Unrecognized request argument supplied: tools"}}`))
	}))
	t.Cleanup(server.Close)

	data := runProbe(t, server)
	if !data.AgentToolsEnabled {
		t.Fatal("probe must report the AI_AGENT_TOOLS switch")
	}
	if data.OK || data.ToolsSupported {
		t.Fatalf("provider that rejects tools must be reported as unsupported: %#v", data)
	}
	if data.Error == "" || !strings.Contains(strings.ToLower(data.Hint), "falls back") {
		t.Fatalf("probe must explain the automatic fallback: %#v", data)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("probe must cost exactly one provider request, got %d", calls)
	}
	if !aiToolsUnsupportedFor(testAISetting(server.URL)) {
		t.Fatal("a rejected tools field must be remembered so the assistant downgrades")
	}
}

func TestTestToolCallingClearsRememberedDowngrade(t *testing.T) {
	ResetAIToolsUnsupportedCache()
	t.Setenv("AI_AGENT_TOOLS", "true")

	server, _ := fakeChatProvider(t, []string{
		toolCallResponse("call_1", aiToolCountProducts, `{}`),
		contentResponse(`{"reply":"done"}`),
	}, http.StatusOK)

	// Simulate a provider that failed before (for example while the account had
	// tool calling disabled).
	setting := testAISetting(server.URL)
	markAIToolsUnsupported(setting)
	if !aiToolsUnsupportedFor(setting) {
		t.Fatal("test setup failed to remember the downgrade")
	}

	if data := runProbe(t, server); !data.OK {
		t.Fatalf("probe should have succeeded: %#v", data)
	}
	if aiToolsUnsupportedFor(setting) {
		t.Fatal("a successful probe must clear the remembered downgrade")
	}
}

func TestTestToolCallingHonoursKillSwitch(t *testing.T) {
	t.Setenv("AI_AGENT_TOOLS", "false")

	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		_, _ = w.Write([]byte(contentResponse(`{"reply":"x"}`)))
	}))
	t.Cleanup(server.Close)

	// The kill switch must short-circuit the handler *before* any provider call,
	// so this test drives the real handler rather than the probe helper.
	c, rec := probeContext(t, probeRequestBody(t, server))
	controller := &AIAgentController{}
	controller.TestToolCalling(c)

	status, data := decodeProbeResponse(t, rec)
	if status != http.StatusOK || data.AgentToolsEnabled {
		t.Fatalf("kill switch must be reported: %#v", data)
	}
	if data.Hint == "" {
		t.Fatal("kill switch result must explain why no probe was performed")
	}
	if atomic.LoadInt32(&calls) != 0 {
		t.Fatal("no provider request may be sent when tool calling is disabled")
	}
}

func TestTestToolCallingRequiresCredentials(t *testing.T) {
	t.Setenv("AI_AGENT_TOOLS", "true")

	c, rec := probeContext(t, `{"base_url":"https://api.example.com/v1","model":"test-model","api_mode":"standard_chat"}`)
	controller := &AIAgentController{}
	controller.TestToolCalling(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a probe without a key must be rejected, got HTTP %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "API key") {
		t.Fatalf("rejection must mention the missing API key: %s", rec.Body.String())
	}

	c, rec = probeContext(t, `{"base_url":"not a url","api_key":"sk-test","model":"test-model","api_mode":"standard_chat"}`)
	controller.TestToolCalling(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("an invalid base URL must be rejected, got HTTP %d", rec.Code)
	}
}

func TestSavedKeyAllowedForHost(t *testing.T) {
	// The stored key may only be sent to the provider it was saved for.
	cases := []struct {
		name      string
		profile   string
		requested string
		allowed   bool
	}{
		{"same host", "https://api.openai.com/v1", "https://api.openai.com/v1", true},
		{"same host, different path", "https://api.openai.com/v1", "https://api.openai.com/v1/chat/completions", true},
		{"default port omitted", "https://api.openai.com/v1", "https://api.openai.com:443/v1", true},
		{"different host", "https://api.openai.com/v1", "https://attacker.example.com/v1", false},
		{"different path on same host is not another origin", "https://gateway.example.com/openai", "https://gateway.example.com/other", true},
		{"different port", "https://api.openai.com/v1", "https://api.openai.com:8443/v1", false},
		{"http downgrade", "https://api.openai.com/v1", "http://api.openai.com/v1", false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := savedKeyAllowedForHost(test.profile, test.requested); got != test.allowed {
				t.Fatalf("savedKeyAllowedForHost(%q, %q) = %v, want %v", test.profile, test.requested, got, test.allowed)
			}
		})
	}
}

func TestAIAgentProbeFailureHint(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"ssrf guard (fake-IP DNS)", errors.New("could not read AI provider response: outbound hostname resolved to a private address"), "fake-IP"},
		{"ssrf guard (literal address)", errors.New("outbound hostname resolved to a private address"), "fake-IP"},
		{"ssrf guard (private URL)", errors.New("private outbound address is not allowed"), "AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES"},
		{"unresolvable host", errors.New("dial tcp: lookup typo.example: no such host"), "could not be reached"},
		{"connection refused", errors.New("dial tcp 1.2.3.4:443: connect: connection refused"), "could not be reached"},
		{"timeout", errors.New("context deadline exceeded"), "could not be reached"},
		{"authorization", errors.New("AI provider returned status 401: invalid api key"), "Check the API key"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got := aiAgentProbeFailureHint(test.err)
			if !strings.Contains(got, test.want) {
				t.Fatalf("hint %q does not contain %q", got, test.want)
			}
		})
	}
	if aiAgentProbeFailureHint(nil) != "" {
		t.Fatal("a nil error must not produce a hint")
	}
}
