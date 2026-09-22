package controllers

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// import_pasted_models: the administrator pastes the model list, the backend
// runs the import
// ---------------------------------------------------------------------------
//
// A pasted list can be a thousand entries long. Asking the language model to
// echo it back as tool arguments would be slow, expensive and easy to truncate,
// so this tool reads the models from the administrator's own message instead.
// The deterministic classification rules resolve brand and product type, the
// missing "Brand > Product type" category is created through the guarded
// administrator path, the products are created with the saved defaults and
// published according to the saved policy, and one resumable AI job then writes
// the customer-facing copy.

const (
	// aiToolImportPastedModels is the bulk entry point for a pasted model list.
	aiToolImportPastedModels = "import_pasted_models"
	// aiAgentMaxBulkImportModels bounds one import.
	aiAgentMaxBulkImportModels = 1000
	// aiAgentBulkImportReportLimit bounds how much detail is echoed back to the
	// model, so a 1000-line list cannot flood the conversation.
	aiAgentBulkImportReportLimit = 40
	// aiAgentBulkImportNameMaxRunes keeps generated titles inside the column.
	aiAgentBulkImportNameMaxRunes = 200
	// aiAgentBulkImportMinCandidateRunes and max bound what may be reported back
	// as an unrecognised entry.
	aiAgentBulkImportMinCandidateRunes = 4
	aiAgentBulkImportMaxCandidateRunes = 40
)

// aiAgentBulkImportContentPrompt is attached to the follow-up AI job. It is
// deliberately strict about what must not be invented: the skeleton product
// only carries facts taken from the model number itself.
const aiAgentBulkImportContentPrompt = `These products were just created by the bulk model import: they currently hold only the brand, the model number, the product type and the default price.
For every product write customer-facing English (US) content, written to rank in search. Use English (US) only, never Chinese or any other language. Lead every value with the product type, the brand and the exact model number, use the wording buyers search for, and keep it readable: no keyword stuffing, no repeated sentences, no ALL-CAPS.
1) a product title that keeps the manufacturer and the exact model number unchanged;
2) a short description (1-2 sentences: what the part is and which equipment families it fits);
3) a long description (3-6 sentences: the product type, typical applications and the specifications that are directly implied by the model family);
4) meta_title, meta_description and meta_keywords.
Never invent price, stock, lead time, warranty terms, certifications, country of origin, dimensions or any specification that cannot be derived from the model number. Omit what you cannot verify.
Do not change the SKU, model, brand, category or price.`

var (
	// aiBulkImportSegmentSeparator splits a pasted list into one entry per line,
	// comma or Chinese list mark. Whitespace is deliberately NOT a separator:
	// "6ES7 315-2AG10-0AB0" is a single model written with a space.
	aiBulkImportSegmentSeparator = regexp.MustCompile(`[\r\n,;，；、|\t]+`)
	// aiBulkImportCandidate finds model-like tokens inside an entry, so a label,
	// a bullet marker or a note in brackets cannot hide the model.
	aiBulkImportCandidate = regexp.MustCompile(`[A-Za-z0-9][A-Za-z0-9._#/()+\\-]{2,39}`)
	// aiBulkImportLabel strips a leading field label such as "model:" or "型号：".
	aiBulkImportLabel = regexp.MustCompile(`(?i)^\s*(model|sku|part\s*no\.?|part\s*number|型号|货号|编号)\s*[:：]?`)
	// aiBulkImportBullet strips a list marker such as "-", "1." or "3、".
	aiBulkImportBullet = regexp.MustCompile(`^\s*(?:[-*•·>]+|\(?\d{1,4}[.)、])\s*`)
	// aiBulkImportNonASCII marks an entry that contains words, not only a model.
	aiBulkImportNonASCII = regexp.MustCompile(`[^\x00-\x7F]`)
)

