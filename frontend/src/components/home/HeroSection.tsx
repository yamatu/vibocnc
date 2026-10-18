'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { HomepageContent } from '@/types';
import { DEFAULT_HERO_DATA, type HeroSectionData } from '@/lib/homepage-defaults';
import { normalizeLegacyCompanyText } from '@/lib/company-facts';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';

type Props = { content?: HomepageContent | null };

function normalizeBrandName(text: string): string {
  return text.replace(/\bvibo\s*cnc\b/gi, 'Vibocnc');
}

function ensureHomepageBrandTitle(text: string, index: number): string {
  const normalized = normalizeBrandName(text).trim();
  if (index !== 0 || /\bvibocnc\b/i.test(normalized)) return normalized;
  return `Vibocnc ${normalized}`;
}

function isLegacyFanucHero(text?: string): boolean {
  const value = String(text || '');
  return /FANUC Spare Parts Supply/i.test(value)
    || /Source FANUC CNC and robot spare parts/i.test(value);
}

function normalizeHeroData(content?: HomepageContent | null): HeroSectionData {
  const raw = content?.data;
  const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;

  // Start from structured data if provided, otherwise defaults.
  const baseSlides = Array.isArray(parsed?.slides) && parsed.slides.length > 0 ? parsed.slides : DEFAULT_HERO_DATA.slides;
  const autoPlayMs = typeof parsed?.autoPlayMs === 'number' ? parsed.autoPlayMs : DEFAULT_HERO_DATA.autoPlayMs;

  // Backwards-compatible override: if admin only edited simple fields (title/subtitle/etc),
  // reflect those changes in the first slide even when `data` is null.
  const slides = [...baseSlides];
  if (slides.length > 0) {
    const s0 = { ...slides[0] };
    if (content?.title && !isLegacyFanucHero(content.title)) s0.title = normalizeLegacyCompanyText(content.title);
    if (content?.subtitle) s0.subtitle = normalizeLegacyCompanyText(content.subtitle);
    if (content?.description && !isLegacyFanucHero(content.description)) s0.description = normalizeLegacyCompanyText(content.description);
    if (content?.image_url) s0.image = content.image_url;
    if (content?.button_text) s0.cta = { ...(s0.cta || {}), primary: { ...(s0.cta?.primary || {}), text: content.button_text, href: content.button_url || s0.cta?.primary?.href || '/products' }, secondary: s0.cta?.secondary || { text: 'Get a Quote', href: '/contact?inquiry_type=quote' } };
    slides[0] = s0;
  }

  return {
    slides: slides.map((slide, index) => ({
      ...slide,
      title: ensureHomepageBrandTitle(normalizeLegacyCompanyText(slide.title), index),
      subtitle: normalizeLegacyCompanyText(slide.subtitle),
      description: normalizeLegacyCompanyText(slide.description),
    })),
    autoPlayMs,
  };
}

