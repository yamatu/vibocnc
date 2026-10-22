package controllers

import (
	"testing"

	"fanuc-backend/models"
)

func TestIsDeepSeekBaseURL(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://api.deepseek.com":            true,
		"https://API.DeepSeek.com/v1":         true,
		"http://api.deepseek.com/v1":          false,
		"https://api.deepseek.com.evil.io/v1": false,
		"https://api.openai.com/v1":           false,
		"":                                    false,
	} {
		if got := isDeepSeekBaseURL(raw); got != want {
			t.Errorf("isDeepSeekBaseURL(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestSelectDeepSeekWebSearchProfile(t *testing.T) {
	active := uint(3)
	profiles := []models.AIAgentProfile{
		{ID: 1, BaseURL: "https://api.openai.com/v1", APIKeyEnc: "k", WebSearchEnabled: true},
		{ID: 2, BaseURL: "https://api.deepseek.com/v1", APIKeyEnc: "k", WebSearchEnabled: true},
		{ID: 3, BaseURL: "https://api.deepseek.com", APIKeyEnc: "k", WebSearchEnabled: true},
		{ID: 4, BaseURL: "https://api.deepseek.com", WebSearchEnabled: true},
	}
	if got := selectDeepSeekWebSearchProfile(profiles, &active); got == nil || got.ID != 3 {
		t.Fatalf("active DeepSeek profile should win, got %+v", got)
	}
	other := uint(1)
	if got := selectDeepSeekWebSearchProfile(profiles, &other); got == nil || got.ID != 2 {
		t.Fatalf("oldest enabled DeepSeek profile should be the fallback, got %+v", got)
	}
	if got := selectDeepSeekWebSearchProfile(profiles[3:], nil); got != nil {
		t.Fatalf("profile without key must not be used, got %+v", got)
	}
}

func TestProfileMutationOnlyEnablesWebSearchForDeepSeek(t *testing.T) {
	enabled := true
	deepSeek := "https://api.deepseek.com/v1"
	profile := models.AIAgentProfile{}
	name := "DeepSeek"
	if err := applyAIAgentProfileMutation(&profile, aiAgentProfileMutationRequest{Name: &name, BaseURL: &deepSeek, WebSearchEnabled: &enabled}, true); err != nil {
		t.Fatal(err)
	}
	if !profile.WebSearchEnabled {
		t.Fatal("DeepSeek profile should keep web search enabled")
	}
	openAI := "https://api.openai.com/v1"
	if err := applyAIAgentProfileMutation(&profile, aiAgentProfileMutationRequest{BaseURL: &openAI}, false); err != nil {
		t.Fatal(err)
	}
	if profile.WebSearchEnabled {
		t.Fatal("switching away from DeepSeek must turn web search off")
	}
}
