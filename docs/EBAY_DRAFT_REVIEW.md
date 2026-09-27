# Automated Draft Review (eBay listing → publishable product)

This document describes the AI review pass that turns a scraped eBay draft into
a product that is **ready to approve**. It covers the pipeline, the endpoints,
the data model and the boundaries that keep the pass from publishing anything on
its own.

## Why the pass exists

A scraped listing is dirty: the title is marketing text, the condition is a
seller's opinion, the category is eBay's, and many fields a product page needs do
not exist at all. Reviewing every draft by hand does not scale, but publishing
them automatically is worse — it would rewrite indexed pages and mint thousands
of new URLs from unverified data.

The pass sits between the two. It does the reading and the writing of a
*proposal*, and a human does the clicking.

```
plugin / crawler
      │  POST /admin/ebay-import-drafts/upload
      ▼
 EbayImportDraft  ──(ai_review_status)──┐
      │                                 │
      │  POST /admin/ebay-import-drafts/ai-review
      ▼                                 │
 EbayDraftReviewJob + items             │
      │                                 │
      │  services.ReviewDraft           │
      ▼                                 │
 proposal written on the draft ─────────┘   ai_review_status = ready
      │
      │  POST /admin/ebay-import-drafts/ai-review/approve
      ▼
 confirmDraftImport → Product (published)
```

## Endpoints

