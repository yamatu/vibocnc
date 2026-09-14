package services

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"gorm.io/gorm"
)

// Learned classification rules turn one verified decision into a reusable
// fact.
//
// The audit trail already records how every automated classification ended, but
// nothing read it back: a second job touching the same brand and model paid for
// the same public search and the same AI classification again. Reading the
// history closes that loop, and also makes the taxonomy more stable, because
// two SKUs of one part number can no longer end up in different categories.
//
// Only decisions that were actually applied are learned: audit rows whose
// taxonomy was confirmed. An unresolved or rejected attempt is never promoted
// into a rule.
const (
	// LearnedClassificationRulePrefix marks a rule that was reconstructed from
	// an earlier decision rather than evaluated from scratch. It keeps
	// provenance visible in the audit trail, and makes it possible to reject a
	// learned rule that does not trace back to a verified source.
	LearnedClassificationRulePrefix = "learned:"

	// A model family shortcut is only trusted after the same family resolved to
	// the same product type more than once. One classification can be wrong;
	// two independent agreements are a much safer bet.
	learnedRuleFamilyMinApprovals = 2

	learnedRuleSuccessTTL = 60 * time.Second
	learnedRuleFailureTTL = 15 * time.Second
	// Bounded so one enormous audit table cannot be turned into an unbounded
	// process-local allocation.
	learnedRuleRowLimit = 20000

	// The shared snapshot keeps every instance on the same rule set instead of
	// letting each one rebuild the grouped query for itself.
	learnedRuleRedisKey        = "vibocnc:classification:learned-rules:v1"
	learnedRuleRedisTTL        = 10 * time.Minute
	learnedRuleSnapshotVersion = 1
)

// LearnedClassificationRule is one brand/model/type decision that survived
// review, together with the rule that originally produced it.
type LearnedClassificationRule struct {
	BrandKey   string `json:"brand_key"`
	BrandName  string `json:"brand_name"`
	PartType   string `json:"part_type"`
	SourceRule string `json:"source_rule"`
	Approvals  int    `json:"approvals"`
}

type learnedRuleRow struct {
	Brand       string
	Model       string
	ProductType string
	MatchRule   string
	Approvals   int
}

type learnedRuleIndex struct {
	byModel map[string]LearnedClassificationRule
	// byModelNoBrand serves products whose brand field is missing or a
	// marketplace placeholder. It only contains models that exactly one
	// manufacturer claims, so it can never guess between two vendors.
	byModelNoBrand map[string]LearnedClassificationRule
	byFamily       map[string]LearnedClassificationRule
}

type learnedRuleCache struct {
	mu       sync.Mutex
	index    *learnedRuleIndex
	expires  time.Time
	lastErr  error
	loads    int64
	rejected int64
}

var learnedRules learnedRuleCache

// InvalidateLearnedClassificationRules drops the cached index so the next
// lookup reloads it. Callers that change the audit trail in a way an
// administrator expects to take effect immediately (approving a candidate in
// the review queue) must call this.
func InvalidateLearnedClassificationRules() {
	learnedRules.mu.Lock()
	learnedRules.index = nil
	learnedRules.expires = time.Time{}
	learnedRules.mu.Unlock()
	// The shared snapshot has to go too, or one instance would immediately
	// restore the state it just invalidated.
	if client := config.GetRedis(); client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := client.Del(ctx, learnedRuleRedisKey).Err(); err != nil {
			log.Printf("classification: could not drop shared learned rules: %v", err)
		}
	}
}

// LearnedClassificationRuleStats reports cache state for diagnostics.
func LearnedClassificationRuleStats() (models int, families int, loads int64, rejected int64) {
	learnedRules.mu.Lock()
	defer learnedRules.mu.Unlock()
	if learnedRules.index != nil {
		models = len(learnedRules.index.byModel)
		families = len(learnedRules.index.byFamily)
	}
	return models, families, learnedRules.loads, learnedRules.rejected
}

func learnedRuleCacheKey(brandKey, value string) string {
	return NormalizeBrandKey(brandKey) + "\x00" + strings.ToUpper(strings.TrimSpace(value))
}

