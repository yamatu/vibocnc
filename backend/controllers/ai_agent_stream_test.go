package controllers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// recordingSink captures the events the conversation loop emits so streaming
// behaviour can be asserted without a real SSE connection.
type recordingSink struct {
	stages []string
	notes  []string
	deltas []string
	steps  []string
}

func (s *recordingSink) Stage(stage string) { s.stages = append(s.stages, stage) }
func (s *recordingSink) Note(text string)   { s.notes = append(s.notes, text) }
func (s *recordingSink) Delta(text string)  { s.deltas = append(s.deltas, text) }
func (s *recordingSink) StepStart(id, tool, detail string) {
	s.steps = append(s.steps, "start:"+id+":"+tool)
}
func (s *recordingSink) StepEnd(id, tool, status, errText string, durationMS int64) {
	s.steps = append(s.steps, "end:"+id+":"+tool+":"+status)
}
func (s *recordingSink) Emitted() bool {
	return len(s.deltas)+len(s.notes)+len(s.steps) > 0
}

func TestStreamReplyExtractorEmitsIncrementalText(t *testing.T) {
	sink := &recordingSink{}
	extractor := newAIStreamReplyExtractor(sink)
	fragments := []string{
		`{"reply":"你好`,
		`，世界`,
		`！\"引号\"`,
		`\n换行`,
		`\u4E2D\u6587`,
		`","suggestions":[]}`,
	}
	for _, fragment := range fragments {
		extractor.feed(fragment)
	}
	extractor.finish()
	got := strings.Join(sink.deltas, "")
	want := "你好，世界！\"引号\"\n换行中文"
	if got != want {
		t.Fatalf("streamed text = %q, want %q", got, want)
	}
	if len(sink.notes) != 0 {
		t.Fatalf("unexpected notes: %#v", sink.notes)
	}
}

func TestStreamReplyExtractorSplitsEscapesAndRunes(t *testing.T) {
	sink := &recordingSink{}
	extractor := newAIStreamReplyExtractor(sink)
	// Fragments split in the middle of a UTF-8 rune and of a \u escape must
	// not corrupt the emitted text or emit partial bytes.
	for _, fragment := range []string{`{"reply":"中`, "\xe6", "\x96", "\x87", `\u`, `4E2D`, `"}`} {
		extractor.feed(fragment)
	}
	extractor.finish()
	if got := strings.Join(sink.deltas, ""); got != "中文中" {
		t.Fatalf("streamed text = %q, want %q", got, "中文中")
	}
}

func TestStreamReplyExtractorRoutesNarrationToNotes(t *testing.T) {
	sink := &recordingSink{}
	extractor := newAIStreamReplyExtractor(sink)
	extractor.feed("我先查一下该型号的现有分类和商品。")
	extractor.finish()
	if len(sink.deltas) != 0 {
		t.Fatalf("narration must not be streamed as answer text: %#v", sink.deltas)
	}
	if len(sink.notes) != 1 || !strings.Contains(sink.notes[0], "查一下") {
		t.Fatalf("unexpected notes: %#v", sink.notes)
	}
}

func TestLooksLikeUnsupportedStream(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		expect bool
	}{
		{"not found", &aiProviderHTTPError{StatusCode: http.StatusNotFound, Body: "nope"}, true},
		{"not implemented", &aiProviderHTTPError{StatusCode: http.StatusNotImplemented, Body: "nope"}, true},
		{"bad request mentioning stream", &aiProviderHTTPError{StatusCode: http.StatusBadRequest, Body: `{"error":{"message":"Unrecognized request argument supplied: stream"}}`}, true},
		{"bad request about context", &aiProviderHTTPError{StatusCode: http.StatusBadRequest, Body: `{"error":{"message":"maximum context length exceeded"}}`}, false},
		{"unauthorized", &aiProviderHTTPError{StatusCode: http.StatusUnauthorized, Body: "bad key"}, false},
		{"transport error", context.DeadlineExceeded, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := looksLikeUnsupportedStream(test.err); got != test.expect {
				t.Fatalf("looksLikeUnsupportedStream = %v, want %v", got, test.expect)
			}
		})
	}
}

