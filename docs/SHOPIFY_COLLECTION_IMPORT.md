# B-Automation Collection Import

The eBay extension can collect products from the public Shopify collection API and send them to the existing admin draft workflow.

## Source API

```text
https://www.b-automationservice.com/collections/{handle}/products.json?limit=250&page={page}
```

The extension keeps the original product object, including `id`, `title`, `handle`, `body_html`, `vendor`, `product_type`, `tags`, `variants`, `images`, `options`, and timestamps.

## Extension workflow

1. Load extension version 3.2.1 or newer.
2. Open the extension control page from the eBay extension action.
3. Enter one brand handle per line. The recommended starter set is `fanuc`, `omron`, `lenze`, `honeywell`, and `beckhoff`.
4. Start the crawl. Pages use a maximum of 250 products, default 1200 ms page delay, and default 2000 ms brand delay.
5. Pause, stop, or resume from the saved page checkpoint. Products are deduplicated by Shopify product ID across collections.
6. Use the optional brand filter to export JSON or upload only one brand.
7. Upload settings (batch size, brand filter, and duplicate-upload option) are saved locally. The upload panel polls the saved task progress and shows the actual batch number, processed count, success count, and failure count.

## Website contract

The extension sends normalized items to:

```text
POST /api/v1/admin/ebay-import-drafts/upload
Authorization: Bearer <admin-jwt>
{ "items": [ ... ] }
```

`source_type` is `shopify_collection`, `source_site` is `b-automationservice`, and the complete source product is preserved under `shopify_product` in `raw_payload`. The backend also normalizes direct Shopify `products.json` objects, so an API client can send the raw shape without using the extension mapper.

Products appear in the existing admin draft page. Review the suggested category and duplicate match before confirming import. Variant and option JSON is retained as draft attributes and in the raw payload because the current product model has no separate variant table.

## Large JSON files

The admin page uses the durable resumable importer for JSON files up to 1 GiB.
The upload is split into 5 MiB chunks (8 MiB maximum), stored below
`UPLOAD_PATH/.imports/ebay-json`, and processed by a database-backed worker.
If the browser or container restarts, selecting the same file resumes from the
last confirmed byte. The worker state survives a page refresh and a backend
restart; duplicate source items are skipped using listing/source keys and a
per-task payload fingerprint.

The endpoints are:

```text
POST  /api/v1/admin/ebay-import-drafts/json-import/tasks
PUT   /api/v1/admin/ebay-import-drafts/json-import/tasks/:id/chunk?offset=N
POST  /api/v1/admin/ebay-import-drafts/json-import/tasks/:id/complete
GET   /api/v1/admin/ebay-import-drafts/json-import/tasks/:id
POST  /api/v1/admin/ebay-import-drafts/json-import/tasks/:id/pause
POST  /api/v1/admin/ebay-import-drafts/json-import/tasks/:id/resume
```

Install `backend/migrations/20260903_add_ebay_import_json_tasks.sql` when
`DB_AUTO_MIGRATE=false`; otherwise the startup migration creates the two task
tables automatically.
