# Product Image Governance Design

## Architecture

The implementation adds two durable job types:

- `ProductImageCleanupJob`: stores the trusted-domain snapshot, product-scope cursor, counters, and worker lease.
- `ProductImageArchiveJob`: stores resumable upload offsets, temporary archive path, archive-processing cursor, counters, and worker lease.
- `ProductImageTrustedURL`: records an exact external URL when an administrator
  explicitly adds it in the product editor; this is narrower than trusting an
  entire CDN hostname.

Both workers use database status and worker tokens to fence stale goroutines. Startup converts interrupted `running` jobs back to `queued` and resumes them; `paused` jobs remain paused.

## Image ownership rules

An image is trusted when any condition is true:

1. It is a relative/local uploads path.
2. It is the public SKU default-image endpoint.
3. Its hostname is `vibocnc.com` or a subdomain.
4. Its normalized hostname equals or is a subdomain of a configured trusted hostname.
5. Its exact URL hash is present in `product_image_trusted_urls` from an
   administrator-approved product edit.

Non-HTTP values are preserved rather than guessed. Cleanup operates on exact parsed JSON values and never uses substring deletion.

## APIs

- `POST /admin/products/image-cleanup/preview`
- `POST /admin/products/image-cleanup/jobs`
- `GET /admin/products/image-cleanup/jobs/latest`
- `GET /admin/products/image-cleanup/jobs/:id`
- `POST /admin/products/image-cleanup/jobs/:id/pause`
- `POST /admin/products/image-cleanup/jobs/:id/resume`
- `GET /admin/media/:id/products`
- `POST /admin/media/sku-archive/jobs`
- `PUT /admin/media/sku-archive/jobs/:id/chunk?offset=N`
- `POST /admin/media/sku-archive/jobs/:id/complete`
- `GET /admin/media/sku-archive/jobs/latest`
- `GET /admin/media/sku-archive/jobs/:id`
- `POST /admin/media/sku-archive/jobs/:id/pause`
- `POST /admin/media/sku-archive/jobs/:id/resume`

Chunk bodies are raw `application/octet-stream`, kept small enough to pass existing reverse-proxy limits. The server uses positional writes and returns the authoritative next offset.

## ZIP processing and safety

- ZIP entries are read directly and never extracted by archive path.
- Paths are normalized, traversal and metadata folders are rejected, and only supported image extensions are opened.
- Archive size, entry count, per-entry uncompressed size, and total uncompressed size are bounded by environment-configurable limits.
- Images reuse the media library's optimization, SHA-256 deduplication, and `/uploads/media/...` storage convention.
- Product updates occur only after every usable image for that SKU has been stored successfully.

## UI design

The existing industrial admin layout remains authoritative. Three operational sections are added above the gallery:

1. Safe external-image cleanup with trusted-domain input, preview metrics, and background progress.
2. Resumable SKU ZIP import with format instructions, upload progress, processing counters, and pause/resume controls.
3. Media usage access from each asset action area, opening a product list with direct admin links.

Palette: slate status text, emerald completion, amber preview warnings, rose destructive confirmation. Existing typography is retained as a narrow design-system override. Heroicons remain the only icon set.

## Testing strategy

- Unit-test trusted URL classification, archive folder/SKU parsing, chunk offset rules, and exact URL matching.
- Route-registration tests cover every new endpoint.
- Run all Go tests and `go vet`.
- Run ESLint on changed frontend files and a production Next.js build.
- Browser-test the admin flow when a local authenticated environment is available; otherwise report the named gap.
