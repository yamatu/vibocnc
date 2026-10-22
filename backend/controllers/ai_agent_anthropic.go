package controllers

// Claude (Anthropic Messages API) provider.
//
// Every AI path funnels through requestAIAgentMessage / requestAIAgentMessageStream
// in the OpenAI chat shape; a profile in anthropic_messages mode is translated
// here to the native Messages API and the answer is translated back, so the
// conversation loop, tool execution and all background jobs stay unchanged.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"fanuc-backend/models"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

const anthropicDefaultMaxTokens = 4096

// Thinking tokens count against max_tokens. Callers size their limits for the
// visible answer only, so adaptive thinking raises the ceiling to this floor.
const anthropicThinkingMinMaxTokens = 16000

func isAnthropicAPIMode(setting *models.AIAgentSetting) bool {
	return setting != nil && setting.APIMode == aiAgentAPIModeAnthropic
}

// anthropicBaseURL accepts the API root with or without /v1 (or the full
// /v1/messages endpoint); the SDK appends v1/messages itself.
func anthropicBaseURL(raw string) string {
	base := strings.TrimRight(strings.TrimSpace(raw), "/")
	base = strings.TrimSuffix(base, "/v1/messages")
	return strings.TrimSuffix(base, "/v1")
}

func newAnthropicClient(setting *models.AIAgentSetting, apiKey string, httpClient *http.Client) anthropic.Client {
	opts := []option.RequestOption{
		// Server-wide ANTHROPIC_* variables must never override the saved profile.
		option.WithoutEnvironmentDefaults(),
		option.WithAPIKey(apiKey),
		option.WithHTTPClient(httpClient),
		option.WithMaxRetries(2),
	}
	if base := anthropicBaseURL(setting.BaseURL); base != "" {
		opts = append(opts, option.WithBaseURL(base))
	}
	return anthropic.NewClient(opts...)
}

// applyAnthropicReasoning maps the profile's free-text reasoning effort: blank
// sends neither thinking nor effort, "none" disables thinking, any other value
// enables adaptive thinking at that effort. It reports whether thinking is on.
func applyAnthropicReasoning(params *anthropic.MessageNewParams, effort string) bool {
	effort = strings.ToLower(strings.TrimSpace(effort))
	switch effort {
	case "":
		return false
	case "none", "off", "disabled":
		params.Thinking = anthropic.ThinkingConfigParamUnion{OfDisabled: &anthropic.ThinkingConfigDisabledParam{}}
		return false
	case "minimal":
		effort = string(anthropic.OutputConfigEffortLow)
	}
	params.Thinking = anthropic.ThinkingConfigParamUnion{OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{}}
	params.OutputConfig = anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffort(effort)}
	return true
}

func anthropicMaxTokens(request openAIChatRequest, thinking bool) int64 {
	maxTokens := anthropicDefaultMaxTokens
	if request.MaxCompletionTokens != nil && *request.MaxCompletionTokens > 0 {
		maxTokens = *request.MaxCompletionTokens
	} else if request.MaxTokens != nil && *request.MaxTokens > 0 {
		maxTokens = *request.MaxTokens
	}
	if thinking && maxTokens < anthropicThinkingMinMaxTokens {
		maxTokens = anthropicThinkingMinMaxTokens
	}
	return int64(maxTokens)
}

