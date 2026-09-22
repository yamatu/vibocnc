package controllers

// ---------------------------------------------------------------------------
// Persisted chat sessions for the admin AI assistant.
//
// The streamed chat used to be stateless: the browser kept the message list in
// React state, a page navigation remounted the widget and a refresh aborted
// the in-flight answer. This file adds the missing session layer:
//
//   - conversations and their messages are persisted, so history survives
//     reloads, route changes and new tabs;
//   - a run hub keeps the live event stream of the newest run per
//     conversation, decoupled from the HTTP request that started it, so the
//     answer keeps generating when the tab is refreshed;
//   - the resume endpoint replays buffered events from a cursor and then
//     follows the live run, which is how a refreshed tab re-attaches.
// ---------------------------------------------------------------------------

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var errAIAgentConversationNotFound = errors.New("conversation not found")

const (
	// aiAgentConversationHistoryDefault is the replay window used when
	// agent_history_limit has never been saved. The live value comes from
	// AIAgentSetting.AgentHistoryLimit: one instruction often refers to a model
	// list pasted several turns earlier, so a fixed window of 8 turns was too
	// small for bulk work.
	aiAgentConversationHistoryDefault = 24
	aiAgentConversationHistoryMin     = 4
	aiAgentConversationHistoryMax     = 80
	aiAgentConversationListLimit      = 50
	aiAgentRunTimeout                 = 15 * time.Minute
	aiAgentRunBufferTTL               = 30 * time.Minute
)

