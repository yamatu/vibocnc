package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"io"
	"net/http"
	"strings"
	"testing"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func stringPointer(value string) *string {
	return &value
}

func TestNormalizeAIAgentModelAcceptsCustomProviderIdentifiers(t *testing.T) {
	model, err := normalizeAIAgentModel("openrouter/vendor/model-v2.1:free")
	if err != nil {
		t.Fatalf("custom model should be accepted: %v", err)
	}
	if model != "openrouter/vendor/model-v2.1:free" {
		t.Fatalf("custom model changed unexpectedly: %q", model)
	}
	for _, invalid := range []string{"", "model with spaces", "model\nname", strings.Repeat("a", 121)} {
		if _, err := normalizeAIAgentModel(invalid); err == nil {
			t.Fatalf("invalid custom model %q was accepted", invalid)
		}
	}
}

func TestNormalizeAIAgentReasoningEffortAllowsSafeCustomValues(t *testing.T) {
	for input, expected := range map[string]string{
		"":                 "",
		" XHIGH ":          "xhigh",
		"deep_think-2026":  "deep_think-2026",
		"provider_level_9": "provider_level_9",
	} {
		value, err := normalizeAIAgentReasoningEffort(input)
		if err != nil || value != expected {
			t.Fatalf("normalize reasoning effort %q = %q, %v; want %q", input, value, err, expected)
		}
	}
	for _, invalid := range []string{"two words", "high/slow", strings.Repeat("a", 33)} {
		if _, err := normalizeAIAgentReasoningEffort(invalid); err == nil {
			t.Fatalf("invalid reasoning effort %q was accepted", invalid)
		}
	}
}

func TestNormalizeAIAgentAPIMode(t *testing.T) {
	for _, value := range []string{aiAgentAPIModeStandard, aiAgentAPIModeReasoning} {
		if normalized, err := normalizeAIAgentAPIMode(value); err != nil || normalized != value {
			t.Fatalf("normalize API mode %q = %q, %v", value, normalized, err)
		}
	}
	if _, err := normalizeAIAgentAPIMode("auto"); err == nil {
		t.Fatal("unsupported API mode was accepted")
	}
}

func TestNormalizeAIAgentBaseURL(t *testing.T) {
	value, err := normalizeAIAgentBaseURL(" https://api.example.com/v1/ ")
	if err != nil || value != "https://api.example.com/v1" {
		t.Fatalf("normalized URL = %q, %v", value, err)
	}
	for _, invalid := range []string{
		"https://user:pass@api.example.com/v1",
		"https://api.example.com/v1?token=secret",
		"https://api.example.com/v1#fragment",
		"file:///tmp/provider",
	} {
		if _, err := normalizeAIAgentBaseURL(invalid); err == nil {
			t.Fatalf("unsafe or malformed URL %q was accepted", invalid)
		}
	}
	customPort, err := normalizeAIAgentBaseURL("https://api.example.com:8443/v1")
	if err != nil || customPort != "https://api.example.com:8443/v1" {
		t.Fatalf("OpenAI-compatible custom port was rejected: %q, %v", customPort, err)
	}
}

func TestAIAgentProviderOriginProtectsCrossProviderKeyReuse(t *testing.T) {
	openAI := aiAgentProviderOrigin("https://api.openai.com/v1")
	if openAI != aiAgentProviderOrigin("https://api.openai.com/compatible/v1") {
		t.Fatal("paths on the same provider origin should be compatible")
	}
	if openAI != aiAgentProviderOrigin("https://api.openai.com:443/v1") {
		t.Fatal("an explicit default HTTPS port should resolve to the same provider origin")
	}
	if aiAgentProviderOrigin("http://provider.example/v1") != aiAgentProviderOrigin("http://provider.example:80/v1") {
		t.Fatal("an explicit default HTTP port should resolve to the same provider origin")
	}
	if openAI == aiAgentProviderOrigin("https://openrouter.ai/api/v1") {
		t.Fatal("different provider hosts must not share credentials")
	}
	if openAI == aiAgentProviderOrigin("http://api.openai.com/v1") {
		t.Fatal("different provider schemes must not share credentials")
	}
	if openAI == aiAgentProviderOrigin("https://api.openai.com:8443/v1") {
		t.Fatal("a non-default port must remain a distinct provider origin")
	}
}

