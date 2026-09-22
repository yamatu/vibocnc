package config

import (
	"fmt"
	"testing"
)

func TestRequiredAIAgentSchemaIncludesSEOJobProfileColumn(t *testing.T) {
	want := map[string]bool{
		"ai_agent_profiles.api_mode":                  false,
		"ai_agent_settings.active_profile_id":         false,
		"ai_agent_settings.api_mode":                  false,
		"ai_agent_settings.max_concurrent_jobs":       false,
		"ai_agent_settings.agent_history_limit":       false,
		"ai_agent_settings.auto_publish_new_products": false,
		"ai_agent_seo_jobs.ai_profile_id":             false,
		"ai_agent_seo_jobs.ai_profile_name":           false,
		"ai_agent_seo_jobs.ai_model":                  false,
		"ai_agent_seo_jobs.ai_api_mode":               false,
	}
	for _, requirement := range requiredAIAgentSchemaColumns() {
		key := requirement.table + "." + requirement.column
		if _, expected := want[key]; !expected {
			t.Fatalf("unexpected AI schema requirement %q", key)
		}
		want[key] = true
	}
	for key, found := range want {
		if !found {
			t.Fatalf("missing AI schema requirement %q", key)
		}
	}
}

// TestRequiredAIAgentSchemaCreatesPromptLibraryTable guards the prompt library
// table: the library is useless if startup never creates it.
func TestRequiredAIAgentSchemaCreatesPromptLibraryTable(t *testing.T) {
	for _, model := range requiredAIAgentSchemaModels() {
		if fmt.Sprintf("%T", model) == "*models.AIAgentPromptPreset" {
			return
		}
	}
	t.Fatal("the AI prompt library table is not part of the required AI schema")
}

func TestAIAgentSchemaNilDatabaseGuard(t *testing.T) {
	if err := migrateAIAgentProfileSchema(nil); err == nil {
		t.Fatal("nil database should be rejected")
	}
	missing := missingAIAgentProfileSchema(nil)
	if len(missing) != 1 || missing[0] != "database connection" {
		t.Fatalf("nil database missing schema = %#v", missing)
	}
}
