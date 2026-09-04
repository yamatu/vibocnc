# Product Catalog Transfer Design

## Archive contract

`product-catalog-v1.zip` contains:

```text
manifest.json
catalog.json
uploads/...       # only referenced local files that exist
```

The manifest stores format/version, source site identity, export timestamp,
counts, included relation types, checksums, and archive capabilities. Catalog
JSON uses stable portable DTOs and never exposes source primary keys as import
identities.

## Backend modules

- `models/product_catalog_transfer.go`: durable import job and portable DTOs.
- `services/product_catalog_export.go`: streaming relation export and referenced
  local-file collection.
- `services/product_catalog_import.go`: validation, preview, transformation,
  category-path resolution, SKU upsert, relation replacement, and job recovery.
- `controllers/product_catalog_backup.go`: export, resumable upload, preview,
  apply, status, pause/resume, and cancel endpoints.
- Existing `/admin/backup` authorization remains admin-only.

## Import phases

1. Create or resume upload job using filename, size, and fingerprint.
2. Upload sequential idempotent chunks into `UPLOAD_PATH/.imports/catalog`.
3. Validate ZIP limits, manifest version, checksums, and paths.
4. Build a preview without product writes.
5. Save selected conflict policy, brand map, text replacements, and category
   creation policy on the durable job.
6. Process products in deterministic SKU order with per-product transactions.
7. Restore referenced local files only after safe path validation.
8. Persist counts/errors and resume from the last completed SKU after restart.

## Compatibility rules

- Canonical DTO fields are independent from GORM structs.
- Unknown archive fields are ignored and recorded in preview warnings.
- Optional target tables are detected before relation writes.
- Category identity is normalized full path; parent categories are created
  before children when explicitly enabled.
- Product identity is normalized SKU.
- Slug conflicts are resolved using the target site's existing slug helpers.
- Text replacements run only on configured customer-facing strings and URLs.
- Brand mappings run only on the product/category brand value.

## Vcocnc repository repair

Use a clean worktree based on `fanucnewvco/origin/main`, because the current
working directory is 138 commits behind with 49 tracked deletions. Use
`C:\Users\98434\Desktop\fanucnewvco-main` (the complete pre-sync ZIP snapshot)
as the protected Vcocnc brand, domain, public-page, and yellow/black/gray palette
baseline. Port the catalog-transfer backend/admin modules into the clean
worktree. Replace hard-coded Vibocnc identity with Vcocnc/site configuration.
Preserve functional changes from the newer branch without copying older page
implementations over newer backend/admin logic.

## API outline

```text
GET    /api/v1/admin/backup/products/export
POST   /api/v1/admin/backup/products/import/jobs
PUT    /api/v1/admin/backup/products/import/jobs/:id/chunk?offset=N
POST   /api/v1/admin/backup/products/import/jobs/:id/complete
GET    /api/v1/admin/backup/products/import/jobs/:id
GET    /api/v1/admin/backup/products/import/jobs/:id/preview
POST   /api/v1/admin/backup/products/import/jobs/:id/apply
POST   /api/v1/admin/backup/products/import/jobs/:id/pause
POST   /api/v1/admin/backup/products/import/jobs/:id/resume
DELETE /api/v1/admin/backup/products/import/jobs/:id
```

## UI

Add a “Product Library Transfer” section to the existing backup page. It uses
the existing site's buttons, borders, typography, and spacing. No cross-repo
color class is copied. The section shows export, upload progress, preview
counts/warnings, editable exact brand mappings, site text replacements,
conflict policy, category creation option, and background-task progress.

## Verification

- Go unit tests for manifest parsing, path safety, field compatibility, brand
  mapping, text replacement, category ordering, and SKU conflict modes.
- Route registration tests and end-to-end service tests with representative
  archives from both schemas.
- Changed-file ESLint/type checks and production builds in both frontends.
- Docker builds for both repositories.
- Browser validation of export, preview, apply, resume, and Vcocnc palette.