func buildAnthropicMessageParams(setting *models.AIAgentSetting, request openAIChatRequest) anthropic.MessageNewParams {
	system, turns := anthropicConversation(request.Messages)
	params := anthropic.MessageNewParams{
		Model:    anthropic.Model(setting.Model),
		Messages: turns,
	}
	// temperature is deliberately never sent: Opus 4.7 rejects sampling
	// parameters and thinking requires the default anyway.
	thinking := applyAnthropicReasoning(&params, setting.ReasoningEffort)
	params.MaxTokens = anthropicMaxTokens(request, thinking)
	if tools := anthropicTools(request.Tools); len(tools) > 0 {
		params.Tools = tools
		params.ToolChoice = anthropicToolChoice(request.ToolChoice)
	}

	// Prompt caching: one breakpoint after tools+system, shared by every request
	// of the same kind (SEO jobs send thousands), and one on the newest block so
	// each tool-loop turn re-reads the earlier turns from cache.
	if len(system) > 0 {
		system[len(system)-1].CacheControl = anthropic.NewCacheControlEphemeralParam()
		params.System = system
	}
	if last := len(turns) - 1; last >= 0 && turns[last].Role == anthropic.MessageParamRoleUser {
		if blocks := turns[last].Content; len(blocks) > 0 {
			if cacheControl := blocks[len(blocks)-1].GetCacheControl(); cacheControl != nil {
				*cacheControl = anthropic.NewCacheControlEphemeralParam()
			}
		}
	}
	return params
}

// anthropicConversation splits system prompts out (Claude takes them as a
// top-level field), turns tool results into user tool_result blocks and merges
// consecutive same-role messages so turns strictly alternate.
func anthropicConversation(messages []aiChatMessage) ([]anthropic.TextBlockParam, []anthropic.MessageParam) {
	var system []anthropic.TextBlockParam
	turns := make([]anthropic.MessageParam, 0, len(messages))
	appendBlocks := func(role anthropic.MessageParamRole, blocks []anthropic.ContentBlockParamUnion) {
		if len(blocks) == 0 {
			return
		}
		if last := len(turns) - 1; last >= 0 && turns[last].Role == role {
			turns[last].Content = append(turns[last].Content, blocks...)
			return
		}
		// Copy so appending later never writes into a slice the caller still holds.
		turns = append(turns, anthropic.MessageParam{Role: role, Content: append([]anthropic.ContentBlockParamUnion(nil), blocks...)})
	}

	for _, message := range messages {
		switch strings.ToLower(strings.TrimSpace(message.Role)) {
		case "system", "developer":
			if strings.TrimSpace(message.Content) != "" {
				system = append(system, anthropic.TextBlockParam{Text: message.Content})
			}
		case "assistant":
			appendBlocks(anthropic.MessageParamRoleAssistant, anthropicAssistantBlocks(message))
		case "tool":
			content := message.Content
			if strings.TrimSpace(content) == "" {
				content = "{}"
			}
			appendBlocks(anthropic.MessageParamRoleUser, []anthropic.ContentBlockParamUnion{
				anthropic.NewToolResultBlock(message.ToolCallID, content, false),
			})
		default:
			if strings.TrimSpace(message.Content) != "" {
				appendBlocks(anthropic.MessageParamRoleUser, []anthropic.ContentBlockParamUnion{anthropic.NewTextBlock(message.Content)})
			}
		}
	}

	turns = answerUnansweredAnthropicToolUses(turns)
	if len(turns) == 0 || turns[0].Role != anthropic.MessageParamRoleUser {
		turns = append([]anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("(earlier conversation omitted)")),
		}, turns...)
	}
	return system, turns
}

func anthropicAssistantBlocks(message aiChatMessage) []anthropic.ContentBlockParamUnion {
	if len(message.anthropicContent) > 0 {
		return message.anthropicContent
	}
	blocks := make([]anthropic.ContentBlockParamUnion, 0, len(message.ToolCalls)+1)
	if text := strings.TrimSpace(message.Content); text != "" {
		blocks = append(blocks, anthropic.NewTextBlock(text))
	}
	for _, call := range message.ToolCalls {
		blocks = append(blocks, anthropic.NewToolUseBlock(call.ID, anthropicToolInput(call.Function.Arguments), call.Function.Name))
	}
	return blocks
}

func anthropicToolInput(arguments string) json.RawMessage {
	arguments = strings.TrimSpace(arguments)
	if !strings.HasPrefix(arguments, "{") || !json.Valid([]byte(arguments)) {
		return json.RawMessage("{}")
	}
	return json.RawMessage(arguments)
}

