package models

import (
	"encoding/json"
	"strings"
	"testing"
)

// Raw profile/evidence columns are decoded by the controller into typed fields.
// They must not be emitted twice or expose internal malformed JSON directly.
func TestProductProfileDraftHidesRawPayloadColumns(t *testing.T) {
	draft := ProductProfileDraft{
		ID:                1,
		Model:             "A06B-6077-H106",
		Status:            "pending",
		ProfileJSON:       `{"secret_internal_profile":true}`,
		ContentJSON:       `{"secret_internal_content":true}`,
		EvidenceJSON:      `[{"secret_internal_evidence":true}]`,
		AppliedFieldsJSON: `["name"]`,
	}
	encoded, err := json.Marshal(draft)
	if err != nil {
		t.Fatal(err)
	}
	value := string(encoded)
	for _, forbidden := range []string{
		"secret_internal_profile",
		"secret_internal_content",
		"secret_internal_evidence",
		"applied_fields_json",
	} {
		if strings.Contains(value, forbidden) {
			t.Errorf("raw internal field %q leaked: %s", forbidden, value)
		}
	}
	if !strings.Contains(value, "A06B-6077-H106") {
		t.Error("review metadata should remain visible")
	}
}
