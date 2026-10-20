import { DEFAULT_PUBLIC_LOCALE, PUBLIC_LOCALES, localizePublicPath, type PublicLocale } from './config';

export interface LocalizedSitemapEntry {
  pathname: string;
  lastModified?: string;
  changeFrequency: string;
  priority: string;
  availableLocales?: readonly PublicLocale[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absoluteUrl(baseUrl: string, pathname: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}${pathname === '/' ? '' : pathname}`;
}

function entryLocales(entry: LocalizedSitemapEntry) {
  const allowedLocales = new Set<PublicLocale>([DEFAULT_PUBLIC_LOCALE, ...(entry.availableLocales || [])]);
  return PUBLIC_LOCALES.filter((locale) => allowedLocales.has(locale.code));
}

export function renderLocalizedSitemapEntries(baseUrl: string, entry: LocalizedSitemapEntry): string {
  const locales = entryLocales(entry);
  // A single-language entry would only carry self-referencing en/x-default links (already in the page
  // <head>); omitting them keeps the file free of XHTML elements so browsers render the XML tree view.
  const alternateLinks = locales.length > 1
    ? [
        ...locales.map((locale) => ({
          hreflang: locale.hreflang,
          url: absoluteUrl(baseUrl, localizePublicPath(entry.pathname, locale.code)),
        })),
        { hreflang: 'x-default', url: absoluteUrl(baseUrl, localizePublicPath(entry.pathname, 'en')) },
      ]
    : [];

  return locales.map((locale) => {
    const localizedUrl = absoluteUrl(baseUrl, localizePublicPath(entry.pathname, locale.code));
    return `  <url>
    <loc>${escapeXml(localizedUrl)}</loc>
${entry.lastModified ? `    <lastmod>${escapeXml(entry.lastModified)}</lastmod>\n` : ''}    <changefreq>${escapeXml(entry.changeFrequency)}</changefreq>
    <priority>${escapeXml(entry.priority)}</priority>
${alternateLinks.map((alternate) => `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.url)}" />\n`).join('')}  </url>`;
  }).join('\n');
}

export function renderLocalizedSitemap(baseUrl: string, entries: LocalizedSitemapEntry[]): string {
  const hasAlternates = entries.some((entry) => entryLocales(entry).length > 1);
  const xhtmlNs = hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtmlNs}>
${entries.map((entry) => renderLocalizedSitemapEntries(baseUrl, entry)).join('\n')}
</urlset>`;
}
