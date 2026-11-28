package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"fanuc-backend/models"
)

// This file turns a Datasheets.com record into a review row in the existing
// ProductSpecDraft queue. It exists so the provider integration reuses the
// catalogue's single publishing path: a draft is reviewed by an administrator,
// approval refuses any candidate without a source URL, and only then does a
// value reach Product.TechnicalSpecs.

// DatasheetDraftInput describes one draft request.
type DatasheetDraftInput struct {
	// Product is nil when the lookup was started from a bare part number.
	Product *models.Product
	Query   string
	Record  DatasheetRecord
	// Candidates are the parameters the administrator chose to keep.
	Candidates []SpecResearchCandidate
	UserID     uint
}

// StoreDatasheetSpecDraft persists the reviewed parameters as a pending draft.
// It supersedes older pending drafts for the same product so the queue never
// holds two competing proposals for one SKU.
func StoreDatasheetSpecDraft(db *gorm.DB, in DatasheetDraftInput) (*models.ProductSpecDraft, error) {
	if db == nil {
		return nil, errors.New("database connection failed")
	}
	if len(in.Candidates) == 0 {
		return nil, errors.New("no parameters were selected")
	}
	model := strings.TrimSpace(in.Record.MPN)
	if model == "" {
		model = strings.TrimSpace(in.Query)
	}
	brand := strings.TrimSpace(in.Record.Manufacturer)

	draft := &models.ProductSpecDraft{
		Brand:       brand,
		Model:       NormalizeProductModel(model),
		Status:      "pending",
		Confidence:  "medium",
		RequestedBy: in.UserID,
		Notes:       datasheetDraftNote(in),
	}
	if in.Product != nil {
		draft.ProductID = in.Product.ID
		draft.SKU = in.Product.SKU
		if draft.Model == "" {
			draft.Model = NormalizeProductModel(in.Product.Model)
		}
		if draft.Brand == "" {
			draft.Brand = in.Product.Brand
		}
	}

	result := SpecResearchResult{
		Brand:      draft.Brand,
		Model:      draft.Model,
		Candidates: in.Candidates,
		Confidence: draft.Confidence,
		Notes:      draft.Notes,
	}
	draft.CandidatesJSON = BuildSpecDraftPayload(result)
	draft.SpecsJSON = JSONObjectOrEmpty(TechnicalSpecsJSON(SpecCandidatesToMap(in.Candidates)))
	draft.EvidenceJSON = JSONArrayOrEmpty(datasheetEvidenceJSON(in.Record))

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(draft).Error; err != nil {
			return err
		}
		supersede := tx.Model(&models.ProductSpecDraft{}).
			Where("id <> ? AND status = ?", draft.ID, "pending")
		if draft.ProductID > 0 {
			supersede = supersede.Where("product_id = ?", draft.ProductID)
		} else if strings.TrimSpace(draft.SKU) != "" {
			supersede = supersede.Where("product_id = 0 AND sku = ?", draft.SKU)
		} else {
			// A draft for a bare model number only supersedes other bare drafts
			// of the same model: they are alternatives for the same decision.
			supersede = supersede.Where("product_id = 0 AND model = ?", draft.Model)
		}
		return supersede.Update("status", "superseded").Error
	})
	if err != nil {
		return nil, err
	}
	return draft, nil
}

// datasheetDraftNote explains where the proposal came from, including the
// licence condition that governs republishing the values.
func datasheetDraftNote(in DatasheetDraftInput) string {
	var b strings.Builder
	b.WriteString("Imported from the Datasheets.com product search API")
	if in.Record.MPN != "" {
		b.WriteString(" (record ")
		b.WriteString(in.Record.MPN)
		if in.Record.Manufacturer != "" {
			b.WriteString(", ")
			b.WriteString(in.Record.Manufacturer)
		}
		b.WriteString(")")
	}
	b.WriteString(". ")
	if in.Record.Lifecycle != "" {
		b.WriteString("Provider lifecycle status: " + in.Record.Lifecycle + ". ")
	}
	b.WriteString("Values are only published after this review. The provider terms require attribution and forbid mirroring their data, ")
	b.WriteString("so keep the link back to Datasheets.com when these parameters are shown publicly.")
	return b.String()
}

// datasheetEvidenceJSON stores the provider record alongside the draft so a
// reviewer can see the whole answer, not just the rows that were proposed.
func datasheetEvidenceJSON(record DatasheetRecord) string {
	evidence := []ProductWebEvidence{{
		URL:           record.URL,
		Title:         fmt.Sprintf("%s · %s %s", datasheetAttribution, record.Manufacturer, record.MPN),
		SourceType:    "datasheet-api",
		EvidenceLevel: "datasheet",
		Snippet:       strings.TrimSpace(record.Description),
	}}
	encoded, err := json.Marshal(evidence)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// DatasheetExactRecord finds the record whose part number matches the requested
// one exactly. An empty wantMPN falls back to the first exact match of the
// lookup, which is what the UI sends after a single-record result.
func DatasheetExactRecord(lookup *DatasheetLookup, wantMPN string) (DatasheetRecord, bool) {
	if lookup == nil {
		return DatasheetRecord{}, false
	}
	want := DatasheetQueryKey(wantMPN)
	if want == "" {
		return DatasheetBestExactRecord(lookup)
	}
	for _, record := range lookup.Records {
		if !record.ExactMatch {
			continue
		}
		if DatasheetQueryKey(record.MPN) == want {
			return record, true
		}
	}
	return DatasheetRecord{}, false
}

// DatasheetBestExactRecord returns the first exactly matching record, preferring
// one that actually carries parameters.
func DatasheetBestExactRecord(lookup *DatasheetLookup) (DatasheetRecord, bool) {
	if lookup == nil {
		return DatasheetRecord{}, false
	}
	var fallback *DatasheetRecord
	for i := range lookup.Records {
		record := lookup.Records[i]
		if !record.ExactMatch {
			continue
		}
		if len(record.Specs) > 0 {
			return record, true
		}
		if fallback == nil {
			copied := record
			fallback = &copied
		}
	}
	if fallback != nil {
		return *fallback, true
	}
	return DatasheetRecord{}, false
}

// DatasheetFilterCandidates keeps only the labels the reviewer ticked. The value
// always comes from the stored record, so a browser cannot inject a parameter
// the provider never published.
func DatasheetFilterCandidates(candidates []SpecResearchCandidate, keep []DatasheetSpec) []SpecResearchCandidate {
	if len(keep) == 0 {
		return candidates
	}
	allowed := make(map[string]struct{}, len(keep))
	for _, spec := range keep {
		label := CanonicalSpecLabel(spec.Name)
		value := strings.TrimSpace(spec.Value)
		if label == "" || value == "" {
			continue
		}
		allowed[datasheetCandidateKey(label, value)] = struct{}{}
	}
	filtered := make([]SpecResearchCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if _, ok := allowed[datasheetCandidateKey(candidate.Label, candidate.Value)]; ok {
			filtered = append(filtered, candidate)
		}
	}
	return filtered
}

func datasheetCandidateKey(label, value string) string {
	return strings.ToLower(strings.TrimSpace(label)) + "\x00" + strings.TrimSpace(value)
}

// DatasheetAttributionText is the credit line every surface showing this data
// must keep, per the provider terms.
func DatasheetAttributionText() string {
	return "Data from Datasheets.com — https://www.datasheets.com"
}

// DatasheetCacheAge renders how old a cached answer is, for the admin UI.
func DatasheetCacheAge(fetchedAt time.Time) string {
	return humanizeAge(time.Since(fetchedAt))
}
