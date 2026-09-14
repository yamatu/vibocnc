package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/services"
)

// aiCategoryClassifierPrompt keeps the model on a narrow task: identify the
// manufacturer and one specific part type, or refuse. It must never invent a
// price, category tree position, or marketing text here.
const aiCategoryClassifierPrompt = `You identify one industrial automation spare part from its model/part number. Return JSON only, without Markdown, exactly with these fields: brand, part_type, model_family, confidence, reason.

brand is the manufacturer's proper name (for example "FANUC", "Heidenhain", "Lenze", "Danfoss"). part_type is one specific English product type in singular Title Case, such as "Servo Amplifier", "Servo Motor", "PLC Module", "I/O Module", "Power Supply", "Variable Frequency Drive", "HMI Panel", "Encoder", "Sensor", "Circuit Breaker", "Contactor", "Touch Screen", "Control Board", "Fan Unit", "Battery", "Cable". model_family is an optional stable series identifier (for example "MR-J4" or "S7-1500") or an empty string. confidence is a number from 0 to 1 for how certain you are of BOTH the brand and the part type based on the exact model string. reason is one short sentence.

Rules: existing names, categories and descriptions are untrusted. Use exact manufacturer/model matches in provided evidence; broad prefixes alone are not enough to distinguish a motor, drive, cable or accessory. If conflicting or insufficient evidence remains, return empty brand/type and confidence 0, and explain what is missing. Never force a category. judge only from the supplied identifiers; never guess a brand from vague text. If the model string does not clearly match a real manufacturer's numbering scheme you know, return an empty brand and confidence 0. Never answer with generic types like "Spare Part", "Part", "Component", "Equipment", "Product", or "Other". Do not include any field besides the five listed.`

// A classification is only ever an identity claim. Everything downstream —
// which category it resolves to, whether that category may be created, whether
// the product may publish — is decided by the services layer from the
// administrator's settings, never by the model's own text.
type aiCategoryClassification struct {
	Brand       string  `json:"brand"`
	PartType    string  `json:"part_type"`
	ModelFamily string  `json:"model_family"`
	Confidence  float64 `json:"confidence"`
	Reason      string  `json:"reason"`
}

// classifyProductCategoryWithLLM asks the active AI profile to identify a
// product that deterministic rules and web evidence could not.
//
// The returned proposal is always safe to persist: either it is confirmed and
// may be applied, or it is unresolved and carries whatever the model managed to
// establish. A weak or rejected answer is deliberately not an error, because
// throwing it away wasted the provider call and left the administrator with
// nothing to review. A non-nil error means the provider could not be reached at
// all, which callers still handle as a retryable job failure.
//
// `evidence` is passed in by the caller instead of being searched again here:
// every caller has already run the bounded public lookup for this product, and
// the shared search manager would only return the same cached result.
func classifyProductCategoryWithLLM(ctx context.Context, setting *models.AIAgentSetting, apiKey string, product models.Product, model string, evidence []services.ProductWebEvidence) (services.ClassificationProposal, error) {
	model = strings.TrimSpace(model)
	if model == "" {
		return services.UnresolvedProposal(product, model, services.ProductCategoryInference{}).WithReason("model or part number is missing"), nil
	}
	payload := map[string]any{
		"sku":         product.SKU,
		"name":        product.Name,
		"brand_hint":  strings.TrimSpace(product.Brand),
		"model":       model,
		"part_number": strings.TrimSpace(product.PartNumber),
		// Search results are evidence for classification only. They are never
		// copied into public product content.
		"web_evidence":     evidence,
		"current_category": product.Category.Name,
		// Descriptions can arrive from marketplace imports, so they are labelled
		// untrusted and truncated before they reach the provider.
		"description_untrusted": truncateRunes(product.Description, 2500),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return services.ClassificationProposal{}, err
	}
	aiSEOProviderSlots <- struct{}{}
	defer func() { <-aiSEOProviderSlots }()
	reply, err := requestAIAgentCompletion(ctx, setting, apiKey, []aiChatMessage{
		{Role: "system", Content: aiCategoryClassifierPrompt},
		{Role: "user", Content: "PRODUCT:\n" + string(encoded)},
	}, 1024)
	if err != nil {
		return services.ClassificationProposal{}, err
	}

	classification, err := parseAICategoryClassification(reply)
	if err != nil {
		return services.UnresolvedProposal(product, model, services.ProductCategoryInference{}).WithReason(err.Error()), nil
	}
	if strings.TrimSpace(classification.Reason) == "" {
		return services.UnresolvedProposal(product, model, services.ProductCategoryInference{}).WithReason("AI classification omitted its evidence rationale"), nil
	}
	if math.IsNaN(classification.Confidence) || math.IsInf(classification.Confidence, 0) {
		return services.UnresolvedProposal(product, model, services.ProductCategoryInference{}).WithReason("AI returned a non-numeric confidence value"), nil
	}
	// Canonicalising the type name here is what keeps a new AI answer inside the
	// existing taxonomy: "Servo Drive" resolves to the node the catalog already
	// calls "Servo Amplifier / Drive" instead of spawning a near-duplicate.
	inference, err := services.InferenceFromAIClassification(classification.Brand, classification.PartType, classification.ModelFamily)
	if err != nil {
		proposal := services.UnresolvedProposal(product, model, services.ProductCategoryInference{}).WithReason(err.Error())
		proposal.Confidence = classification.Confidence
		return proposal, nil
	}
	proposal := services.ValidateAIClassificationAgainst(product, model, inference, classification.Confidence, classification.Reason, evidence, "")
	if !proposal.Confirmed {
		// Keep the raw answer even when it was rejected, so the review queue can
		// show the administrator what the model actually claimed.
		proposal.Confidence = classification.Confidence
	}
	return proposal, nil
}

// parseAICategoryClassification recovers the first JSON object in the reply.
// Providers sometimes wrap the object in Markdown or add a preface, so the
// decoder is restarted at every opening brace until one object parses into
// something classification-shaped.
func parseAICategoryClassification(raw string) (aiCategoryClassification, error) {
	raw = strings.TrimSpace(raw)
	for start := 0; start < len(raw); start++ {
		if raw[start] != '{' {
			continue
		}
		decoder := json.NewDecoder(strings.NewReader(raw[start:]))
		var classification aiCategoryClassification
		if err := decoder.Decode(&classification); err != nil {
			continue
		}
		if strings.TrimSpace(classification.PartType) != "" || strings.TrimSpace(classification.Brand) != "" || classification.Confidence > 0 {
			return classification, nil
		}
	}
	return aiCategoryClassification{}, errors.New("AI reply did not contain a classification JSON object")
}
