package controllers

// ---------------------------------------------------------------------------
// Streaming (SSE) chat for the admin AI assistant.
//
// The classic /chat endpoint answers once the whole proposal is ready. This
// endpoint streams the run in real time instead, so the admin UI can render
// the agent's steps while they happen: a tool call starts and finishes with
// its duration, intermediate narration appears as a grey status line, and the
// final answer types itself out. The event names follow the same model used
// by modern agent runtimes (start/end events around each tool execution).
//
//	event: stage       {"stage":"thinking"|"tools"|"answering"}
//	event: step_start  {"id":"0-1","tool":"search_products","detail":"A06B-6111"}
//	event: step_end    {"id":"0-1","tool":"search_products","status":"ok","duration_ms":420}
//	event: note        {"text":"..."}   intermediate narration (grey line)
//	event: delta       {"text":"..."}   incremental final answer text
//	event: final       {...exactly the /chat reply object...}
//	event: error       {"message":"..."}
//
// The final event carries the same JSON contract as the non-streaming
// endpoint, so the existing proposal cards and the apply flow keep working
// unchanged. Providers that reject the stream flag are remembered and fall
// back to non-streamed requests while the step events keep flowing.
// ---------------------------------------------------------------------------

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"github.com/gin-gonic/gin"
)

// errAIAgentStreamUnsupported marks a provider rejection of the stream flag.
// The caller then remembers the provider and re-runs without streaming.
var errAIAgentStreamUnsupported = errors.New("the configured AI provider does not support streaming responses")

// aiStreamUnsupportedProviders remembers providers that rejected stream=true,
// keyed by endpoint plus model, so every later chat turn does not pay a failed
// request first.
var aiStreamUnsupportedProviders sync.Map

func aiAgentStreamKey(setting *models.AIAgentSetting) string {
	return strings.TrimSpace(setting.BaseURL) + "|" + strings.TrimSpace(setting.Model)
}

func aiStreamUnsupportedFor(setting *models.AIAgentSetting) bool {
	_, found := aiStreamUnsupportedProviders.Load(aiAgentStreamKey(setting))
	return found
}

func markAIStreamUnsupported(setting *models.AIAgentSetting) {
	aiStreamUnsupportedProviders.Store(aiAgentStreamKey(setting), time.Now())
}

// ResetAIStreamUnsupportedCache clears the downgrade memory. It exists for
// tests and for an administrator who switches to a provider that does support
// streaming.
func ResetAIStreamUnsupportedCache() {
	aiStreamUnsupportedProviders.Range(func(key, _ any) bool {
		aiStreamUnsupportedProviders.Delete(key)
		return true
	})
}

// aiAgentStreamEnabled is the kill switch: AI_AGENT_STREAM=false restores the
// non-streaming request style while the endpoint still streams step events.
func aiAgentStreamEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AI_AGENT_STREAM"))) {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}

// looksLikeUnsupportedStream classifies a provider rejection as "this
// endpoint does not implement SSE streaming". The body check keeps an
// unrelated 400 (context length, bad key) from silently disabling streaming.
func looksLikeUnsupportedStream(err error) bool {
	var httpErr *aiProviderHTTPError
	if !errors.As(err, &httpErr) {
		return false
	}
	switch httpErr.StatusCode {
	case http.StatusNotFound, http.StatusNotImplemented, http.StatusUnprocessableEntity:
		return true
	case http.StatusBadRequest:
		body := strings.ToLower(httpErr.Body)
		for _, marker := range []string{"stream", "sse"} {
			if strings.Contains(body, marker) {
				return true
			}
		}
	}
	return false
}

// aiSSEWriter serialises event writes and flushes every frame immediately so
// the browser (behind Cloudflare and nginx) sees progress as it happens.
type aiSSEWriter struct {
	w       gin.ResponseWriter
	flusher http.Flusher
	mu      sync.Mutex
}

func newAISSEWriter(c *gin.Context) *aiSSEWriter {
	return &aiSSEWriter{w: c.Writer, flusher: c.Writer}
}

func (s *aiSSEWriter) event(name string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// A failed write means the client is gone; there is nobody left to tell,
	// so the error is deliberately ignored.
	_, _ = fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", name, data)
	s.flusher.Flush()
}

// rawEvent writes a pre-serialised frame; used when replaying buffered run
// events so re-encoded JSON stays byte-identical to the live stream.
func (s *aiSSEWriter) rawEvent(name string, data json.RawMessage) {
	if len(data) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", name, data)
	s.flusher.Flush()
}

