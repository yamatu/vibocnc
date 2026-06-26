import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import Image from 'next/image';
import { getSiteUrl } from '@/lib/url';
import { generateBreadcrumbSchema } from '@/lib/structured-data';
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

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getSiteUrl();
  return {
    title: 'About Vcocnc - Top 3 FANUC Parts Supplier in China Since 2005',
    description: 'Vcocnc is a leading FANUC CNC parts supplier established in 2005 in Kunshan, China. With 100,000+ items in stock, 37 employees, and a 5,000 sqm workshop, we are one of the top 3 FANUC suppliers in China. Worldwide shipping.',
    keywords: 'Vcocnc, about Vcocnc, FANUC supplier China, CNC parts supplier, industrial automation company, Kunshan, top FANUC supplier',
    alternates: { canonical: `${baseUrl}/about` },
    openGraph: {
      title: 'About Vcocnc - Top 3 FANUC Parts Supplier in China Since 2005',
      description: 'Leading FANUC CNC parts supplier since 2005. 100,000+ items in stock, 37 employees, 5,000 sqm workshop. Top 3 FANUC supplier in China with worldwide shipping.',
      url: `${baseUrl}/about`,
      type: 'website',
    },
  };
}

export default function About() {
  const baseUrl = getSiteUrl();

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: 'Home', url: baseUrl },
    { name: 'About', url: `${baseUrl}/about` },
  ]);

  const aboutPageSchema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "name": "About Vcocnc",
    "description": "Learn about Vcocnc, a top 3 FANUC parts supplier in China since 2005.",
    "url": `${baseUrl}/about`,
    "mainEntity": {
      "@type": "Organization",
      "name": "Vcocnc",
      "foundingDate": "2005",
      "foundingLocation": {
        "@type": "Place",
        "name": "Kunshan, Jiangsu, China"
      },
      "numberOfEmployees": {
        "@type": "QuantitativeValue",
        "value": 37
      },
      "description": "One of the top three FANUC suppliers in China with 100,000+ items regularly stocked, serving customers worldwide with industrial automation components.",
      "knowsAbout": [
        "FANUC CNC parts",
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
      "slogan": "Your Trusted FANUC Parts Partner Since 2005"
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
            <div className="site-hero-kicker mb-5">About VIBO CNC</div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">About Vcocnc</h1>
            <p className="text-xl md:text-2xl text-blue-100 max-w-3xl mx-auto">
              Your trusted one-stop CNC solution supplier since 2005
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
                Company Profile
              </h2>
              <p className="text-lg text-gray-700 mb-6 leading-relaxed">
                Vcocnc established in 2005 in Kunshan, China. We are selling automation components like 
                System unit, Circuit board, PLC, HMI, Inverter, Encoder, Amplifier, Servomotor, Servodrive 
                etc of AB, ABB, Fanuc, Mitsubishi, Siemens and other manufacturers in our own 5,000sqm workshop.
              </p>
              <p className="text-lg text-gray-700 mb-6 leading-relaxed">
                Especially Fanuc, We are one of the top three suppliers in China. We now have 27 workers, 
                10 sales and 100,000 items regularly stocked. Daily parcel around 50-100pcs, yearly turnover 
                around 200 million.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="site-subtle-card p-4">
                  <div className="text-2xl font-bold text-[#0b3e75]">20+</div>
                  <div className="text-sm text-gray-600">Years Experience</div>
                </div>
                <div className="site-subtle-card p-4">
                  <div className="text-2xl font-bold text-[#0b3e75]">Top 3</div>
                  <div className="text-sm text-gray-600">Fanuc Supplier in China</div>
                </div>
              </div>
            </div>
            <div className="relative">
              <Image
                src="https://s2.loli.net/2025/09/01/G1JcoeXWNTdpIfZ.jpg"
                alt="Vcocnc Company Building"
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
              Warehouse & Items
            </h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              We now have 27 workers, 10 sales and 100,000 items regularly stocked. 
              Daily parcel around 50-100pcs, yearly turnover around 200 million.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="site-detail-panel text-center p-8">
              <BuildingOfficeIcon className="h-12 w-12 text-[#0b3e75] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">5,000</div>
              <div className="text-gray-600">sqm Workshop</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <UserGroupIcon className="h-12 w-12 text-[#0b3e75] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">37</div>
              <div className="text-gray-600">Total Employees</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <CubeIcon className="h-12 w-12 text-[#0b3e75] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">100K+</div>
              <div className="text-gray-600">Items in Stock</div>
            </div>

            <div className="site-detail-panel text-center p-8">
              <TruckIcon className="h-12 w-12 text-[#0b3e75] mx-auto mb-4" />
              <div className="text-3xl font-bold text-gray-900 mb-2">50-100</div>
              <div className="text-gray-600">Daily Parcels</div>
            </div>
          </div>
        </div>
      </section>

      {/* Professional Service */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Professional Service
            </h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              We have a professional team to provide services including sales, testing and maintenance
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <ChartBarIcon className="h-16 w-16 text-[#0b3e75] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Sales Service</h3>
              <p className="text-gray-600">
                Professional sales team with deep knowledge of automation components
                to help you find the right solutions.
              </p>
            </div>

            <div className="text-center p-6">
              <ClockIcon className="h-16 w-16 text-[#0b3e75] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Testing Service</h3>
              <p className="text-gray-600">
                Comprehensive testing procedures ensure all components meet quality
                standards before delivery.
              </p>
            </div>

            <div className="text-center p-6">
              <WrenchScrewdriverIcon className="h-16 w-16 text-[#0b3e75] mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Maintenance Service</h3>
              <p className="text-gray-600">
                Expert maintenance and repair services to keep your automation
                systems running at peak performance.
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
                20+ Years of Excellence
              </h2>
              <p className="text-lg text-blue-100 mb-6 leading-relaxed">
                More than 18 years experience we have ability to coordinate specific strengths
                into a whole, providing clients with solutions that consider various import and
                export transportation options.
              </p>
              <div className="flex items-center space-x-4">
                <ShieldCheckIcon className="h-12 w-12 text-orange-300" />
                <div>
                  <div className="text-xl font-semibold">Trusted Partner</div>
                  <div className="text-blue-100">Reliable solutions worldwide</div>
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
