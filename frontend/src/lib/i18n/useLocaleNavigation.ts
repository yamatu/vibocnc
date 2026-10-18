'use client';

import { useCallback } from 'react';
import {
  PUBLIC_LOCALE_COOKIE,
  PUBLIC_LOCALE_SELECTION_PARAM,
  localizePublicPath,
  type PublicLocale,
} from './config';

export function useLocaleNavigation() {
  // Read the browser URL at click time: usePathname() can expose the internal
  // /{locale} rewrite target, and useSearchParams() would opt static pages
  // out of prerendering.
  return useCallback((nextLocale: PublicLocale) => {
    document.cookie = `${PUBLIC_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    const target = localizePublicPath(window.location.pathname || '/', nextLocale);
    const targetUrl = new URL(target, window.location.origin);

    new URLSearchParams(window.location.search).forEach((value, key) => {
      if (key !== PUBLIC_LOCALE_SELECTION_PARAM) targetUrl.searchParams.append(key, value);
    });
    targetUrl.searchParams.set(PUBLIC_LOCALE_SELECTION_PARAM, nextLocale);

    // A full navigation lets middleware persist the explicit choice and avoids
    // reusing a React Server Component response cached for another language.
    window.location.assign(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
  }, []);
}
