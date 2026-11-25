export const PUBLIC_CONTENT_SIGNAL_POLICY = 'search=yes, ai-input=yes, ai-train=yes, use=reference';

// Paths that must never be crawled: admin, authentication, account, checkout
// and API endpoints. These routes already send noindex headers, but without a
// robots.txt entry crawlers still spend budget on URLs that can only return a
// private form or a redirect. Assets and product images are untouched.
export const PRIVATE_ROBOTS_PATHS = [
  '/admin',
  '/api/',
  '/account',
  '/cart',
  '/checkout',
  '/login',
  '/register',
  '/forgot-password',
  '/track-order',
  '/orders/track',
] as const;

export function buildRobotsTxt(siteUrl: string): string {
  const site = siteUrl.replace(/\/+$/, '');
  return [
    // All crawlers share the same policy. Content signals stay in the HTTP
    // header so robots.txt contains only standard crawl directives.
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_ROBOTS_PATHS.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${site}/sitemap.xml`,
  ].join('\n') + '\n';
}