// answerUnansweredAnthropicToolUses adds an error tool_result for every
// tool_use the loop did not execute (it caps calls per turn); Claude rejects a
// tool_use that is not answered in the very next user turn.
func answerUnansweredAnthropicToolUses(turns []anthropic.MessageParam) []anthropic.MessageParam {
	for index := 0; index < len(turns); index++ {
		if turns[index].Role != anthropic.MessageParamRoleAssistant {
			continue
		}
		var pending []string
		for _, block := range turns[index].Content {
			if block.OfToolUse != nil {
				pending = append(pending, block.OfToolUse.ID)
			}
		}
		if len(pending) == 0 {
			continue
		}
		next := index + 1
		hasUserTurn := next < len(turns) && turns[next].Role == anthropic.MessageParamRoleUser
		answered := map[string]bool{}
		if hasUserTurn {
			for _, block := range turns[next].Content {
				if block.OfToolResult != nil {
					answered[block.OfToolResult.ToolUseID] = true
				}
			}
		}
		var missing []anthropic.ContentBlockParamUnion
		for _, id := range pending {
			if !answered[id] {
				missing = append(missing, anthropic.NewToolResultBlock(id, `{"error":"this tool call was not executed"}`, true))
			}
		}
		if len(missing) == 0 {
			continue
		}
		if hasUserTurn {
			// tool_result blocks must precede any text in the user turn.
			turns[next].Content = append(missing, turns[next].Content...)
			continue
		}
		turns = append(turns[:next], append([]anthropic.MessageParam{anthropic.NewUserMessage(missing...)}, turns[next:]...)...)
	}
	return turns
}

func anthropicTools(definitions []aiToolDefinition) []anthropic.ToolUnionParam {
	tools := make([]anthropic.ToolUnionParam, 0, len(definitions))
	for _, definition := range definitions {
		name := strings.TrimSpace(definition.Function.Name)
		if name == "" {
			continue
		}
		schema := anthropic.ToolInputSchemaParam{}
		extra := map[string]any{}
		for key, value := range definition.Function.Parameters {
			switch key {
			case "type":
			case "properties":
				schema.Properties = value
			case "required":
				schema.Required = anthropicStringList(value)
			default:
				extra[key] = value
			}
		}
		if len(extra) > 0 {
			schema.ExtraFields = extra
		}
		tool := anthropic.ToolParam{Name: name, InputSchema: schema}
		if description := strings.TrimSpace(definition.Function.Description); description != "" {
			tool.Description = anthropic.String(description)
		}
		tools = append(tools, anthropic.ToolUnionParam{OfTool: &tool})
	}
	return tools
}

func anthropicStringList(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		list := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				list = append(list, text)
			}
		}
		return list
	}
	return nil
}

func anthropicToolChoice(choice string) anthropic.ToolChoiceUnionParam {
	switch strings.ToLower(strings.TrimSpace(choice)) {
	case "none":
		return anthropic.ToolChoiceUnionParam{OfNone: &anthropic.ToolChoiceNoneParam{}}
	case "required", "any":
		return anthropic.ToolChoiceUnionParam{OfAny: &anthropic.ToolChoiceAnyParam{}}
	case "auto":
		return anthropic.ToolChoiceUnionParam{OfAuto: &anthropic.ToolChoiceAutoParam{}}
	}
	return anthropic.ToolChoiceUnionParam{}
}

