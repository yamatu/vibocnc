package controllers

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

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
	// aiAgentBulkImportUnknownBrand and aiAgentBulkImportFallbackProductType are
	// what an imported model gets when the rules cannot name its manufacturer or
	// its type. The follow-up AI job replaces both with real values.
	aiAgentBulkImportUnknownBrand        = "Unbranded"
	aiAgentBulkImportFallbackProductType = "Industrial Spare Part"
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
	// aiBulkImportInvisible removes the invisible characters a paste out of a
	// spreadsheet, a PDF page or a chat window drags along (BOM, zero-width
	// joiners, non-breaking and full-width spaces). "A06B\u00a0-6089" is one model,
	// and a stray zero-width character must not split it into two.
	aiBulkImportInvisible = regexp.MustCompile("[\u00a0\u1680\u2000-\u200d\u202f\u205f\u3000\ufeff]")
)

// aiBulkImportProseWords are the words that share a line with real part numbers
// in quotations, packing lists and spreadsheets but are never part numbers
// themselves: quantities, units, currencies and column labels. Rejecting them
// keeps a pasted price column out of the import while leaving every genuine
// model number in it.
var aiBulkImportProseWords = map[string]bool{
	"pcs": true, "pc": true, "qty": true, "ea": true, "each": true, "set": true,
	"kit": true, "unit": true, "units": true, "total": true, "sum": true,
	"and": true, "the": true, "for": true, "with": true, "from": true,
	"price": true, "usd": true, "eur": true, "cny": true, "rmb": true,
	"moq": true, "new": true, "used": true, "ref": true, "stock": true,
	"lead": true, "time": true, "days": true, "day": true, "weeks": true,
	"months": true, "years": true, "note": true, "notes": true, "remark": true,
	"remarks": true, "model": true, "sku": true, "brand": true, "type": true,
	"origin": true, "gross": true, "net": true, "kg": true, "lbs": true,
	"mm": true, "cm": true, "inch": true, "watts": true, "kw": true, "hp": true,
	"rpm": true, "hz": true, "vdc": true, "vac": true, "amp": true, "amps": true,
}

// pastedModelScan is the deterministic result of reading a pasted list.
// Models holds what will be imported; Unrecognised holds what looked like a
// model but is not in the rule set, so the assistant can report it instead of
// silently dropping it.
type pastedModelScan struct {
	Models []string
	// Unconfirmed holds accepted models the deterministic rules cannot verify.
	// They are imported anyway - the administrator pasted a real list - but they
	// are reported so the catalogue can review them, and so nothing is dropped
	// silently.
	Unconfirmed       []string
	UnconfirmedTotal  int
	Unrecognised      []string
	UnrecognisedTotal int
	// Truncated counts the unique models left out because the list was longer
	// than one import allows, so the assistant can ask for the remainder instead
	// of silently dropping them.
	Truncated int
}

// scanPastedProductModels reads a pasted model list. Nothing here consults a
// language model: an entry is accepted only when the catalogue's own
// classification rules resolve both a brand and a specific product type, which
// is the same bar the import itself has to clear.
func scanPastedProductModels(text string, limit int) pastedModelScan {
	if limit <= 0 || limit > aiAgentMaxBulkImportModels {
		limit = aiAgentMaxBulkImportModels
	}
	text = aiBulkImportInvisible.ReplaceAllString(text, " ")
	scan := pastedModelScan{Models: make([]string, 0, 64), Unrecognised: make([]string, 0, 8)}
	seen := map[string]bool{}
	for _, rawSegment := range aiBulkImportSegmentSeparator.Split(text, -1) {
		segment := strings.TrimSpace(aiBulkImportBullet.ReplaceAllString(rawSegment, ""))
		segment = strings.TrimSpace(aiBulkImportLabel.ReplaceAllString(segment, ""))
		if segment == "" {
			continue
		}
		entryModels := modelsInEntry(segment)
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
			if len(scan.Models) >= limit {
				// Unique models past the limit are counted, not dropped quietly.
				scan.Truncated++
				continue
			}
			scan.Models = append(scan.Models, model)
			if !ruleConfirmedModel(model) {
				scan.UnconfirmedTotal++
				if len(scan.Unconfirmed) < aiAgentBulkImportReportLimit {
					scan.Unconfirmed = append(scan.Unconfirmed, model)
				}
			}
		}
	}
	return scan
}

