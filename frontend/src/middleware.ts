import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Define protected routes
const protectedRoutes = ['/admin'];
const authRoutes = ['/admin/login', '/admin/forgot-password'];

// List of search engine crawlers
const SEARCH_ENGINE_BOTS = [
  'googlebot',
  'bingbot',
  'slurp', // Yahoo
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'whatsapp',
  'telegrambot',
  // AI search engine bots
  'gptbot',
  'chatgpt-user',
  'perplexitybot',
  'claudebot',
  'anthropic-ai',
  'google-extended',
  'applebot',
  'cohere-ai',
];

function isSearchEngineCrawler(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return SEARCH_ENGINE_BOTS.some(bot => ua.includes(bot));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('auth_token')?.value;
  const userAgent = request.headers.get('user-agent') || '';

  // Redirect legacy product sitemap URLs:
  // /sitemap-products-1.xml -> /sitemap-products/1.xml
  const legacySitemapMatch = pathname.match(/^\/sitemap-products-(\d+)\.xml$/);
  if (legacySitemapMatch) {
    const url = request.nextUrl.clone();
    url.pathname = `/sitemap-products/${legacySitemapMatch[1]}.xml`;
    return NextResponse.redirect(url, 301);
  }

  // Serve /sitemap-products/:page.xml by rewriting to an internal route
  // /sitemap-products/1.xml -> /sitemap-products/1 (keeps .xml in the URL)
  const productsSitemapMatch = pathname.match(/^\/sitemap-products\/(\d+)\.xml$/);
  if (productsSitemapMatch) {
    const url = request.nextUrl.clone();
    url.pathname = `/sitemap-products/${productsSitemapMatch[1]}`;
    return NextResponse.rewrite(url);
  }

  // Handle product URL redirects for SEO-friendly URLs
  // Redirect old format /products/[sku] to new format /products/[sku]-[slug]
  if (pathname.match(/^\/products\/[A-Z0-9][A-Z0-9\-._]*$/i) && !pathname.includes('-')) {
    // This looks like an old SKU-only URL, but we need to check if it exists first
    // For now, let the route handler deal with it to avoid complexity here
  }

  // Canonicalize product URLs: strip common brand prefix in path
  if (pathname.startsWith('/products/FANUC-')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace('/products/FANUC-', '/products/');
    return NextResponse.redirect(url, 301);
  }

  // Check if the current path is a protected route
  const isProtectedRoute = protectedRoutes.some(route =>
    pathname.startsWith(route) && !authRoutes.some(authRoute => pathname.startsWith(authRoute))
  );

  // Check if the current path is an auth route
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route));

  // If accessing a protected route without a token, redirect to login
  if (isProtectedRoute && !token) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If accessing auth route with a token, redirect to admin dashboard
  if (isAuthRoute && token) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // Create response with SEO optimizations
  const response = NextResponse.next();

  // Special handling for search engine crawlers
  if (isSearchEngineCrawler(userAgent)) {
    // Ensure no caching for crawlers on dynamic pages
    if (pathname.startsWith('/products') || pathname.includes('sitemap')) {
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
    }
    // Do not force X-Robots-Tag here; let per-page metadata control indexing
  }

  // Add security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'origin-when-cross-origin');

  // Let per-page metadata control robots; avoid overriding here

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
};
