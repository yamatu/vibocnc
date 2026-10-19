'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, GlobeAltIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { PUBLIC_LOCALES, type PublicLocale } from '@/lib/i18n/config';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { useLocaleNavigation } from '@/lib/i18n/useLocaleNavigation';

export default function MobileLanguageSwitcher() {
  const { locale, dir, t } = usePublicI18n();
  const changeLocale = useLocaleNavigation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const activeLocale = PUBLIC_LOCALES.find((item) => item.code === locale) || PUBLIC_LOCALES[0];
  const panelId = 'mobile-language-panel';

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    firstOptionRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const selectLocale = (nextLocale: PublicLocale) => {
    setOpen(false);
    if (nextLocale !== locale) changeLocale(nextLocale);
  };

  return (
    <div
      ref={containerRef}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-3 z-[60] md:hidden"
      dir={dir}
    >
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={t('language.label')}
          className="mb-3 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
              <GlobeAltIcon className="h-5 w-5 shrink-0 text-[#003a78]" aria-hidden="true" />
              <span className="truncate">{t('language.label')}</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#003a78]"
              aria-label={t('header.closeMenu')}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="grid max-h-[min(55vh,27rem)] grid-cols-2 gap-1 overflow-y-auto p-2 overscroll-contain">
            {PUBLIC_LOCALES.map((option, index) => {
              const selected = option.code === locale;
              return (
                <button
                  key={option.code}
                  ref={index === 0 ? firstOptionRef : undefined}
                  type="button"
                  lang={option.hreflang}
                  dir={option.dir}
                  onClick={() => selectLocale(option.code)}
                  aria-pressed={selected}
                  className={`flex min-h-12 items-center gap-2 rounded-xl px-3 py-2 text-start text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#003a78] ${selected ? 'bg-blue-50 font-semibold text-[#003a78]' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="w-6 shrink-0 text-center text-xs font-bold uppercase text-slate-500">{option.code}</span>
                  <span className="min-w-0 flex-1 leading-tight">{option.nativeName}</span>
                  {selected && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${t('language.label')}: ${activeLocale.nativeName}`}
        aria-controls={panelId}
        aria-expanded={open}
        className="flex h-10 items-center gap-1 rounded-full border border-white/70 bg-slate-950/90 px-2.5 text-white shadow-lg ring-1 ring-black/10 backdrop-blur transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2"
      >
        {/* Compact chip: it floats over page content (incl. purchase buttons). */}
        <GlobeAltIcon className="h-4 w-4 text-orange-300" aria-hidden="true" />
        <span className="text-xs font-bold uppercase">{activeLocale.code}</span>
      </button>
    </div>
  );
}