func (s *aiSSEWriter) comment(text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = fmt.Fprintf(s.w, ": %s\n\n", text)
	s.flusher.Flush()
}

// aiSSESink adapts the conversation loop's progress callbacks to SSE frames.
type aiSSESink struct {
	w *aiSSEWriter

	mu     sync.Mutex
	deltas int
	steps  int
	notes  int
}

func (s *aiSSESink) Stage(stage string) {
	s.w.event("stage", gin.H{"stage": stage})
}

func (s *aiSSESink) Note(text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	s.mu.Lock()
	s.notes++
	s.mu.Unlock()
	s.w.event("note", gin.H{"text": text})
}

func (s *aiSSESink) Delta(text string) {
	if text == "" {
		return
	}
	s.mu.Lock()
	s.deltas++
	s.mu.Unlock()
	s.w.event("delta", gin.H{"text": text})
}

func (s *aiSSESink) StepStart(id, tool, detail string) {
	s.mu.Lock()
	s.steps++
	s.mu.Unlock()
	s.w.event("step_start", gin.H{"id": id, "tool": tool, "detail": detail})
}

func (s *aiSSESink) StepEnd(id, tool, status, errText string, durationMS int64) {
	s.w.event("step_end", gin.H{"id": id, "tool": tool, "status": status, "duration_ms": durationMS, "error": errText})
}

// Emitted reports whether anything user-visible has been sent. The streaming
// fallback may only restart the conversation when this is false, so replaying
// the run cannot duplicate visible output.
func (s *aiSSESink) Emitted() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deltas+s.steps+s.notes > 0
}

func (s *aiSSESink) deltaCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deltas
}

// ---------------------------------------------------------------------------
// Incremental "reply" extractor.
//
// The model's final answer is a JSON object. Streaming that raw JSON to the
// administrator would show braces and escaped quotes, so the extractor scans
// the stream for the "reply" string value and emits only its decoded text as
// it arrives. It is deliberately conservative: any malformed input stops live
// decoding, and the final parseAIAgentReply call remains the source of truth.
// ---------------------------------------------------------------------------

type aiReplyExtractMode int

const (
	aiReplyModeUnknown aiReplyExtractMode = iota
	aiReplyModeNote
	aiReplyModeJSON
)

type aiStreamReplyExtractor struct {
	sink aiAgentEventSink

	mode   aiReplyExtractMode
	prefix strings.Builder

	raw        strings.Builder
	searchFrom int
	valueStart int
	scanPos    int
	decoded    []byte
	emitted    int
	done       bool

	noteBuf strings.Builder
}

func newAIStreamReplyExtractor(sink aiAgentEventSink) *aiStreamReplyExtractor {
	return &aiStreamReplyExtractor{sink: sink, valueStart: -1}
}

// feed receives one content fragment of the current assistant turn.
func (e *aiStreamReplyExtractor) feed(fragment string) {
	if fragment == "" {
		return
	}
	switch e.mode {
	case aiReplyModeUnknown:
		e.prefix.WriteString(fragment)
		e.classifyPrefix()
	case aiReplyModeNote:
		e.appendNote(fragment)
	case aiReplyModeJSON:
		e.feedJSON(fragment)
	}
}

// finish flushes buffered narration when the turn ends.
func (e *aiStreamReplyExtractor) finish() {
	e.flushNotes()
}

func (e *aiStreamReplyExtractor) classifyPrefix() {
	text := e.prefix.String()
	trimmed := strings.TrimLeft(text, " \t\r\n")
	if trimmed == "" {
		return
	}
	// A final answer is JSON, optionally wrapped in a ``` fence. Anything else
	// is narration for the grey status line.
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "```") {
		e.mode = aiReplyModeJSON
		if e.sink != nil {
			e.sink.Stage("answering")
		}
		e.feedJSON(text)
		return
	}
	e.mode = aiReplyModeNote
	e.appendNote(text)
}

func (e *aiStreamReplyExtractor) feedJSON(fragment string) {
	if e.raw.Len() > 2<<20 {
		return
	}
	e.raw.WriteString(fragment)
	if e.valueStart < 0 {
		e.locateReplyValue()
	}
	if e.valueStart < 0 {
		return
	}
	e.scan()
}