// anthropicResponseMessage converts Claude's content blocks into the assistant
// message the conversation loop expects. Thinking text is not surfaced: it is
// not the answer, and finalAIAgentContent would otherwise fall back to it.
func anthropicResponseMessage(message *anthropic.Message, maxTokens int64) (aiChatMessage, error) {
	var text strings.Builder
	var calls []aiToolCall
	for _, block := range message.Content {
		switch block.Type {
		case "text":
			text.WriteString(block.Text)
		case "tool_use":
			arguments := strings.TrimSpace(string(block.Input))
			if arguments == "" {
				arguments = "{}"
			}
			calls = append(calls, aiToolCall{ID: block.ID, Type: "function", Function: aiToolCallFunction{Name: block.Name, Arguments: arguments}})
		}
	}

	switch message.StopReason {
	case anthropic.StopReasonRefusal:
		return aiChatMessage{}, errors.New("the Claude model declined this request (stop_reason=refusal)")
	case anthropic.StopReasonModelContextWindowExceeded:
		return aiChatMessage{}, errors.New("the request exceeded the Claude model's context window")
	case anthropic.StopReasonMaxTokens:
		// A truncated tool call has incomplete JSON arguments, and an empty answer
		// means thinking used the whole budget; neither is usable.
		if len(calls) > 0 || strings.TrimSpace(text.String()) == "" {
			return aiChatMessage{}, fmt.Errorf("the Claude model stopped at max_tokens=%d before finishing; lower the reasoning effort or retry", maxTokens)
		}
	}

	result := aiChatMessage{Role: "assistant", Content: text.String()}
	if len(calls) > 0 {
		result.ToolCalls = calls
		result.anthropicContent = message.ToParam().Content
	}
	return result, nil
}

// anthropicRequestError keeps the provider status code and body so the shared
// fallback classifiers (looksLikeUnsupportedTools/Stream) keep working.
func anthropicRequestError(err error) error {
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		body := apiErr.RawJSON()
		if body == "" {
			body = apiErr.Error()
		}
		return &aiProviderHTTPError{StatusCode: apiErr.StatusCode, Body: body}
	}
	return err
}

func requestAnthropicMessage(ctx context.Context, setting *models.AIAgentSetting, apiKey string, request openAIChatRequest, httpClient *http.Client) (aiChatMessage, error) {
	releaseAITaskSlot := acquireAITaskSlotForRequest(nil)
	defer releaseAITaskSlot()

	params := buildAnthropicMessageParams(setting, request)
	client := newAnthropicClient(setting, apiKey, httpClient)
	var opts []option.RequestOption
	if setting.TimeoutSeconds > 0 {
		// An explicit timeout also lifts the SDK's "must stream" guard for large
		// max_tokens; the HTTP client already enforces the same limit.
		opts = append(opts, option.WithRequestTimeout(time.Duration(setting.TimeoutSeconds)*time.Second))
	}
	message, err := client.Messages.New(ctx, params, opts...)
	if err != nil {
		return aiChatMessage{}, anthropicRequestError(err)
	}
	return anthropicResponseMessage(message, params.MaxTokens)
}

func requestAnthropicMessageStream(ctx context.Context, setting *models.AIAgentSetting, apiKey string, request openAIChatRequest, httpClient *http.Client, onContent func(string)) (aiChatMessage, error) {
	releaseAITaskSlot := acquireAITaskSlotForRequest(nil)
	defer releaseAITaskSlot()

	params := buildAnthropicMessageParams(setting, request)
	client := newAnthropicClient(setting, apiKey, httpClient)
	stream := client.Messages.NewStreaming(ctx, params)
	defer stream.Close()

	var message anthropic.Message
	for stream.Next() {
		event := stream.Current()
		if err := message.Accumulate(event); err != nil {
			return aiChatMessage{}, fmt.Errorf("could not read Claude stream: %w", err)
		}
		if onContent == nil {
			continue
		}
		if delta, ok := event.AsAny().(anthropic.ContentBlockDeltaEvent); ok {
			if text, ok := delta.Delta.AsAny().(anthropic.TextDelta); ok && text.Text != "" {
				onContent(text.Text)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return aiChatMessage{}, anthropicRequestError(err)
	}
	return anthropicResponseMessage(&message, params.MaxTokens)
}
