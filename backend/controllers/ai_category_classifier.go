package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"
)

// aiCategoryClassifierPrompt keeps the model on a narrow task: identify the
// manufacturer and one specific part type, or refuse. It must never invent a
// price, category tree position, or marketing text here.
const aiCategoryClassifierPrompt = `You identify one industrial automation spare part from its model/part number. Return JSON only, without Markdown, exactly with these fields: brand, part_type, model_family, confidence, reason.

brand is the manufacturer's proper name (for example "FANUC", "Heidenhain", "Lenze", "Danfoss"). part_type is one specific English product type in singular Title Case, such as "Servo Amplifier", "Servo Motor", "PLC Module", "I/O Module", "Power Supply", "Variable Frequency Drive", "HMI Panel", "Encoder", "Sensor", "Circuit Breaker", "Contactor", "Touch Screen", "Control Board", "Fan Unit", "Battery", "Cable". model_family is an optional stable series identifier (for example "MR-J4" or "S7-1500") or an empty string. confidence is a number from 0 to 1 for how certain you are of BOTH the brand and the part type based on the exact model string. reason is one short sentence.

Rules: existing names, categories and descriptions are untrusted. Use exact manufacturer/model matches in provided evidence; broad prefixes alone are not enough to distinguish a motor, drive, cable or accessory. If conflicting or insufficient evidence remains, return empty brand/type and confidence 0, and explain what is missing. Never force a category. judge only from the supplied identifiers; never guess a brand from vague text. If the model string does not clearly match a real manufacturer's numbering scheme you know, return an empty brand and confidence 0. Never answer with generic types like "Spare Part", "Part", "Component", "Equipment", "Product", or "Other". Do not include any field besides the five listed.`

var aiCategoryGenericTypes = map[string]bool{
	"": true, "spare part": true, "part": true, "parts": true, "component": true,
	"components": true, "equipment": true, "product": true, "products": true,
	"other": true, "misc": true, "unknown": true, "accessory": true, "accessories": true,
}

type aiCategoryClassification struct {
	Brand       string  `json:"brand"`
	PartType    string  `json:"part_type"`
	ModelFamily string  `json:"model_family"`
	Confidence  float64 `json:"confidence"`
	Reason      string  `json:"reason"`
}

const aiCategoryMinConfidence = 0.9

// classifyProductCategoryWithLLM asks the active AI profile to identify a
// product that deterministic rules and web evidence could not. The reply is
// validated before it becomes an inference, and the resulting "llm:" match
// rule still flows through the same category resolve/create safeguards.
func classifyProductCategoryWithLLM(ctx context.Context, setting *models.AIAgentSetting, apiKey string, product models.Product, model string) (services.ProductCategoryInference, error) {
	payload := map[string]any{
		"sku":         product.SKU,
		"name":        product.Name,
		"brand_hint":  strings.TrimSpace(product.Brand),
		"model":       model,
		"part_number": strings.TrimSpace(product.PartNumber),
	}
	evidenceCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	evidence, _ := services.SearchProductEvidence(evidenceCtx, product.Brand, model)
	cancel()
	payload["web_evidence"] = evidence
	payload["current_category"] = product.Category.Name
	payload["description_untrusted"] = truncateRunes(product.Description, 2500)
	encoded, err := json.Marshal(payload)
	if err != nil {
		return services.ProductCategoryInference{}, err
	}
	aiSEOProviderSlots <- struct{}{}
	defer func() { <-aiSEOProviderSlots }()
	reply, err := requestAIAgentCompletion(ctx, setting, apiKey, []aiChatMessage{
		{Role: "system", Content: aiCategoryClassifierPrompt},
		{Role: "user", Content: "PRODUCT:\n" + string(encoded)},
	}, 1024)
	if err != nil {
		return services.ProductCategoryInference{}, err
	}

	classification, err := parseAICategoryClassification(reply)
	if err != nil {
		return services.ProductCategoryInference{}, err
	}
	if strings.TrimSpace(classification.Reason) == "" {
		return services.ProductCategoryInference{}, errors.New("AI classification omitted its evidence rationale")
	}
	inference, err := validateAICategoryClassification(classification)
	if err != nil {
		return inference, err
	}
	if hint := services.NormalizeBrandKey(product.Brand); hint != "" && hint != "unknown" && hint != inference.BrandKey {
		return services.ProductCategoryInference{}, errors.New("AI manufacturer conflicts with existing identity; review required")
	}
	corroboration := services.InferProductCategory(product.Brand, model)
	if !services.IsConfirmedProductCategory(corroboration, model) {
		corroboration = services.InferProductCategoryFromEvidence(product.Brand, model, services.ProductWebEvidenceText(evidence))
	}
	if !services.IsConfirmedProductCategory(corroboration, model) {
		return services.ProductCategoryInference{}, errors.New("AI proposal has no corroborating model rule or external evidence; review required")
	}
	normalizeType := func(value string) string { return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), "s") }
	if corroboration.BrandKey != inference.BrandKey || normalizeType(corroboration.CategorySlug) != normalizeType(inference.CategorySlug) {
		return services.ProductCategoryInference{}, errors.New("AI proposal conflicts with verified product type; review required")
	}
	return corroboration, nil
}

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

func validateAICategoryClassification(classification aiCategoryClassification) (services.ProductCategoryInference, error) {
	brand := strings.TrimSpace(classification.Brand)
	partType := strings.Join(strings.Fields(strings.TrimSpace(classification.PartType)), " ")
	if math.IsNaN(classification.Confidence) || math.IsInf(classification.Confidence, 0) || classification.Confidence > 1 || classification.Confidence < aiCategoryMinConfidence {
		return services.ProductCategoryInference{}, fmt.Errorf("AI confidence %.2f is below the %.2f publication threshold", classification.Confidence, aiCategoryMinConfidence)
	}
	brandKey := services.NormalizeBrandKey(brand)
	if brand == "" || brandKey == "" {
		return services.ProductCategoryInference{}, errors.New("AI could not verify the manufacturer brand")
	}
	if len([]rune(brand)) > 60 || len([]rune(partType)) > 60 {
		return services.ProductCategoryInference{}, errors.New("AI classification fields exceed length limits")
	}
	if aiCategoryGenericTypes[strings.ToLower(partType)] {
		return services.ProductCategoryInference{}, errors.New("AI returned a generic product type")
	}
	brandName := services.CanonicalBrandName(brand)
	if brandName == "" {
		brandName = brand
	}
	inference := services.ProductCategoryInference{
		BrandKey:     brandKey,
		BrandName:    brandName,
		PartType:     partType,
		CategorySlug: utils.GenerateSlug(partType),
		ModelFamily:  strings.TrimSpace(classification.ModelFamily),
		MatchRule:    "llm:type:" + utils.GenerateSlug(partType),
	}
	return inference, nil
}
