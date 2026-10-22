package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"fanuc-backend/models"
)

func anthropicTestSetting(baseURL, effort string) *models.AIAgentSetting {
	return &models.AIAgentSetting{BaseURL: baseURL, Model: "claude-opus-4-7", APIMode: aiAgentAPIModeAnthropic, ReasoningEffort: effort, TimeoutSeconds: 5}
}

func marshalAnthropicParams(t *testing.T, setting *models.AIAgentSetting, request openAIChatRequest) map[string]any {
	t.Helper()
	raw, err := json.Marshal(buildAnthropicMessageParams(setting, request))
	if err != nil {
		t.Fatalf("marshal params: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal params: %v", err)
	}
	return body
}

func TestBuildAnthropicMessageParamsTranslatesOpenAIShape(t *testing.T) {
	maxTokens := 900
	temperature := 0.2
	request := openAIChatRequest{
		Model:       "ignored",
		Temperature: &temperature,
		MaxTokens:   &maxTokens,
		ToolChoice:  "none",
		Messages: []aiChatMessage{
			{Role: "system", Content: "tool addendum"},
			{Role: "system", Content: "main prompt"},
			{Role: "user", Content: "find A06B"},
			{Role: "assistant", Content: "looking", ToolCalls: []aiToolCall{{ID: "call_1", Type: "function", Function: aiToolCallFunction{Name: "search_products", Arguments: `{"query":"A06B"}`}}}},
			{Role: "tool", ToolCallID: "call_1", Name: "search_products", Content: `{"items":[]}`},
		},
		Tools: []aiToolDefinition{{Type: "function", Function: aiToolFunctionSchema{
			Name: "search_products", Description: "Search the catalogue",
			Parameters: map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}, "required": []any{"query"}, "additionalProperties": false},
		}}},
	}
	body := marshalAnthropicParams(t, anthropicTestSetting("https://api.anthropic.com", "high"), request)

	if _, found := body["temperature"]; found {
		t.Fatal("temperature must never be sent to Claude")
	}
	if body["model"] != "claude-opus-4-7" {
		t.Fatalf("model = %v", body["model"])
	}
	if body["max_tokens"].(float64) != anthropicThinkingMinMaxTokens {
		t.Fatalf("max_tokens = %v, want thinking floor %d", body["max_tokens"], anthropicThinkingMinMaxTokens)
	}
	if body["thinking"].(map[string]any)["type"] != "adaptive" || body["output_config"].(map[string]any)["effort"] != "high" {
		t.Fatalf("thinking/effort = %v / %v", body["thinking"], body["output_config"])
	}
	if body["tool_choice"].(map[string]any)["type"] != "none" {
		t.Fatalf("tool_choice = %v", body["tool_choice"])
	}

	system := body["system"].([]any)
	if len(system) != 2 || system[1].(map[string]any)["cache_control"] == nil || system[0].(map[string]any)["cache_control"] != nil {
		t.Fatalf("system blocks / cache breakpoint wrong: %v", system)
	}

	tool := body["tools"].([]any)[0].(map[string]any)
	schema := tool["input_schema"].(map[string]any)
	if schema["type"] != "object" || schema["additionalProperties"] != false || len(schema["required"].([]any)) != 1 {
		t.Fatalf("input_schema = %v", schema)
	}

	messages := body["messages"].([]any)
	roles := []string{}
	for _, message := range messages {
		roles = append(roles, message.(map[string]any)["role"].(string))
	}
	if strings.Join(roles, ",") != "user,assistant,user" {
		t.Fatalf("roles = %v", roles)
	}
	assistant := messages[1].(map[string]any)["content"].([]any)
	toolUse := assistant[1].(map[string]any)
	if toolUse["type"] != "tool_use" || toolUse["id"] != "call_1" || toolUse["input"].(map[string]any)["query"] != "A06B" {
		t.Fatalf("tool_use block = %v", toolUse)
	}
	result := messages[2].(map[string]any)["content"].([]any)[0].(map[string]any)
	if result["type"] != "tool_result" || result["tool_use_id"] != "call_1" || result["cache_control"] == nil {
		t.Fatalf("tool_result block = %v", result)
	}
}