// ruleConfirmedModel reports whether the catalogue's own deterministic rules
// resolve both a manufacturer and a specific product type for a model.
func ruleConfirmedModel(model string) bool {
	return services.IsConfirmedProductCategory(services.InferProductCategory("", model), model)
}

// modelShapeCandidate accepts a token that looks like a manufacturer part
// number, whether or not the deterministic rules know its family.
//
// The rule engine covers a fixed set of manufacturers, so requiring it before a
// pasted model may be imported is far too strict: a real list of Siemens,
// Schneider or ABB numbers sits almost entirely outside the rule set, and the
// import reported those lines instead of importing them. The shape test below is
// what actually separates a part number from prose; the rule engine then decides
// whether the classification is verified or needs review.
func modelShapeCandidate(candidate string) (string, bool) {
	candidate = aiBulkImportLabel.ReplaceAllString(strings.TrimSpace(candidate), "")
	candidate = strings.Trim(candidate, "._-#/()\\")
	if candidate == "" || len(candidate) > aiAgentBulkImportMaxCandidateRunes {
		return "", false
	}
	if !strings.ContainsAny(candidate, "0123456789") || !strings.ContainsAny(candidate, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
		return "", false
	}
	if aiBulkImportProseWords[strings.ToLower(candidate)] {
		return "", false
	}
	if !looksLikePartNumber(candidate) {
		return "", false
	}
	model := services.NormalizeProductModel(candidate)
	if model == "" || !aiProductIdentifierPattern.MatchString(model) {
		return "", false
	}
	return model, true
}

// looksLikePartNumber keeps field labels, units and ordinary words out of the
// import. A part number is written either with a separator ("3VA1125-4ED46",
// "MR-J4-70B"), or as a compact alphanumeric code carrying several digits
// ("3NE1815", "GOT1000"), or in capitals ("PTQPDPMV1").
func looksLikePartNumber(candidate string) bool {
	if strings.ContainsAny(candidate, "-_/.") {
		return true
	}
	if countCandidateDigits(candidate) >= 2 {
		return true
	}
	return len(candidate) >= 4 && candidate == strings.ToUpper(candidate)
}

func countCandidateDigits(candidate string) int {
	digits := 0
	for _, glyph := range candidate {
		if glyph >= '0' && glyph <= '9' {
			digits++
		}
	}
	return digits
}

// modelsInEntry decides how many models one entry holds.
//
// A pasted line can be a single model, or several models separated by spaces.
// Every token passing the shape test is a model candidate, and the tokens the
// rules can verify are preferred because two verified models on one line is
// unambiguous. Otherwise the complete tokens - those already written as a full
// part number rather than a fragment - are taken as a list, and anything else is
// joined back together, which is what a model written with an internal space
// looks like ("6ES7 315-2AG10-0AB0", "A06B 6089 H105"). A description such as
// "1756-L71  AB PLC" must never be glued into a part number that does not exist,
// so any word on the line means the tokens stand alone.
func modelsInEntry(segment string) []string {
	candidates := make([]string, 0, 4)
	verified := make([]string, 0, 4)
	complete := make([]string, 0, 4)
	seen := map[string]bool{}
	for _, token := range aiBulkImportCandidate.FindAllString(segment, -1) {
		model, ok := modelShapeCandidate(token)
		if !ok {
			continue
		}
		identity := normalizePriceModel(model)
		if identity == "" || seen[identity] {
			continue
		}
		seen[identity] = true
		candidates = append(candidates, model)
		if ruleConfirmedModel(model) {
			verified = append(verified, model)
		}
		if completePartNumberToken(token) {
			complete = append(complete, model)
		}
	}
	if len(verified) > 1 {
		return verified
	}
	if len(candidates) == 0 {
		return candidates
	}
	if aiBulkImportNonASCII.MatchString(segment) {
		// An entry with words in another script is a list item, not a model
		// written with a space; only the tokens above may count.
		return candidates
	}
	for _, part := range strings.Fields(segment) {
		if !strings.ContainsAny(part, "0123456789") {
			return candidates
		}
	}
	if len(complete) > 1 {
		// "A06B-1 A06B-2": several standalone models on one line.
		return candidates
	}
	joined := strings.Join(strings.Fields(segment), " ")
	if whole, ok := modelShapeCandidate(joined); ok {
		return []string{whole}
	}
	return candidates
}

