# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is a full-stack FANUC industrial automation parts e-commerce platform with a Next.js frontend and Go backend. The system handles product catalog management, order processing with PayPal integration, and a comprehensive admin panel.

## Development Commands

### Frontend (Next.js)
```bash
# Development
cd frontend
npm run dev                    # Start development server on localhost:3000

# Building
npm run build                  # Production build
npm run build:development     # Development build
npm run start                 # Start production server

# Linting
npm run lint                  # Run ESLint
```

### Backend (Go)
```bash
# Development
cd backend
go run main.go                # Start development server on localhost:8080

# Building
go build -o fanuc-backend main.go    # Build production binary
./fanuc-backend                       # Run production binary

# Database
# Auto-migration runs on startup, creates tables and seeds default data
```

## Architecture Overview

### Tech Stack
- **Frontend**: Next.js 15.5.2, React 19, TypeScript, TailwindCSS 4
- **Backend**: Go 1.21, Gin framework, GORM ORM
- **Database**: MySQL 8.0+ with comprehensive e-commerce schema
- **Auth**: JWT tokens with role-based access (admin/editor/viewer)

### API Configuration
- **Frontend API Base**: `http://127.0.0.1:8080/api/v1` (development)
- **Backend Port**: 8080
- **Frontend Port**: 3000 (or 3001 if 3000 in use)

### Database Architecture
The MySQL database has 17+ tables with complete e-commerce functionality:
- **Core**: products, categories, orders, order_items, payment_transactions
- **Auth**: admin_users with role-based permissions
- **Content**: banners, homepage_contents, company_profiles
- **i18n**: Multi-language support with translation tables
- **SEO**: seo_redirects, structured data support

Auto-migration creates all tables and seeds:
- Default admin user: `admin` / `admin123`
- 6 default product categories (PCB Boards, I/O Modules, etc.)
- Company profile data

## Key Architectural Patterns

### Frontend Data Flow
1. **API Services** (`src/services/`) - Axios-based service layer for each entity
2. **Type Safety** (`src/types/`) - Comprehensive TypeScript definitions
3. **State Management** - Zustand for client state, TanStack Query for server state
4. **Error Handling** - Centralized API error handling with toast notifications
5. **Auth Flow** - JWT tokens stored in secure cookies, middleware for route protection

### Backend Structure
```
backend/
├── controllers/     # HTTP request handlers, one per entity
├── models/         # GORM database models with relationships
├── middleware/     # Auth, CORS, role-based access control
├── routes/         # API route definitions (public, auth, admin)
├── config/         # Database connection and auto-migration
└── utils/          # Helper functions (password hashing, etc.)
```

### API Endpoints Structure
```
/api/v1/
├── public/          # Unauthenticated (products, categories, banners, commerce-policy)
├── auth/           # Login, profile management
├── admin/          # Protected admin endpoints (requires authentication)
│   ├── products    # Product CRUD with image management
│   │   ├── spec-research        # Model-number parameter research (creates drafts)
│   │   └── spec-drafts          # Draft endpoints (no standalone page; see below)
│   ├── ebay-import-drafts  # Scraped listing queue + eBay market/pricing tab
│   ├── commerce-policy # Editable shipping / warranty / return promise
│   ├── categories  # Category management
│   ├── orders      # Order management (admin only)
│   ├── users       # User management (admin only)
│   └── dashboard   # Analytics (admin/editor)
└── orders/         # Public order creation and payment processing
```

## Important Implementation Details

### Authentication & Authorization
- **JWT Secret**: Configured in `.env` file
- **Role Hierarchy**: admin > editor > viewer
- **Middleware Chain**: `AuthMiddleware()` → `AdminOnly()/EditorOrAdmin()`
- **Frontend Guards**: Route middleware checks auth status and redirects

