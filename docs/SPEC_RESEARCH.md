# Model-Number Specification Research

How Vibocnc turns a model number (型号) into verified product parameters without
risking the quality of indexed pages.

## Why the pipeline is review-first

The storefront already ranks for a large number of product pages. Rewriting those
pages from an unattended web search would be the fastest way to lose that
ranking: a wrong voltage or the wrong weight makes a page worse than a page with
no specification table at all, and search engines treat mass low-confidence
rewrites as content churn.

So the pipeline has one hard rule:

> Researched parameters are **proposals**. They reach a live product page only
> after an administrator approves them. There is no auto-publish switch.

## Pipeline

```
model number (型号)
        │
        ├─ 1. Search   services.SpecResearchEvidence(ctx, brand, model)
        │              bounded + SSRF-safe fetch, manufacturer pages preferred,
        │              results cached (success 15m / failure 45s); up to 3 real
        │              pages are opened and up to 6 specification windows
        │              (700 chars each) are kept next to the classified snippet
        │
        ├─ 2. Extract  services.ExtractSpecCandidates(model, evidence)
        │              deterministic regex extraction, no inference
        │
        ├─ 3. AI pass  controllers.proposeSpecsWithAI(...)   (optional)
        │              the configured provider reads the *evidence text only*
        │
        ├─ 4. Verify   services.FilterSpecCandidatesByVerbatimEvidence(...)
        │              drops every value that is not literally on a cited page
        │
        └─ 5. Draft    models.ProductSpecDraft (status = pending)
                       waiting in Admin → Spec Research
                                    │
                                    └─ approve → Product.TechnicalSpecs
                                       (blank fields only, unless "overwrite")
```

### One spelling per parameter

Two pages rarely spell a parameter the same way (`Rated input voltage` vs
`Input voltage` vs `主电源电压`). Left alone, one product would end up with two
rows for the same measurement — or worse, two contradictory values.

`services.CanonicalSpecLabel` therefore folds known spellings and qualifiers onto
a single canonical label, and `services.CanonicalizeSpecMap` folds a whole table.
Unknown labels keep the reviewer's wording, because a parameter we do not
recognise is not ours to rename. Values are never dropped: the first non-empty
value wins and the map function never returns a row without a value.

### Conflicts are surfaced, not hidden

When several pages disagree, the stronger source is proposed
(`specSourceIsStronger`: manufacturer > distributor > aggregator), the other
values are recorded in the candidate's `alternatives` list, the candidate is
flagged `conflict`, and its confidence is downgraded. The review UI shows
"sources disagree" and the alternatives next to the value, so the operator makes
the decision instead of the pipeline silently keeping whichever page it read
first.

### Extraction rules (anti-fabrication)

A candidate is produced only when **all** of these hold:

1. The evidence is a real page. Search-engine result summaries are never a source,
   because the engine rewrites them and they often mix several products.
2. The evidence text contains the exact model identifier. This is what stops a
   neighbouring model's datasheet (`-H105` vs `-H106`) from being attributed to
   this product.
3. The extracted value is copied **verbatim** from that text — no unit conversion,
   no rounding, no "typical values".
4. The value passes a sanity check for its parameter family (for example an input
   voltage must end in `V`, `V AC` or `V DC`; an interface must be a known
   fieldbus/port name).

Recognised parameter families: input voltage, rated current, rated power,
frequency, weight, dimensions, max speed, encoder resolution, operating
temperature, protection class, insulation class, cooling method, mounting type,
interface, certifications.

### What the AI pass is allowed to do

The language model is an **extraction aid**, never a generator:

- it only receives the collected evidence text,
- it is told to omit anything not present in that text,
- every value it returns is re-checked against the evidence
  (`FilterSpecCandidatesByVerbatimEvidence`), and the value must appear verbatim,
- values that pass are tagged `origin: "ai"` in the review UI so a reviewer knows
  they came from the model rather than a regex match.

A model that invents `7.5 kW` for a product whose pages never mention it produces
an empty result, not a wrong parameter.

## Admin workflow

1. **Start research** — three entry points:
   - Admin → Spec Research (bare model number, no product row yet) — runs
     synchronously, because a single lookup is fast;
   - the **Research specs by model number** button on the product edit form
     (next to the 型号 / Model field) — queues a one-product task;
   - select products in Admin → Products and press **Research Specs** — queues a
     task for the selection (`only_missing` skips products that already have
     specifications).

   Catalogue products are always researched **on the AI job queue**, never inside
   the request: every product performs a real web lookup, so a synchronous batch
   used to time out mid-run, showed no progress and lost everything on a restart.
   A queued task gives the run item-level progress, pause / resume / stop, and
   automatic recovery after a restart, and it occupies the same overlap gate as
   content optimization so two tasks cannot research the same product at once.
   The task **never publishes**: each item only creates a review draft.