func TestRequestAIAgentMessageStreamAssemblesSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		frames := []string{
			`data: {"choices":[{"delta":{"role":"assistant","content":"{\"reply\":\"he"}}]}`,
			`data: {"choices":[{"delta":{"content":"llo\"}"}}]}`,
			`data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
			`data: [DONE]`,
		}
		for _, frame := range frames {
			_, _ = w.Write([]byte(frame + "\n\n"))
			flusher.Flush()
		}
	}))
	t.Cleanup(server.Close)

	var fragments []string
	request := openAIChatRequest{Model: "test", Stream: true}
	message, err := requestAIAgentMessageStream(context.Background(), testAISetting(server.URL), "key", request, server.Client(), func(text string) {
		fragments = append(fragments, text)
	})
	if err != nil {
		t.Fatalf("stream request failed: %v", err)
	}
	if message.Content != `{"reply":"hello"}` {
		t.Fatalf("assembled content = %q", message.Content)
	}
	if strings.Join(fragments, "") != message.Content {
		t.Fatalf("content fragments = %#v", fragments)
	}
}

func TestRequestAIAgentMessageStreamAssemblesToolCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		frames := []string{
			`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_products","arguments":"{\"que"}}]}}]}`,
			`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ry\":\"A06B\"}"}}]}}]}`,
			`data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
			`data: [DONE]`,
		}
		for _, frame := range frames {
			_, _ = w.Write([]byte(frame + "\n\n"))
			flusher.Flush()
		}
	}))
	t.Cleanup(server.Close)

	request := openAIChatRequest{Model: "test", Stream: true}
	message, err := requestAIAgentMessageStream(context.Background(), testAISetting(server.URL), "key", request, server.Client(), nil)
	if err != nil {
		t.Fatalf("stream request failed: %v", err)
	}
	if len(message.ToolCalls) != 1 || message.ToolCalls[0].Function.Name != aiToolSearchProducts {
		t.Fatalf("unexpected tool calls: %#v", message.ToolCalls)
	}
	if message.ToolCalls[0].Function.Arguments != `{"query":"A06B"}` {
		t.Fatalf("assembled arguments = %q", message.ToolCalls[0].Function.Arguments)
	}
}

func TestRequestAIAgentMessageStreamAcceptsJSONResponse(t *testing.T) {
	// A provider that ignores stream=true and answers with a regular JSON body
	// must keep working without deltas.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(contentResponse(`{"reply":"plain","suggestions":[]}`)))
	}))
	t.Cleanup(server.Close)

	request := openAIChatRequest{Model: "test", Stream: true}
	message, err := requestAIAgentMessageStream(context.Background(), testAISetting(server.URL), "key", request, server.Client(), nil)
	if err != nil {
		t.Fatalf("stream request failed: %v", err)
	}
	if !strings.Contains(message.Content, "plain") {
		t.Fatalf("unexpected content: %q", message.Content)
	}
}

func TestRunAIAgentConversationWithEventsStreamsStepsAndAnswer(t *testing.T) {
	ResetAIToolsUnsupportedCache()
	ResetAIStreamUnsupportedCache()
	t.Setenv("AI_AGENT_TOOLS", "true")
	t.Setenv("AI_AGENT_STREAM", "true")

	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		var frames []string
		if attempt == 1 {
			frames = []string{
				`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"count_products","arguments":"{}"}}]}}]}`,
				`data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
				`data: [DONE]`,
			}
		} else {
			frames = []string{
				`data: {"choices":[{"delta":{"content":"{\"reply\":\"完成"}}]}`,
				`data: {"choices":[{"delta":{"content":"了\"}"}}]}`,
				`data: [DONE]`,
			}
		}
		for _, frame := range frames {
			_, _ = w.Write([]byte(frame + "\n\n"))
			flusher.Flush()
		}
	}))
	t.Cleanup(server.Close)

	setting := testAISetting(server.URL)
	sink := &recordingSink{}
	content, trace, err := runAIAgentConversationWithEvents(context.Background(), setting, "key",
		[]aiChatMessage{{Role: "user", Content: "count active products"}}, 512, server.Client(), dryRunDB(t), sink, true)
	if err != nil {
		t.Fatalf("stream conversation failed: %v", err)
	}
	if !strings.Contains(content, "完成") {
		t.Fatalf("unexpected content: %s", content)
	}
	if len(trace) != 1 || trace[0].Tool != aiToolCountProducts {
		t.Fatalf("unexpected trace: %#v", trace)
	}
	if len(sink.steps) != 2 {
		t.Fatalf("expected a step start and a step end event, got %#v", sink.steps)
	}
	if got := strings.Join(sink.deltas, ""); got != "完成了" {
		t.Fatalf("streamed answer = %q", got)
	}
	if len(sink.stages) == 0 || sink.stages[len(sink.stages)-1] != "answering" {
		t.Fatalf("expected an answering stage, got %#v", sink.stages)
	}
}
