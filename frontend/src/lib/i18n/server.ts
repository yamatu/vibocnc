import { getSiteUrl } from '@/lib/url';
import {
  buildLanguageAlternates,
  DEFAULT_PUBLIC_LOCALE,
  isPublicLocale,
  localizePublicPath,
  normalizePublicLocale,
  type PublicLocale,
} from './config';

export type LocaleRouteParams = Promise<{ locale: string }>;

// Middleware rewrites every public URL to /{locale}{path}. Reading the locale
// from the route segment (not request headers) keeps public pages ISR-cacheable.
export async function resolveRouteLocale(params: Promise<{ locale?: string }>): Promise<PublicLocale> {
  const { locale } = await params;
  return normalizePublicLocale(locale);
}

export async function getLocalizedMetadataPaths(
  locale: PublicLocale,
  pathname: string,
  availableLocales?: readonly PublicLocale[],
) {
  const baseUrl = getSiteUrl();
  const localizedPath = localizePublicPath(pathname, locale);
  const allowedLocales = availableLocales
    ? Array.from(new Set([DEFAULT_PUBLIC_LOCALE, ...availableLocales.filter(isPublicLocale)]))
    : undefined;
  return {
    locale,
    canonical: `${baseUrl}${localizedPath === '/' ? '' : localizedPath}`,
    languages: buildLanguageAlternates(baseUrl, pathname, allowedLocales),
  };
}

export async function getLocalizedMetadataPathsWithQuery(
  locale: PublicLocale,
  pathname: string,
  query: string,
  availableLocales?: readonly PublicLocale[],
) {
  const metadata = await getLocalizedMetadataPaths(locale, pathname, availableLocales);
  const normalizedQuery = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return {
    ...metadata,
    canonical: `${metadata.canonical}${normalizedQuery}`,
    languages: Object.fromEntries(
      Object.entries(metadata.languages).map(([language, url]) => [language, `${url}${normalizedQuery}`]),
    ),
  };
}
