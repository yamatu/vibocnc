'use client';

import { GlobeAltIcon } from '@heroicons/react/24/outline';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import {
  PUBLIC_LOCALES,
  type PublicLocale,
} from '@/lib/i18n/config';
import { useLocaleNavigation } from '@/lib/i18n/useLocaleNavigation';

export default function LanguageSelector() {
  const { locale, t } = usePublicI18n();
  const changeLocale = useLocaleNavigation();

  return (
    <label className="relative flex max-w-[11rem] items-center">
      <span className="sr-only">{t('language.label')}</span>
      <GlobeAltIcon className="pointer-events-none absolute left-2.5 h-5 w-5 text-slate-500" aria-hidden="true" />
      <select
        value={locale}
        onChange={(event) => changeLocale(event.target.value as PublicLocale)}
        aria-label={t('language.label')}
        title={t('language.label')}
        className="h-10 w-[11rem] appearance-none border border-slate-300 bg-white py-2 pl-9 pr-7 text-sm font-medium text-slate-700 shadow-sm outline-none transition-colors hover:border-orange-400 focus:border-[var(--site-primary)] focus:ring-2 focus:ring-blue-100"
      >
        {PUBLIC_LOCALES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.selectorLabel}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 text-xs text-slate-400">&#9662;</span>
    </label>
  );
}