2. **Review** — each row shows the parameter, the value, the source page and the
   verbatim evidence snippet. Values whose citation is missing are refused by the
   API, so a value can never be approved without a source. The reviewer may
   correct a label/value before approving.
3. **Apply** — writes the selected parameters into the product's
   `technical_specs` column. Existing parameters are preserved unless
   "Overwrite parameters that are already published" is ticked.
4. **Reject** — closes the draft and records the reason; the product is untouched.

The product's generated content picks the approved values up on its next
regeneration, because `KnownTechnicalSpecs` is merged with the stored
`technical_specs` column in `enrichWithContentSkeleton`. Regeneration itself
stays opt-in, so existing indexed copy is not rewritten in bulk.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/v1/admin/products/spec-research` | bare model number: `{brand, model, sku?, use_ai?, force?}` → draft |
| `POST` | `/api/v1/admin/products/:id/spec-research` | queue a one-product task → `202` + job |
| `POST` | `/api/v1/admin/products/spec-research/batch` | `{product_ids, limit, only_missing?, use_ai?, force?}` → `202` + job |
| `POST` | `/api/v1/admin/ai-agent/seo/spec-jobs` | scope-filtered task: `{limit, category_id?, include_descendants?, brand?, search?, include_inactive?, only_missing?, use_ai?, force?}` |
| `GET` | `/api/v1/admin/products/spec-drafts` | `?status=&search=&product_id=&page=&page_size=` |
| `GET` | `/api/v1/admin/products/spec-drafts/:id` | draft + candidates + evidence |
| `POST` | `/api/v1/admin/products/spec-drafts/:id/approve` | body `{candidates?, overwrite?}` |
| `POST` | `/api/v1/admin/products/spec-drafts/:id/reject` | body `{reason?}` |

All of the above require `editor` or `admin` (unlike category jobs, which are
admin-only: a research task writes drafts, never product content).

Progress, pause / resume / stop and the per-product outcome are read through the
shared job endpoints (`GET /admin/ai-agent/seo/jobs/:id`,
`.../jobs/:id/items`, `.../jobs/:id/pause|resume|end`). Each completed item
carries `{draft_id, candidates, confidence, conflicts, reused}` in
`evidence_json`, which is what links a job row to the draft to review.

A draft created from a bare model number is linked to a product by SKU when it is
applied; if no product has that SKU the API asks the operator to start the
research from the product page. Re-running research for the same product and
model marks the older pending draft `superseded`, so the queue always has exactly
one current proposal per model.

## AI availability

The AI pass is an optional booster on top of deterministic extraction. At start
time the API checks the active provider: if none is configured the task is
created with `use_ai = false` and the response says so, instead of queueing work
that silently does nothing. A task that is already running keeps using the AI
profile it was created with, even if the administrator switches profiles
mid-run.

The pipeline and the content skeleton are brand agnostic. FANUC, Mitsubishi,
Siemens, ABB, Allen-Bradley, Omron, Yaskawa, Schneider, SICK, Tamagawa, Fluke,
Heidenhain, Lenze and Danfoss all flow through `EnrichProductByBrand`, and
generated copy never names a brand other than the product's own — a non-FANUC
page that mentioned FANUC used to be flagged as "needs brand refresh", which
caused a regeneration loop.

Legacy URL handling is intentional: `toProductPathId` still strips a leading
`FANUC-` so previously indexed product URLs keep working. Brand-prefixed part
numbers are accepted for every brand on the backend
(`services.StripKnownBrandPrefix` + `services.KnownBrandDisplayNames`) and in the
admin forms (`stripBrandPrefixFromModel` in `frontend/src/lib/utils.ts`).

## Commercial parameters are not part of the spec table

Shipping, warranty and return promises do **not** live in researched
specifications. They come from the admin-editable commerce policy
(`CommercePolicySetting`): transit time (for example `4-5 DAYS`), lead time,
warranty period, return window (`1 year`) and who pays return freight
(`shared`). See `docs/SHIPPING_RATES.md` and Admin → Commerce Policy.

## How this combines with the automatic (model-driven) optimization

Two layers fill the specification table, and the difference matters:

1. **Automatic optimization** (save-after-create, `POST /admin/products/optimize`,
   `bulk-optimize`) publishes `technical_specs` immediately, but only from values
   the catalogue already owns (`services.KnownTechnicalSpecs`): brand, model /
   part number, SKU, component type, condition, weight, dimensions, country of
   origin, MOQ, warranty, lead time, packaging and certifications. Nothing is
   invented, and a table that already exists is left untouched.
2. **Spec research** (this document) adds the deeper electrical/mechanical
   parameters that only a datasheet or nameplate carries. Those always land in
   the review queue first, because a wrong parameter is worse than a missing one.

The same product can use both: the automatic pass gives every record a valid
table, and approved research is merged over it (`services.MergeTechnicalSpecs`)
on the next regeneration, which writes both the JSON column and the
"Technical specifications" section of the generated body copy.