All under `/api/v1/admin/ebay-import-drafts`. They are registered **before** the
`/:id` routes because gin matches in registration order — `ai-review` would
otherwise be parsed as a draft id. `routes/ebay_draft_review_routes_test.go`
asserts that ordering.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/ai-review/summary` | Counts per review state, for the panel header |
| `GET` | `/ai-review/latest` | Most recent job, so a reload reconnects to a running pass |
| `POST` | `/ai-review` | Start a pass: `{ids}` or `{all_filtered, ...filters}` (`202`) |
| `GET` | `/ai-review/:jobId` | Job snapshot + per-item results |
| `POST` | `/ai-review/:jobId/pause` | Stop after the in-flight items |
| `POST` | `/ai-review/:jobId/resume` | Requeue interrupted items and continue |
| `POST` | `/ai-review/:jobId/cancel` | Abandon the job |
| `POST` | `/ai-review/approve` | **Publish** the selected ready drafts |
| `POST` | `/ai-review/reject` | Discard a proposal, keep the draft |

`ai_review_status` is also a list filter (`GET /admin/ebay-import-drafts`), which
is how the queue surfaces the rows that are waiting.

## What one review does

`services.ReviewDraft` (in `services/ebay_draft_review.go`) runs in order:

1. **Preflight** (`EbayDraftPreflight`) — refuse anything already imported or
   skipped, anything with no identifier, and anything with no title. A draft that
   fails here is marked, not silently dropped.

   The identifier is `NormalizedPartNumber` → `NormalizedMPN` →
   `NormalizedModel`, and identification cannot run without one. Marketplace
   listings frequently have no *Model* item specific, so
   `BuildEbayImportDraftWithContext` falls back to the part number written in the
   listing **title** (`utils.ExtractModelFromText`, matching the known part-number
   families only). Without that fallback such listings were permanently
   unreviewable: every batch reported *no reviewable drafts were selected*. A
   title that names no known part still yields no identifier, and such a draft
   must stay out of the queue rather than be guessed at.

   A selection whose drafts all fail the preflight returns `409` with each reason
   and its count (`services.EbayNoReviewableDraftsError`); a selection that only
   partly fails says so in the `202` message, so a batch that is quietly smaller
   than the selection is never mistaken for a full run. Only the drafts that got
   a job item are marked `queued`.
2. **Identify** — `IdentifyProduct` reads the model's eBay evidence (item
   specifics and category path rank above listing prose) and returns a
   `ProductProfile`. A model mismatch between the draft and the profile aborts
   the item rather than writing a proposal for the wrong part.
3. **Title** — `BuildProfileProductTitle`. A `skipped` status here means the
   existing name already matches the generated one, which is a success, not a
   failure.
4. **Category** — `ResolveDraftReviewCategory` (see below).
5. **Content** — `BuildProfileContent` for description and SEO. Generated copy
   never names a brand other than the product's own; foreign brand mentions are
   rejected by `ForeignBrandMentions`.

Every result is either a stored proposal or a recorded failure reason. Nothing is
written to `products`.

## Category resolution

`ResolveDraftReviewCategory` tries, in order:

1. The draft's own `SuggestedCategoryID`, but **only** when
   `taxonomy_status == matched` — an unconfirmed suggestion is not proof.
2. `ResolveExistingCategoryForInference`, which only returns a category whose
   path corroborates the inference.
3. `ResolveOrCreateCategoryForAdministrator`, which creates a parent named after
   the brand and a child named after the part type, e.g. `Fanuc > Fanuc Drive`.

Step 3 is gated on `IsConfirmedProductCategory(inference, model)` **and**
`!IsGenericProductType(inference.PartType)`. If either fails, the function
returns "no match" and the draft is left for a human. A generic `Spare Part`
branch is never created, and an unrecognised brand never gets a parent node.

Creating a node is serialized by `withCategoryCreationLock` and duplicate-safe
inside a transaction, so two workers cannot race into two `Fanuc` parents.

## Price

`ApplyDraftReviewToDraft` copies `NormalizedPrice` — the price actually collected
from eBay — straight onto the product request.

The `price_sync` factor (`CommercePolicySetting.PriceSyncFactor`) is a **separate,
opt-in** mechanism for re-pricing products that already exist. It is not applied
during draft review. See `services/price_sync.go`.

## Data model

`models/ebay_draft_review_job.go` defines two tables:

- `EbayDraftReviewJob` — status, counters, selection mode, progress.
- `EbayDraftReviewJobItem` — one row per draft with outcome and error text.

They are deliberately **not** `AIAgentSEOJob`: that model's `ProductID` column is
`NOT NULL`, and a draft is not a product. Reusing it would have required faking a
product id or relaxing a constraint the rest of the SEO pipeline depends on.

On the draft itself, `models/ebay_import_draft.go` adds:

- `AIReviewStatus`, `AIReviewedAt`, `AIReviewError`, `AIReviewNotes`
- `Proposed*` (name, descriptions, category, brand, model, part type, meta
  fields, images)

`ApplyDraftReviewToDraft` copies the `Proposed*` values onto the `Normalized*`
columns so the existing importer path is reused unchanged.

## Review states

| Value | Meaning |
| --- | --- |
| `''` | Not reviewed |
| `queued` | In a job, not started |
| `processing` | Being worked on |
| `ready` | **Proposal waiting for approval** |
| `approved` | Published via the approve endpoint |
| `rejected` | Proposal discarded, draft kept |
| `failed` | The pass could not produce a proposal; see `ai_review_error` |

Filtering by `unreviewed` matches `IS NULL OR = ''`. This goes through
`services.EbayDraftReviewStatusClause`, a pure function with its own test,
because an equality comparison on `unreviewed` would match zero rows and make the
filter look like an empty queue rather than a bug.

## UI

`frontend/src/components/admin/AIReviewPanel.tsx` renders the loop inside the
**采集草稿** tab of `Admin → eBay Drafts`:

- Start a pass over the selected rows, or everything matching the current filter.
- Pause / resume / cancel, with a terminal-style log.
- A list of `ready` drafts with checkboxes and per-row approve / reject.

The drafts table itself shows a `待批准` badge, the AI-proposed category, and the
error text for `failed` / `rejected` rows, so the queue is usable without opening
the panel.

### Queue navigation

The page carries the scrape → confirm → review → publish order itself:

- A **workflow strip** (`WORKFLOW_STEPS`) is four presets over the existing
  filters (新品待确认 / 待 AI 审核 / 待批准上架 / 已上架), so the next step is a click
  rather than a combination of dropdowns. Each step is only a filter, so it
  cannot show a different set than the filters it sets.
- A **下一步** column says what a row needs and, when it is blocked, why —
  `缺少型号/料号，AI 会跳过` is reported on the row *before* a batch is selected,
  instead of surfacing as a 409 afterwards.
- **Select all** addresses the filter, and the delete runs as a filter-based
  statement rather than an id array, so a queue of any size is deleted whole. The
  selection banner states that the delete covers every matching draft.

Error toasts go through `getErrorMessage`, which appends the API's `error`
detail to its `message` headline: the headline alone ("Failed to start AI
review") is not actionable.

## Publishing inside the run

The pass does not publish. A run publishes only when the request sets
`auto_publish`, which the UI exposes as 「直接上架」 (off by default, and stated in
both the button label and the option's help text).

`auto_publish` changes *when* a draft is imported, never *how*:

- `services.publishReadyDraft` calls the import entry point the import
  controller registers via `RegisterConfirmDraftImport` at startup. That is the
  same `confirmReviewedDraft` the manual approve button calls, so an
  auto-published product gets identical validation, duplicate handling and
  upsert. A second import path would be a second definition of "approved".
- A skip reason (`not_ready`, a duplicate, invalid data) is **not** counted as
  published. It is reported as an import failure so the run's summary says
  "published N" only when N products exist.
- `ready` and `imported` are separate counters, and an auto-publishing run's
  completion message reports `imported` rather than `ready`: describing a
  published draft as "pending approval" would describe work that no longer
  exists.
- The flag lives on the job row, so a resumed run publishes only if it was
  asked to. The publisher itself is a function and cannot be persisted, so
  `RunEbayDraftReviewJob` re-registers it for any job whose `auto_publish` is
  set — otherwise a run resumed after a restart would report every ready draft
  as an import failure.
- Publishers are keyed by job id, so a review-only run cannot start publishing
  because another job enabled it.

## Not implemented on purpose

- **No auto-publish by default.** The pass publishes only when the caller opts
  in per run (see above). There is no stored setting that makes publishing the
  default, because a default is exactly what turns a review queue into an
  unattended publisher.
- **No spec publishing.** Cited parameters become pending `ProductSpecDraft`
  rows, which are reviewed separately.
- **No re-review of `ready` rows.** The default selection excludes rows that
  already hold a proposal, so a second pass cannot overwrite a proposal an
  administrator is looking at. An explicit `ai_review_status` filter overrides
  that guard, and only that guard.
