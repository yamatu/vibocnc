import Image from 'next/image';
import { getSiteUrl } from '@/lib/url';
import { generateBreadcrumbSchema } from '@/lib/structured-data';
import { localizePublicPath, type PublicLocale } from '@/lib/i18n/config';
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

import { createPageText, type PageData } from '@/lib/page-content';
import { ABOUT_PAGE_SCHEMA } from '@/lib/page-content-schema';

// Admin-entered URLs may point at hosts outside next.config images.remotePatterns.
const isExternal = (src: string) => /^https?:\/\//i.test(src);

export default function AboutPageView({ locale, data }: { locale: PublicLocale; data: PageData }) {
  const baseUrl = getSiteUrl();
  const text = createPageText(ABOUT_PAGE_SCHEMA, data, locale, (key) => translatePublicMessage(locale, key));
  const heroImage = text('heroImage');
  const heroStyle = heroImage
    ? { backgroundImage: `linear-gradient(rgba(15, 23, 42, 0.78), rgba(15, 23, 42, 0.78)), url(${JSON.stringify(heroImage)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined;
  const localizedAboutUrl = `${baseUrl}${localizePublicPath('/about', locale)}`;

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: translatePublicMessage(locale, 'common.home'), url: `${baseUrl}${localizePublicPath('/', locale)}` },
    { name: translatePublicMessage(locale, 'nav.about'), url: localizedAboutUrl },
  ]);

  const aboutPageSchema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "name": text('heroTitle'),
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
      {/* Hero Section */}
      <section className="site-page-hero py-24" style={heroStyle}>
        <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="site-hero-kicker mb-5">{text('heroKicker')}</div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">{text('heroTitle')}</h1>
            <p className="whitespace-pre-line text-xl md:text-2xl text-blue-100 max-w-3xl mx-auto">
              {text('heroSubtitle')}
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
                {text('profileTitle')}
              </h2>
              <p className="whitespace-pre-line text-lg text-gray-700 mb-6 leading-relaxed">
                {text('profileText1')}
              </p>
              <p className="whitespace-pre-line text-lg text-gray-700 mb-6 leading-relaxed">
                {text('profileText2')}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="site-subtle-card p-4">
                  <div className="text-2xl font-bold text-[var(--site-primary)]">{text('profileStat1Value')}</div>
                  <div className="text-sm text-gray-600">{text('profileStat1Label')}</div>
                </div>
                <div className="site-subtle-card p-4">
                  <div className="text-2xl font-bold text-[var(--site-primary)]">{text('profileStat2Value')}</div>
                  <div className="text-sm text-gray-600">{text('profileStat2Label')}</div>
                </div>
              </div>
            </div>
            <div className="relative">
              <Image
                src={text('experienceImage')}
                unoptimized={isExternal(text('experienceImage'))}
                alt={text('heroTitle')}
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
              {text('facilityTitle')}
            </h2>
            <p className="whitespace-pre-line text-lg text-gray-600 max-w-3xl mx-auto">
              {text('facilityText')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="site-detail-panel text-center p-8">
              <BuildingOfficeIcon className="h-12 w-12 text-[var(--site-primary)] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">{text('stat1Value')}</div>
              <div className="text-gray-600">{text('stat1Label')}</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <UserGroupIcon className="h-12 w-12 text-[var(--site-primary)] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">{text('stat2Value')}</div>
              <div className="text-gray-600">{text('stat2Label')}</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <CubeIcon className="h-12 w-12 text-[var(--site-primary)] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">{text('stat3Value')}</div>
              <div className="text-gray-600">{text('stat3Label')}</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <TruckIcon className="h-12 w-12 text-[var(--site-primary)] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">{text('stat4Value')}</div>
              <div className="text-gray-600">{text('stat4Label')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Professional Service */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {text('servicesTitle')}
            </h2>
            <p className="whitespace-pre-line text-lg text-gray-600 max-w-3xl mx-auto">
              {text('servicesText')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <ChartBarIcon className="h-16 w-16 text-[var(--site-primary)] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{text('service1Title')}</h3>
              <p className="text-gray-600">
                {text('service1Text')}
              </p>
            </div>

            <div className="text-center p-6">
              <ClockIcon className="h-16 w-16 text-[var(--site-primary)] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{text('service2Title')}</h3>
              <p className="text-gray-600">
                {text('service2Text')}
              </p>
            </div>

            <div className="text-center p-6">
              <WrenchScrewdriverIcon className="h-16 w-16 text-[var(--site-primary)] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{text('service3Title')}</h3>
              <p className="text-gray-600">
                {text('service3Text')}
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
                {text('experienceTitle')}
              </h2>
              <p className="text-lg text-blue-100 mb-6 leading-relaxed">
                {text('experienceText')}
              </p>
              <div className="flex items-center space-x-4">
                <ShieldCheckIcon className="h-12 w-12 text-orange-300" />
                <div>
                  <div className="text-xl font-semibold">{text('trustTitle')}</div>
                  <div className="text-blue-100">{text('trustText')}</div>
                </div>
              </div>
            </div>
            <div className="relative">
              <Image
                src={text('profileImage')}
                unoptimized={isExternal(text('profileImage'))}
                alt="Workshop Interior"
                width={600}
                height={400}
                className="w-full rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