func TestBuildAnthropicMessageParamsReasoningEffortMapping(t *testing.T) {
	maxTokens := 900
	request := openAIChatRequest{MaxTokens: &maxTokens, Messages: []aiChatMessage{{Role: "user", Content: "hi"}}}

	blank := marshalAnthropicParams(t, anthropicTestSetting("https://api.anthropic.com", ""), request)
	if blank["thinking"] != nil || blank["output_config"] != nil || blank["max_tokens"].(float64) != 900 {
		t.Fatalf("blank effort must omit thinking: %v", blank)
	}
	none := marshalAnthropicParams(t, anthropicTestSetting("https://api.anthropic.com", "none"), request)
	if none["thinking"].(map[string]any)["type"] != "disabled" || none["output_config"] != nil {
		t.Fatalf("none must disable thinking: %v", none)
	}
	minimal := marshalAnthropicParams(t, anthropicTestSetting("https://api.anthropic.com", "minimal"), request)
	if minimal["output_config"].(map[string]any)["effort"] != "low" {
		t.Fatalf("minimal must map to low: %v", minimal["output_config"])
	}
}

func TestAnthropicConversationAnswersSkippedToolCalls(t *testing.T) {
	_, turns := anthropicConversation([]aiChatMessage{
		{Role: "user", Content: "go"},
		{Role: "assistant", ToolCalls: []aiToolCall{
			{ID: "a", Function: aiToolCallFunction{Name: "x", Arguments: "{}"}},
			{ID: "b", Function: aiToolCallFunction{Name: "x", Arguments: "{}"}},
		}},
		{Role: "tool", ToolCallID: "a", Content: "{}"},
	})
	if len(turns) != 3 {
		t.Fatalf("turns = %d", len(turns))
	}
	answered := map[string]bool{}
	for _, block := range turns[2].Content {
		if block.OfToolResult != nil {
			answered[block.OfToolResult.ToolUseID] = true
		}
	}
	if !answered["a"] || !answered["b"] {
		t.Fatalf("every tool_use needs a tool_result, got %v", answered)
	}
}

func TestAnthropicConversationStartsWithUser(t *testing.T) {
	_, turns := anthropicConversation([]aiChatMessage{{Role: "assistant", Content: "earlier answer"}, {Role: "user", Content: "next"}})
	if turns[0].Role != "user" || turns[1].Role != "assistant" {
		t.Fatalf("roles = %s,%s", turns[0].Role, turns[1].Role)
	}
}

func TestRequestAnthropicMessageReplaysThinkingWithToolUse(t *testing.T) {
	var requests []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("X-Api-Key") != "sk-ant-test" || r.Header.Get("Anthropic-Version") == "" {
			t.Errorf("unexpected request %s key=%q version=%q", r.URL.Path, r.Header.Get("X-Api-Key"), r.Header.Get("Anthropic-Version"))
		}
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		requests = append(requests, body)
		w.Header().Set("Content-Type", "application/json")
		if len(requests) == 1 {
			_, _ = io.WriteString(w, `{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-4-7","stop_reason":"tool_use","usage":{"input_tokens":10,"output_tokens":5},
				"content":[{"type":"thinking","thinking":"","signature":"sig-123"},{"type":"tool_use","id":"toolu_1","name":"count_products","input":{"only_active":false}}]}`)
			return
		}
		_, _ = io.WriteString(w, `{"id":"msg_2","type":"message","role":"assistant","model":"claude-opus-4-7","stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5},
			"content":[{"type":"text","text":"{\"reply\":\"done\",\"suggestions\":[]}"}]}`)
	}))
	defer server.Close()

	setting := anthropicTestSetting(server.URL+"/v1", "high")
	conversation := []aiChatMessage{{Role: "system", Content: "probe"}, {Role: "user", Content: "count"}}
	first, err := requestAIAgentMessage(context.Background(), setting, "sk-ant-test", buildOpenAIChatRequest(setting, conversation, 512), server.Client())
	if err != nil {
		t.Fatalf("first request: %v", err)
	}
	if len(first.ToolCalls) != 1 || first.ToolCalls[0].ID != "toolu_1" || first.ToolCalls[0].Function.Arguments != `{"only_active":false}` {
		t.Fatalf("tool calls = %+v", first.ToolCalls)
	}

	conversation = append(conversation, first, aiChatMessage{Role: "tool", ToolCallID: "toolu_1", Content: `{"count":3}`})
	second, err := requestAIAgentMessage(context.Background(), setting, "sk-ant-test", buildOpenAIChatRequest(setting, conversation, 512), server.Client())
	if err != nil {
		t.Fatalf("second request: %v", err)
	}
	if !strings.Contains(second.Content, `"reply":"done"`) {
		t.Fatalf("content = %q", second.Content)
	}

	replayed := requests[1]["messages"].([]any)[1].(map[string]any)["content"].([]any)
	thinking := replayed[0].(map[string]any)
	if thinking["type"] != "thinking" || thinking["signature"] != "sig-123" {
		t.Fatalf("thinking block must be replayed verbatim, got %v", replayed)
	}
}

