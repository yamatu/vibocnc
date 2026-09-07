import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  DEFAULT_PUBLIC_LOCALE,
  PUBLIC_LOCALE_COOKIE,
  PUBLIC_LOCALE_SELECTION_PARAM,
  detectPublicLocale,
  getLocaleFromPathname,
  isPublicLocale,
  isAutomaticLocaleRedirectAllowed,
  isLocalizablePublicPath,
  localizePublicPath,
  normalizePublicLocale,
  stripLocaleFromPathname,
} from '@/lib/i18n/config';
import { PUBLIC_CONTENT_SIGNAL_POLICY } from '@/lib/robots';

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

const GEO_COUNTRY_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'cloudfront-viewer-country',
  'x-country-code',
  'x-geo-country',
] as const;

function getRequestCountry(request: NextRequest): string | null {
  for (const headerName of GEO_COUNTRY_HEADERS) {
    const value = request.headers.get(headerName)?.split(',')[0].trim();
    if (value) return value;
  }
  return null;
}

function saveLocalePreference(response: NextResponse, request: NextRequest, locale: string): void {
  response.cookies.set(PUBLIC_LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  });
}

function preventLocaleRedirectCaching(response: NextResponse): void {
  response.headers.set('Cache-Control', 'private, no-store, no-cache, max-age=0, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Vary', 'Accept-Language, Cookie');
}

function getBackendBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://backend:8080').replace(/\/+$/, '');
}

function getRequestHostname(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
  const incomingHost = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  try {
    return new URL(`http://${incomingHost}`).hostname.toLowerCase();
  } catch {
    return request.nextUrl.hostname.toLowerCase();
  }
}

function getCanonicalHostname(): string {
  const configured = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://vibocnc.com';
  try {
    return new URL(configured).hostname.toLowerCase();
  } catch {
    return 'vibocnc.com';
  }
}

// decodeJwtExpiryMs reads the exp claim without verifying the signature —
// verification stays on the backend; this only improves routing so an
// expired cookie is treated as "not logged in" instead of bouncing the user
// between the login page and a 401-storming admin page.
function decodeJwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(normalized));
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isAdminTokenUsable(token: string | undefined): boolean {
  if (!token) return false;
  const expiry = decodeJwtExpiryMs(token);
  // Unparseable tokens are treated as expired so the user reaches the login form.
  if (expiry === null) return false;
  return expiry > Date.now();
}

