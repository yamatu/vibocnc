'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { HeroSectionData } from '@/lib/homepage-defaults';

type HeroSlide = HeroSectionData['slides'][number];

interface HeroCarouselControlsProps {
  slides: HeroSlide[];
  autoPlayMs: number;
}

const MIN_INITIAL_AUTOPLAY_DELAY_MS = 8000;

function getDescriptiveCtaText(text: string, href: string, slideTitle: string): string {
  if (!/^(learn|read|view) more$/i.test(text.trim())) return text;
  if (href === '/about') return 'About Vcocnc';
  if (href === '/contact') return 'Contact Vcocnc';
  if (href === '/categories') return 'Browse Product Categories';
  return `Explore ${slideTitle}`;
}

export default function HeroCarouselControls({ slides, autoPlayMs }: HeroCarouselControlsProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const activeSlide = slides[currentSlide] || slides[0];

  useEffect(() => {
    if (!isAutoPlaying || slides.length <= 1) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let interval: number | undefined;
    const initialDelay = Math.max(autoPlayMs, MIN_INITIAL_AUTOPLAY_DELAY_MS);
    const startHandle = setTimeout(() => {
      setCurrentSlide((previous) => (previous + 1) % slides.length);
      interval = Number(setInterval(() => {
        setCurrentSlide((previous) => (previous + 1) % slides.length);
      }, autoPlayMs));
    }, initialDelay);

    return () => {
      window.clearTimeout(startHandle);
      if (interval) window.clearInterval(interval);
    };
  }, [autoPlayMs, isAutoPlaying, slides.length]);

  const selectSlide = (index: number) => {
    setCurrentSlide(index);
    setIsAutoPlaying(false);
  };

  return (
    <>
      {currentSlide > 0 && activeSlide ? (
        <div className="absolute inset-0 z-[15] flex items-center justify-center text-center">
          <div className="absolute inset-0 h-full w-full">
            <Image
              src={activeSlide.image}
              alt={activeSlide.title}
              width={1920}
              height={1080}
              quality={70}
              className="absolute inset-0 h-full w-full object-cover"
              sizes="100vw"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-black/40" />
          </div>

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto bg-white bg-opacity-90 rounded-2xl p-8 md:p-12 shadow-2xl">
              <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight text-gray-900">
                {activeSlide.title}
              </h2>
              <p className="text-xl md:text-2xl lg:text-3xl font-light mb-8 text-yellow-600">
                {activeSlide.subtitle}
              </p>
              <p className="text-lg md:text-xl mb-12 max-w-3xl mx-auto leading-relaxed text-gray-700">
                {activeSlide.description}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href={activeSlide.cta.primary.href}
                  className="bg-yellow-500 hover:bg-yellow-600 text-black px-8 py-4 rounded-lg text-lg font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg"
                >
                  {getDescriptiveCtaText(activeSlide.cta.primary.text, activeSlide.cta.primary.href, activeSlide.title)}
                </Link>
                <Link
                  href={activeSlide.cta.secondary.href}
                  className="border-2 border-yellow-500 text-yellow-600 hover:bg-yellow-500 hover:text-black px-8 py-4 rounded-lg text-lg font-semibold transition-all duration-300 transform hover:scale-105"
                >
                  {getDescriptiveCtaText(activeSlide.cta.secondary.text, activeSlide.cta.secondary.href, activeSlide.title)}
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {slides.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => selectSlide((currentSlide - 1 + slides.length) % slides.length)}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 bg-black bg-opacity-50 hover:bg-opacity-75 text-white p-3 rounded-full transition-all duration-300"
            aria-label="Previous slide"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => selectSlide((currentSlide + 1) % slides.length)}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 bg-black bg-opacity-50 hover:bg-opacity-75 text-white p-3 rounded-full transition-all duration-300"
            aria-label="Next slide"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>

          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex space-x-3">
            {slides.map((slide, index) => (
              <button
                key={slide.id ?? index}
                type="button"
                onClick={() => selectSlide(index)}
                className={`w-3 h-3 rounded-full transition-all duration-300 ${
                  index === currentSlide
                    ? 'bg-yellow-400 scale-125'
                    : 'bg-yellow-400 bg-opacity-50 hover:bg-opacity-75'
                }`}
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === currentSlide ? 'true' : undefined}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
