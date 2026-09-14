package controllers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"fanuc-backend/models"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// dryRunDB returns a GORM handle that renders SQL without touching a server.
// Tool executors therefore return empty result sets, which is exactly what is
// needed to exercise the loop and the SQL they build.
func dryRunDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       "user:password@tcp(localhost:3306)/test?charset=utf8mb4&parseTime=True&loc=Local",
		SkipInitializeWithVersion: true,
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatalf("open dry-run database: %v", err)
	}
	return db
}

func TestIsAIAgentToolNameRejectsUnknownTools(t *testing.T) {
	for _, allowed := range aiAgentToolNames() {
		if !isAIAgentToolName(allowed) {
			t.Fatalf("allow-listed tool %q was rejected", allowed)
		}
	}
	for _, blocked := range []string{"", "execute_sql", "apply", "delete_product", "Search_Products"} {
		if isAIAgentToolName(blocked) {
			t.Fatalf("tool %q must not be executable", blocked)
		}
	}
}

func TestExecuteAIAgentToolCallValidatesArguments(t *testing.T) {
	db := dryRunDB(t)

	if _, err := executeAIAgentToolCall(db, aiToolCall{Function: aiToolCallFunction{Name: "drop_table", Arguments: "{}"}}); err == nil {
		t.Fatal("an unknown tool must be rejected")
	}
	if _, err := executeAIAgentToolCall(db, aiToolCall{Function: aiToolCallFunction{Name: aiToolSearchProducts, Arguments: "{not json"}}); err == nil {
		t.Fatal("malformed arguments must be rejected")
	}
	if _, err := executeAIAgentToolCall(db, aiToolCall{Function: aiToolCallFunction{
		Name:      aiToolSearchProducts,
		Arguments: `{"query":"` + strings.Repeat("a", aiAgentMaxToolArgumentBytes+1) + `"}`,
	}}); err == nil {
		t.Fatal("oversized arguments must be rejected")
	}
}

func TestAIAgentProductFilterRejectsUnknownMissingField(t *testing.T) {
	db := dryRunDB(t)
	_, err := executeAIAgentTool(db, aiToolSearchProducts, `{"missing":"password_hash"}`)
	if err == nil {
		t.Fatal("an unknown missing field must not reach the query builder")
	}
}

func TestAIAgentProductFilterRejectsInventedCategory(t *testing.T) {
	db := dryRunDB(t)
	// The dry run never returns rows, so any category id looks non-existent and
	// the tool must refuse instead of filtering on an invented id.
	if _, err := executeAIAgentTool(db, aiToolCountProducts, `{"category_id":4242}`); err == nil {
		t.Fatal("an unverifiable category id must be rejected")
	}
}

func TestAIAgentMissingFieldProducesEmptyColumnPredicate(t *testing.T) {
	db := dryRunDB(t)
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		query, err := (aiAgentProductFilter{Missing: "meta_title"}).apply(tx.Model(&models.Product{}))
		if err != nil {
			t.Fatalf("filter failed: %v", err)
		}
		return query.Find(&[]models.Product{})
	})
	if !strings.Contains(sql, "TRIM(COALESCE(meta_title, '')) = ''") {
		t.Fatalf("missing-field predicate absent from SQL: %s", sql)
	}
}

func TestNormalizeAIAgentLimitClampsToSchema(t *testing.T) {
	if got := normalizeAIAgentLimit(0); got != aiToolDefaultLimit {
		t.Fatalf("default limit = %d, want %d", got, aiToolDefaultLimit)
	}
	if got := normalizeAIAgentLimit(-5); got != aiToolDefaultLimit {
		t.Fatalf("negative limit = %d, want %d", got, aiToolDefaultLimit)
	}
	if got := normalizeAIAgentLimit(1000); got != aiToolMaxLimit {
		t.Fatalf("oversized limit = %d, want %d", got, aiToolMaxLimit)
	}
	if got := normalizeAIAgentLimit(7); got != 7 {
		t.Fatalf("in-range limit = %d, want 7", got)
	}
}