// locateReplyValue finds `"reply": "` in the accumulated raw JSON and sets the
// scan position just after the opening quote. Incomplete prefixes are retried
// on the next fragment.
func (e *aiStreamReplyExtractor) locateReplyValue() {
	raw := e.raw.String()
	if e.searchFrom > len(raw) {
		e.searchFrom = len(raw)
	}
	index := strings.Index(raw[e.searchFrom:], `"reply"`)
	if index < 0 {
		// Keep a small overlap so a key split across fragments is still found.
		if len(raw) > 8 {
			e.searchFrom = len(raw) - 8
		}
		return
	}
	keyStart := e.searchFrom + index
	position := skipJSONSpace(raw, keyStart+len(`"reply"`))
	if position >= len(raw) {
		e.searchFrom = keyStart
		return
	}
	if raw[position] != ':' {
		e.searchFrom = keyStart + len(`"reply"`)
		return
	}
	position = skipJSONSpace(raw, position+1)
	if position >= len(raw) {
		e.searchFrom = keyStart
		return
	}
	if raw[position] != '"' {
		e.searchFrom = keyStart + len(`"reply"`)
		return
	}
	e.valueStart = position
	e.scanPos = position + 1
}

func skipJSONSpace(raw string, position int) int {
	for position < len(raw) {
		switch raw[position] {
		case ' ', '\t', '\r', '\n':
			position++
		default:
			return position
		}
	}
	return position
}

func (e *aiStreamReplyExtractor) scan() {
	raw := e.raw.String()
	for !e.done && e.scanPos < len(raw) {
		b := raw[e.scanPos]
		switch {
		case b == '"':
			e.done = true
			e.scanPos++
		case b == '\\':
			if e.scanPos+1 >= len(raw) {
				e.flushDecoded()
				return
			}
			switch raw[e.scanPos+1] {
			case '"', '\\', '/':
				e.decoded = append(e.decoded, raw[e.scanPos+1])
				e.scanPos += 2
			case 'b', 'f', 'n', 'r', 't':
				e.decoded = append(e.decoded, jsonControlReplacement(raw[e.scanPos+1]))
				e.scanPos += 2
			case 'u':
				r, consumed, ok := decodeJSONUnicodeEscape(raw, e.scanPos)
				if !ok {
					e.flushDecoded()
					return
				}
				e.decoded = utf8.AppendRune(e.decoded, r)
				e.scanPos += consumed
			default:
				// Unknown escape sequence; stop live decoding and let the
				// final JSON parse decide.
				e.done = true
			}
		default:
			need := utf8SequenceLen(b)
			if need == 0 {
				e.done = true
				continue
			}
			if e.scanPos+need > len(raw) {
				e.flushDecoded()
				return
			}
			e.decoded = append(e.decoded, raw[e.scanPos:e.scanPos+need]...)
			e.scanPos += need
		}
	}
	e.flushDecoded()
}

func (e *aiStreamReplyExtractor) flushDecoded() {
	if e.sink == nil || e.emitted >= len(e.decoded) {
		return
	}
	text := string(e.decoded[e.emitted:])
	e.emitted = len(e.decoded)
	if text != "" {
		e.sink.Delta(text)
	}
}

func (e *aiStreamReplyExtractor) appendNote(fragment string) {
	e.noteBuf.WriteString(fragment)
	if e.noteBuf.Len() >= 160 || strings.Contains(fragment, "\n") {
		e.flushNotes()
	}
}

func (e *aiStreamReplyExtractor) flushNotes() {
	text := strings.TrimSpace(e.noteBuf.String())
	e.noteBuf.Reset()
	if text != "" && e.sink != nil {
		e.sink.Note(text)
	}
}

func jsonControlReplacement(b byte) byte {
	switch b {
	case 'b':
		return '\b'
	case 'f':
		return '\f'
	case 'n':
		return '\n'
	case 'r':
		return '\r'
	default:
		return '\t'
	}
}

// decodeJSONUnicodeEscape decodes a \uXXXX sequence (including surrogate
// pairs) at raw[pos] (which must be the backslash). It returns ok=false when
// more data is needed before the sequence can be decoded.
func decodeJSONUnicodeEscape(raw string, pos int) (rune, int, bool) {
	if pos+6 > len(raw) {
		return 0, 0, false
	}
	code, err := strconv.ParseUint(raw[pos+2:pos+6], 16, 32)
	if err != nil {
		return utf8.RuneError, 6, true
	}
	r := rune(code)
	if utf16.IsSurrogate(r) {
		if pos+12 > len(raw) {
			return 0, 0, false
		}
		if raw[pos+6] == '\\' && raw[pos+7] == 'u' {
			low, lowErr := strconv.ParseUint(raw[pos+8:pos+12], 16, 32)
			if lowErr == nil {
				if combined := utf16.DecodeRune(r, rune(low)); combined != utf8.RuneError {
					return combined, 12, true
				}
			}
		}
		return utf8.RuneError, 6, true
	}
	return r, 6, true
}

