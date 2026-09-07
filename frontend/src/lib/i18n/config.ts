export const PUBLIC_LOCALES = [
  { code: 'en', hreflang: 'en', nativeName: 'English', region: 'United States', selectorLabel: 'English (US)', dir: 'ltr' },
  { code: 'zh', hreflang: 'zh-CN', nativeName: '简体中文', region: '中国', selectorLabel: '简体中文 (CN)', dir: 'ltr' },
  { code: 'es', hreflang: 'es', nativeName: 'Español', region: 'España / Latinoamérica', selectorLabel: 'Español (ES/LATAM)', dir: 'ltr' },
  { code: 'de', hreflang: 'de', nativeName: 'Deutsch', region: 'Deutschland', selectorLabel: 'Deutsch (DE)', dir: 'ltr' },
  { code: 'fr', hreflang: 'fr', nativeName: 'Français', region: 'France', selectorLabel: 'Français (FR)', dir: 'ltr' },
  { code: 'it', hreflang: 'it', nativeName: 'Italiano', region: 'Italia', selectorLabel: 'Italiano (IT)', dir: 'ltr' },
  { code: 'pt', hreflang: 'pt', nativeName: 'Português', region: 'Brasil / Portugal', selectorLabel: 'Português (BR/PT)', dir: 'ltr' },
  { code: 'ja', hreflang: 'ja', nativeName: '日本語', region: '日本', selectorLabel: '日本語 (JP)', dir: 'ltr' },
  { code: 'ko', hreflang: 'ko', nativeName: '한국어', region: '대한민국', selectorLabel: '한국어 (KR)', dir: 'ltr' },
  { code: 'ru', hreflang: 'ru', nativeName: 'Русский', region: 'Россия', selectorLabel: 'Русский (RU)', dir: 'ltr' },
  { code: 'ar', hreflang: 'ar', nativeName: 'العربية', region: 'الشرق الأوسط', selectorLabel: 'العربية (MENA)', dir: 'rtl' },
] as const;

export type PublicLocale = (typeof PUBLIC_LOCALES)[number]['code'];

export const DEFAULT_PUBLIC_LOCALE: PublicLocale = 'en';
export const PUBLIC_LOCALE_COOKIE = 'vibocnc_locale';
export const PUBLIC_LOCALE_SELECTION_PARAM = 'site_locale';

const localeCodes = new Set<string>(PUBLIC_LOCALES.map((locale) => locale.code));

export const LIMITED_TRANSLATION_PUBLIC_PATHS = [
  '/faq',
  '/privacy',
  '/terms',
  '/warranty',
  '/warranty-policy',
  '/shipping-policy',
  '/technical-support',
  '/returns',
  '/docs',
] as const;

// These pages have an explicit English canonical entry point. A visitor's
// browser language or an old locale cookie must not silently move that entry
// point to another URL; only an explicit locale URL or language selection may
// choose a translated version. This keeps support and policy links reliably
// English by default while still allowing the language selector to opt in.
export const AUTO_LOCALE_REDIRECT_EXCLUDED_PATHS = [
  '/track-order',
  '/categories',
  '/repair-request',
  '/contact',
  '/faq',
  '/docs',
  '/warranty',
  '/warranty-policy',
  '/shipping-policy',
  '/technical-support',
  '/returns',
] as const;

export function isLimitedTranslationPublicPath(pathname: string): boolean {
  const normalized = stripLocaleFromPathname(pathname || '/');
  return LIMITED_TRANSLATION_PUBLIC_PATHS.some((path) => (
    normalized === path || normalized.startsWith(`${path}/`)
  ));
}

export function isAutomaticLocaleRedirectAllowed(pathname: string): boolean {
  const normalized = stripLocaleFromPathname(pathname || '/');
  return !AUTO_LOCALE_REDIRECT_EXCLUDED_PATHS.some((path) => (
    normalized === path || normalized.startsWith(`${path}/`)
  ));
}

export function isPublicLocale(value?: string | null): value is PublicLocale {
  return Boolean(value && localeCodes.has(value.toLowerCase()));
}

export function normalizePublicLocale(value?: string | null): PublicLocale {
  if (!value) return DEFAULT_PUBLIC_LOCALE;
  const normalized = value.toLowerCase().split('-')[0];
  return isPublicLocale(normalized) ? normalized : DEFAULT_PUBLIC_LOCALE;
}

