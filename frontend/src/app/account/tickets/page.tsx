'use client';

import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import {
  ChevronLeftIcon,
  EnvelopeIcon,
  PhoneIcon,
  MapPinIcon,
  GlobeAltIcon,
  BuildingOfficeIcon,
} from '@heroicons/react/24/outline';

export default function ContactPage() {
  const contactInfo = [
    {
      icon: BuildingOfficeIcon,
      label: 'Company Name',
      value: 'Vcocnc',
      description: 'Industrial Automation Specialists',
    },
    {
      icon: EnvelopeIcon,
      label: 'Email',
      value: 'sales@vcocncspare.com',
      link: 'mailto:sales@vcocncspare.com',

      description: 'Send us an email anytime',
    },
    {
      icon: PhoneIcon,
      label: 'Phone',
      value: '+86 13348028050',
      link: 'tel:+8613348028050',

      description: 'Monday to Friday, 9:00 AM - 6:00 PM (China Time)',
    },
    {
      icon: MapPinIcon,
      label: 'Address',
      value: 'Kunshan, Jiangsu Province, China',
      description: '5,000 sqm workshop facility',
    },
    {
      icon: GlobeAltIcon,
      label: 'Website',
      value: 'www.vcocnc.shop',
      link: 'https://www.vcocnc.shop',
      description: 'Visit our website for more information',
    },
  ];

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/account"
              className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
            >
              <ChevronLeftIcon className="h-4 w-4 mr-1" />
              Back to Account
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Contact Information</h1>
            <p className="mt-2 text-sm text-gray-600">
              Get in touch with us for any questions or inquiries
            </p>
          </div>

          {/* Contact Cards */}
          <div className="space-y-4">
            {contactInfo.map((info) => {
              const Icon = info.icon;
              const content = (
                <div className="bg-white shadow rounded-lg p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <div className="flex items-center justify-center h-12 w-12 rounded-md bg-amber-100 text-amber-600">
                        <Icon className="h-6 w-6" />
                      </div>
                    </div>
                    <div className="ml-4 flex-1">
                      <h3 className="text-sm font-medium text-gray-500">{info.label}</h3>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {info.value}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">{info.description}</p>
                    </div>
                    {info.link && (
                      <div className="ml-4 flex-shrink-0">
                        <svg
                          className="h-5 w-5 text-gray-400"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              );

              return info.link ? (
                <a
                  key={info.label}
                  href={info.link}
                  target={info.link.startsWith('http') ? '_blank' : undefined}
                  rel={info.link.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="block"
                >
                  {content}
                </a>
              ) : (
                <div key={info.label}>{content}</div>
              );
            })}
          </div>

          {/* Additional Info */}
          <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-blue-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">About Vcocnc</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>
                    Established in 2005, we are one of the top three FANUC suppliers in China.
                    We specialize in automation components including System units, Circuit boards,
                    PLC, HMI, Inverters, Encoders, Amplifiers, Servomotors, and Servodrives from
                    manufacturers like AB, ABB, FANUC, Mitsubishi, and Siemens.
                  </p>
                  <ul className="list-disc pl-5 mt-3 space-y-1">
                    <li>27 dedicated workers</li>
                    <li>10 professional sales staff</li>
                    <li>100,000+ items regularly stocked</li>
                    <li>50-100 daily parcels shipped worldwide</li>
                    <li>200 million yearly turnover</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