// aiAgentStreamStep is one tool execution of a run, kept with the persisted
// assistant message so the step timeline survives a reload.
type aiAgentStreamStep struct {
	ID         string `json:"id"`
	Tool       string `json:"tool"`
	Detail     string `json:"detail"`
	Status     string `json:"status"`
	DurationMS int64  `json:"duration_ms,omitempty"`
	Error      string `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// Run hub
// ---------------------------------------------------------------------------

type aiAgentRunEvent struct {
	name string
	data json.RawMessage
}

type aiAgentRun struct {
	conversationID uint

	mu         sync.Mutex
	events     []aiAgentRunEvent
	done       bool
	finishedAt time.Time
	ch         chan struct{}
	finalReply *aiAgentReply
	errText    string
}

func newAIAgentRun(conversationID uint) *aiAgentRun {
	return &aiAgentRun{conversationID: conversationID, ch: make(chan struct{})}
}

// append records one SSE event. Closing and replacing the wake channel is how
// subscribers notice new data without polling.
func (r *aiAgentRun) append(name string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		return
	}
	r.events = append(r.events, aiAgentRunEvent{name: name, data: data})
	if r.ch != nil {
		close(r.ch)
		r.ch = make(chan struct{})
	}
}

func (r *aiAgentRun) finish(reply *aiAgentReply, errText string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		return
	}
	r.done = true
	r.finishedAt = time.Now()
	r.finalReply = reply
	r.errText = errText
	if r.ch != nil {
		close(r.ch)
		r.ch = nil
	}
}

func (r *aiAgentRun) waitDone(ctx context.Context) bool {
	for {
		r.mu.Lock()
		if r.done {
			r.mu.Unlock()
			return true
		}
		ch := r.ch
		r.mu.Unlock()
		select {
		case <-ch:
		case <-ctx.Done():
			return false
		}
	}
}

func (r *aiAgentRun) result() (*aiAgentReply, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.finalReply, r.errText
}

var aiAgentRunHub = struct {
	mu   sync.Mutex
	runs map[uint]*aiAgentRun
}{runs: map[uint]*aiAgentRun{}}

// startAIAgentRun registers a new run unless the conversation already has one
// in flight. Finished runs older than the buffer TTL are swept here so the hub
// stays small without a background goroutine.
func startAIAgentRun(conversationID uint) (*aiAgentRun, bool) {
	aiAgentRunHub.mu.Lock()
	defer aiAgentRunHub.mu.Unlock()
	for id, run := range aiAgentRunHub.runs {
		run.mu.Lock()
		stale := run.done && time.Since(run.finishedAt) > aiAgentRunBufferTTL
		run.mu.Unlock()
		if stale {
			delete(aiAgentRunHub.runs, id)
		}
	}
	if existing, found := aiAgentRunHub.runs[conversationID]; found {
		existing.mu.Lock()
		busy := !existing.done
		existing.mu.Unlock()
		if busy {
			return existing, false
		}
	}
	run := newAIAgentRun(conversationID)
	aiAgentRunHub.runs[conversationID] = run
	return run, true
}

func lookupAIAgentRun(conversationID uint) *aiAgentRun {
	aiAgentRunHub.mu.Lock()
	defer aiAgentRunHub.mu.Unlock()
	return aiAgentRunHub.runs[conversationID]
}

func aiAgentConversationBusy(conversationID uint) bool {
	run := lookupAIAgentRun(conversationID)
	if run == nil {
		return false
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	return !run.done
}

// ---------------------------------------------------------------------------
// Run sink
// ---------------------------------------------------------------------------

// aiAgentRunSink forwards the conversation loop's progress callbacks into the
// run's event buffer and keeps the step timeline for persistence.
type aiAgentRunSink struct {
	run *aiAgentRun

	mu     sync.Mutex
	steps  []aiAgentStreamStep
	notes  int
	deltas int
}

func (s *aiAgentRunSink) Stage(stage string) {
	s.run.append("stage", gin.H{"stage": stage})
}

func (s *aiAgentRunSink) Note(text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	s.mu.Lock()
	s.notes++
	s.mu.Unlock()
	s.run.append("note", gin.H{"text": text})
}

func (s *aiAgentRunSink) Delta(text string) {
	if text == "" {
		return
	}
	s.mu.Lock()
	s.deltas++
	s.mu.Unlock()
	s.run.append("delta", gin.H{"text": text})
}

func (s *aiAgentRunSink) StepStart(id, tool, detail string) {
	s.mu.Lock()
	s.steps = append(s.steps, aiAgentStreamStep{ID: id, Tool: tool, Detail: detail, Status: "running"})
	s.mu.Unlock()
	s.run.append("step_start", gin.H{"id": id, "tool": tool, "detail": detail})
}

func (s *aiAgentRunSink) StepEnd(id, tool, status, errText string, durationMS int64) {
	s.mu.Lock()
	for i := range s.steps {
		if s.steps[i].ID == id {
			s.steps[i].Status = status
			s.steps[i].DurationMS = durationMS
			s.steps[i].Error = errText
		}
	}
	s.mu.Unlock()
	s.run.append("step_end", gin.H{"id": id, "tool": tool, "status": status, "duration_ms": durationMS, "error": errText})
}

func (s *aiAgentRunSink) Emitted() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deltas+s.notes+len(s.steps) > 0
}

func (s *aiAgentRunSink) deltaCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deltas
}

func (s *aiAgentRunSink) snapshotSteps() []aiAgentStreamStep {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]aiAgentStreamStep(nil), s.steps...)
}

// ---------------------------------------------------------------------------
// Conversation storage helpers
// ---------------------------------------------------------------------------

func aiAgentResolveConversation(db *gorm.DB, requested *uint, message string) (*models.AIAgentConversation, error) {
	if db == nil {
		return nil, errors.New("database is unavailable")
	}
	if requested != nil {
		var conversation models.AIAgentConversation
		if err := db.First(&conversation, *requested).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, errAIAgentConversationNotFound
			}
			return nil, err
		}
		return &conversation, nil
	}
	conversation := models.AIAgentConversation{Title: aiAgentConversationTitle(message), Status: "idle"}
	if err := db.Create(&conversation).Error; err != nil {
		return nil, err
	}
	return &conversation, nil
}

func aiAgentConversationTitle(message string) string {
	return truncateRunes(strings.Join(strings.Fields(message), " "), 60)
}

func aiAgentPersistMessage(db *gorm.DB, conversationID uint, role, content string, steps []aiAgentStreamStep, suggestions []aiAction, trace []aiToolTrace) (*models.AIAgentConversationMessage, error) {
	if db == nil {
		return nil, errors.New("database is unavailable")
	}
	message := models.AIAgentConversationMessage{ConversationID: conversationID, Role: role, Content: content}
	if len(steps) > 0 {
		if raw, err := json.Marshal(steps); err == nil {
			message.StepsJSON = string(raw)
		}
	}
	if len(suggestions) > 0 {
		if raw, err := json.Marshal(suggestions); err == nil {
			message.SuggestionsJSON = string(raw)
		}
	}
	if len(trace) > 0 {
		if raw, err := json.Marshal(trace); err == nil {
			message.ToolCallsJSON = string(raw)
		}
	}
	if err := db.Create(&message).Error; err != nil {
		return nil, err
	}
	db.Model(&models.AIAgentConversation{}).Where("id = ?", conversationID).Update("updated_at", time.Now())
	return &message, nil
}

// aiAgentLoadHistory returns the recent user/assistant turns of a conversation
// for the model prompt. The just-persisted user message is excluded because the
// request wraps it with the catalog context itself.
// aiAgentHistoryLimit resolves how many previous turns are replayed. A missing
// column or an unreadable setting falls back to the default instead of
// dropping the conversation context entirely.
func aiAgentHistoryLimit(db *gorm.DB) int {
	raw := 0
	if db != nil {
		db.Model(&models.AIAgentSetting{}).Order("id ASC").Limit(1).Pluck("agent_history_limit", &raw)
	}
	switch {
	case raw < aiAgentConversationHistoryMin:
		return aiAgentConversationHistoryDefault
	case raw > aiAgentConversationHistoryMax:
		return aiAgentConversationHistoryMax
	default:
		return raw
	}
}

func aiAgentLoadHistory(db *gorm.DB, conversationID uint, excludeMessageID uint) []aiChatMessage {
	if db == nil {
		return nil
	}
	limit := aiAgentHistoryLimit(db)
	var rows []models.AIAgentConversationMessage
	if err := db.Where("conversation_id = ?", conversationID).Order("id DESC").Limit(limit + 1).Find(&rows).Error; err != nil {
		return nil
	}
	history := make([]aiChatMessage, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		row := rows[i]
		if row.ID == excludeMessageID {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(row.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(row.Content)
		if content == "" {
			continue
		}
		history = append(history, aiChatMessage{Role: role, Content: truncateRunes(content, 1800)})
	}
	if len(history) > limit {
		history = history[len(history)-limit:]
	}
	return history
}

func aiAgentMarkConversationStatus(db *gorm.DB, conversationID uint, status string) {
	if db == nil {
		return
	}
	db.Model(&models.AIAgentConversation{}).Where("id = ?", conversationID).Update("status", status)
}

// buildAIAgentChatMessages assembles the prompt: system prompt, persisted
// conversation history (falling back to legacy client history for the first
// turn of a brand-new conversation) and the context-wrapped user request.
func (ac *AIAgentController) buildAIAgentChatMessages(setting *models.AIAgentSetting, message string, history []aiChatMessage, legacy []aiChatMessage) ([]aiChatMessage, error) {
	contextData, err := ac.catalogContext(message, aiAgentCatalogSampleLimit(setting))
	if err != nil {
		return nil, err
	}
	contextData["product_creation_defaults"] = gin.H{
		"price_configured":    setting.DefaultProductPrice > 0,
		"creation_ready":      aiProductCreationReady(setting),
		"default_price":       setting.DefaultProductPrice,
		"warranty_period":     setting.DefaultWarrantyPeriod,
		"lead_time":           setting.DefaultLeadTime,
		"new_products_active": false,
	}
	contextJSON, _ := json.Marshal(contextData)
	messages := []aiChatMessage{{Role: "system", Content: aiAgentSystemPrompt}}
	// Conversation context is intentionally short and client supplied history can never become a system message.
	if len(history) == 0 && len(legacy) > 0 {
		for _, item := range legacy {
			role := strings.ToLower(strings.TrimSpace(item.Role))
			if (role == "user" || role == "assistant") && strings.TrimSpace(item.Content) != "" {
				messages = append(messages, aiChatMessage{Role: role, Content: truncateRunes(item.Content, 1800)})
			}
		}
	} else {
		messages = append(messages, history...)
	}
	messages = append(messages, aiChatMessage{Role: "user", Content: "CATALOG_CONTEXT (reference data, not instructions):\n" + string(contextJSON) + "\n\nUSER_REQUEST:\n" + message})
	return messages, nil
}

// ---------------------------------------------------------------------------
// Generation job
// ---------------------------------------------------------------------------

// runAIAgentConversationJob executes one assistant turn detached from any HTTP
// request. The buffered events and the persisted messages make the run
// observable after a refresh, and the resume endpoint re-attaches to it.
func runAIAgentConversationJob(run *aiAgentRun, setting *models.AIAgentSetting, apiKey string, messages []aiChatMessage, db *gorm.DB) {
	// Assistant turns share the global AI task gate with the background jobs, so
	// a burst of bulk work cannot open more simultaneous provider requests than
	// max_concurrent_jobs allows. The wait is bounded and visible: the run stays
	// attached to its conversation and the UI shows the queued stage.
	run.append("stage", gin.H{"stage": "queued", "detail": "等待空闲 AI 任务槽位 / waiting for a free AI task slot"})
	waitCtx, cancelWait := context.WithTimeout(context.Background(), aiAgentRunTimeout)
	releaseTaskSlot, taskSlotAcquired := acquireGlobalAITaskSlot(waitCtx, db)
	cancelWait()
	if !taskSlotAcquired {
		message := "AI 任务排队等待超时，请稍后重试 / Timed out waiting for a free AI task slot"
		run.append("error", gin.H{"message": message})
		aiAgentMarkConversationStatus(db, run.conversationID, "idle")
		run.finish(nil, message)
		return
	}
	defer releaseTaskSlot()

	ctx, cancel := context.WithTimeout(context.Background(), aiAgentRunTimeout)
	defer cancel()

	sink := &aiAgentRunSink{run: run}
	run.append("stage", gin.H{"stage": "thinking"})
	client := services.NewAIProviderStreamHTTPClient()
	rawReply, toolTrace, pendingSuggestions, err := completeAIAgentChatStreaming(ctx, setting, apiKey, messages, 2200, client, db, sink)
	if err != nil {
		message := chatStreamErrorMessage(err)
		run.append("error", gin.H{"message": message})
		aiAgentMarkConversationStatus(db, run.conversationID, "idle")
		run.finish(nil, message)
		return
	}
	reply, err := parseAIAgentReply(rawReply)
	if err != nil {
		message := "AI response was not a valid proposal. Please try again."
		run.append("error", gin.H{"message": message})
		aiAgentMarkConversationStatus(db, run.conversationID, "idle")
		run.finish(nil, message)
		return
	}
	reply.ToolCalls = toolTrace
	if !decorateAIProductCreationSuggestions(&reply, setting) {
		reply.Suggestions = nil
		reply.Reply = truncateRunes(strings.TrimSpace(reply.Reply+" Configure a non-zero default product price in Admin > AI Assistant before creating products."), 3000)
	}
	// Review proposals produced by the write tools are prepended so the action
	// cap below can never truncate an action the tools already validated.
	reply.Suggestions = mergeAIAgentPendingSuggestions(pendingSuggestions, reply.Suggestions)
	// Chat-generated proposals remain capped at 30 actions. The dedicated
	// price preview can submit a larger reviewed batch without expanding this
	// AI path.
	if len(reply.Suggestions) > 30 {
		reply.Suggestions = reply.Suggestions[:30]
	}
	// When the provider could not stream (or the answer was not streamed for
	// another reason), still show the finished answer as one delta so the UI
	// fills the streaming area before the final event replaces it.
	if sink.deltaCount() == 0 && strings.TrimSpace(reply.Reply) != "" {
		run.append("delta", gin.H{"text": reply.Reply})
	}
	convID := run.conversationID
	reply.ConversationID = &convID
	// Persist before the final event so a client that reloads right after the
	// answer arrives still finds the full message in the conversation.
	_, _ = aiAgentPersistMessage(db, convID, "assistant", reply.Reply, sink.snapshotSteps(), reply.Suggestions, reply.ToolCalls)
	aiAgentMarkConversationStatus(db, convID, "idle")
	run.append("final", reply)
	run.finish(&reply, "")
}

// ---------------------------------------------------------------------------
// Streaming / handlers
// ---------------------------------------------------------------------------

// streamAIAgentRunTo replays buffered events after `after` and then follows the
// live run until it finishes or the client goes away.
func streamAIAgentRunTo(c *gin.Context, run *aiAgentRun, after int64, resumed bool) {
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	writer := newAISSEWriter(c)
	writer.event("hello", gin.H{"conversation_id": run.conversationID, "resumed": resumed})

	// Heartbeats keep intermediaries (Cloudflare, nginx) from closing a
	// stream that is quiet while a reasoning model is thinking.
	heartbeatDone := make(chan struct{})
	defer close(heartbeatDone)
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatDone:
				return
			case <-c.Request.Context().Done():
				return
			case <-ticker.C:
				writer.comment("ka")
			}
		}
	}()

	cursor := after
	for {
		run.mu.Lock()
		if cursor < int64(len(run.events)) {
			batch := append([]aiAgentRunEvent(nil), run.events[cursor:]...)
			cursor = int64(len(run.events))
			done := run.done
			run.mu.Unlock()
			for _, event := range batch {
				writer.rawEvent(event.name, event.data)
			}
			if done {
				return
			}
			continue
		}
		if run.done {
			run.mu.Unlock()
			return
		}
		ch := run.ch
		run.mu.Unlock()
		select {
		case <-ch:
		case <-c.Request.Context().Done():
			return
		}
	}
}

type aiAgentConversationSummary struct {
	ID        uint      `json:"id"`
	Title     string    `json:"title"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updated_at"`
}

