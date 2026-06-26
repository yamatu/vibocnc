'use client';

import { useEffect, useState } from 'react';
import ClientOnly from '@/components/common/ClientOnly';
import type { HomepageContent } from '@/types';
import { 
  CalendarIcon, 
  BuildingOfficeIcon, 
  UsersIcon, 
  GlobeAltIcon,
  CogIcon,
  ShieldCheckIcon,
  TruckIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import { DEFAULT_COMPANY_STATS_DATA, type CompanyStatsData } from '@/lib/homepage-defaults';

type Props = { content?: HomepageContent | null };

const ICONS: Record<string, any> = {
  calendar: CalendarIcon,
  building: BuildingOfficeIcon,
  users: UsersIcon,
  globe: GlobeAltIcon,
  cog: CogIcon,
  shield: ShieldCheckIcon,
  truck: TruckIcon,
  clock: ClockIcon,
};

function normalizeCompanyStatsData(input: any): CompanyStatsData {
  if (!input) return DEFAULT_COMPANY_STATS_DATA;
  const data = typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { return null; } })() : input;
  const stats = Array.isArray(data?.stats) && data.stats.length > 0 ? data.stats : DEFAULT_COMPANY_STATS_DATA.stats;
  return {
    headerTitle: data?.headerTitle || DEFAULT_COMPANY_STATS_DATA.headerTitle,
    headerDescription: data?.headerDescription || DEFAULT_COMPANY_STATS_DATA.headerDescription,
    stats,
    ctaTitle: data?.ctaTitle || DEFAULT_COMPANY_STATS_DATA.ctaTitle,
    ctaDescription: data?.ctaDescription || DEFAULT_COMPANY_STATS_DATA.ctaDescription,
    ctaPrimary: data?.ctaPrimary || DEFAULT_COMPANY_STATS_DATA.ctaPrimary,
    ctaSecondary: data?.ctaSecondary || DEFAULT_COMPANY_STATS_DATA.ctaSecondary,
  };
}

function AnimatedCounter({ value, duration = 2000 }: { value: number; duration?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      setCount(Math.floor(progress * value));
      
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [value, duration]);

  return <span suppressHydrationWarning>{count.toLocaleString()}</span>;
}

export function CompanyStats({ content }: Props) {
  const [isVisible, setIsVisible] = useState(false);
  const base = normalizeCompanyStatsData((content as any)?.data);
  const data: CompanyStatsData = {
    ...base,
    // Back-compat: allow simple fields to affect the section even if `data` is null.
    headerTitle: content?.title || base.headerTitle,
    headerDescription: content?.description || base.headerDescription,
    ctaPrimary: content?.button_text
      ? { text: content.button_text, href: content.button_url || base.ctaPrimary.href }
      : base.ctaPrimary,
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 }
    );

    const element = document.getElementById('company-stats');
    if (element) {
      observer.observe(element);
    }

    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, []);

  return (
    <section id="company-stats" className="py-20 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-950 mb-4">
            {data.headerTitle}
          </h2>
          <p className="text-xl text-slate-600 max-w-4xl mx-auto">
            {data.headerDescription}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
          {data.stats.map((stat: any, index: number) => {
            const IconComponent = ICONS[String(stat.icon)] || CalendarIcon;
            
            return (
              <div
                key={stat.id}
                className={`bg-white rounded-lg border border-slate-200 p-5 sm:p-6 lg:p-8 shadow-sm hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1 ${
                  isVisible
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-4 sm:translate-y-8'
                }`}
                style={{
                  transitionDelay: isVisible ? `${index * 100}ms` : '0ms'
                }}
              >
                <div className="flex items-center justify-center mb-4 sm:mb-6">
                  <div className={`p-3 sm:p-4 rounded-lg bg-slate-50 ${stat.color}`}>
                    <IconComponent className="h-6 w-6 sm:h-8 sm:w-8" />
                  </div>
                </div>
                
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-950 mb-1 sm:mb-2">
                    <ClientOnly fallback={<span suppressHydrationWarning>0</span>}>
                      {isVisible ? (
                        <AnimatedCounter value={stat.value} />
                      ) : (
                        <span suppressHydrationWarning>0</span>
                      )}
                    </ClientOnly>
                    <span className={`${stat.color} text-base sm:text-lg align-top ml-1`}>{stat.suffix}</span>
                  </div>
                  
                  <h3 className="text-sm sm:text-base font-semibold text-slate-900 mb-1 sm:mb-2 leading-snug">
                    {stat.label}
                  </h3>

                  <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                    {stat.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-16">
          <div className="bg-slate-950 rounded-lg p-8 shadow-lg max-w-4xl mx-auto text-white">
            <h3 className="text-2xl font-bold mb-4">
              {data.ctaTitle}
            </h3>
            <p className="text-slate-300 mb-6">
              {data.ctaDescription}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={data.ctaPrimary?.href || '/contact'}
                className="bg-orange-500 hover:bg-[#003a78] text-white px-8 py-3 rounded-md font-semibold transition-colors duration-300"
              >
                {data.ctaPrimary?.text || 'Contact Our Experts'}
              </a>
              <a
                href={data.ctaSecondary?.href || '/products'}
                className="border border-white/50 text-white hover:bg-white hover:text-slate-950 px-8 py-3 rounded-md font-semibold transition-colors duration-300"
              >
                {data.ctaSecondary?.text || 'Browse Products'}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default CompanyStats;