// classificationFamilyKey derives a stable series identifier such as
// "A06B-6089" from a full ordering code such as "A06B-6089-H105".
//
// Only explicit, segmented identifiers are used: an arbitrary string is not
// split, because dropping the tail of an unsegmented part number would claim
// that unrelated parts share a family.
func classificationFamilyKey(model string) string {
	normalized := strings.ToUpper(strings.TrimSpace(model))
	if normalized == "" {
		return ""
	}
	segments := strings.Split(normalized, "-")
	if len(segments) < 3 {
		return ""
	}
	tail := strings.TrimSpace(segments[len(segments)-1])
	// The trailing segment is a variant/option code. Anything longer is likely
	// a distinguishing part of the number itself, so leave it alone.
	if tail == "" || len(tail) > 4 {
		return ""
	}
	family := strings.TrimSpace(strings.Join(segments[:len(segments)-1], "-"))
	if len(family) < 4 {
		return ""
	}
	return family
}

// StripLearnedRulePrefix removes every "learned:" provenance prefix from a
// rule string, exposing the verified rule it was recorded from. Callers that
// ask "is this rule trustworthy?" must ask it about the inner rule.
func StripLearnedRulePrefix(rule string) string {
	rule = strings.ToLower(strings.TrimSpace(rule))
	for strings.HasPrefix(rule, LearnedClassificationRulePrefix) {
		rule = strings.TrimPrefix(rule, LearnedClassificationRulePrefix)
	}
	return rule
}

// IsVerifiedClassificationRule reports whether a rule string was produced by a
// source that verified the identity (public evidence naming the exact model, or
// an AI classification that passed every validator). Learned rules keep their
// original rule inside them so this check stays meaningful after a round trip
// through the database.
func IsVerifiedClassificationRule(rule string) bool {
	rule = StripLearnedRulePrefix(rule)
	return strings.HasPrefix(rule, "web:") || strings.HasPrefix(rule, "llm:")
}

// IsGenericProductType rejects placeholder type names that must never be
// published as a category. Kept in one place so imports, the AI classifier and
// the learned-rule loader all agree on what "not a real product type" means.
func IsGenericProductType(value string) bool {
	normalized := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " "))
	if normalized == "" {
		return true
	}
	return genericProductTypes[normalized]
}

var genericProductTypes = map[string]bool{
	"spare part": true, "spare parts": true, "part": true, "parts": true,
	"component": true, "components": true, "equipment": true,
	"product": true, "products": true, "other": true, "others": true,
	"misc": true, "unknown": true, "accessory": true, "accessories": true,
}

func learnedRuleFromRow(row learnedRuleRow) (LearnedClassificationRule, bool) {
	brandKey := NormalizeBrandKey(row.Brand)
	if brandKey == "" || brandKey == "unknown" {
		return LearnedClassificationRule{}, false
	}
	if !IsVerifiedClassificationRule(row.MatchRule) {
		return LearnedClassificationRule{}, false
	}
	partType := CanonicalProductType(row.ProductType)
	if IsGenericProductType(partType) {
		return LearnedClassificationRule{}, false
	}
	brandName := CanonicalBrandName(brandKey)
	if brandName == "" {
		brandName = strings.TrimSpace(row.Brand)
	}
	if brandName == "" {
		return LearnedClassificationRule{}, false
	}
	return LearnedClassificationRule{
		BrandKey:   brandKey,
		BrandName:  brandName,
		PartType:   partType,
		SourceRule: strings.ToLower(strings.TrimSpace(row.MatchRule)),
		Approvals:  row.Approvals,
	}, true
}