### Order System Architecture
- **Order Creation**: Public endpoint at `/orders` (no auth required)
- **Payment Processing**: PayPal integration at `/orders/:id/payment`
- **Order Tracking**: Public endpoint at `/orders/track/:orderNumber`
- **Stock Management**: Automatic inventory updates on payment confirmation
- **Order Status Flow**: pending → confirmed → processing → shipped → delivered

### Frontend SEO Implementation
- **Structured Data**: JSON-LD for products, company, breadcrumbs
- **Meta Tags**: Dynamic meta titles, descriptions, Open Graph
- **Sitemap**: Primary submission entry at `/sitemap.xml`, which serves the Next.js sitemap index and discovers child sitemaps automatically
- **Image Optimization**: Next.js Image component with lazy loading

### Commercial Promise (single source of truth)
- **Model**: `backend/models/commerce_policy.go` (`CommercePolicySetting`, single row, ID=1)
- **Accessor**: `services.GetCommercePolicy(db)` / `services.CurrentCommercePolicy()` (never read the table directly from a controller)
- **Public API**: `GET /api/v1/public/commerce-policy`; admin editor at `Admin → Commerce Policy`
- **Never hardcode** shipping/transit time, lead time, warranty period, return window, destination scope or who pays return freight in templates or components. Use the policy:
  - Backend: `services.CurrentCommercePolicy()`, `CommercePolicyWarrantyText`, `CommercePolicyLeadTimeText`, `CommercePolicyShipsWorldwide`, `CommercePolicyCountryList`, `CommercePolicyCarrierList`, `CommercePolicyReturnShippingText`, `shipScopeOf` (inside generated copy)
  - Frontend: `commercePolicyTransitText`, `resolveLeadTime`, `resolveWarrantyPeriod`, `commercePolicyReturnWindowText`, `commercePolicyReturnShippingText`, `commercePolicyDestinationCountries` (`frontend/src/lib/commerce-policy.ts`)
- `GLOBAL` in `shipping_destination_countries` means worldwide; a country list makes generated copy say e.g. "shipping to US, CA" instead of "worldwide shipping"
- Landing pages, admin forms (`new`/`edit` product, bulk commerce fill, AI assistant defaults) and meta descriptions all read this policy; editing it must also mean updating `/shipping-policy`, `/warranty-policy`, `/returns` under **Admin → Site Pages**
- **Client vs server**: pure helpers live in `@/lib/commerce-policy`; the React-`cache()` fetch lives in `@/services/commerce-policy.server.ts` (client components must not import it)
- **FAQ**: `frontend/src/lib/faq-content.ts` is the single list rendered both as visible `<details>`/panels and as FAQPage JSON-LD

### Product Content (brand agnostic)
- **Skeleton**: `services.BuildProductContentSkeleton` is used for every brand (FANUC, Mitsubishi, Siemens, …); `FanucEnrich` is only a delegating shim
- Generated copy must never name a brand other than the product's own — foreign brand mentions are detected by `services.ForeignBrandMentions` (token based, so "ABB" never matches inside "cable") and trigger a content refresh
- Content regeneration is **opt-in**; never mass-rewrite indexed pages
- Brand-prefixed part numbers resolve for every brand: `services.StripKnownBrandPrefix` + `services.KnownBrandDisplayNames` (backend SKU lookup, XLSX importer, media filenames via `utils.ParseModelFromFilename`) and `stripBrandPrefixFromModel` (`frontend/src/lib/utils.ts`)
- Legacy product URLs keep working: `toProductPathId` still strips a leading `FANUC-` (intentional — do not change without a redirect plan)

#### What the model number alone can fill
`enhanceProductContent` (used by save-after-create, `POST /admin/products/optimize` and `bulk-optimize`) derives everything below from the model number plus columns the catalogue already owns. Fields are only written when empty/short, so published copy is never rewritten:

