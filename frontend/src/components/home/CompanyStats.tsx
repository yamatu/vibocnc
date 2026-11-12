'use client';

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
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { normalizeCompanyStat, normalizeLegacyCompanyText } from '@/lib/company-facts';

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
  const statsSource = Array.isArray(data?.stats) && data.stats.length > 0 ? data.stats : DEFAULT_COMPANY_STATS_DATA.stats;
  const stats = statsSource.map((stat: Record<string, unknown>) => normalizeCompanyStat(stat));
  return {
    headerTitle: normalizeLegacyCompanyText(data?.headerTitle || DEFAULT_COMPANY_STATS_DATA.headerTitle),
    headerDescription: normalizeLegacyCompanyText(data?.headerDescription || DEFAULT_COMPANY_STATS_DATA.headerDescription),
    stats,
    ctaTitle: normalizeLegacyCompanyText(data?.ctaTitle || DEFAULT_COMPANY_STATS_DATA.ctaTitle),
    ctaDescription: normalizeLegacyCompanyText(data?.ctaDescription || DEFAULT_COMPANY_STATS_DATA.ctaDescription),
    ctaPrimary: data?.ctaPrimary || DEFAULT_COMPANY_STATS_DATA.ctaPrimary,
    ctaSecondary: data?.ctaSecondary || DEFAULT_COMPANY_STATS_DATA.ctaSecondary,
  };
}

export function CompanyStats({ content }: Props) {
  const { locale, t, href } = usePublicI18n();
  const base = normalizeCompanyStatsData((content as any)?.data);
  const data: CompanyStatsData = {
    ...base,
    // Back-compat: allow simple fields to affect the section even if `data` is null.
    headerTitle: content?.title && !/FANUC and CNC Spare Parts Supplier/i.test(content.title) ? normalizeLegacyCompanyText(content.title) : base.headerTitle,
    headerDescription: content?.description ? normalizeLegacyCompanyText(content.description) : base.headerDescription,
    ctaPrimary: content?.button_text
      ? { text: content.button_text, href: content.button_url || base.ctaPrimary.href }
      : base.ctaPrimary,
  };

  return (
    <section id="company-stats" className="home-deferred-section py-20 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-950 mb-4">
            {locale === 'en' ? data.headerTitle : t('home.stats.title')}
          </h2>
          <p className="text-xl text-slate-600 max-w-4xl mx-auto">
            {locale === 'en' ? data.headerDescription : t('home.stats.description')}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
          {data.stats.map((stat: any) => {
            const IconComponent = ICONS[String(stat.icon)] || CalendarIcon;
            
            return (
              <div
                key={stat.id}
                className="bg-white rounded-lg border border-slate-200 p-5 sm:p-6 lg:p-8 shadow-sm hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1"
              >
                <div className="flex items-center justify-center mb-4 sm:mb-6">
                  <div className={`p-3 sm:p-4 rounded-lg bg-slate-50 ${stat.color}`}>
                    <IconComponent className="h-6 w-6 sm:h-8 sm:w-8" />
                  </div>
                </div>
                
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-950 mb-1 sm:mb-2">
                    <span>{Number(stat.value).toLocaleString()}</span>
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
              {locale === 'en' ? data.ctaTitle : t('home.stats.ctaTitle')}
            </h3>
            <p className="text-slate-300 mb-6">
              {locale === 'en' ? data.ctaDescription : t('home.stats.ctaDescription')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={href(data.ctaPrimary?.href || '/contact')}
                className="bg-orange-700 hover:bg-[var(--site-primary)] text-white px-8 py-3 rounded-md font-semibold transition-colors duration-300"
              >
                {locale === 'en' ? data.ctaPrimary?.text || t('home.stats.contact') : t('home.stats.contact')}
              </a>
              <a
                href={href(data.ctaSecondary?.href || '/products')}
                className="border border-white/50 text-white hover:bg-white hover:text-slate-950 px-8 py-3 rounded-md font-semibold transition-colors duration-300"
              >
                {locale === 'en' ? data.ctaSecondary?.text || t('home.stats.browse') : t('home.stats.browse')}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default CompanyStats;