export async function middleware(request: NextRequest) {
  const rawPathname = request.nextUrl.pathname;
  if (rawPathname === '/en' || rawPathname.startsWith('/en/')) {
    const url = request.nextUrl.clone();
    url.pathname = rawPathname.slice(3) || '/';
    return NextResponse.redirect(url, 308);
  }
  const pathLocale = getLocaleFromPathname(rawPathname);
  const pathname = stripLocaleFromPathname(rawPathname);
  const forwardedSiteLocale = request.headers.get('x-site-locale');
  const locale = pathLocale
    || (isPublicLocale(forwardedSiteLocale) ? normalizePublicLocale(forwardedSiteLocale) : DEFAULT_PUBLIC_LOCALE);
  const rawToken = request.cookies.get('auth_token')?.value;
  const token = isAdminTokenUsable(rawToken) ? rawToken : undefined;
  const userAgent = request.headers.get('user-agent') || '';

  const requestedLocale = request.nextUrl.searchParams.get(PUBLIC_LOCALE_SELECTION_PARAM);
  if (isPublicLocale(requestedLocale) && isLocalizablePublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = localizePublicPath(pathname, requestedLocale);
    url.searchParams.delete(PUBLIC_LOCALE_SELECTION_PARAM);
    const response = NextResponse.redirect(url, 307);
    saveLocalePreference(response, request, requestedLocale);
    preventLocaleRedirectCaching(response);
    return response;
  }

  if (pathLocale && !isLocalizablePublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    return NextResponse.redirect(url, 308);
  }


  const rawSavedLocale = request.cookies.get(PUBLIC_LOCALE_COOKIE)?.value;
  const savedLocale = isPublicLocale(rawSavedLocale) ? normalizePublicLocale(rawSavedLocale) : null;
  const isCrawler = isSearchEngineCrawler(userAgent);
  const detectedLocale = detectPublicLocale(
    request.headers.get('accept-language'),
    getRequestCountry(request),
  );
  const preferredLocale = savedLocale || detectedLocale;
  const automaticLocale = preferredLocale;
  // A localized URL is internally rewritten to its unprefixed route. Next may
  // run middleware again for that rewritten request, so only auto-detect on an
  // actual unprefixed browser URL. Otherwise /zh -> rewrite / -> redirect /zh
  // becomes an infinite loop.
  const isLocalizedInternalRewrite = Boolean(forwardedSiteLocale);
  if (
    !pathLocale
    && !isLocalizedInternalRewrite
    && isAutomaticLocaleRedirectAllowed(pathname)
    && automaticLocale !== DEFAULT_PUBLIC_LOCALE
    && isLocalizablePublicPath(pathname)
    && !isCrawler
  ) {
    const url = request.nextUrl.clone();
    url.pathname = localizePublicPath(pathname, automaticLocale);
    const response = NextResponse.redirect(url, 307);
    saveLocalePreference(response, request, preferredLocale);
    preventLocaleRedirectCaching(response);
    return response;
  }

  const requestHostname = getRequestHostname(request);
  const canonicalHostname = getCanonicalHostname();
  const alternateHostname = canonicalHostname.startsWith('www.')
    ? canonicalHostname.slice(4)
    : `www.${canonicalHostname}`;
  if (requestHostname === alternateHostname) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.protocol = 'https';
    canonicalUrl.hostname = canonicalHostname;
    canonicalUrl.port = '';
    return NextResponse.redirect(canonicalUrl, 301);
  }

  const indexNowKeyMatch = pathname.match(/^\/([A-Za-z0-9_-]{8,128})\.txt$/);
  if (indexNowKeyMatch) {
    const requestedKey = indexNowKeyMatch[1];
    try {
      const res = await fetch(`${getBackendBaseUrl()}/api/v1/public/indexnow/key`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        return new NextResponse('Not Found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        });
      }

      const json = await res.json();
      const configuredKey = String(json?.data?.key || '').trim();
      if (!configuredKey || configuredKey !== requestedKey) {
        return new NextResponse('Not Found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        });
      }

      return new NextResponse(configuredKey, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    } catch {
      return new NextResponse('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }
  }

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

  // Canonicalize legacy FANUC-prefixed product URLs to the shared product slug rule.
  if (/^\/products\/FANUC-/i.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = localizePublicPath(pathname.replace(/^\/products\/FANUC-/i, '/products/'), locale);
    return NextResponse.redirect(url, 301);
  }

  // Check if the current path is a protected route
  const isProtectedRoute = protectedRoutes.some(route =>
    pathname.startsWith(route) && !authRoutes.some(authRoute => pathname.startsWith(authRoute))
  );

  // Check if the current path is an auth route
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route));

  // If accessing a protected route without a usable token, redirect to login
  // and drop the stale cookie so the login page is reachable immediately.
  if (isProtectedRoute && !token) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    if (rawToken) {
      redirectResponse.cookies.delete('auth_token');
      redirectResponse.cookies.delete('auth_token_expires');
    }
    return redirectResponse;
  }

  // If accessing auth route with a token, redirect to admin dashboard
  if (isAuthRoute && token) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // Create response with SEO optimizations
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-site-locale', locale);
  requestHeaders.set('x-site-pathname', pathname);

  const response = pathLocale
    ? NextResponse.rewrite(
        (() => {
          const url = request.nextUrl.clone();
          url.pathname = pathname;
          return url;
        })(),
        { request: { headers: requestHeaders } },
      )
    : NextResponse.next({ request: { headers: requestHeaders } });

  // Explicit language selection is persisted by useLocaleNavigation and the
  // site_locale redirect above. Plain locale URL requests do not need Set-Cookie;
  // keeping them cookie-free allows shared CDN caching.

  // Do not vary cache policy by user agent. Serving the same cacheable HTML to
  // users and crawlers keeps rendering fast and avoids crawler-only behavior.

  // Add security headers
  // Allow the public homepage to render inside the same-origin admin preview.
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  response.headers.set(
    'Content-Security-Policy',
    "base-uri 'self'; frame-ancestors 'self'; object-src 'none'"
  );

  // Order lookups can contain customer data and must never enter a search index.
  if (pathname.startsWith('/orders/track/')) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  }

  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/account') ||
    pathname.startsWith('/checkout') ||
    pathname === '/register' ||
    pathname === '/forgot-password'
  ) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  }

  if (request.nextUrl.searchParams.get('admin_preview') === '1') {
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  if (isLocalizablePublicPath(pathname) && !response.headers.has('X-Robots-Tag')) {
    response.headers.set('Content-Signal', PUBLIC_CONTENT_SIGNAL_POLICY);
  }

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