| Field | Source |
| --- | --- |
| `name` | brand + model + inferred component type (only when empty) |
| `short_description`, `description` | brand-agnostic skeleton |
| `meta_title`, `meta_description`, `meta_keywords` | skeleton + commerce policy |
| `compatibility_info`, `installation_guide`, `maintenance_tips` | skeleton |
| `technical_specs` (JSON) | `services.KnownTechnicalSpecs` — brand, model/part number, SKU, component type, condition, weight, dimensions, origin, MOQ, warranty, lead time, packaging, certifications |
| `warranty_period`, `lead_time` | `services.CurrentCommercePolicy()` |
| `manufacturer`, `origin_country`, `brand`, `model`, `part_number` | canonical brand / catalogue defaults |
| `category_id`, `is_active` | `services.InferProductCategory` (+ web evidence, taxonomy gate) |
| product FAQs | `upsertGeneratedProductFAQs` |
| `seo_score`, `last_optimized_at` | `calculateSEOScore` (weights images, specs, compliance and logistics fields) |

Not derivable from a model number (never invented): price, stock, weight, dimensions, condition, images, datasheet/manual URLs, related products. Deeper parameters (rated output, voltage, interface …) come only from an approved research draft in `Admin → Spec Research`.

The single source of truth for the list above is `controllers.modelDerivedFields`; `GET /admin/products/optimization-status` returns `field_coverage` (missing products per field, one aggregate query via `fieldCoverageSelections`) and the products admin page renders it as a "what can still be filled" panel. `TestModelOnlyRecordCoversModelDerivableFields` fails if the generator and that list ever drift apart.

### Spec Research (model number → parameters)

> The standalone `Admin → Spec Research` review page was removed. The endpoints
> below are unchanged and still back the product edit form and the profile review
> panel.
- Endpoints: `POST /admin/products/spec-research` (bare model number, synchronous), `POST /admin/products/spec-research/batch` and `POST /admin/products/:id/spec-research` (queue an AI job, `202`), `POST /admin/ai-agent/seo/spec-jobs` (scope-filtered job), `GET /admin/products/spec-drafts[/:id]`, `POST /admin/products/spec-drafts/:id/{approve,reject}` (`backend/routes/routes.go`, asserted by `routes/spec_draft_routes_test.go`)
- **Catalogue products are always researched on the AI job queue** (`controllers/ai_seo_spec_jobs.go`, `aiSEOSpecSelectionMode = "spec_research"`): a synchronous batch timed out, showed no progress and lost work on restart. Job kinds that only write drafts (`category_optimization`, `spec_research`) are the ones `ResumeSEOJob` requeues for and `controllers.finalizeDraftJob` finalizes; content jobs must never be requeued.
- A spec job **never calls `publishAIAgentSEOJobCompletion`** — it publishes nothing, so there is no cache to invalidate and no URL to submit. It also has no dedicated capacity cap; it counts against `maxActiveAISEOJobs=8` only, because `validateAISEOJobCapacity`'s signature is test-asserted.
- UI: `Admin → eBay Drafts` (`/admin/ebay-import-drafts`) is the single hub for the scraped-listing workflow, with two tabs: **采集草稿** (the queue plus the AI review pass below) and **市场调研 / 价格** (eBay market quotes, price suggestions, product-profile drafts). The former standalone `/admin/ebay-market` page now redirects to `?tab=market` — the two are one workflow (scrape → review → price → publish), so they must not drift apart.
- The spec-draft **review page was removed**; `Admin → Spec Research` no longer exists as a nav entry. The `/admin/products/spec-drafts` **endpoints remain** and are still used by the product edit form ("Research specs by model number") and by `ProductProfileReviewPanel`. Deleting the page did not delete the API.
- Every brand-agnostic detail of the pipeline is covered by `docs/SPEC_RESEARCH.md` (services) and `docs/EBAY_DRAFT_REVIEW.md` (the automated review pass).
- Approval writes `product.technical_specs`; the value flows into generated copy on the next regeneration (opt-in) and is rendered by the storefront spec table
- `services.ResearchProductSpecs` searches public evidence and extracts parameters verbatim; `models.ProductSpecDraft` holds the review queue. Nothing is auto-published, and every candidate needs a cited `SourceURL`
- Details: `docs/SPEC_RESEARCH.md`

