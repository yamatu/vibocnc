package controllers

import (
	"strings"
	"testing"
)

// Specification research must keep the same queue contract as every other AI
// job: the options travel with the job record, so a restarted process can resume
// a task that was created by an older build.
func TestSpecResearchJobOptionsRoundTrip(t *testing.T) {
	prompt, err := encodeAISEOSpecJobOptions(aiSEOSpecJobOptions{OnlyMissing: true, UseAI: true, Force: false})
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}
	if !strings.Contains(prompt, aiSEOSpecOptionsMarker) {
		t.Fatalf("prompt lost the options marker: %q", prompt)
	}
	opts, err := decodeAISEOSpecJobOptions(prompt)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !opts.OnlyMissing || !opts.UseAI || opts.Force {
		t.Errorf("options changed across the round trip: %+v", opts)
	}
}

// The job dispatcher picks a processor by selection mode, and each processor
// decodes its own option marker. Cross-decoding a prompt would silently run the
// wrong pipeline, so the markers must stay distinct.
func TestSpecResearchJobOptionsAreNotConfusedWithOtherJobKinds(t *testing.T) {
	if aiSEOSpecSelectionMode == aiSEOCategorySelectionMode {
		t.Fatal("specification research and category optimization must use different selection modes")
	}
	if aiSEOSpecOptionsMarker == aiSEOCategoryOptionsMarker {
		t.Fatal("specification research and category optimization must use different option markers")
	}
	specPrompt, err := encodeAISEOSpecJobOptions(aiSEOSpecJobOptions{OnlyMissing: true})
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}
	if _, err := decodeAISEOCategoryJobOptions(specPrompt); err == nil {
		t.Error("a specification research prompt must not decode as category optimization options")
	}
	categoryPrompt, err := encodeAISEOCategoryJobOptions(aiSEOCategoryJobOptions{RepairContent: true})
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}
	if _, err := decodeAISEOSpecJobOptions(categoryPrompt); err == nil {
		t.Error("a category optimization prompt must not decode as specification research options")
	}
	if _, err := decodeAISEOSpecJobOptions("no marker here"); err == nil {
		t.Error("a prompt without the marker must be rejected instead of silently defaulting")
	}
	if _, err := decodeAISEOSpecJobOptions(aiSEOSpecOptionsMarker + "!!!]]"); err == nil {
		t.Error("a malformed payload must be rejected")
	}
}

func TestSpecResearchJobLimitsAndStartMessage(t *testing.T) {
	if !validAISEOJobLimit(defaultSpecResearchJobLimit) {
		t.Error("the default specification research limit must be a valid AI job limit")
	}
	if defaultSpecResearchJobLimit > maxSpecResearchJobLimit {
		t.Errorf("default limit %d exceeds the maximum %d", defaultSpecResearchJobLimit, maxSpecResearchJobLimit)
	}
	if maxSpecResearchJobLimit > maxAISEOCandidateProducts {
		t.Errorf("the research limit may not exceed the queue-wide candidate cap %d", maxAISEOCandidateProducts)
	}
	if got := specResearchStartMessage(""); got != "Specification research task started" {
		t.Errorf("unexpected plain start message: %q", got)
	}
	if got := specResearchStartMessage("AI 未配置"); !strings.Contains(got, "AI 未配置") {
		t.Errorf("the AI fallback warning was dropped: %q", got)
	}
}

func TestParsePositiveUintParam(t *testing.T) {
	if value, err := parsePositiveUintParam(" 42 "); err != nil || value != 42 {
		t.Errorf("parsePositiveUintParam(42) = %d, %v", value, err)
	}
	for _, invalid := range []string{"", "0", "-3", "abc"} {
		if _, err := parsePositiveUintParam(invalid); err == nil {
			t.Errorf("parsePositiveUintParam(%q) must fail", invalid)
		}
	}
}