// pastedModelScan is the deterministic result of reading a pasted list.
// Models holds what will be imported; Unrecognised holds what looked like a
// model but is not in the rule set, so the assistant can report it instead of
// silently dropping it.
type pastedModelScan struct {
	Models            []string
	Unrecognised      []string
	UnrecognisedTotal int
}

// scanPastedProductModels reads a pasted model list. Nothing here consults a
// language model: an entry is accepted only when the catalogue's own
// classification rules resolve both a brand and a specific product type, which
// is the same bar the import itself has to clear.
func scanPastedProductModels(text string, limit int) pastedModelScan {
	if limit <= 0 || limit > aiAgentMaxBulkImportModels {
		limit = aiAgentMaxBulkImportModels
	}
	scan := pastedModelScan{Models: make([]string, 0, 64), Unrecognised: make([]string, 0, 8)}
	seen := map[string]bool{}
	for _, rawSegment := range aiBulkImportSegmentSeparator.Split(text, -1) {
		segment := strings.TrimSpace(aiBulkImportBullet.ReplaceAllString(rawSegment, ""))
		segment = strings.TrimSpace(aiBulkImportLabel.ReplaceAllString(segment, ""))
		if segment == "" {
			continue
		}
		entryModels := confirmedModelsInEntry(segment)
		if len(entryModels) == 0 {
			if candidate := firstModelLikeCandidate(segment); candidate != "" {
				scan.UnrecognisedTotal++
				if len(scan.Unrecognised) < aiAgentBulkImportReportLimit {
					scan.Unrecognised = append(scan.Unrecognised, candidate)
				}
			}
			continue
		}
		for _, model := range entryModels {
			identity := normalizePriceModel(model)
			if identity == "" || seen[identity] {
				continue
			}
			seen[identity] = true
			if len(scan.Models) < limit {
				scan.Models = append(scan.Models, model)
			}
		}
	}
	return scan
}

// confirmedModelsInEntry decides how many models one entry holds.
//
// A pasted line can be a single model, or several models separated by spaces.
// The rule set cannot tell "A06B" from "A06B-6089-H105" on its own, so the
// entry is resolved like this: every token that classifies on its own is a
// model candidate, and the whole entry is only joined back together when that
// leaves exactly zero or one candidate, which is what a model written with an
// internal space looks like ("6ES7 315-2AG10-0AB0", "A06B 6089 H105"). Two or
// more standalone candidates means the entry is a space separated list. Prose
// stays out because a word only classifies after the rules resolve a brand and
// a specific product type for it.
func confirmedModelsInEntry(segment string) []string {
	models := make([]string, 0, 4)
	seen := map[string]bool{}
	for _, candidate := range aiBulkImportCandidate.FindAllString(segment, -1) {
		model, ok := confirmedModelCandidate(candidate)
		if !ok {
			continue
		}
		identity := normalizePriceModel(model)
		if identity == "" || seen[identity] {
			continue
		}
		seen[identity] = true
		models = append(models, model)
	}
	if aiBulkImportNonASCII.MatchString(segment) {
		// An entry with words in another script is a list item, not a model
		// written with a space; only the tokens above may count.
		return models
	}
	if len(models) > 1 {
		// "A06B-1 A06B-2": several standalone models on one line.
		return models
	}
	// A description such as "1756-L71  AB PLC" would otherwise be glued into a
	// part number that does not exist. Words without a digit are prose, so more
	// than one of them means only the standalone models below may count.
	proseParts := 0
	for _, part := range strings.Fields(segment) {
		if !strings.ContainsAny(part, "0123456789") {
			proseParts++
		}
	}
	if proseParts > 1 {
		return models
	}
	if proseParts == 1 && len(models) > 0 {
		// A single trailing word after a confirmed model is a note, not a model
		// fragment, so the entry must not be rejoined.
		return models
	}
	joined := strings.Join(strings.Fields(segment), " ")
	whole, ok := confirmedModelCandidate(joined)
	if !ok {
		return models
	}
	if len(models) == 1 && whole == models[0] {
		return models
	}
	return []string{whole}
}

