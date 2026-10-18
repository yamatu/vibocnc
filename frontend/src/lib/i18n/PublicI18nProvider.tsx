'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import {
  getLocaleConfig,
  localizePublicPath,
  type PublicLocale,
} from './config';
import { enMessages, formatPublicMessage, type PublicMessageVariables } from './messages-en';

type PublicI18nContextValue = {
  locale: PublicLocale;
  dir: 'ltr' | 'rtl';
  t: (key: string, variables?: PublicMessageVariables) => string;
  href: (path: string) => string;
};

const PublicI18nContext = createContext<PublicI18nContextValue | null>(null);

export function PublicI18nProvider({
  initialLocale,
  messageOverrides,
  children,
}: {
  initialLocale: PublicLocale;
  // From getPublicMessageOverrides() on the server; null for English. Only the
  // English fallback is bundled, so other languages never ship to every page.
  messageOverrides?: Record<string, string> | null;
  children: React.ReactNode;
}) {
  // The [locale] route segment is the authoritative locale for this render.
  const locale = initialLocale;
  const config = getLocaleConfig(locale);

  useEffect(() => {
    document.documentElement.lang = config.hreflang;
    document.documentElement.dir = config.dir;
  }, [config.dir, config.hreflang]);

  const value = useMemo<PublicI18nContextValue>(() => ({
    locale,
    dir: config.dir,
    t: (key, variables) => formatPublicMessage(
      messageOverrides?.[key] || enMessages[key as keyof typeof enMessages] || key,
      variables,
    ),
    href: (path) => localizePublicPath(path, locale),
  }), [config.dir, locale, messageOverrides]);

  return <PublicI18nContext.Provider value={value}>{children}</PublicI18nContext.Provider>;
}

export function usePublicI18n(): PublicI18nContextValue {
  const context = useContext(PublicI18nContext);
  if (!context) throw new Error('usePublicI18n must be used within PublicI18nProvider');
  return context;
}
