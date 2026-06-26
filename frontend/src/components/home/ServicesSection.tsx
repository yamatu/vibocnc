'use client';

import Link from 'next/link';
import type { HomepageContent } from '@/types';
import { 
  CogIcon, 
  WrenchScrewdriverIcon, 
  PhoneIcon, 
  TruckIcon,
  ShieldCheckIcon,
  AcademicCapIcon,
  ClockIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline';
import { DEFAULT_SERVICES_SECTION_DATA, type ServicesSectionData } from '@/lib/homepage-defaults';

type Props = { content?: HomepageContent | null };

const ICONS: Record<string, any> = {
  cog: CogIcon,
  wrench: WrenchScrewdriverIcon,
  phone: PhoneIcon,
  truck: TruckIcon,
  shield: ShieldCheckIcon,
  cap: AcademicCapIcon,
};

function normalizeServicesData(input: any): ServicesSectionData {
  if (!input) return DEFAULT_SERVICES_SECTION_DATA;
  const data = typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { return null; } })() : input;
  const services = Array.isArray(data?.services) && data.services.length > 0 ? data.services : DEFAULT_SERVICES_SECTION_DATA.services;
  const processSteps = Array.isArray(data?.processSteps) && data.processSteps.length > 0 ? data.processSteps : DEFAULT_SERVICES_SECTION_DATA.processSteps;
  return {
    headerTitle: data?.headerTitle || DEFAULT_SERVICES_SECTION_DATA.headerTitle,
    headerDescription: data?.headerDescription || DEFAULT_SERVICES_SECTION_DATA.headerDescription,
    services,
    processTitle: data?.processTitle || DEFAULT_SERVICES_SECTION_DATA.processTitle,
    processDescription: data?.processDescription || DEFAULT_SERVICES_SECTION_DATA.processDescription,
    processSteps,
    ctaTitle: data?.ctaTitle || DEFAULT_SERVICES_SECTION_DATA.ctaTitle,
    ctaDescription: data?.ctaDescription || DEFAULT_SERVICES_SECTION_DATA.ctaDescription,
    ctaPrimary: data?.ctaPrimary || DEFAULT_SERVICES_SECTION_DATA.ctaPrimary,
    ctaSecondary: data?.ctaSecondary || DEFAULT_SERVICES_SECTION_DATA.ctaSecondary,
    ctaBadges: Array.isArray(data?.ctaBadges) ? data.ctaBadges : DEFAULT_SERVICES_SECTION_DATA.ctaBadges,
  };
}

export function ServicesSection({ content }: Props) {
  const base = normalizeServicesData((content as any)?.data);
  const data: ServicesSectionData = {
    ...base,
    headerTitle: content?.title || base.headerTitle,
    headerDescription: content?.description || base.headerDescription,
    ctaPrimary: content?.button_text
      ? { text: content.button_text, href: content.button_url || base.ctaPrimary.href }
      : base.ctaPrimary,
  };
  return (
    <section className="py-20 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-950 mb-4">
            {data.headerTitle}
          </h2>
          <p className="text-xl text-slate-600 max-w-3xl mx-auto">
            {data.headerDescription}
          </p>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
          {data.services.map((service: any) => {
            const Icon = ICONS[String(service.icon)] || CogIcon;
            return (
              <div
                key={service.id}
                className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1 overflow-hidden group"
              >
                <div className="p-8">
                  <div
                    className={`${
                      service.color || 'bg-yellow-500'
                    } p-4 rounded-lg w-16 h-16 mb-6 flex items-center justify-center group-hover:scale-105 transition-transform duration-300`}
                  >
                    <Icon className="h-8 w-8 text-white" />
                  </div>

                  <h3 className="text-xl font-bold text-slate-950 mb-4">
                    {service.title}
                  </h3>

                  <p className="text-slate-600 mb-6 leading-relaxed">
                    {service.description}
                  </p>

                  <ul className="space-y-2 mb-6">
                    {(service.features || []).map((feature: any, index: number) => (
                      <li key={index} className="flex items-center text-sm text-slate-600">
                        <div className="w-2 h-2 bg-orange-500 rounded-full mr-3 flex-shrink-0"></div>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={service.href || '/contact'}
                    className="text-[#003a78] hover:text-[#003a78] font-semibold text-sm flex items-center group-hover:translate-x-2 transition-transform duration-300"
                  >
                    Learn More
                    <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* Process Section */}
        <div className="bg-white rounded-lg border border-slate-200 p-8 md:p-12">
          <div className="text-center mb-12">
            <h3 className="text-2xl md:text-3xl font-bold text-slate-950 mb-4">
              {data.processTitle}
            </h3>
            <p className="text-slate-600 max-w-2xl mx-auto">
              {data.processDescription}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {data.processSteps.map((step: any, index: number) => (
              <div key={index} className="text-center relative">
                {/* Step Number */}
                <div className="bg-slate-950 text-white w-16 h-16 rounded-lg flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {step.step}
                </div>

                {/* Connector Line */}
                {index < data.processSteps.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-1/2 w-full h-0.5 bg-teal-100 transform translate-x-8"></div>
                )}

                <h4 className="text-lg font-semibold text-slate-950 mb-2">
                  {step.title}
                </h4>

                <p className="text-slate-600 text-sm leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center mt-16">
          <div className="bg-slate-950 rounded-lg p-8 md:p-12 text-white">
            <div className="max-w-3xl mx-auto">
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                {data.ctaTitle}
              </h3>
              <p className="text-slate-300 mb-8 text-lg">
                {data.ctaDescription}
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href={data.ctaPrimary?.href || '/contact'}
                  className="bg-orange-500 text-white hover:bg-[#003a78] px-8 py-4 rounded-md font-semibold transition-colors duration-300 flex items-center justify-center"
                >
                  <PhoneIcon className="h-5 w-5 mr-2" />
                  {data.ctaPrimary?.text || 'Contact Us Today'}
                </Link>

                <Link
                  href={data.ctaSecondary?.href || '/products'}
                  className="border border-white/60 text-white hover:bg-white hover:text-slate-950 px-8 py-4 rounded-md font-semibold transition-colors duration-300 flex items-center justify-center"
                >
                  <CogIcon className="h-5 w-5 mr-2" />
                  {data.ctaSecondary?.text || 'Browse Products'}
                </Link>
              </div>

              {/* Contact Info */}
              <div className="flex flex-col md:flex-row justify-center items-center space-y-4 md:space-y-0 md:space-x-8 mt-8 pt-8 border-t border-white/15">
                {(data.ctaBadges || []).slice(0, 3).map((txt: any, idx: number) => {
                  const Icon = idx === 0 ? ClockIcon : idx === 1 ? GlobeAltIcon : ShieldCheckIcon;
                  return (
                    <div key={idx} className="flex items-center text-orange-100">
                      <Icon className="h-5 w-5 mr-2" />
                      <span>{txt}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ServicesSection;
