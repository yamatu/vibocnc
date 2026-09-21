package controllers

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestAIAgentToolSessionCapsAndDedupe verifies the per-answer proposal rules
// that keep write tools from flooding the administrator.
func TestAIAgentToolSessionCapsAndDedupe(t *testing.T) {
	session := &aiAgentToolSession{}
	action := aiAction{Type: aiToolAssignCategory, Title: "t", Data: map[string]any{"product_id": 1, "category_id": 2}}
	if err := session.add(action); err != nil {
		t.Fatalf("first proposal rejected: %v", err)
	}
	if err := session.add(action); err == nil {
		t.Fatal("a duplicate proposal must be rejected")
	}
	if len(session.pending) != 1 {
		t.Fatalf("pending = %d, want 1", len(session.pending))
	}
	for i := 2; i <= aiAgentMaxAssignProposals+1; i++ {
		another := aiAction{Type: aiToolAssignCategory, Data: map[string]any{"product_id": i, "category_id": 2}}
		err := session.add(another)
		if i <= aiAgentMaxAssignProposals {
			if err != nil {
				t.Fatalf("proposal %d rejected: %v", i, err)
			}
		} else if err == nil {
			t.Fatal("the per-answer assignment cap must be enforced")
		}
	}

	var missing *aiAgentToolSession
	if err := missing.add(action); err == nil {
		t.Fatal("a nil session must reject proposals")
	}
}

func TestMergeAIAgentPendingSuggestionsDedupes(t *testing.T) {
	pending := []aiAction{{Type: aiToolAssignCategory, Data: map[string]any{"product_id": 1, "category_id": 2}}}
	modelAuthored := []aiAction{
		{Type: aiToolAssignCategory, Data: map[string]any{"product_id": 1, "category_id": 2}},
		{Type: "update_product", Data: map[string]any{"product_id": 3, "meta_title": "x"}},
	}
	merged := mergeAIAgentPendingSuggestions(pending, modelAuthored)
	if len(merged) != 2 {
		t.Fatalf("merged = %d proposals, want 2", len(merged))
	}
	if merged[0].Type != aiToolAssignCategory || merged[1].Type != "update_product" {
		t.Fatalf("unexpected merge order: %#v", merged)
	}
	if got := mergeAIAgentPendingSuggestions(nil, modelAuthored); len(got) != len(modelAuthored) {
		t.Fatalf("nil pending must pass model suggestions through, got %d", len(got))
	}
}

