package controllers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAIAgentConversationTitle(t *testing.T) {
	title := aiAgentConversationTitle("  A06B-6111   伺服驱动器   SEO  ")
	if title != "A06B-6111 伺服驱动器 SEO" {
		t.Fatalf("title = %q", title)
	}
	long := strings.Repeat("型", 200)
	if got := aiAgentConversationTitle(long); len([]rune(got)) != 60 {
		t.Fatalf("long title runes = %d, want 60", len([]rune(got)))
	}
}

func TestAIAgentRunReplayAndFinish(t *testing.T) {
	run := newAIAgentRun(7)
	run.append("stage", gin.H{"stage": "thinking"})
	run.append("delta", gin.H{"text": "你"})
	run.append("delta", gin.H{"text": "好"})

	run.mu.Lock()
	if len(run.events) != 3 {
		run.mu.Unlock()
		t.Fatalf("events = %d, want 3", len(run.events))
	}
	run.mu.Unlock()

	run.finish(nil, "")
	if !run.waitDone(context.Background()) {
		t.Fatal("waitDone returned false after finish")
	}
	if reply, errText := run.result(); reply != nil || errText != "" {
		t.Fatalf("result = (%v, %q), want empty", reply, errText)
	}

	// Events appended after the run finished must be ignored so the replayed
	// stream stays stable for late subscribers.
	run.append("delta", gin.H{"text": "late"})
	run.mu.Lock()
	count := len(run.events)
	run.mu.Unlock()
	if count != 3 {
		t.Fatalf("events after late append = %d, want 3", count)
	}
}

func TestAIAgentRunSinkTracksStepsAndDeltas(t *testing.T) {
	run := newAIAgentRun(1)
	sink := &aiAgentRunSink{run: run}
	sink.Stage("thinking")
	sink.StepStart("0-1", "search_products", "A06B")
	sink.StepEnd("0-1", "search_products", "ok", "", 420)
	sink.Delta("hello")
	sink.Note("查一下")

	steps := sink.snapshotSteps()
	if len(steps) != 1 || steps[0].Status != "ok" || steps[0].DurationMS != 420 || steps[0].Tool != "search_products" {
		t.Fatalf("steps = %#v", steps)
	}
	if sink.deltaCount() != 1 || !sink.Emitted() {
		t.Fatalf("deltaCount = %d, emitted = %v", sink.deltaCount(), sink.Emitted())
	}
	run.mu.Lock()
	eventCount := len(run.events)
	run.mu.Unlock()
	if eventCount != 5 {
		t.Fatalf("events = %d, want 5", eventCount)
	}
}

func TestStartAIAgentRunRejectsBusyConversation(t *testing.T) {
	run, ok := startAIAgentRun(99)
	if !ok {
		t.Fatal("first start must succeed")
	}
	if _, ok := startAIAgentRun(99); ok {
		t.Fatal("second start must report busy")
	}
	if !aiAgentConversationBusy(99) {
		t.Fatal("conversation must report busy while its run is in flight")
	}
	run.finish(nil, "")
	if aiAgentConversationBusy(99) {
		t.Fatal("conversation must be idle after finish")
	}
	replacement, ok := startAIAgentRun(99)
	if !ok || replacement == run {
		t.Fatal("a finished run must be replaceable")
	}
	replacement.finish(nil, "")
	aiAgentRunHub.mu.Lock()
	delete(aiAgentRunHub.runs, 99)
	aiAgentRunHub.mu.Unlock()
}

func TestStreamAIAgentRunToReplaysBufferedEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	run := newAIAgentRun(5)
	run.append("stage", gin.H{"stage": "thinking"})
	run.append("delta", gin.H{"text": "hi"})
	run.finish(nil, "")

	writer := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(writer)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	streamAIAgentRunTo(c, run, 0, true)

	body := writer.Body.String()
	if !strings.Contains(body, "event: hello") {
		t.Fatalf("missing hello event in %q", body)
	}
	if !strings.Contains(body, "event: stage") || !strings.Contains(body, "event: delta") {
		t.Fatalf("missing replayed events in %q", body)
	}
	if !strings.Contains(body, `"resumed":true`) {
		t.Fatalf("hello must mark the stream as resumed in %q", body)
	}
}

func TestStreamAIAgentRunToHonoursCursor(t *testing.T) {
	gin.SetMode(gin.TestMode)
	run := newAIAgentRun(6)
	run.append("stage", gin.H{"stage": "thinking"})
	run.append("delta", gin.H{"text": "first"})
	run.append("delta", gin.H{"text": "second"})
	run.finish(nil, "")

	writer := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(writer)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	// Cursor 2 means the first two events are already displayed; only the
	// remaining delta may replay.
	streamAIAgentRunTo(c, run, 2, true)

	body := writer.Body.String()
	if strings.Contains(body, `"first"`) || strings.Contains(body, `"thinking"`) {
		t.Fatalf("events before the cursor must not replay: %q", body)
	}
	if !strings.Contains(body, `"second"`) {
		t.Fatalf("events after the cursor must replay: %q", body)
	}
}
