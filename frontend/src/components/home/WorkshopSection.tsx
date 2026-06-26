'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { HomepageContent } from '@/types';
import { 
  CheckCircleIcon, 
  CogIcon, 
  ShieldCheckIcon, 
  TruckIcon,
  WrenchScrewdriverIcon,
  BeakerIcon,
  ArchiveBoxIcon,
  ClipboardDocumentCheckIcon
} from '@heroicons/react/24/outline';
import { DEFAULT_WORKSHOP_SECTION_DATA, type WorkshopSectionData } from '@/lib/homepage-defaults';

type Props = { content?: HomepageContent | null };

const ICONS: Record<string, any> = {
  beaker: BeakerIcon,
  archive: ArchiveBoxIcon,
  wrench: WrenchScrewdriverIcon,
  shield: ShieldCheckIcon,
  cog: CogIcon,
  clipboard: ClipboardDocumentCheckIcon,
  truck: TruckIcon,
  check: CheckCircleIcon,
};

function normalizeWorkshopData(input: any): WorkshopSectionData {
  if (!input) return DEFAULT_WORKSHOP_SECTION_DATA;
  const data = typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { return null; } })() : input;
  const facilities = Array.isArray(data?.facilities) && data.facilities.length > 0 ? data.facilities : DEFAULT_WORKSHOP_SECTION_DATA.facilities;
  const capabilities = Array.isArray(data?.capabilities) && data.capabilities.length > 0 ? data.capabilities : DEFAULT_WORKSHOP_SECTION_DATA.capabilities;
  return {
    headerTitle: data?.headerTitle || DEFAULT_WORKSHOP_SECTION_DATA.headerTitle,
    headerDescription: data?.headerDescription || DEFAULT_WORKSHOP_SECTION_DATA.headerDescription,
    facilities,
    capabilities,
    statsBlock: data?.statsBlock || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock,
  };
}

export function WorkshopSection({ content }: Props) {
  const [activeTab, setActiveTab] = useState(0);
  const base = normalizeWorkshopData((content as any)?.data);
  const data: WorkshopSectionData = {
    ...base,
    headerTitle: content?.title || base.headerTitle,
    headerDescription: content?.description || base.headerDescription,
  };

  return (
    <section className="py-20 bg-white">
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

        {/* Facility Tabs */}
        <div className="mb-16">
          {/* Tab Navigation */}
          <div className="flex flex-wrap justify-center mb-8 border-b border-slate-200">
            {data.facilities.map((facility: any, index: number) => (
              <button
                key={facility.id}
                onClick={() => setActiveTab(index)}
                className={`px-6 py-3 font-medium text-sm md:text-base transition-colors duration-300 border-b-2 ${
                  activeTab === index
                    ? 'border-[#003a78] text-[#003a78]'
                    : 'border-transparent text-slate-600 hover:text-[#003a78]'
                }`}
              >
                {facility.title}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden">
            {data.facilities.map((facility: any, index: number) => (
              <div
                key={facility.id}
                className={`${activeTab === index ? 'block' : 'hidden'}`}
              >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                  {/* Image */}
                  <div className="relative h-96 lg:h-auto">
                    <Image
                      src={facility.image}
                      alt={facility.title}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 50vw"
                      className="object-cover"
                      unoptimized={typeof facility.image === 'string' && facility.image.startsWith('/uploads/')}
                      onError={() => {
                        console.error('Image failed to load:', facility.image);
                        // 可以设置备用图片
                      }}
                      onLoad={() => {
                        console.log('Image loaded successfully:', facility.image);
                      }}
                      priority={activeTab === index}
                    />
                  </div>

                  {/* Content */}
                  <div className="p-8 lg:p-12 flex flex-col justify-center">
                    <div className="flex items-center mb-6">
                      <div className="bg-blue-50 p-3 rounded-lg mr-4">
                        {(() => {
                          const Icon = ICONS[String(facility.icon)] || BeakerIcon;
                          return <Icon className="h-8 w-8 text-[#003a78]" />;
                        })()}
                      </div>
                      <h3 className="text-2xl font-bold text-slate-950">
                        {facility.title}
                      </h3>
                    </div>

                    <p className="text-slate-600 text-lg mb-8 leading-relaxed">
                      {facility.description}
                    </p>

                    <div className="space-y-4">
                      {(facility.features || []).map((feature: any, featureIndex: number) => (
                        <div key={featureIndex} className="flex items-center">
                          <CheckCircleIcon className="h-5 w-5 text-green-500 mr-3 flex-shrink-0" />
                          <span className="text-slate-700">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Capabilities Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
          {data.capabilities.map((capability: any, index: number) => (
            <div
              key={index}
              className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm hover:shadow-lg transition-shadow duration-300 text-center"
            >
              <div className="bg-blue-50 p-4 rounded-lg w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                {(() => {
                  const Icon = ICONS[String(capability.icon)] || CogIcon;
                  return <Icon className="h-8 w-8 text-[#003a78]" />;
                })()}
              </div>
              <h3 className="text-lg font-semibold text-slate-950 mb-2">
                {capability.title}
              </h3>
              <p className="text-slate-600 text-sm">
                {capability.description}
              </p>
            </div>
          ))}
        </div>

        {/* Statistics */}
        <div className="bg-slate-950 rounded-lg p-8 md:p-12 text-white">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {(data.statsBlock?.items || []).slice(0, 3).map((item: any, idx: number) => (
              <div key={idx}>
                <div className="text-4xl md:text-5xl font-bold mb-2">{item.value}</div>
                <div className="text-orange-100 text-lg">{item.title}</div>
                <div className="text-slate-300 text-sm mt-1">{item.subtitle}</div>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <h3 className="text-2xl font-bold mb-4">
              {data.statsBlock?.ctaTitle || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.ctaTitle}
            </h3>
            <p className="text-slate-300 mb-6 max-w-2xl mx-auto">
              {data.statsBlock?.ctaDescription || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.ctaDescription}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={data.statsBlock?.ctaPrimary?.href || '/contact'}
                className="bg-orange-500 text-white hover:bg-[#003a78] px-8 py-3 rounded-md font-semibold transition-colors duration-300"
              >
                {data.statsBlock?.ctaPrimary?.text || 'Schedule Tour'}
              </a>
              <a
                href={data.statsBlock?.ctaSecondary?.href || '/about'}
                className="border border-white/60 text-white hover:bg-white hover:text-slate-950 px-8 py-3 rounded-md font-semibold transition-colors duration-300"
              >
                {data.statsBlock?.ctaSecondary?.text || 'Learn More'}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default WorkshopSection;