// completePartNumberToken reports whether a token is already a full part number
// rather than a fragment of one, so a space separated list of them is not glued
// back into a single invented identifier.
func completePartNumberToken(token string) bool {
	if strings.ContainsAny(token, "-_/") {
		return true
	}
	return countCandidateDigits(token) >= 3
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
		// AcceptUnverifiedModels defaults to true: the administrator pasted a
		// list of real model numbers, so a model the rule engine cannot place is
		// imported with a fallback classification and reported for review rather
		// than silently dropped.
		AcceptUnverifiedModels *bool `json:"accept_unverified_models"`
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

	acceptUnverified := true
	if args.AcceptUnverifiedModels != nil {
		acceptUnverified = *args.AcceptUnverifiedModels
	}
	created := make([]gin.H, 0, len(scan.Models))
	createdRefs := make([]aiSEOProductRef, 0, len(scan.Models))
	skipped := make([]gin.H, 0)
	unverifiedRows := make([]gin.H, 0)
	unverifiedCount := 0

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

		// Two tiers. A model the deterministic rules can place goes through the
		// guarded, verified category path exactly as before. A model they cannot
		// place is still a real part number the administrator asked for: it is
		// imported under its brand category (or a shared fallback category when
		// even the brand is unknown) and reported as needing review, so a pasted
		// list of Siemens, Schneider or ABB numbers is no longer reported back
		// instead of imported.
		inference := services.InferProductCategory("", model)
		verified := services.IsConfirmedProductCategory(inference, model)
		brand := services.CanonicalBrandName(inference.BrandKey)
		if strings.EqualFold(strings.TrimSpace(brand), "unknown") {
			brand = ""
		}
		productType := trimField(inference.PartType, 100)
		classification := "verified"
		categoryID := uint(0)
		if verified && brand != "" && productType != "" {
			resolvedCategoryID, _, categoryErr := services.ResolveOrCreateCategoryForAdministrator(db, inference, args.AllowNewProductTypes)
			if categoryErr == nil {
				categoryID = resolvedCategoryID
			} else if !acceptUnverified {
				skipped = append(skipped, gin.H{"model": model, "reason": trimField(categoryErr.Error(), 300)})
				continue
			}
		}
		if categoryID == 0 {
			if !acceptUnverified {
				skipped = append(skipped, gin.H{"model": model, "reason": "brand or product type could not be verified from the model number"})
				continue
			}
			classification = "unverified"
			if brand == "" {
				brand = aiAgentBulkImportUnknownBrand
			}
			if productType == "" {
				productType = aiAgentBulkImportFallbackProductType
			}
			fallbackCategoryID, fallbackErr := ensureBulkImportFallbackCategory(db, brand)
			if fallbackErr != nil {
				skipped = append(skipped, gin.H{"model": model, "reason": trimField(fallbackErr.Error(), 300)})
				continue
			}
			categoryID = fallbackCategoryID
			unverifiedCount++
			unverifiedRows = append(unverifiedRows, gin.H{"model": model, "brand": brand, "category_id": categoryID})
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
			"classification": classification,
			"needs_review":   classification == "unverified",
		})
	}

	response := gin.H{
		"recognised_models":  len(scan.Models),
		"created_count":      len(created),
		"skipped_count":      len(skipped),
		"published":          publish,
		"created_products":   cappedRows(created, aiAgentBulkImportReportLimit),
		"skipped_items":      cappedRows(skipped, aiAgentBulkImportReportLimit),
		"unverified_count":   unverifiedCount,
		"unrecognised_count": scan.UnrecognisedTotal,
		"unrecognised_items": scan.Unrecognised,
		"image_note":         "no image was set; the storefront keeps generating the placeholder image for this model",
	}
	if scan.Truncated > 0 {
		response["over_limit_count"] = scan.Truncated
		response["over_limit_note"] = fmt.Sprintf(
			"only %d unique models are imported per message; %d more were left out, ask the administrator to paste the remaining models in one more message",
			aiAgentMaxBulkImportModels, scan.Truncated)
	}
	if len(created) > aiAgentBulkImportReportLimit {
		response["created_products_note"] = fmt.Sprintf("only the first %d created products are listed", aiAgentBulkImportReportLimit)
	}
	if unverifiedCount > 0 {
		response["unverified_items"] = cappedRows(unverifiedRows, aiAgentBulkImportReportLimit)
		response["unverified_note"] = fmt.Sprintf(
			"%d model(s) were imported with a fallback classification because the catalogue rules do not know their product family yet. They are published according to your setting and listed for review; the follow-up AI job writes their English copy, and a category task can classify them later.",
			unverifiedCount)
	}

	// The customer-facing copy is generated by the existing resumable AI job
	// engine, so a long import survives a restart and its progress is visible on
	// the AI SEO page instead of being tied to this conversation.
	if len(createdRefs) > 0 {
		// The scope marker keeps this a content + SEO run: the products were just
		// created from a pasted list, so their copy must be written even when the
		// catalogue's classifier cannot yet verify their identity. Their category
		// is left as imported and can be optimized by a separate task.
		job, jobErr := createAIAgentSEOJob(db, createdRefs, aiAgentBulkImportContentPrompt+"\n\n"+aiSEOScopeMarker+"seo,content]]", "selected", session.userID)
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

// ensureBulkImportFallbackCategory returns the category an imported model is
// filed under when the deterministic rules cannot verify its product type: the
// manufacturer's own category when the brand is known, otherwise one shared
// "Unbranded" category. Category creation is serialized through the same lock
// the verified path uses, so two concurrent imports cannot create it twice.
func ensureBulkImportFallbackCategory(db *gorm.DB, brand string) (uint, error) {
	brand = strings.TrimSpace(brand)
	if brand == "" {
		brand = aiAgentBulkImportUnknownBrand
	}
	var existing models.Category
	err := db.Where("is_active = ? AND parent_id IS NULL AND LOWER(name) = ?", true, strings.ToLower(brand)).First(&existing).Error
	if err == nil {
		return existing.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}
	category := models.Category{
		Name:        brand,
		Slug:        uniqueBulkImportCategorySlug(db, brand),
		Description: brand + " industrial automation parts",
		IsActive:    true,
	}
	if createErr := db.Create(&category).Error; createErr != nil {
		// A concurrent import may have created it between the lookup and the
		// insert; read it back instead of failing the product.
		if lookupErr := db.Where("is_active = ? AND parent_id IS NULL AND LOWER(name) = ?", true, strings.ToLower(brand)).First(&existing).Error; lookupErr == nil {
			return existing.ID, nil
		}
		return 0, createErr
	}
	return category.ID, nil
}

func uniqueBulkImportCategorySlug(db *gorm.DB, name string) string {
	base := utils.GenerateSlug(name)
	if base == "" {
		base = "unbranded"
	}
	slug := base
	for suffix := 2; suffix < 100; suffix++ {
		var count int64
		if err := db.Model(&models.Category{}).Where("slug = ?", slug).Count(&count).Error; err != nil {
			return slug
		}
		if count == 0 {
			return slug
		}
		slug = fmt.Sprintf("%s-%d", base, suffix)
	}
	return base + "-2"
}