func TestApplyAIAgentProfileMutationKeepsOrReplacesEncryptedKey(t *testing.T) {
	t.Setenv("SETTINGS_ENCRYPTION_KEY", "12345678901234567890123456789012")
	profile := models.AIAgentProfile{APIKeyEnc: "existing-ciphertext"}
	if err := applyAIAgentProfileMutation(&profile, aiAgentProfileMutationRequest{APIKey: stringPointer("")}, false); err != nil {
		t.Fatalf("blank key update failed: %v", err)
	}
	if profile.APIKeyEnc != "existing-ciphertext" {
		t.Fatal("blank API key must preserve the saved credential")
	}
	if err := applyAIAgentProfileMutation(&profile, aiAgentProfileMutationRequest{APIKey: stringPointer("new-secret")}, false); err != nil {
		t.Fatalf("new key update failed: %v", err)
	}
	plain, err := utils.DecryptSecret(profile.APIKeyEnc)
	if err != nil || plain != "new-secret" {
		t.Fatalf("saved key did not decrypt to the replacement: %q, %v", plain, err)
	}
	if err := applyAIAgentProfileMutation(&profile, aiAgentProfileMutationRequest{ClearAPIKey: true}, false); err != nil {
		t.Fatalf("clear key update failed: %v", err)
	}
	if profile.APIKeyEnc != "" {
		t.Fatal("clear_api_key must remove the credential")
	}
}

func TestCopyAIAgentProfileToSettingPreservesGlobalValues(t *testing.T) {
	setting := models.AIAgentSetting{SEOJobConcurrency: 12, DefaultProductPrice: 55.5}
	profile := models.AIAgentProfile{BaseURL: "https://provider.example/v1", APIKeyEnc: "ciphertext", Model: "vendor/model", ReasoningEffort: "custom_level", TimeoutSeconds: 90}
	copyAIAgentProfileToSetting(&setting, &profile)
	if setting.Model != profile.Model || setting.BaseURL != profile.BaseURL || setting.ReasoningEffort != profile.ReasoningEffort {
		t.Fatalf("provider fields were not copied: %#v", setting)
	}
	if setting.SEOJobConcurrency != 12 || setting.DefaultProductPrice != 55.5 {
		t.Fatalf("profile copy changed singleton business settings: %#v", setting)
	}
}

func TestScopeActiveAIAgentSEOJobsSupportsLegacySchema(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       "user:password@tcp(localhost:3306)/test?charset=utf8mb4&parseTime=True&loc=Local",
		SkipInitializeWithVersion: true,
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatalf("open dry-run database: %v", err)
	}

	for _, test := range []struct {
		name               string
		hasProfileIDColumn bool
		wantProfileScope   bool
	}{
		{name: "current schema", hasProfileIDColumn: true, wantProfileScope: true},
		{name: "legacy schema", hasProfileIDColumn: false, wantProfileScope: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
				return scopeActiveAIAgentSEOJobs(tx.Model(&models.AIAgentSEOJob{}), 7, test.hasProfileIDColumn).
					Find(&[]models.AIAgentSEOJob{})
			})
			hasProfileScope := strings.Contains(sql, "ai_profile_id = 7")
			if hasProfileScope != test.wantProfileScope {
				t.Fatalf("profile scope mismatch: SQL = %s", sql)
			}
			if !strings.Contains(sql, "status IN ('queued','running','paused')") {
				t.Fatalf("active status scope missing: SQL = %s", sql)
			}
		})
	}
}

func TestIsMissingAIAgentProfileIDError(t *testing.T) {
	if !isMissingAIAgentProfileIDError(errors.New("Error 1054 (42S22): Unknown column 'ai_profile_id' in 'where clause'")) {
		t.Fatal("legacy ai_profile_id error was not recognized")
	}
	if isMissingAIAgentProfileIDError(errors.New("Error 1054 (42S22): Unknown column 'model' in 'field list'")) {
		t.Fatal("unrelated missing column was treated as ai_profile_id")
	}
	if isMissingAIAgentProfileIDError(nil) {
		t.Fatal("nil error was treated as a missing column")
	}
}