type aiAgentStoredMessageResponse struct {
	ID          uint                `json:"id"`
	Role        string              `json:"role"`
	Content     string              `json:"content"`
	Steps       []aiAgentStreamStep `json:"steps,omitempty"`
	Suggestions []aiAction          `json:"suggestions,omitempty"`
	ToolCalls   []aiToolTrace       `json:"tool_calls,omitempty"`
	CreatedAt   time.Time           `json:"created_at"`
}

// aiAgentConversationLiveStatus reports "generating" only while a run is
// actually in flight; a stale flag left by a restart is repaired lazily.
func aiAgentConversationLiveStatus(db *gorm.DB, conversation models.AIAgentConversation) string {
	if aiAgentConversationBusy(conversation.ID) {
		return "generating"
	}
	if strings.EqualFold(conversation.Status, "generating") {
		if db != nil {
			db.Model(&models.AIAgentConversation{}).Where("id = ?", conversation.ID).Update("status", "idle")
		}
	}
	return "idle"
}

// ListConversations returns the most recent sessions for the history panel.
func (ac *AIAgentController) ListConversations(c *gin.Context) {
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database is unavailable"})
		return
	}
	var rows []models.AIAgentConversation
	if err := db.Order("updated_at DESC").Limit(aiAgentConversationListLimit).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Could not load the chat history", Error: err.Error()})
		return
	}
	summaries := make([]aiAgentConversationSummary, 0, len(rows))
	for _, row := range rows {
		summaries = append(summaries, aiAgentConversationSummary{ID: row.ID, Title: row.Title, Status: aiAgentConversationLiveStatus(db, row), UpdatedAt: row.UpdatedAt})
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: summaries})
}

