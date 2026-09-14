package services

import (
	"os"
	"strings"
	"testing"
	"time"

	"fanuc-backend/config"
)

// The learned-rule layer is the only reader of the classification audit table.
// These tests pin the two things it must never do: promote an unverified
// attempt into a rule, and generalise from a single or contradictory decision.

func learnedRow(brand, model, partType, rule string, approvals int) learnedRuleRow {
	return learnedRuleRow{Brand: brand, Model: model, ProductType: partType, MatchRule: rule, Approvals: approvals}
}

func TestBuildLearnedRuleIndexKeepsExactModelRule(t *testing.T) {
	index := buildLearnedRuleIndex([]learnedRuleRow{
		learnedRow("FANUC", "A06B-6089-H105", "Servo Amplifier / Drive", "llm:type:servo-amplifier-drive", 1),
	})
	key := learnedRuleCacheKey("fanuc", "A06B-6089-H105")
	rule, found := index.byModel[key]
	if !found {
		t.Fatalf("exact model rule was dropped")
	}
	if rule.PartType != "Servo Amplifier / Drive" || rule.BrandKey != "fanuc" {
		t.Fatalf("unexpected rule: %+v", rule)
	}
}

func TestBuildLearnedRuleIndexRejectsUnverifiedSources(t *testing.T) {
	index := buildLearnedRuleIndex([]learnedRuleRow{
		learnedRow("FANUC", "A06B-6089-H105", "Servo Amplifier / Drive", "admin-name:type:servo-amplifier-drive", 5),
		learnedRow("FANUC", "A06B-6089-H106", "Spare Part", "web:model-match", 5),
		learnedRow("FANUC", "A06B-6089-H107", "Servo Motor", "generic:servo-motor-keyword", 5),
	})
	if len(index.byModel) != 0 {
		t.Fatalf("unverified or generic rows became rules: %+v", index.byModel)
	}
}

// A learned rule wraps the rule it came from, so the trust check has to look
// through the "learned:" prefix instead of trusting the outermost string.
func TestIsVerifiedClassificationRuleUnwrapsLearnedPrefix(t *testing.T) {
	if !IsVerifiedClassificationRule("learned:web:model-exact-match") {
		t.Fatalf("a learned web rule must stay trusted")
	}
	if !IsVerifiedClassificationRule("learned:learned:llm:type:encoder") {
		t.Fatalf("repeated learned prefixes must stay trusted")
	}
	if IsVerifiedClassificationRule("learned:generic:fallback") {
		t.Fatalf("a learned generic fallback must not become trusted")
	}
	if IsVerifiedClassificationRule("fanuc:servo-motor") {
		t.Fatalf("deterministic rules are not the shared trust signal")
	}
}

func TestBuildLearnedRuleIndexRequiresUniqueBrandForBrandlessLookup(t *testing.T) {
	shared := "TS2640N71E4"
	index := buildLearnedRuleIndex([]learnedRuleRow{
		learnedRow("Tamagawa", shared, "Rotary Encoder", "web:model-match", 2),
		learnedRow("Heidenhain", shared, "Encoder / Feedback", "web:model-match", 2),
	})
	modelKey := classificationFamilyModelKey(shared)
	if _, found := index.byModelNoBrand[modelKey]; found {
		t.Fatalf("a model claimed by two manufacturers must not resolve without a brand")
	}
	if _, found := index.byModel[learnedRuleCacheKey("tamagawa", shared)]; !found {
		t.Fatalf("the branded rule must still be kept")
	}
}

func TestBuildLearnedRuleIndexFamilyNeedsAgreementAndTwoApprovals(t *testing.T) {
	index := buildLearnedRuleIndex([]learnedRuleRow{
		learnedRow("FANUC", "A06B-6089-H105", "Servo Amplifier / Drive", "web:model-match", 1),
		learnedRow("FANUC", "A06B-6089-H208", "Servo Amplifier / Drive", "web:model-match", 1),
		// Same family, second type: the family must not generalise.
		learnedRow("FANUC", "A06B-6089-H300", "Servo Motor", "web:model-match", 4),
		// A single approval is not enough for a family shortcut.
		learnedRow("Siemens", "6ES7-315-2AG10-0AB0", "Programmable Logic Controller", "web:model-match", 1),
		// A family needs at least three segments; these are not families.
		learnedRow("Siemens", "6ES7315", "Programmable Logic Controller", "web:model-match", 4),
	})
	familyKey := learnedRuleCacheKey("fanuc", "A06B-6089")
	if _, found := index.byFamily[familyKey]; found {
		t.Fatalf("a family with two different product types must not produce a rule")
	}
	if len(index.byFamily) != 0 {
		t.Fatalf("unexpected family rules: %+v", index.byFamily)
	}

	agreed := buildLearnedRuleIndex([]learnedRuleRow{
		learnedRow("FANUC", "A06B-6089-H105", "Servo Amplifier / Drive", "web:model-match", 1),
		learnedRow("FANUC", "A06B-6089-H208", "Servo Amplifier / Drive", "web:model-match", 1),
	})
	rule, found := agreed.byFamily[familyKey]
	if !found {
		t.Fatalf("an agreed family with two approvals should produce a rule")
	}
	if rule.Approvals != 2 || rule.PartType != "Servo Amplifier / Drive" {
		t.Fatalf("unexpected family rule: %+v", rule)
	}
}

