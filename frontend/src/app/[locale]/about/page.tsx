import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import Image from 'next/image';
import { getSiteUrl } from '@/lib/url';
import { generateBreadcrumbSchema } from '@/lib/structured-data';
import { withSiteName } from '@/lib/seo';
import { getLocalizedMetadataPaths, resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';
import { localizePublicPath } from '@/lib/i18n/config';
import { translatePublicMessage } from '@/lib/i18n/messages';
import {
  BuildingOfficeIcon,
  UserGroupIcon,
  CubeIcon,
  TruckIcon,
  ChartBarIcon,
  ClockIcon,
  WrenchScrewdriverIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const { locale, canonical, languages } = await getLocalizedMetadataPaths(await resolveRouteLocale(params), '/about');
  const title = translatePublicMessage(locale, 'about.title');
  return {
    title,
    description: 'Founded in 2007, Vibocnc supplies CNC and industrial automation parts across 20+ brands from a 3,500 sqm facility in Kunshan, China.',
    keywords: 'Vibocnc, about Vibocnc, industrial automation parts supplier China, CNC parts supplier, PLC HMI servo parts, Kunshan automation company',
    alternates: { canonical, languages },
    openGraph: {
      title: withSiteName(title),
      description: 'Industrial automation parts supplier since 2007, supporting 20+ brands from a 3,500 sqm inspection and service facility with worldwide shipping.',
      url: canonical,
      type: 'website',
    },
  };
}

export default async function About({ params }: { params: LocaleRouteParams }) {
  const baseUrl = getSiteUrl();
  const locale = await resolveRouteLocale(params);
  const localizedAboutUrl = `${baseUrl}${localizePublicPath('/about', locale)}`;

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: translatePublicMessage(locale, 'common.home'), url: `${baseUrl}${localizePublicPath('/', locale)}` },
    { name: translatePublicMessage(locale, 'nav.about'), url: localizedAboutUrl },
  ]);

  const aboutPageSchema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "name": translatePublicMessage(locale, 'about.title'),
    "description": "Learn about Vibocnc, a multi-brand industrial automation parts supplier founded in China in 2007.",
    "url": localizedAboutUrl,
    "mainEntity": {
      "@type": "Organization",
      "@id": `${baseUrl}/#organization`,
      "name": "Vibocnc",
      "url": baseUrl,
      "foundingDate": "2007",
      "foundingLocation": {
        "@type": "Place",
        "name": "Kunshan, Jiangsu, China"
      },
      "numberOfEmployees": {
        "@type": "QuantitativeValue",
        "value": 37
      },
      "description": "A multi-brand industrial automation parts supplier with 100,000+ items regularly stocked, serving maintenance teams worldwide.",
      "knowsAbout": [
        "Multi-brand CNC parts",
        "FANUC automation parts",
        "Siemens automation parts",
        "Mitsubishi automation parts",
        "ABB and Allen-Bradley components",
        "Industrial automation",
        "Servo motors",
        "PCB boards",
        "I/O modules",
        "PLC",
        "HMI",
        "Inverters",
        "Encoders",
        "Amplifiers"
      ],
      "slogan": "Your Industrial Automation Parts Partner Since 2007"
    }
  };

  const combinedSchema = {
    "@context": "https://schema.org",
    "@graph": [aboutPageSchema, breadcrumbSchema]
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(combinedSchema) }}
      />
      <PublicLayout>
      {/* Hero Section */}
      <section className="site-page-hero py-24">
        <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="site-hero-kicker mb-5">{translatePublicMessage(locale, 'about.kicker')}</div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">{translatePublicMessage(locale, 'about.title')}</h1>
            <p className="text-xl md:text-2xl text-blue-100 max-w-3xl mx-auto">
              {translatePublicMessage(locale, 'about.subtitle')}
            </p>
          </div>
        </div>
      </section>

      {/* Company Profile */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                {translatePublicMessage(locale, 'about.profile')}
              </h2>
              <p className="text-lg text-gray-700 mb-6 leading-relaxed">
                {translatePublicMessage(locale, 'about.profileDescription')}
              </p>
              <p className="text-lg text-gray-700 mb-6 leading-relaxed">
                {translatePublicMessage(locale, 'about.warehouseDescription')}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="site-subtle-card p-4">
                  <div className="text-2xl font-bold text-[#0b3e75]">15+</div>
                  <div className="text-sm text-gray-600">{translatePublicMessage(locale, 'about.years')}</div>
                </div>
                <div className="site-subtle-card p-4">
                  <div className="text-2xl font-bold text-[#0b3e75]">20+</div>
                  <div className="text-sm text-gray-600">{translatePublicMessage(locale, 'about.topSupplier')}</div>
                </div>
              </div>
            </div>
            <div className="relative">
              <Image
                src="https://s2.loli.net/2025/09/01/G1JcoeXWNTdpIfZ.jpg"
                alt="Vibocnc Company Building"
                width={600}
                height={400}
                className="w-full rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Company Stats */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {translatePublicMessage(locale, 'about.warehouse')}
            </h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              {translatePublicMessage(locale, 'about.warehouseDescription')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="site-detail-panel text-center p-8">
              <BuildingOfficeIcon className="h-12 w-12 text-[#0b3e75] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">3,500</div>
              <div className="text-gray-600">{translatePublicMessage(locale, 'about.workshop')}</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <UserGroupIcon className="h-12 w-12 text-[#0b3e75] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">37</div>
              <div className="text-gray-600">{translatePublicMessage(locale, 'about.employees')}</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <CubeIcon className="h-12 w-12 text-[#0b3e75] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">100K+</div>
              <div className="text-gray-600">{translatePublicMessage(locale, 'about.items')}</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <TruckIcon className="h-12 w-12 text-[#0b3e75] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">50-100</div>
              <div className="text-gray-600">{translatePublicMessage(locale, 'about.parcels')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Professional Service */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {translatePublicMessage(locale, 'about.services')}
            </h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              {translatePublicMessage(locale, 'about.servicesDescription')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <ChartBarIcon className="h-16 w-16 text-[#0b3e75] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{translatePublicMessage(locale, 'about.sales')}</h3>
              <p className="text-gray-600">
                {translatePublicMessage(locale, 'about.salesDescription')}
              </p>
            </div>

            <div className="text-center p-6">
              <ClockIcon className="h-16 w-16 text-[#0b3e75] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{translatePublicMessage(locale, 'about.testing')}</h3>
              <p className="text-gray-600">
                {translatePublicMessage(locale, 'about.testingDescription')}
              </p>
            </div>

            <div className="text-center p-6">
              <WrenchScrewdriverIcon className="h-16 w-16 text-[#0b3e75] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{translatePublicMessage(locale, 'about.maintenance')}</h3>
              <p className="text-gray-600">
                {translatePublicMessage(locale, 'about.maintenanceDescription')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Experience Section */}
      <section className="site-page-hero py-16">
        <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                {translatePublicMessage(locale, 'about.experience')}
              </h2>
              <p className="text-lg text-blue-100 mb-6 leading-relaxed">
                {translatePublicMessage(locale, 'about.experienceDescription')}
              </p>
              <div className="flex items-center space-x-4">
                <ShieldCheckIcon className="h-12 w-12 text-orange-300" />
                <div>
                  <div className="text-xl font-semibold">{translatePublicMessage(locale, 'about.trustedPartner')}</div>
                  <div className="text-blue-100">{translatePublicMessage(locale, 'about.trustedDescription')}</div>
                </div>
              </div>
            </div>
            <div className="relative">
              <Image
                src="https://s2.loli.net/2025/09/01/G1JcoeXWNTdpIfZ.jpg"
                alt="Workshop Interior"
                width={600}
                height={400}
                className="w-full rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
    </>
  );
}