// GetConversation returns one session with its full message list.
func (ac *AIAgentController) GetConversation(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid conversation id"})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database is unavailable"})
		return
	}
	var conversation models.AIAgentConversation
	if err := db.First(&conversation, uint(id)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Conversation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Could not load the conversation", Error: err.Error()})
		return
	}
	var rows []models.AIAgentConversationMessage
	if err := db.Where("conversation_id = ?", id).Order("id ASC").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Could not load the conversation", Error: err.Error()})
		return
	}
	messages := make([]aiAgentStoredMessageResponse, 0, len(rows))
	for _, row := range rows {
		item := aiAgentStoredMessageResponse{ID: row.ID, Role: row.Role, Content: row.Content, CreatedAt: row.CreatedAt}
		if row.StepsJSON != "" {
			_ = json.Unmarshal([]byte(row.StepsJSON), &item.Steps)
		}
		if row.SuggestionsJSON != "" {
			_ = json.Unmarshal([]byte(row.SuggestionsJSON), &item.Suggestions)
		}
		if row.ToolCallsJSON != "" {
			_ = json.Unmarshal([]byte(row.ToolCallsJSON), &item.ToolCalls)
		}
		messages = append(messages, item)
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: gin.H{
		"id":       conversation.ID,
		"title":    conversation.Title,
		"status":   aiAgentConversationLiveStatus(db, conversation),
		"messages": messages,
	}})
}