// utf8SequenceLen returns the byte length of the UTF-8 sequence whose lead
// byte is b, or 0 when b cannot start a sequence. Partial sequences are kept
// in the buffer until the next fragment completes them.
func utf8SequenceLen(b byte) int {
	switch {
	case b < 0x80:
		return 1
	case b >= 0xC0 && b < 0xE0:
		return 2
	case b >= 0xE0 && b < 0xF0:
		return 3
	case b >= 0xF0 && b < 0xF8:
		return 4
	default:
		return 0
	}
}

// ---------------------------------------------------------------------------
// Streamed provider request
// ---------------------------------------------------------------------------

type aiToolCallDelta struct {
	Index    int                `json:"index"`
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function aiToolCallFunction `json:"function"`
}

type openAIStreamDelta struct {
	Content          string            `json:"content"`
	ReasoningContent string            `json:"reasoning_content"`
	ToolCalls        []aiToolCallDelta `json:"tool_calls"`
}

type openAIStreamChoice struct {
	Delta        openAIStreamDelta `json:"delta"`
	FinishReason string            `json:"finish_reason"`
}

type openAIStreamChunk struct {
	Choices []openAIStreamChoice `json:"choices"`
}

// requestAIAgentMessageStream performs one streamed provider round trip. It
// returns the fully assembled assistant message (content, reasoning and tool
// calls with their argument fragments concatenated) so the caller can feed it
// back into the conversation loop exactly like a non-streamed message. The
// onContent callback receives raw content fragments as they arrive.
func requestAIAgentMessageStream(ctx context.Context, setting *models.AIAgentSetting, apiKey string, request openAIChatRequest, client *http.Client, onContent func(string)) (aiChatMessage, error) {
	payload, err := json.Marshal(request)
	if err != nil {
		return aiChatMessage{}, err
	}
	endpoint := setting.BaseURL
	if !strings.HasSuffix(endpoint, "/chat/completions") {
		endpoint += "/chat/completions"
	}

	// One retry is safe while nothing has been received yet: either the
	// request never reached a working stream or it was rejected before any
	// output, so replaying it cannot duplicate visible text.
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		message, progressed, err := doRequestAIAgentMessageStream(ctx, endpoint, apiKey, payload, client, onContent)
		if err == nil {
			return message, nil
		}
		lastErr = err
		if progressed || ctx.Err() != nil {
			return aiChatMessage{}, err
		}
		select {
		case <-time.After(300 * time.Millisecond):
		case <-ctx.Done():
			return aiChatMessage{}, ctx.Err()
		}
	}
	return aiChatMessage{}, lastErr
}