func confirmedModelCandidate(candidate string) (string, bool) {
	candidate = aiBulkImportLabel.ReplaceAllString(strings.TrimSpace(candidate), "")
	candidate = strings.Trim(candidate, "._-#/()\\")
	if candidate == "" || len(candidate) > aiAgentBulkImportMaxCandidateRunes {
		return "", false
	}
	if !strings.ContainsAny(candidate, "0123456789") || !strings.ContainsAny(candidate, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
		return "", false
	}
	model := services.NormalizeProductModel(candidate)
	if model == "" || !aiProductIdentifierPattern.MatchString(model) {
		return "", false
	}
	if !services.IsConfirmedProductCategory(services.InferProductCategory("", model), model) {
		return "", false
	}
	return model, true
}

func firstModelLikeCandidate(segment string) string {
	for _, candidate := range aiBulkImportCandidate.FindAllString(segment, -1) {
		trimmed := strings.Trim(candidate, "._-#/()\\")
		if len(trimmed) < aiAgentBulkImportMinCandidateRunes || len(trimmed) > aiAgentBulkImportMaxCandidateRunes {
			continue
		}
		if !strings.ContainsAny(trimmed, "0123456789") || !strings.ContainsAny(trimmed, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
			continue
		}
		return trimmed
	}
	return ""
}