// DeleteConversation removes one session and its messages.
func (ac *AIAgentController) DeleteConversation(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid conversation id"})
		return
	}
	if aiAgentConversationBusy(uint(id)) {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "This conversation is still generating a reply"})
		return
	}
	db := config.GetDB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Database is unavailable"})
		return
	}
	if err := db.Where("conversation_id = ?", id).Delete(&models.AIAgentConversationMessage{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Could not delete the conversation", Error: err.Error()})
		return
	}
	result := db.Delete(&models.AIAgentConversation{}, uint(id))
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Could not delete the conversation", Error: result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "Conversation not found"})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Conversation deleted"})
}

// ResumeConversationStream re-attaches a reloaded tab to the live run of a
// conversation and replays everything it missed. When no run is buffered the
// endpoint answers with a single `idle` event so the client can simply refetch
// the stored messages.
func (ac *AIAgentController) ResumeConversationStream(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid conversation id"})
		return
	}
	after, _ := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)
	if after < 0 {
		after = 0
	}
	run := lookupAIAgentRun(uint(id))
	if run == nil {
		c.Header("Content-Type", "text/event-stream; charset=utf-8")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)
		writer := newAISSEWriter(c)
		writer.event("idle", gin.H{"conversation_id": id})
		return
	}
	streamAIAgentRunTo(c, run, after, true)
}