// buildLearnedRuleIndex converts audit rows into lookup tables. Exact-model
// entries win over family entries, and family entries are only created when the
// whole family agreed on one product type.
func buildLearnedRuleIndex(rows []learnedRuleRow) *learnedRuleIndex {
	index := &learnedRuleIndex{
		byModel:        make(map[string]LearnedClassificationRule, len(rows)),
		byModelNoBrand: make(map[string]LearnedClassificationRule),
		byFamily:       make(map[string]LearnedClassificationRule),
	}
	type familyTally struct {
		rule      LearnedClassificationRule
		approvals int
		distinct  map[string]bool
	}
	families := make(map[string]*familyTally)
	// modelBrands tracks how many manufacturers a model string was seen under.
	modelBrands := make(map[string]map[string]bool)

	for _, row := range rows {
		rule, ok := learnedRuleFromRow(row)
		if !ok {
			continue
		}
		modelKey := classificationFamilyModelKey(row.Model)
		if modelKey == "" {
			continue
		}
		key := learnedRuleCacheKey(rule.BrandKey, modelKey)
		if existing, found := index.byModel[key]; !found || rule.Approvals > existing.Approvals {
			index.byModel[key] = rule
		}
		brands, found := modelBrands[modelKey]
		if !found {
			brands = map[string]bool{}
			modelBrands[modelKey] = brands
		}
		brands[rule.BrandKey] = true
		// The same model string must not resolve to two different types; keep
		// the strongest one, and let the family tally see both so it refuses to
		// generalise.
		family := classificationFamilyKey(row.Model)
		if family == "" {
			continue
		}
		familyKey := learnedRuleCacheKey(rule.BrandKey, family)
		tally, found := families[familyKey]
		if !found {
			tally = &familyTally{rule: rule, distinct: map[string]bool{}}
			families[familyKey] = tally
		}
		tally.approvals += rule.Approvals
		tally.distinct[rule.PartType] = true
		if rule.Approvals > tally.rule.Approvals {
			tally.rule = rule
		}
	}

	for modelKey, brands := range modelBrands {
		if len(brands) != 1 {
			continue
		}
		for brandKey := range brands {
			if rule, found := index.byModel[learnedRuleCacheKey(brandKey, modelKey)]; found {
				index.byModelNoBrand[modelKey] = rule
			}
		}
	}

	for familyKey, tally := range families {
		if len(tally.distinct) != 1 || tally.approvals < learnedRuleFamilyMinApprovals {
			continue
		}
		rule := tally.rule
		rule.Approvals = tally.approvals
		index.byFamily[familyKey] = rule
	}
	return index
}

func classificationFamilyModelKey(model string) string {
	return strings.ToUpper(strings.TrimSpace(model))
}

func learnedRuleIndexFromDB(db *gorm.DB) (*learnedRuleIndex, error) {
	var rows []learnedRuleRow
	err := db.Model(&models.ProductClassificationAudit{}).
		Select("brand, model, product_type, match_rule, COUNT(*) AS approvals").
		Where("status = ?", "completed").
		Where("brand <> '' AND model <> '' AND product_type <> ''").
		Group("brand, model, product_type, match_rule").
		Limit(learnedRuleRowLimit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return buildLearnedRuleIndex(rows), nil
}

func learnedRuleIndexCached(db *gorm.DB) *learnedRuleIndex {
	learnedRules.mu.Lock()
	defer learnedRules.mu.Unlock()
	now := time.Now()
	if learnedRules.index != nil && now.Before(learnedRules.expires) {
		return learnedRules.index
	}
	// Without a database there is nothing to rebuild the index from.
	if db == nil {
		return nil
	}
	// Another instance may have already rebuilt the same snapshot. Reusing it
	// avoids repeating the grouped scan of the audit table per process.
	if index := loadSharedLearnedRuleIndex(); index != nil {
		learnedRules.index = index
		learnedRules.expires = now.Add(learnedRuleSuccessTTL)
		return index
	}
	index, err := learnedRuleIndexFromDB(db)
	learnedRules.loads++
	if err != nil {
		// A transient database problem must not disable classification, and
		// must not turn one failed query into a query per product either.
		learnedRules.lastErr = err
		learnedRules.index = nil
		learnedRules.expires = now.Add(learnedRuleFailureTTL)
		log.Printf("classification: could not load learned rules: %v", err)
		return nil
	}
	learnedRules.lastErr = nil
	learnedRules.index = index
	learnedRules.expires = now.Add(learnedRuleSuccessTTL)
	storeSharedLearnedRuleIndex(index)
	return index
}

// learnedRuleSnapshot is the wire form of a rule index. It exists because the
// index itself is deliberately opaque (unexported maps), while the snapshot has
// to survive a round trip through Redis.
type learnedRuleSnapshot struct {
	Version        int                                  `json:"version"`
	ByModel        map[string]LearnedClassificationRule `json:"by_model"`
	ByModelNoBrand map[string]LearnedClassificationRule `json:"by_model_no_brand"`
	ByFamily       map[string]LearnedClassificationRule `json:"by_family"`
}

// loadSharedLearnedRuleIndex reads the snapshot another instance published.
// Every failure is silent on purpose: the local database load is the fallback,
// so a missing or corrupt cache must never change behaviour.
func loadSharedLearnedRuleIndex() *learnedRuleIndex {
	client := config.GetRedis()
	if client == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	raw, err := client.Get(ctx, learnedRuleRedisKey).Bytes()
	if err != nil {
		return nil
	}
	var snapshot learnedRuleSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		log.Printf("classification: ignoring unreadable shared learned rules: %v", err)
		return nil
	}
	if snapshot.Version != learnedRuleSnapshotVersion || snapshot.ByModel == nil {
		return nil
	}
	index := &learnedRuleIndex{
		byModel:        snapshot.ByModel,
		byModelNoBrand: snapshot.ByModelNoBrand,
		byFamily:       snapshot.ByFamily,
	}
	if index.byModelNoBrand == nil {
		index.byModelNoBrand = map[string]LearnedClassificationRule{}
	}
	if index.byFamily == nil {
		index.byFamily = map[string]LearnedClassificationRule{}
	}
	return index
}