const COUNTRY_LOCALE_MAP: Partial<Record<string, PublicLocale>> = {
  CN: 'zh', HK: 'zh', MO: 'zh', TW: 'zh',
  ES: 'es', MX: 'es', AR: 'es', BO: 'es', CL: 'es', CO: 'es', CR: 'es', CU: 'es', DO: 'es', EC: 'es', GT: 'es', HN: 'es', NI: 'es', PA: 'es', PE: 'es', PR: 'es', PY: 'es', SV: 'es', UY: 'es', VE: 'es',
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', SN: 'fr', CI: 'fr', CM: 'fr',
  IT: 'it', SM: 'it', VA: 'it',
  BR: 'pt', PT: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt',
  JP: 'ja',
  KR: 'ko', KP: 'ko',
  RU: 'ru', BY: 'ru', KZ: 'ru', KG: 'ru',
  AE: 'ar', SA: 'ar', EG: 'ar', DZ: 'ar', BH: 'ar', IQ: 'ar', JO: 'ar', KW: 'ar', LB: 'ar', LY: 'ar', MA: 'ar', OM: 'ar', PS: 'ar', QA: 'ar', SD: 'ar', SY: 'ar', TN: 'ar', YE: 'ar',
};

function localeFromLanguageTag(languageTag: string): PublicLocale | null {
  const primaryLanguage = languageTag.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (primaryLanguage === 'cmn' || primaryLanguage === 'yue') return 'zh';
  return isPublicLocale(primaryLanguage) ? primaryLanguage : null;
}

export function getLocaleFromAcceptLanguage(value?: string | null): PublicLocale | null {
  if (!value) return null;

  const preferences = value
    .split(',')
    .map((part, index) => {
      const [languageTag, ...parameters] = part.trim().split(';');
      const qualityParameter = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith('q='));
      const parsedQuality = qualityParameter ? Number.parseFloat(qualityParameter.split('=')[1]) : 1;
      return {
        languageTag,
        quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
        index,
      };
    })
    .filter((preference) => preference.languageTag && preference.languageTag !== '*' && preference.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const preference of preferences) {
    const locale = localeFromLanguageTag(preference.languageTag);
    if (locale) return locale;
  }
  return null;
}

export function getLocaleFromCountry(countryCode?: string | null): PublicLocale | null {
  if (!countryCode) return null;
  return COUNTRY_LOCALE_MAP[countryCode.trim().toUpperCase()] || null;
}

export function detectPublicLocale(acceptLanguage?: string | null, countryCode?: string | null): PublicLocale {
  return getLocaleFromAcceptLanguage(acceptLanguage)
    || getLocaleFromCountry(countryCode)
    || DEFAULT_PUBLIC_LOCALE;
}

export function getLocaleConfig(locale: PublicLocale) {
  return PUBLIC_LOCALES.find((item) => item.code === locale) || PUBLIC_LOCALES[0];
}

export function getLocaleFromPathname(pathname: string): PublicLocale | null {
  const firstSegment = pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  return isPublicLocale(firstSegment) && firstSegment !== DEFAULT_PUBLIC_LOCALE ? firstSegment : null;
}

export function stripLocaleFromPathname(pathname: string): string {
  const locale = getLocaleFromPathname(pathname);
  if (!locale) return pathname || '/';
  const stripped = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), '');
  return stripped || '/';
}

export function localizePublicPath(href: string, locale: PublicLocale): string {
  if (!href || href.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) return href;

  const [pathAndQuery, hash = ''] = href.split('#', 2);
  const queryIndex = pathAndQuery.indexOf('?');
  const pathname = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
  const query = queryIndex >= 0 ? pathAndQuery.slice(queryIndex) : '';
  const normalizedPath = stripLocaleFromPathname(pathname.startsWith('/') ? pathname : `/${pathname}`);
  const localized = locale === DEFAULT_PUBLIC_LOCALE
    ? normalizedPath
    : normalizedPath === '/'
      ? `/${locale}`
      : `/${locale}${normalizedPath}`;

  return `${localized}${query}${hash ? `#${hash}` : ''}`;
}

export function buildLanguageAlternates(
  baseUrl: string,
  pathname: string,
  availableLocales: readonly PublicLocale[] = PUBLIC_LOCALES.map((locale) => locale.code),
): Record<string, string> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = stripLocaleFromPathname(pathname || '/');
  const allowedLocales = new Set<PublicLocale>([DEFAULT_PUBLIC_LOCALE, ...availableLocales]);
  const languages = Object.fromEntries(
    PUBLIC_LOCALES.filter((locale) => allowedLocales.has(locale.code)).map((locale) => [
      locale.hreflang,
      `${cleanBase}${localizePublicPath(cleanPath, locale.code) === '/' ? '' : localizePublicPath(cleanPath, locale.code)}`,
    ]),
  );
  languages['x-default'] = `${cleanBase}${cleanPath === '/' ? '' : cleanPath}`;
  return languages;
}

export function isLocalizablePublicPath(pathname: string): boolean {
  return !(
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/uploads') ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/account') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/forgot-password') ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.includes('sitemap-') ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}
