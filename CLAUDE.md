# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
├── public/          # Unauthenticated (products, categories, banners)
├── auth/           # Login, profile management
├── admin/          # Protected admin endpoints (requires authentication)
│   ├── products    # Product CRUD with image management
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