### Automated Draft Review (eBay listing → publishable product)

Admin → eBay Drafts can run an AI pass over scraped drafts. It is the only path
the plugin/爬虫 feeds into that can end in a published product, so its boundaries
are strict:

- **The pass never publishes.** `services.ReviewDraft` writes a proposal onto the
draft (`ai_review_status = ready` plus the `Proposed*` columns). A product is
created only by `ApproveReview`, which reuses `confirmDraftImport` so an approved
draft passes exactly the same validation, duplicate handling and upsert as a
manually confirmed one. There is no auto-publish switch, by design: `AGENTS.md`
forbids silently rewriting indexed pages, and bulk auto-publishing would create
thousands of new ones.
- **Category creation is brand → type.** `ResolveDraftReviewCategory` reuses an
already-taxonomy-matched category first, then `ResolveExistingCategoryForInference`,
and only then `ResolveOrCreateCategoryForAdministrator` — which creates a parent
named after the brand and a child named after the part type (e.g. `Fanuc > Fanuc
Drive`). Creation is gated on `IsConfirmedProductCategory` **and**
`!IsGenericProductType`, so an unconfirmed inference or a generic "Spare Part"
never mints a category.
- **Price is the collected eBay price.** `ApplyDraftReviewToDraft` copies
`NormalizedPrice` straight through; the market `price_sync` factor is a separate,
opt-in mechanism and is not applied here.
- **Jobs, not requests.** A pass runs as `EbayDraftReviewJob` +
`EbayDraftReviewJobItem` (their own tables — `AIAgentSEOJob.ProductID` is
`NOT NULL` and drafts are not products). Progress is polled; the job is
resumable and survives a restart.
- Review state is a column on the draft (`ai_review_status`), filterable from the
list (`ready` = awaiting approval, `unreviewed` = no state yet). `unreviewed` is
an absence, so it is matched with `IS NULL OR = ''` via
`services.EbayDraftReviewStatusClause` — an equality would silently match nothing.
- Details: `docs/EBAY_DRAFT_REVIEW.md`.

### Error Handling Strategy
- **API Errors**: Centralized handling in `src/lib/api.ts`
- **Network Failures**: Automatic fallback to mock data for development
- **Timeout Handling**: 60-second timeout with graceful degradation
- **User Feedback**: React Hot Toast for user notifications

## Database Connection

The backend reads MySQL settings from environment variables (see `backend/.env.example`):
- **DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME**
- **Auto-migration**: Creates tables on startup (can be disabled via `DB_AUTO_MIGRATE=false`)
- **Seeding**: Dev env can seed default admin/categories; production should explicitly configure the seed switch

## Key Configuration Files

### Frontend Environment
- `.env.local` - API base URL and PayPal configuration
- `src/lib/api.ts` - Axios configuration with interceptors
- `middleware.ts` - Route protection and SEO redirects

### Backend Environment
- `.env` - Database, JWT, CORS, and upload configuration
- `main.go` - Application entry point with middleware setup
- `config/database.go` - Database connection and auto-migration

## Development Workflow

1. **Database**: Backend auto-creates tables and seeds data on first run
2. **API Development**: Backend controllers follow RESTful conventions
3. **Frontend Development**: Services in `src/services/` mirror backend endpoints
4. **Type Safety**: Update `src/types/index.ts` when adding new API fields
5. **Testing**: Use mock data fallbacks when backend is unavailable

## Common Patterns

### Adding New API Endpoints
1. Add model to `backend/models/`
2. Create controller in `backend/controllers/`
3. Add routes in `backend/routes/routes.go`
4. Create service in `frontend/src/services/`
5. Add TypeScript types in `frontend/src/types/`

### Role-Based Features
Use middleware chain: `admin.Use(middleware.AuthMiddleware(), middleware.AdminOnly())`

### Frontend API Calls
Always use service layer methods that include error handling and type safety.