// aiToolRunImportPastedModels creates the products for the model numbers in the
// administrator's current message. It writes directly (the administrator asked
// for one-paste publishing), so every guard the review flow had is applied here
// instead: an unresolved classification is reported rather than published, and
// categories go through the same guarded, serialized creation path the review
// flow uses.
func aiToolRunImportPastedModels(db *gorm.DB, rawArguments string, session *aiAgentToolSession) (any, error) {
	var args struct {
		AllowNewProductTypes bool  `json:"allow_new_product_types"`
		Publish              *bool `json:"publish"`
	}
	if err := decodeAIAgentToolArguments(rawArguments, &args); err != nil {
		return nil, err
	}
	if session == nil || strings.TrimSpace(session.userMessage) == "" {
		return nil, errors.New("this tool needs the administrator's current message")
	}

	scan := scanPastedProductModels(session.userMessage, aiAgentMaxBulkImportModels)
	if len(scan.Models) == 0 {
		return nil, errors.New("the administrator's message contains no model number the catalogue can classify; ask the administrator to paste the manufacturer model numbers, one per line, and do not guess the brand")
	}

	var setting *models.AIAgentSetting
	if session.setting != nil {
		setting = session.setting
	} else {
		loaded, err := getOrCreateAIAgentSetting(db)
		if err != nil {
			return nil, err
		}
		setting = loaded
	}
	if !aiProductCreationReady(setting) {
		return nil, errors.New("set the default warranty period and lead time before importing products")
	}
	publish := setting.AutoPublishNewProducts
	if args.Publish != nil {
		publish = *args.Publish
	}

	created := make([]gin.H, 0, len(scan.Models))
	createdRefs := make([]aiSEOProductRef, 0, len(scan.Models))
	skipped := make([]gin.H, 0)

	for _, model := range scan.Models {
		identity := normalizePriceModel(model)
		var existing models.Product
		findErr := db.Select("id", "sku").Where(
			"UPPER(REPLACE(TRIM(sku), ' ', '')) = ? OR UPPER(REPLACE(TRIM(model), ' ', '')) = ? OR UPPER(REPLACE(TRIM(part_number), ' ', '')) = ?",
			identity, identity, identity).First(&existing).Error
		if findErr == nil {
			skipped = append(skipped, gin.H{"model": model, "reason": "already in the catalogue", "sku": existing.SKU})
			continue
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return nil, findErr
		}

		inference := services.InferProductCategory("", model)
		if !services.IsConfirmedProductCategory(inference, model) {
			skipped = append(skipped, gin.H{"model": model, "reason": "brand or product type could not be verified from the model number"})
			continue
		}
		brand := services.CanonicalBrandName(inference.BrandKey)
		if brand == "" || strings.EqualFold(brand, "unknown") {
			skipped = append(skipped, gin.H{"model": model, "reason": "the manufacturer could not be resolved"})
			continue
		}
		productType := trimField(inference.PartType, 100)
		if productType == "" {
			skipped = append(skipped, gin.H{"model": model, "reason": "the product type could not be resolved"})
			continue
		}

		categoryID, _, categoryErr := services.ResolveOrCreateCategoryForAdministrator(db, inference, args.AllowNewProductTypes)
		if categoryErr != nil {
			skipped = append(skipped, gin.H{"model": model, "reason": trimField(categoryErr.Error(), 300)})
			continue
		}

		name := truncateRunes(strings.Join([]string{brand, model, productType}, " "), aiAgentBulkImportNameMaxRunes)
		shortDescription := fmt.Sprintf("%s %s %s. Manufacturer: %s. Type: %s. Model: %s.", brand, model, productType, brand, productType, model)
		request := models.ProductCreateRequest{
			SKU:              model,
			Name:             name,
			ShortDescription: shortDescription,
			Brand:            brand,
			Model:            model,
			PartNumber:       model,
			CategoryID:       categoryID,
			Price:            setting.DefaultProductPrice,
			StockQuantity:    0,
			WarrantyPeriod:   trimField(setting.DefaultWarrantyPeriod, 50),
			LeadTime:         trimField(setting.DefaultLeadTime, 50),
			IsActive:         publish,
			MetaTitle:        name,
			MetaDescription:  shortDescription,
			MetaKeywords:     strings.Join([]string{brand, model, productType}, ", "),
		}
		result, upsertErr := services.CreateProductFromRequest(db, request)
		if upsertErr != nil {
			skipped = append(skipped, gin.H{"model": model, "reason": trimField(upsertErr.Message, 300)})
			continue
		}
		createdProduct := result.Product
		createdRefs = append(createdRefs, aiSEOProductRef{ID: createdProduct.ID, SKU: createdProduct.SKU})
		created = append(created, gin.H{
			"id": createdProduct.ID, "sku": createdProduct.SKU, "name": createdProduct.Name,
			"brand": brand, "model": model, "product_type": productType,
			"category_id": categoryID, "published": createdProduct.IsActive,
		})
	}

	response := gin.H{
		"recognised_models":  len(scan.Models),
		"created_count":      len(created),
		"skipped_count":      len(skipped),
		"published":          publish,
		"created_products":   cappedRows(created, aiAgentBulkImportReportLimit),
		"skipped_items":      cappedRows(skipped, aiAgentBulkImportReportLimit),
		"unrecognised_count": scan.UnrecognisedTotal,
		"unrecognised_items": scan.Unrecognised,
		"image_note":         "no image was set; the storefront keeps generating the placeholder image for this model",
	}
	if len(created) > aiAgentBulkImportReportLimit {
		response["created_products_note"] = fmt.Sprintf("only the first %d created products are listed", aiAgentBulkImportReportLimit)
	}

	// The customer-facing copy is generated by the existing resumable AI job
	// engine, so a long import survives a restart and its progress is visible on
	// the AI SEO page instead of being tied to this conversation.
	if len(createdRefs) > 0 {
		job, jobErr := createAIAgentSEOJob(db, createdRefs, aiAgentBulkImportContentPrompt, "selected", session.userID)
		if jobErr != nil {
			response["content_job_error"] = trimField(jobErr.Error(), 300)
			response["content_job_note"] = "the products were created, but the AI content job could not be queued; start it again from the AI SEO page"
		} else {
			response["content_job_id"] = job.ID
			response["content_job_status"] = job.Status
			response["content_job_total"] = job.Total
		}
	}
	return response, nil
}

func cappedRows(rows []gin.H, limit int) []gin.H {
	if len(rows) <= limit {
		return rows
	}
	return rows[:limit]
}