func TestBuildAICategoryOptimizationJobRequestScopes(t *testing.T) {
	cases := []struct {
		name    string
		data    map[string]any
		wantErr bool
		check   func(t *testing.T, req aiSEOCategoryJobRequest)
	}{
		{
			name: "uncategorized",
			data: map[string]any{"scope": "uncategorized"},
			check: func(t *testing.T, req aiSEOCategoryJobRequest) {
				if !req.UncategorizedOnly || req.ReworkOnly || req.Brand != "" {
					t.Fatalf("unexpected request: %#v", req)
				}
			},
		},
		{
			name:    "brand scope requires a brand",
			data:    map[string]any{"scope": "brand"},
			wantErr: true,
		},
		{
			name: "brand",
			data: map[string]any{"scope": "brand", "brand": "Siemens"},
			check: func(t *testing.T, req aiSEOCategoryJobRequest) {
				if req.Brand != "Siemens" {
					t.Fatalf("brand = %q", req.Brand)
				}
			},
		},
		{
			name: "products",
			data: map[string]any{"scope": "products", "product_ids": []any{float64(1), float64(2)}},
			check: func(t *testing.T, req aiSEOCategoryJobRequest) {
				if len(req.ProductIDs) != 2 {
					t.Fatalf("ids = %#v", req.ProductIDs)
				}
			},
		},
		{
			name:    "unknown scope",
			data:    map[string]any{"scope": "everything"},
			wantErr: true,
		},
		{
			name: "rework",
			data: map[string]any{"scope": "rework"},
			check: func(t *testing.T, req aiSEOCategoryJobRequest) {
				if !req.ReworkOnly {
					t.Fatal("rework scope must set ReworkOnly")
				}
			},
		},
		{
			name: "limit passes through",
			data: map[string]any{"scope": "uncategorized", "limit": float64(250)},
			check: func(t *testing.T, req aiSEOCategoryJobRequest) {
				if req.Limit != 250 {
					t.Fatalf("limit = %d", req.Limit)
				}
			},
		},
	}
	for _, tc := range cases {
		req, err := buildAICategoryOptimizationJobRequest(tc.data)
		if tc.wantErr {
			if err == nil {
				t.Fatalf("%s: expected an error", tc.name)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if tc.check != nil {
			tc.check(t, req)
		}
	}
}

func TestAiToolRunCreateCategoryRejectsUnverifiedBrand(t *testing.T) {
	db := dryRunDB(t)
	session := &aiAgentToolSession{}
	if _, err := aiToolRunCreateCategory(db, `{"brand":"Weidmuller","product_type":"Terminal Block"}`, session); err == nil {
		t.Fatal("a brand outside the verified list must be refused for direct category creation")
	}
	if len(session.pending) != 0 {
		t.Fatal("no proposal may be attached for a refused request")
	}
}

func TestAiToolRunCreateCategoryRejectsGenericType(t *testing.T) {
	db := dryRunDB(t)
	session := &aiAgentToolSession{}
	if _, err := aiToolRunCreateCategory(db, `{"brand":"FANUC","product_type":"Spare Part"}`, session); err == nil {
		t.Fatal("a generic product type must be refused")
	}
}

func TestAiToolRunCreateCategoryProposesForVerifiedBrand(t *testing.T) {
	db := dryRunDB(t)
	session := &aiAgentToolSession{}
	result, err := aiToolRunCreateCategory(db, `{"brand":"FANUC","product_type":"Servo Drive"}`, session)
	if err != nil {
		t.Fatalf("a verified brand must produce a proposal: %v", err)
	}
	if len(session.pending) != 1 || session.pending[0].Type != aiToolCreateCategory {
		t.Fatalf("pending = %#v", session.pending)
	}
	if !strings.Contains(string(mustJSON(t, result)), "proposal_created") {
		t.Fatalf("unexpected result: %s", mustJSON(t, result))
	}
}

func TestAiToolRunStartCategoryOptimizationValidatesArguments(t *testing.T) {
	db := dryRunDB(t)
	session := &aiAgentToolSession{}
	if _, err := aiToolRunStartCategoryOptimization(db, `{"scope":"brand"}`, session); err == nil {
		t.Fatal("brand scope without a brand must be refused")
	}
	if _, err := aiToolRunStartCategoryOptimization(db, `{"scope":"products"}`, session); err == nil {
		t.Fatal("products scope without ids must be refused")
	}
	if _, err := aiToolRunStartCategoryOptimization(db, `{"scope":"nonsense"}`, session); err == nil {
		t.Fatal("an unknown scope must be refused")
	}
	tooMany := make([]string, 0, aiAgentMaxJobProductIDs+1)
	for i := 0; i <= aiAgentMaxJobProductIDs; i++ {
		tooMany = append(tooMany, "1")
	}
	// Build a payload with one id over the cap without re-serialising numbers.
	ids := "[" + strings.Join(tooMany, ",") + "]"
	if _, err := aiToolRunStartCategoryOptimization(db, `{"scope":"products","product_ids":`+ids+`}`, session); err == nil {
		t.Fatal("an oversized product id list must be refused")
	}
	if len(session.pending) != 0 {
		t.Fatal("no proposal may be attached for refused requests")
	}
}

func TestAiToolRunAssignProductCategoryValidatesArguments(t *testing.T) {
	db := dryRunDB(t)
	session := &aiAgentToolSession{}
	if _, err := aiToolRunAssignProductCategory(db, `{"product_id":0,"category_id":1}`, session); err == nil {
		t.Fatal("a missing product id must be refused")
	}
	if _, err := aiToolRunAssignProductCategory(db, `{"product_id":1,"category_id":0}`, session); err == nil {
		t.Fatal("a missing category id must be refused")
	}
	// The dry-run database returns no rows, so the validator must report the
	// product as not found instead of proposing a change for an unknown id.
	if _, err := aiToolRunAssignProductCategory(db, `{"product_id":123,"category_id":45}`, session); err == nil {
		t.Fatal("an unverifiable product must be refused in a dry run")
	}
	if len(session.pending) != 0 {
		t.Fatal("no proposal may be attached for refused requests")
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return raw
}

func TestApplyAICategoryCreationValidatesInput(t *testing.T) {
	db := dryRunDB(t)
	if _, err := applyAICategoryCreation(db, map[string]any{"brand": "", "product_type": "Servo Drive"}); err == nil {
		t.Fatal("a missing brand must be refused before any write")
	}
	if _, err := applyAICategoryCreation(db, map[string]any{"brand": "FANUC", "product_type": "Spare Part"}); err == nil {
		t.Fatal("a generic product type must be refused before any write")
	}
	if _, err := applyAICategoryCreation(db, map[string]any{"brand": "Weidmuller", "product_type": "Terminal Block"}); err == nil {
		t.Fatal("an unverified brand must be refused before any write")
	}
}

func TestApplyAIActionAssignValidatesIdentifiers(t *testing.T) {
	db := dryRunDB(t)
	if _, err := applyAIAction(db, aiAction{Type: "assign_product_category", Data: map[string]any{"product_id": 0, "category_id": 3}}, nil, nil, nil, 0); err == nil {
		t.Fatal("a missing product_id must be refused")
	}
	if _, err := applyAIAction(db, aiAction{Type: "assign_product_category", Data: map[string]any{"product_id": 3, "category_id": 0}}, nil, nil, nil, 0); err == nil {
		t.Fatal("a missing category_id must be refused")
	}
	if _, err := applyAIAction(db, aiAction{Type: "start_category_optimization", Data: map[string]any{"scope": "brand"}}, nil, nil, nil, 0); err == nil {
		t.Fatal("an incomplete task request must be refused")
	}
}

func TestAiAgentPausedHeldUncategorizedDryRun(t *testing.T) {
	db := dryRunDB(t)
	// The dry-run database returns no rows, so the helper must report no hold.
	if jobID, held := aiAgentPausedHeldUncategorized(db); jobID != "" || held != 0 {
		t.Fatalf("dry run should report no paused hold, got job=%q held=%d", jobID, held)
	}
}
