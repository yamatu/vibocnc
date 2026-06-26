'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { HomepageContent } from '@/types';
import { DEFAULT_HERO_DATA, type HeroSectionData } from '@/lib/homepage-defaults';

type Props = { content?: HomepageContent | null };

function normalizeHeroData(content?: HomepageContent | null): HeroSectionData {
  const raw = (content as any)?.data;
  const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;

  // Start from structured data if provided, otherwise defaults.
  const baseSlides = Array.isArray(parsed?.slides) && parsed.slides.length > 0 ? parsed.slides : DEFAULT_HERO_DATA.slides;
  const autoPlayMs = typeof parsed?.autoPlayMs === 'number' ? parsed.autoPlayMs : DEFAULT_HERO_DATA.autoPlayMs;

  // Backwards-compatible override: if admin only edited simple fields (title/subtitle/etc),
  // reflect those changes in the first slide even when `data` is null.
  const slides = [...baseSlides];
  if (slides.length > 0) {
    const s0 = { ...slides[0] };
    if (content?.title) s0.title = content.title;
    if (content?.subtitle) s0.subtitle = content.subtitle;
    if (content?.description) s0.description = content.description;
    if (content?.image_url) s0.image = content.image_url;
    if (content?.button_text) s0.cta = { ...(s0.cta || {}), primary: { ...(s0.cta?.primary || {}), text: content.button_text, href: content.button_url || s0.cta?.primary?.href || '/products' }, secondary: s0.cta?.secondary || { text: 'Learn More', href: '/about' } };
    slides[0] = s0;
  }

  return { slides, autoPlayMs };
}

export function HeroSection({ content }: Props) {
  const heroData = normalizeHeroData(content);
  const slides = heroData.slides;
  const autoPlayMs = heroData.autoPlayMs || 6000;
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  // Auto-play functionality
  useEffect(() => {
    if (!isAutoPlaying) return;

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
      {/* Background Images */}
      {slides.map((slide, index) => (
        <div
          key={slide.id ?? index}
          className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ${
            index === currentSlide ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Image
            src={slide.image}
            alt={slide.title}
            fill
            className="object-cover w-full h-full"
            style={{
              objectPosition: 'center center',
              objectFit: 'cover'
            }}
            sizes="100vw"
            priority={index === 0}
            unoptimized={typeof slide.image === 'string' && slide.image.startsWith('/uploads/')}
            onError={(e) => {
              console.error('Image failed to load:', slide.image);
              // 设置备用图片
              const target = e.currentTarget as HTMLImageElement;
              target.src = 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1920&h=1080';
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.92)_0%,rgba(15,23,42,0.74)_42%,rgba(15,23,42,0.28)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/75 to-transparent" />
        </div>
      ))}

      {/* Content */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {slides.map((slide, index) => (
          <div
            key={slide.id ?? index}
            className={`max-w-3xl transition-all duration-1000 ${
              index === currentSlide
                ? 'opacity-100 transform translate-y-0'
                : 'opacity-0 transform translate-y-8'
            }`}
            style={{ display: index === currentSlide ? 'block' : 'none' }}
          >
            <div className="mb-6 inline-flex items-center border border-orange-300/40 bg-slate-950/45 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-orange-100 backdrop-blur">
              Industrial Automation Supply
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black mb-6 leading-[0.98] text-white">
              {slide.title}
            </h1>

            <h2 className="text-xl md:text-2xl font-semibold mb-6 text-orange-200">
              {slide.subtitle}
            </h2>

            <p className="text-base md:text-lg mb-10 max-w-2xl leading-8 text-slate-200">
              {slide.description}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={slide.cta.primary.href}
                className="inline-flex justify-center bg-orange-500 hover:bg-[#003a78] text-white px-7 py-3 rounded-md text-base font-semibold transition-colors shadow-lg shadow-teal-950/30"
              >
                {slide.cta.primary.text}
              </Link>

              <Link
                href={slide.cta.secondary.href}
                className="inline-flex justify-center border border-white/60 text-white hover:bg-white hover:text-slate-950 px-7 py-3 rounded-md text-base font-semibold transition-colors"
              >
                {slide.cta.secondary.text}
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Arrows */}
      <button
        onClick={prevSlide}
        className="absolute left-4 top-1/2 transform -translate-y-1/2 z-20 bg-slate-950/50 hover:bg-slate-950/80 text-white p-3 rounded-full transition-all duration-300"
        aria-label="Previous slide"
      >
        <ChevronLeftIcon className="h-6 w-6" />
      </button>

      <button
        onClick={nextSlide}
        className="absolute right-4 top-1/2 transform -translate-y-1/2 z-20 bg-slate-950/50 hover:bg-slate-950/80 text-white p-3 rounded-full transition-all duration-300"
        aria-label="Next slide"
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
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>

      {/* Scroll Indicator */}
      <div className="hidden md:block absolute bottom-8 right-8 z-20 text-white animate-bounce">
        <div className="flex flex-col items-center">
          <span className="text-sm mb-2">Scroll Down</span>
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
