# FANUC Bulk SEO Optimization

This project now supports batch FANUC SKU categorization and SEO enrichment for large catalogs.

## Go Version

The backend module is declared as `go 1.21`.

If you want all backend packages and controller tests to build cleanly, use Go 1.21 or newer.

Current environment note:
- `go1.19.8` can run the new bulk CLI command help output and service-level tests.
- Full controller package builds are blocked by upstream dependencies that require Go 1.20+.

## CLI: Batch Optimize Products

Run from [backend](/root/fanucnewvco/backend):

```bash
GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOPATH=/tmp/go \
go run ./cmd/bulk-seo-optimize -brand FANUC -batch-size 500
```

Common examples:

```bash
# Process only active FANUC products
GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOPATH=/tmp/go \
go run ./cmd/bulk-seo-optimize -brand FANUC -status active

# Process a limited sample first
GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOPATH=/tmp/go \
go run ./cmd/bulk-seo-optimize -brand FANUC -limit 100 -batch-size 100

# Force refresh existing content
GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOPATH=/tmp/go \
go run ./cmd/bulk-seo-optimize -brand FANUC -force

# Optimize a keyword subset
GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOPATH=/tmp/go \
go run ./cmd/bulk-seo-optimize -brand FANUC -search A06B
```

## Admin API Endpoints

Authenticated admin/editor routes:

- `PUT /api/v1/admin/products/bulk-auto-categorize`
- `PUT /api/v1/admin/products/bulk-categorize-optimize`
- `GET /api/v1/admin/products/optimization-status`
- `POST /api/v1/admin/products/optimize`
- `POST /api/v1/admin/products/bulk-optimize`

## What Gets Generated

For matching FANUC products, the optimizer can fill:

- Category assignment from SKU/model prefix
- Name
- Short description
- Long description
- Meta title
- Meta description
- Meta keywords
- Compatibility info
- Installation guide
- Maintenance tips
- Warranty / manufacturer / origin / lead time defaults
- FAQ records for product detail pages

## Recommended Rollout for 20k Products

1. Run a small sample:

```bash
GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOPATH=/tmp/go \
go run ./cmd/bulk-seo-optimize -brand FANUC -limit 100 -batch-size 100
```

2. Review several product pages and categories.

3. Run the full catalog:

```bash
GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOPATH=/tmp/go \
go run ./cmd/bulk-seo-optimize -brand FANUC -batch-size 500
```

4. Rebuild sitemap caches and submit the sitemap in Search Console / Bing Webmaster Tools.

## Docker Compose Production Workflow

The production compose file now includes a one-shot service:

- `backend_seo_optimize`

It uses the same backend image and DB environment as the production backend, but runs the batch optimizer once and exits.

Example:

```bash
docker compose build backend backend_seo_optimize
docker compose run --rm \
  -e SEO_OPTIMIZER_BRAND=FANUC \
  -e SEO_OPTIMIZER_BATCH_SIZE=500 \
  backend_seo_optimize
```

Sample-first run:

```bash
docker compose run --rm \
  -e SEO_OPTIMIZER_BRAND=FANUC \
  -e SEO_OPTIMIZER_BATCH_SIZE=100 \
  -e SEO_OPTIMIZER_LIMIT=100 \
  backend_seo_optimize
```

Force refresh existing records:

```bash
docker compose run --rm \
  -e SEO_OPTIMIZER_BRAND=FANUC \
  -e SEO_OPTIMIZER_FORCE=1 \
  backend_seo_optimize
```