func storeSharedLearnedRuleIndex(index *learnedRuleIndex) {
	client := config.GetRedis()
	if client == nil || index == nil {
		return
	}
	payload, err := json.Marshal(learnedRuleSnapshot{
		Version:        learnedRuleSnapshotVersion,
		ByModel:        index.byModel,
		ByModelNoBrand: index.byModelNoBrand,
		ByFamily:       index.byFamily,
	})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Set(ctx, learnedRuleRedisKey, payload, learnedRuleRedisTTL).Err(); err != nil {
		log.Printf("classification: could not publish shared learned rules: %v", err)
	}
}

// LearnedClassificationRuleFor returns a previously verified rule for one
// product identity. An empty brand is allowed: an exact model identifier
// determines the part on its own, and imported products often carry a
// placeholder brand. A brand that disagrees with the stored rule is a conflict
// and yields no rule, so the normal verification path runs instead.
func LearnedClassificationRuleFor(db *gorm.DB, brand, model string) (LearnedClassificationRule, bool) {
	index := learnedRuleIndexCached(db)
	if index == nil {
		return LearnedClassificationRule{}, false
	}
	brandKey := NormalizeBrandKey(brand)
	modelKey := classificationFamilyModelKey(model)
	if modelKey == "" {
		return LearnedClassificationRule{}, false
	}
	if brandKey != "" && brandKey != "unknown" {
		if rule, found := index.byModel[learnedRuleCacheKey(brandKey, modelKey)]; found {
			return rule, true
		}
	} else {
		// Without a brand the model alone has to identify the rule uniquely.
		// byModelNoBrand only holds models that one manufacturer claims.
		if rule, found := index.byModelNoBrand[modelKey]; found {
			return rule, true
		}
	}
	familyKey := classificationFamilyKey(modelKey)
	if familyKey == "" {
		return LearnedClassificationRule{}, false
	}
	if rule, found := index.byFamily[learnedRuleCacheKey(brandKey, familyKey)]; found {
		return rule, true
	}
	return LearnedClassificationRule{}, false
}

// LearnedClassificationInference exposes a learned rule as a normal inference.
// The model string is required so the same confirmation rules that guard every
// other classifier apply here too.
func LearnedClassificationInference(db *gorm.DB, brand, model string) (ProductCategoryInference, bool) {
	rule, ok := LearnedClassificationRuleFor(db, brand, model)
	if !ok {
		return ProductCategoryInference{}, false
	}
	inference := ProductCategoryInference{
		BrandKey:     rule.BrandKey,
		BrandName:    rule.BrandName,
		PartType:     rule.PartType,
		CategorySlug: utils.GenerateSlug(rule.PartType),
		MatchRule:    LearnedClassificationRulePrefix + rule.SourceRule,
	}
	if !IsConfirmedProductCategory(inference, model) {
		learnedRules.mu.Lock()
		learnedRules.rejected++
		learnedRules.mu.Unlock()
		return ProductCategoryInference{}, false
	}
	return inference, true
}