export function HeroSection({ content }: Props) {
  const { locale, t, href } = usePublicI18n();
  const heroData = normalizeHeroData(content);
  const slides = heroData.slides;
  const autoPlayMs = heroData.autoPlayMs || 6000;
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const activeSlide = slides[currentSlide] || slides[0] || DEFAULT_HERO_DATA.slides[0];
  const fallbackImage =
    DEFAULT_HERO_DATA.slides[currentSlide % DEFAULT_HERO_DATA.slides.length]?.image ||
    DEFAULT_HERO_DATA.slides[0].image;
  const imageSrc = failedImages.has(activeSlide.image) ? fallbackImage : activeSlide.image;
  const localizedSlide = locale === 'en'
    ? {
        ...activeSlide,
        cta: {
          ...activeSlide.cta,
          secondary: {
            ...activeSlide.cta.secondary,
            text: t('home.hero.secondary'),
            href: '/contact?inquiry_type=quote',
          },
        },
      }
    : {
        ...activeSlide,
        title: ensureHomepageBrandTitle(t('home.hero.title'), 0),
        subtitle: t('home.hero.subtitle'),
        description: t('home.hero.description'),
        cta: {
          primary: { ...activeSlide.cta.primary, text: t('home.hero.primary'), href: '/products' },
          secondary: {
            ...activeSlide.cta.secondary,
            text: t('home.hero.secondary'),
            href: '/contact?inquiry_type=quote',
          },
        },
      };

  // LCP collection remains open until the first interaction. Starting the
  // full-viewport carousel earlier can replace the LCP candidate at 6s.
  useEffect(() => {
    if (slides.length <= 1) return;
    const enableAutoPlay = () => setIsAutoPlaying(true);
    window.addEventListener('pointerdown', enableAutoPlay, { once: true, passive: true });
    window.addEventListener('keydown', enableAutoPlay, { once: true });
    return () => {
      window.removeEventListener('pointerdown', enableAutoPlay);
      window.removeEventListener('keydown', enableAutoPlay);
    };
  }, [slides.length]);

  useEffect(() => {
    if (!isAutoPlaying || slides.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, autoPlayMs);

    return () => clearInterval(interval);
  }, [isAutoPlaying, slides.length, autoPlayMs]);

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
    setIsAutoPlaying(false);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
    setIsAutoPlaying(false);
  };

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
    setIsAutoPlaying(false);
  };

  return (
    <section className="relative w-full h-[72vh] min-h-[560px] max-h-[780px] flex items-center overflow-hidden bg-slate-950">
      <div className="absolute inset-0 h-full w-full">
        <Image
          key={imageSrc}
          src={imageSrc}
          alt={localizedSlide.title}
          width={1920}
          height={1080}
          className="h-full w-full object-cover"
          sizes="100vw"
          priority={currentSlide === 0}
          loading={currentSlide === 0 ? 'eager' : 'lazy'}
          fetchPriority={currentSlide === 0 ? 'high' : 'auto'}
          quality={70}
          onError={() => {
            if (imageSrc === fallbackImage) return;
            setFailedImages((current) => new Set(current).add(activeSlide.image));
          }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.92)_0%,rgba(15,23,42,0.74)_42%,rgba(15,23,42,0.28)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/75 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div key={activeSlide.id ?? currentSlide} className="max-w-3xl">
            <div className="mb-6 inline-flex items-center border border-orange-300/40 bg-slate-950/45 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-orange-100 backdrop-blur">
              {t('home.hero.kicker')}
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black mb-6 leading-[0.98] text-white">
              {localizedSlide.title}
            </h1>

            <p className="text-xl md:text-2xl font-semibold mb-6 text-orange-200">
              {localizedSlide.subtitle}
            </p>

            <p className="text-base md:text-lg mb-10 max-w-2xl leading-8 text-slate-200">
              {localizedSlide.description}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={href(localizedSlide.cta.primary.href)}
                className="inline-flex justify-center bg-orange-700 hover:bg-[#003a78] text-white px-7 py-3 rounded-md text-base font-semibold transition-colors shadow-lg shadow-teal-950/30"
              >
                {localizedSlide.cta.primary.text}
              </Link>

              <Link
                href={href(localizedSlide.cta.secondary.href)}
                className="inline-flex justify-center border border-white/60 text-white hover:bg-white hover:text-slate-950 px-7 py-3 rounded-md text-base font-semibold transition-colors"
              >
                {localizedSlide.cta.secondary.text}
              </Link>
            </div>
          </div>
      </div>

      {/* Navigation Arrows */}
      <button
        onClick={prevSlide}
        className="absolute left-4 top-1/2 transform -translate-y-1/2 z-20 bg-slate-950/50 hover:bg-slate-950/80 text-white p-3 rounded-full transition-all duration-300"
        aria-label={t('home.hero.previous')}
      >
        <ChevronLeftIcon className="h-6 w-6" />
      </button>

      <button
        onClick={nextSlide}
        className="absolute right-4 top-1/2 transform -translate-y-1/2 z-20 bg-slate-950/50 hover:bg-slate-950/80 text-white p-3 rounded-full transition-all duration-300"
        aria-label={t('home.hero.next')}
      >
        <ChevronRightIcon className="h-6 w-6" />
      </button>

      {/* Slide Indicators */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-20 flex space-x-3">
        {slides.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              index === currentSlide
                ? 'bg-orange-500 scale-125'
                : 'bg-white/50 hover:bg-white/80'
            }`}
            aria-label={t('home.hero.goTo', { number: index + 1 })}
          />
        ))}
      </div>

      {/* Scroll Indicator */}
      <div className="hidden md:motion-safe:block absolute bottom-8 right-8 z-20 text-white motion-safe:animate-bounce" aria-hidden="true">
        <div className="flex flex-col items-center">
          <span className="text-sm mb-2">{t('home.hero.scroll')}</span>
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </div>
      </div>
    </section>
  );
}

export default HeroSection;