func TestLooksLikeUnsupportedTools(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		expect bool
	}{
		{"not found", &aiProviderHTTPError{StatusCode: http.StatusNotFound, Body: "not found"}, true},
		{"not implemented", &aiProviderHTTPError{StatusCode: http.StatusNotImplemented, Body: "nope"}, true},
		{"unprocessable", &aiProviderHTTPError{StatusCode: http.StatusUnprocessableEntity, Body: "invalid"}, true},
		{"bad request mentioning tools", &aiProviderHTTPError{StatusCode: http.StatusBadRequest, Body: `{"error":{"message":"Unrecognized request argument supplied: tools"}}`}, true},
		{"bad request mentioning functions", &aiProviderHTTPError{StatusCode: http.StatusBadRequest, Body: `{"error":{"message":"functions is not supported"}}`}, true},
		{"bad request about context length", &aiProviderHTTPError{StatusCode: http.StatusBadRequest, Body: `{"error":{"message":"maximum context length exceeded"}}`}, false},
		{"unauthorized", &aiProviderHTTPError{StatusCode: http.StatusUnauthorized, Body: "bad key"}, false},
		{"transport error", context.DeadlineExceeded, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := looksLikeUnsupportedTools(test.err); got != test.expect {
				t.Fatalf("looksLikeUnsupportedTools = %v, want %v", got, test.expect)
			}
		})
	}
}

// fakeChatProvider answers chat completions from a scripted queue of JSON
// bodies, so the loop can be exercised without a real provider.
func fakeChatProvider(t *testing.T, responses []string, status int) (*httptest.Server, *[]string) {
	t.Helper()
	var requests []string
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, string(body))
		index := int(atomic.AddInt32(&calls, 1)) - 1
		if index >= len(responses) {
			index = len(responses) - 1
		}
		w.Header().Set("Content-Type", "application/json")
		if status != http.StatusOK {
			w.WriteHeader(status)
		}
		_, _ = w.Write([]byte(responses[index]))
	}))
	t.Cleanup(server.Close)
	return server, &requests
}