func doRequestAIAgentMessageStream(ctx context.Context, endpoint, apiKey string, payload []byte, client *http.Client, onContent func(string)) (aiChatMessage, bool, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return aiChatMessage{}, false, fmt.Errorf("invalid AI provider URL: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := client.Do(httpReq)
	if err != nil {
		return aiChatMessage{}, false, fmt.Errorf("could not reach AI provider: %w", err)
	}
	defer resp.Body.Close()

	reader := bufio.NewReaderSize(resp.Body, 64*1024)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(reader, 1<<20))
		return aiChatMessage{}, false, &aiProviderHTTPError{StatusCode: resp.StatusCode, Body: string(body)}
	}

	// Some OpenAI-compatible endpoints ignore stream=true and answer with a
	// regular JSON body. Detect that before handing the body to the SSE
	// parser so such providers keep working without deltas.
	if first, peekErr := reader.Peek(1); peekErr == nil && len(first) == 1 && first[0] == '{' {
		body, readErr := io.ReadAll(io.LimitReader(reader, 2<<20))
		if readErr != nil {
			return aiChatMessage{}, false, fmt.Errorf("could not read AI provider response: %w", readErr)
		}
		var providerResponse openAIChatResponse
		if err := json.Unmarshal(body, &providerResponse); err != nil || len(providerResponse.Choices) == 0 {
			return aiChatMessage{}, false, errors.New("AI provider returned an invalid response")
		}
		return providerResponse.Choices[0].Message, false, nil
	}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 4<<20)
	var content strings.Builder
	var reasoning strings.Builder
	toolCalls := make([]aiToolCall, 0, 2)
	toolPositions := map[int]int{}
	progressed := false

	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}
		var chunk openAIStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue // tolerate non-JSON keepalive payloads
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
				content.WriteString(choice.Delta.Content)
				progressed = true
				if onContent != nil {
					onContent(choice.Delta.Content)
				}
			}
			if choice.Delta.ReasoningContent != "" {
				reasoning.WriteString(choice.Delta.ReasoningContent)
				progressed = true
			}
			for _, call := range choice.Delta.ToolCalls {
				position, exists := toolPositions[call.Index]
				if !exists {
					position = len(toolCalls)
					toolPositions[call.Index] = position
					toolCalls = append(toolCalls, aiToolCall{Type: "function"})
				}
				if call.ID != "" {
					toolCalls[position].ID = call.ID
				}
				if call.Type != "" {
					toolCalls[position].Type = call.Type
				}
				if call.Function.Name != "" {
					toolCalls[position].Function.Name = call.Function.Name
				}
				if call.Function.Arguments != "" {
					toolCalls[position].Function.Arguments += call.Function.Arguments
				}
				progressed = true
			}
		}
		if content.Len() > 2<<20 {
			return aiChatMessage{}, true, errors.New("AI provider stream was too large")
		}
	}
	if err := scanner.Err(); err != nil {
		return aiChatMessage{}, progressed, fmt.Errorf("could not read AI provider stream: %w", err)
	}
	message := aiChatMessage{Role: "assistant", Content: content.String(), ReasoningContent: reasoning.String()}
	if len(toolCalls) > 0 {
		message.ToolCalls = toolCalls
	}
	return message, progressed, nil
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

// ChatStream is the streaming twin of Chat. It validates and prepares the
// request exactly like Chat does, then streams progress events until the
// final proposal (same JSON shape as Chat) is sent.
func (ac *AIAgentController) ChatStream(c *gin.Context) {
	var req aiAgentChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid AI request", Error: err.Error()})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if len([]rune(req.Message)) < 2 || len([]rune(req.Message)) > aiAgentMessageMaxRunes {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: fmt.Sprintf("Message must contain 2-%d characters", aiAgentMessageMaxRunes)})
		return
	}

	setting, apiKey, configErr := loadAIAgentConfig()
	if configErr != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "AI settings could not be read", Error: configErr.Error()})
		return
	}
	if !setting.Enabled || apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, models.APIResponse{Success: false, Message: "AI assistant is not configured. An administrator must save an API key and enable it in Admin > AI Assistant."})
		return
	}

	db := config.GetDB()
	conversation, err := aiAgentResolveConversation(db, req.ConversationID, req.Message)
	if err != nil {
		status := http.StatusInternalServerError
		if err == errAIAgentConversationNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, models.APIResponse{Success: false, Message: "Could not prepare the AI conversation", Error: err.Error()})
		return
	}
	if aiAgentConversationBusy(conversation.ID) {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "This conversation is already generating a reply"})
		return
	}
	userMessage, err := aiAgentPersistMessage(db, conversation.ID, "user", req.Message, nil, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Could not save the chat message", Error: err.Error()})
		return
	}
	messages, err := ac.buildAIAgentChatMessages(setting, req.Message, aiAgentLoadHistory(db, conversation.ID, userMessage.ID), req.History)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Could not prepare catalog context", Error: err.Error()})
		return
	}

	run, started := startAIAgentRun(conversation.ID)
	if !started {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "This conversation is already generating a reply"})
		return
	}
	aiAgentMarkConversationStatus(db, conversation.ID, "generating")
	go runAIAgentConversationJob(run, setting, apiKey, messages, db)
	// From here on the response is an SSE stream fed by the run's buffered
	// events, so a refresh can re-attach through the resume endpoint.
	streamAIAgentRunTo(c, run, 0, false)
}

// chatStreamErrorMessage maps internal errors to a bounded, user-safe message
// for the error event.
func chatStreamErrorMessage(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "AI provider timed out. Please try again."
	case errors.Is(err, context.Canceled):
		return "Generation was cancelled."
	default:
		return truncateRunes("AI provider request failed: "+err.Error(), 300)
	}
}