type flakyAIResponseBody struct {
	readCount int
}

func (b *flakyAIResponseBody) Read(_ []byte) (int, error) {
	b.readCount++
	return 0, errors.New("http2: response body closed")
}

func (b *flakyAIResponseBody) Close() error { return nil }

type flakyAITransport struct {
	calls int
}

func (t *flakyAITransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.calls++
	if t.calls == 1 {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       &flakyAIResponseBody{},
			Header:     make(http.Header),
			Request:    req,
		}, nil
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"OK"}}]}`)),
		Header:     make(http.Header),
		Request:    req,
	}, nil
}

func TestRequestAIAgentCompletionRetriesResponseBodyReadFailure(t *testing.T) {
	transport := &flakyAITransport{}
	client := &http.Client{Transport: transport}
	setting := &models.AIAgentSetting{
		BaseURL:        "https://provider.example/v1",
		Model:          "test-model",
		APIMode:        aiAgentAPIModeStandard,
		TimeoutSeconds: 5,
	}

	reply, err := requestAIAgentCompletionWithClient(
		context.Background(), setting, "test-key",
		[]aiChatMessage{{Role: "user", Content: "ping"}}, 128, client,
	)
	if err != nil {
		t.Fatalf("response body read failure should be retried: %v", err)
	}
	if reply != "OK" {
		t.Fatalf("reply = %q, want OK", reply)
	}
	if transport.calls != 2 {
		t.Fatalf("provider calls = %d, want 2", transport.calls)
	}
}

func TestOpenAIChatRequestOmitsEmptyReasoningEffort(t *testing.T) {
	payload, err := json.Marshal(openAIChatRequest{Model: "custom/model", ReasoningEffort: ""})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "reasoning_effort") {
		t.Fatalf("empty reasoning effort must be omitted: %s", payload)
	}
	payload, err = json.Marshal(openAIChatRequest{Model: "custom/model", ReasoningEffort: "deep_think"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"reasoning_effort":"deep_think"`) {
		t.Fatalf("custom reasoning effort was not serialized: %s", payload)
	}
}

func TestBuildOpenAIChatRequestUsesModeCompatibleTokenFields(t *testing.T) {
	messages := []aiChatMessage{{Role: "user", Content: "test"}}
	standard := buildOpenAIChatRequest(&models.AIAgentSetting{
		Model: "custom/chat", APIMode: aiAgentAPIModeStandard,
	}, messages, 1200)
	standardPayload, err := json.Marshal(standard)
	if err != nil {
		t.Fatal(err)
	}
	standardJSON := string(standardPayload)
	if !strings.Contains(standardJSON, `"max_tokens":1200`) || !strings.Contains(standardJSON, `"temperature":0.2`) {
		t.Fatalf("standard chat fields are missing: %s", standardJSON)
	}
	if strings.Contains(standardJSON, "max_completion_tokens") {
		t.Fatalf("standard chat emitted reasoning token field: %s", standardJSON)
	}

	reasoning := buildOpenAIChatRequest(&models.AIAgentSetting{
		Model: "o3", APIMode: aiAgentAPIModeReasoning, ReasoningEffort: "high",
	}, messages, 2400)
	reasoningPayload, err := json.Marshal(reasoning)
	if err != nil {
		t.Fatal(err)
	}
	reasoningJSON := string(reasoningPayload)
	if !strings.Contains(reasoningJSON, `"max_completion_tokens":2400`) || !strings.Contains(reasoningJSON, `"reasoning_effort":"high"`) {
		t.Fatalf("reasoning chat fields are missing: %s", reasoningJSON)
	}
	if strings.Contains(reasoningJSON, `"max_tokens"`) || strings.Contains(reasoningJSON, `"temperature"`) {
		t.Fatalf("reasoning chat emitted incompatible legacy fields: %s", reasoningJSON)
	}
}