func toolCallResponse(id, name, arguments string) string {
	payload := map[string]any{"choices": []map[string]any{{
		"index": 0,
		"message": map[string]any{
			"role":    "assistant",
			"content": "",
			"tool_calls": []map[string]any{{
				"id": id, "type": "function",
				"function": map[string]any{"name": name, "arguments": arguments},
			}},
		},
		"finish_reason": "tool_calls",
	}}}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func contentResponse(content string) string {
	payload := map[string]any{"choices": []map[string]any{{
		"index":         0,
		"message":       map[string]any{"role": "assistant", "content": content},
		"finish_reason": "stop",
	}}}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func testAISetting(baseURL string) *models.AIAgentSetting {
	return &models.AIAgentSetting{BaseURL: baseURL, Model: "test-model", APIMode: aiAgentAPIModeStandard, TimeoutSeconds: 5}
}

func TestRunAIAgentConversationFeedsToolResultsBack(t *testing.T) {
	ResetAIToolsUnsupportedCache()
	t.Setenv("AI_AGENT_TOOLS", "true")

	server, requests := fakeChatProvider(t, []string{
		toolCallResponse("call_1", aiToolCountProducts, `{"only_active":true}`),
		contentResponse(`{"reply":"ok","suggestions":[]}`),
	}, http.StatusOK)

	setting := testAISetting(server.URL)
	messages := []aiChatMessage{{Role: "system", Content: "system"}, {Role: "user", Content: "request"}}
	content, trace, err := runAIAgentConversation(context.Background(), setting, "key", messages, 512, server.Client(), dryRunDB(t))
	if err != nil {
		t.Fatalf("conversation failed: %v", err)
	}
	if !strings.Contains(content, `"reply":"ok"`) {
		t.Fatalf("unexpected final content: %s", content)
	}
	if len(trace) != 1 || trace[0].Tool != aiToolCountProducts {
		t.Fatalf("expected one recorded tool call, got %#v", trace)
	}
	if len(*requests) != 2 {
		t.Fatalf("expected two provider requests, got %d", len(*requests))
	}
	// The second request must replay the assistant tool call and its result, or
	// the provider rejects the conversation as malformed.
	if !strings.Contains((*requests)[1], `"tool_call_id":"call_1"`) {
		t.Fatalf("tool result was not replayed to the provider: %s", (*requests)[1])
	}
	if !strings.Contains((*requests)[1], `"tools"`) {
		t.Fatalf("tool definitions missing from request: %s", (*requests)[1])
	}
}

func TestRunAIAgentConversationForcesFinalAnswerOnLastTurn(t *testing.T) {
	ResetAIToolsUnsupportedCache()
	t.Setenv("AI_AGENT_TOOLS", "true")

	// Always answer with a tool call: the loop must cut it off and force a final
	// answer instead of looping until the provider budget runs out.
	responses := make([]string, 0, aiAgentMaxToolTurns+1)
	for i := 0; i < aiAgentMaxToolTurns+1; i++ {
		responses = append(responses, toolCallResponse("call", aiToolCountProducts, "{}"))
	}
	responses[aiAgentMaxToolTurns] = contentResponse(`{"reply":"final","suggestions":[]}`)
	server, requests := fakeChatProvider(t, responses, http.StatusOK)

	setting := testAISetting(server.URL)
	content, _, err := runAIAgentConversation(context.Background(), setting, "key", []aiChatMessage{{Role: "user", Content: "x"}}, 512, server.Client(), dryRunDB(t))
	if err != nil {
		t.Fatalf("conversation failed: %v", err)
	}
	if !strings.Contains(content, `"reply":"final"`) {
		t.Fatalf("unexpected final content: %s", content)
	}
	if len(*requests) > aiAgentMaxToolTurns+1 {
		t.Fatalf("loop exceeded its turn budget: %d requests", len(*requests))
	}
	if !strings.Contains((*requests)[len(*requests)-1], `"tool_choice":"none"`) {
		t.Fatalf("final request must disable tool choice: %s", (*requests)[len(*requests)-1])
	}
}

func TestCompleteAIAgentChatFallsBackWhenProviderRejectsTools(t *testing.T) {
	ResetAIToolsUnsupportedCache()
	t.Setenv("AI_AGENT_TOOLS", "true")

	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := atomic.AddInt32(&calls, 1)
		if attempt == 1 {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"Unrecognized request argument supplied: tools"}}`))
			return
		}
		_, _ = w.Write([]byte(contentResponse(`{"reply":"fallback","suggestions":[]}`)))
	}))
	t.Cleanup(server.Close)

	setting := testAISetting(server.URL)
	content, trace, err := completeAIAgentChat(context.Background(), setting, "key",
		[]aiChatMessage{{Role: "user", Content: "x"}}, 512, server.Client(), dryRunDB(t))
	if err != nil {
		t.Fatalf("fallback failed: %v", err)
	}
	if !strings.Contains(content, "fallback") {
		t.Fatalf("unexpected content: %s", content)
	}
	if trace != nil {
		t.Fatalf("fallback must not report tool calls, got %#v", trace)
	}
	if !aiToolsUnsupportedFor(setting) {
		t.Fatal("provider must be remembered as tool-unsupported")
	}
	// The second call must skip tools entirely rather than pay another failure.
	before := atomic.LoadInt32(&calls)
	if _, _, err := completeAIAgentChat(context.Background(), setting, "key",
		[]aiChatMessage{{Role: "user", Content: "x"}}, 512, server.Client(), dryRunDB(t)); err != nil {
		t.Fatalf("second fallback failed: %v", err)
	}
	if atomic.LoadInt32(&calls) != before+1 {
		t.Fatalf("tool-unsupported provider should need exactly one request per call, got %d extra", atomic.LoadInt32(&calls)-before)
	}
}

func TestCompleteAIAgentChatHonoursKillSwitch(t *testing.T) {
	ResetAIToolsUnsupportedCache()
	t.Setenv("AI_AGENT_TOOLS", "false")

	server, requests := fakeChatProvider(t, []string{contentResponse(`{"reply":"plain","suggestions":[]}`)}, http.StatusOK)
	setting := testAISetting(server.URL)
	content, trace, err := completeAIAgentChat(context.Background(), setting, "key",
		[]aiChatMessage{{Role: "user", Content: "x"}}, 512, server.Client(), dryRunDB(t))
	if err != nil {
		t.Fatalf("kill switch path failed: %v", err)
	}
	if !strings.Contains(content, "plain") || trace != nil {
		t.Fatalf("kill switch must use the single-shot path, got content=%s trace=%#v", content, trace)
	}
	if strings.Contains((*requests)[0], `"tools"`) {
		t.Fatalf("kill switch must not advertise tools: %s", (*requests)[0])
	}
}

func TestAIAgentToolPromptAddendumKeepsProposalContract(t *testing.T) {
	// The tool loop must not relax the safety contract: it still demands the
	// single JSON proposal object that Apply revalidates.
	for _, marker := range []string{"read-only", "untrusted", "Never invent", "single JSON object"} {
		if !strings.Contains(aiAgentToolPromptAddendum, marker) {
			t.Fatalf("tool prompt lost the %q guardrail", marker)
		}
	}
}

func TestCatalogSearchTermsKeepsEveryIdentifier(t *testing.T) {
	// The seed snapshot used to be built from one token, so a request naming two
	// part numbers showed the assistant only half of what it asked about.
	terms := catalogSearchTerms("please correct A06B-6111-H002 and A06B-6111-H003 category")
	if len(terms) != 2 {
		t.Fatalf("expected both part numbers, got %#v", terms)
	}
	if terms[0] != "A06B-6111-H002" || terms[1] != "A06B-6111-H003" {
		t.Fatalf("unexpected token order: %#v", terms)
	}
}

func TestCatalogSearchTermsPrefersIdentifiersOverProse(t *testing.T) {
	// "PLEASE" and "CATEGORY" are long enough to look like search terms. Spending
	// the budget on them would hide the actual identifier.
	terms := catalogSearchTerms("PLEASE UPDATE THE CATEGORY FOR A06B-6111-H002")
	if len(terms) != 1 || terms[0] != "A06B-6111-H002" {
		t.Fatalf("expected only the identifier, got %#v", terms)
	}
}

func TestCatalogSearchTermsFallsBackToRecentProducts(t *testing.T) {
	// With no identifier there is nothing reliable to seed, so the snapshot falls
	// back to recent products and the assistant uses search_products instead.
	if terms := catalogSearchTerms("show me the servo amplifier products"); len(terms) != 0 {
		t.Fatalf("prose must not be treated as an identifier, got %#v", terms)
	}
}

func TestCatalogSearchTermsDeduplicatesAndCaps(t *testing.T) {
	terms := catalogSearchTerms("A061 A062 A063 A064 A065 A061")
	if len(terms) != aiCatalogSeedMaxTerms {
		t.Fatalf("expected the token count to be capped at %d, got %#v", aiCatalogSeedMaxTerms, terms)
	}
	seen := map[string]bool{}
	for _, term := range terms {
		if seen[term] {
			t.Fatalf("duplicate token %q in %#v", term, terms)
		}
		seen[term] = true
	}
}

func TestCatalogSearchTermsIgnoresShortPunctuationOnlyInput(t *testing.T) {
	if terms := catalogSearchTerms("fix the SEO, please!!"); len(terms) != 0 {
		t.Fatalf("words without digits must be ignored, got %#v", terms)
	}
	if terms := catalogSearchTerms("a b c 1 2 3"); len(terms) != 0 {
		t.Fatalf("short tokens must be ignored, got %#v", terms)
	}
}