func TestRequestAnthropicMessageStreamForwardsTextDeltas(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		events := []string{
			`event: message_start` + "\n" + `data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-4-7","content":[],"stop_reason":null,"usage":{"input_tokens":5,"output_tokens":0}}}`,
			`event: content_block_start` + "\n" + `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
			`event: content_block_delta` + "\n" + `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\"reply\":\"he"}}`,
			`event: content_block_delta` + "\n" + `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"llo\"}"}}`,
			`event: content_block_stop` + "\n" + `data: {"type":"content_block_stop","index":0}`,
			`event: message_delta` + "\n" + `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}`,
			`event: message_stop` + "\n" + `data: {"type":"message_stop"}`,
		}
		for _, event := range events {
			_, _ = io.WriteString(w, event+"\n\n")
		}
	}))
	defer server.Close()

	setting := anthropicTestSetting(server.URL, "")
	var fragments []string
	request := buildOpenAIChatRequest(setting, []aiChatMessage{{Role: "user", Content: "hi"}}, 512)
	message, err := requestAIAgentMessageStream(context.Background(), setting, "sk-ant-test", request, server.Client(), func(text string) {
		fragments = append(fragments, text)
	})
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	if message.Content != `{"reply":"hello"}` || len(fragments) != 2 {
		t.Fatalf("content=%q fragments=%v", message.Content, fragments)
	}
}

func TestRequestAnthropicMessageKeepsProviderStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"invalid_request_error","message":"model: bad"}}`)
	}))
	defer server.Close()

	setting := anthropicTestSetting(server.URL, "")
	_, err := requestAIAgentMessage(context.Background(), setting, "sk-ant-test", buildOpenAIChatRequest(setting, []aiChatMessage{{Role: "user", Content: "hi"}}, 64), server.Client())
	var httpErr *aiProviderHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusBadRequest || !strings.Contains(httpErr.Body, "model: bad") {
		t.Fatalf("err = %v", err)
	}
}

func TestRequestAnthropicMessageRejectsTruncatedAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"m","type":"message","role":"assistant","model":"claude-opus-4-7","stop_reason":"max_tokens","usage":{"input_tokens":1,"output_tokens":1},"content":[{"type":"thinking","thinking":"","signature":"s"}]}`)
	}))
	defer server.Close()

	setting := anthropicTestSetting(server.URL, "high")
	_, err := requestAIAgentMessage(context.Background(), setting, "k", buildOpenAIChatRequest(setting, []aiChatMessage{{Role: "user", Content: "hi"}}, 64), server.Client())
	if err == nil || !strings.Contains(err.Error(), "max_tokens") {
		t.Fatalf("err = %v", err)
	}
}

func TestAnthropicBaseURL(t *testing.T) {
	for input, want := range map[string]string{
		"https://api.anthropic.com":              "https://api.anthropic.com",
		"https://api.anthropic.com/v1":           "https://api.anthropic.com",
		"https://api.anthropic.com/v1/messages":  "https://api.anthropic.com",
		"https://relay.example.com/anthropic/v1": "https://relay.example.com/anthropic",
	} {
		if got := anthropicBaseURL(input); got != want {
			t.Errorf("anthropicBaseURL(%q) = %q, want %q", input, got, want)
		}
	}
}