func TestClassificationFamilyKeyOnlySplitsSegmentedIdentifiers(t *testing.T) {
	cases := map[string]string{
		"A06B-6089-H105":  "A06B-6089",
		"A06B-6089-H1050": "",
		"6ES7315":         "",
		"6ES7-315-2AG1":   "6ES7-315",
		// A five-character variant code is treated as part of the identifier
		// itself, so the family must not be guessed from it.
		"6ES7-315-2AG10": "",
		"":               "",
	}
	for model, want := range cases {
		if got := classificationFamilyKey(model); got != want {
			t.Errorf("classificationFamilyKey(%q) = %q, want %q", model, got, want)
		}
	}
}

func TestLearnedRuleLookupFallsBackWithoutBrandAndRejectsContradiction(t *testing.T) {
	learnedRules.mu.Lock()
	learnedRules.index = buildLearnedRuleIndex([]learnedRuleRow{
		learnedRow("Heidenhain", "ERN-480-1000", "Encoder / Feedback", "web:model-match", 1),
	})
	learnedRules.expires = time.Now().Add(time.Hour)
	learnedRules.mu.Unlock()
	t.Cleanup(InvalidateLearnedClassificationRules)

	if rule, found := LearnedClassificationRuleFor(nil, "", "ERN-480-1000"); !found || rule.BrandKey != "heidenhain" {
		t.Fatalf("brandless lookup should reuse the only manufacturer's rule: %+v %v", rule, found)
	}
	if _, found := LearnedClassificationRuleFor(nil, "Siemens", "ERN-480-1000"); found {
		t.Fatalf("a contradicting brand must fall through to normal verification")
	}
	if inference, found := LearnedClassificationInference(nil, "Heidenhain", "ERN-480-1000"); !found || inference.MatchRule != "learned:web:model-match" {
		t.Fatalf("unexpected inference: %+v %v", inference, found)
	}
}

func TestIsGenericProductType(t *testing.T) {
	for _, value := range []string{"", "  ", "Spare Part", "spare   parts", "Other", "Component"} {
		if !IsGenericProductType(value) {
			t.Errorf("%q should be rejected as a generic type", value)
		}
	}
	for _, value := range []string{"Servo Motor", "Encoder / Feedback", "Variable Frequency Drive"} {
		if IsGenericProductType(value) {
			t.Errorf("%q is a real product type", value)
		}
	}
}

// The shared snapshot is what keeps two application instances on the same rule
// set. It only runs when a Redis is reachable, so CI stays dependency-free:
//
//	REDIS_TEST_ADDR=127.0.0.1:6379 go test ./services/ -run RedisRoundTrip
func TestSharedLearnedRuleIndexRedisRoundTrip(t *testing.T) {
	addr := strings.TrimSpace(os.Getenv("REDIS_TEST_ADDR"))
	if addr == "" {
		t.Skip("REDIS_TEST_ADDR is not set")
	}
	t.Setenv("REDIS_ADDR", addr)
	config.ConnectRedis()
	t.Cleanup(func() {
		InvalidateLearnedClassificationRules()
		config.Redis = nil
	})
	if config.GetRedis() == nil {
		t.Fatal("redis client was not initialised")
	}
	InvalidateLearnedClassificationRules()
	if index := loadSharedLearnedRuleIndex(); index != nil {
		t.Fatalf("the cache must start empty: %+v", index.byModel)
	}

	index := buildLearnedRuleIndex([]learnedRuleRow{
		learnedRow("FANUC", "A06B-6089-H105", "Servo Amplifier / Drive", "web:model-match", 1),
		learnedRow("FANUC", "A06B-6089-H208", "Servo Amplifier / Drive", "web:model-match", 1),
	})
	storeSharedLearnedRuleIndex(index)

	loaded := loadSharedLearnedRuleIndex()
	if loaded == nil {
		t.Fatal("the published snapshot was not readable")
	}
	if len(loaded.byModel) != len(index.byModel) || len(loaded.byFamily) != len(index.byFamily) {
		t.Fatalf("snapshot lost entries: %d/%d models, %d/%d families", len(loaded.byModel), len(index.byModel), len(loaded.byFamily), len(index.byFamily))
	}
	rule, found := loaded.byModel[learnedRuleCacheKey("fanuc", "A06B-6089-H105")]
	if !found || rule.PartType != "Servo Amplifier / Drive" {
		t.Fatalf("snapshot corrupted the rule: %+v %v", rule, found)
	}
	if _, found := loaded.byFamily[learnedRuleCacheKey("fanuc", "A06B-6089")]; !found {
		t.Fatalf("snapshot lost the family rule")
	}

	// Invalidation has to reach the shared copy too, or a fresh instance would
	// immediately restore what an administrator just changed.
	InvalidateLearnedClassificationRules()
	if index := loadSharedLearnedRuleIndex(); index != nil {
		t.Fatalf("invalidation left the shared snapshot behind: %+v", index.byModel)
	}
}
