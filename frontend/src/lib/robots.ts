export const PUBLIC_CONTENT_SIGNAL_POLICY = 'search=yes, ai-input=yes, ai-train=yes, use=reference';

export const PRIVATE_ROBOTS_PATHS = [
  '/admin',
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
