'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import ContactService from '@/services/contact.service';
import type { ContactCreateRequest } from '@/services/contact.service';
import PublicLayout from '@/components/layout/PublicLayout';
import { getSiteUrl } from '@/lib/url';
import {
  MapPinIcon,
  PhoneIcon,
  EnvelopeIcon,
  ClockIcon,
  BuildingOfficeIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { createPageText, type PageData } from '@/lib/page-content';
import { CONTACT_PAGE_SCHEMA } from '@/lib/page-content-schema';

const siteUrl = getSiteUrl();

const contactPageSchema = {
  "@context": "https://schema.org",
  "@type": "ContactPage",
  "name": "Contact Vibocnc",
  "description": "Get in touch with Vibocnc for multi-brand industrial automation parts, repair evaluation, technical support and quotes.",
  "url": `${siteUrl}/contact`,
  "mainEntity": {
    "@type": "Organization",
    "name": "Vibocnc",
    "telephone": "+86-13301553506",
    "email": "flora@vibocnc.com",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Kunshan",
      "addressRegion": "Jiangsu",
      "addressCountry": "CN"
    },
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "opens": "08:00",
        "closes": "18:00"
      },
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Saturday"],
        "opens": "09:00",
        "closes": "17:00"
      }
    ]
  }
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": siteUrl },
    { "@type": "ListItem", "position": 2, "name": "Contact", "item": `${siteUrl}/contact` }
  ]
};

function ContactContent({ data }: { data: PageData }) {
  const searchParams = useSearchParams();
  const { locale, t, href } = usePublicI18n();
  const text = createPageText(CONTACT_PAGE_SCHEMA, data, locale, (key) => t(key));
  const heroImage = text('heroImage');
  const facility = text('facility');
  const heroStyle = heroImage
    ? { backgroundImage: `linear-gradient(rgba(15, 23, 42, 0.72), rgba(15, 23, 42, 0.72)), url(${JSON.stringify(heroImage)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined;
  const [formData, setFormData] = useState<ContactCreateRequest>({
    name: '',
    email: '',
    company: '',
    phone: '',
    subject: '',
    message: '',
    inquiry_type: 'general'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Prefill email from query string (e.g., /contact?email=foo@bar.com)
  useEffect(() => {
    const email = searchParams?.get('email') || '';
    const inquiryType = searchParams?.get('inquiry_type');
    const nextInquiryType = inquiryType === 'parts' || inquiryType === 'repair' || inquiryType === 'support' || inquiryType === 'quote'
      ? inquiryType
      : undefined;
    if (email || nextInquiryType) setFormData((prev) => ({ ...prev, ...(email ? { email } : {}), ...(nextInquiryType ? { inquiry_type: nextInquiryType } : {}) }));
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await ContactService.submitContact(formData);

      toast.success(t('contact.success'));
      setFormData({
        name: '',
        email: '',
        company: '',
        phone: '',
        subject: '',
        message: '',
        inquiry_type: 'general'
      });
    } catch (error: unknown) {
      console.error('Error submitting form:', error);
      toast.error(error instanceof Error && error.message ? error.message : t('contact.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      {/* Contact Page Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@graph": [{ ...contactPageSchema, mainEntity: { ...contactPageSchema.mainEntity, telephone: text('phone'), email: text('email') }, url: `${siteUrl}${href('/contact')}` }, { ...breadcrumbSchema, itemListElement: [
          { "@type": "ListItem", "position": 1, "name": t('common.home'), "item": `${siteUrl}${href('/')}` },
          { "@type": "ListItem", "position": 2, "name": t('nav.contact'), "item": `${siteUrl}${href('/contact')}` },
        ] }] }) }}
      />
      {/* Hero Section */}
      <section className="site-page-hero py-24" style={heroStyle}>
        <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="site-hero-kicker mb-5">{text('heroKicker')}</div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">{text('heroTitle')}</h1>
            <p className="text-xl md:text-2xl text-blue-100 max-w-3xl mx-auto">
              {text('heroText')}
            </p>
          </div>
        </div>
      </section>

      {/* Contact Information & Form */}
      <section className="site-page-shell py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Contact Information */}
            <div className="lg:col-span-1">
              <h2 className="text-2xl font-bold text-gray-900 mb-8">{text('infoTitle')}</h2>

              <div className="space-y-6">
                <div className="flex items-start space-x-4">
                  <MapPinIcon className="h-6 w-6 text-[var(--site-primary)] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">{t('contact.address')}</h3>
                    <p className="whitespace-pre-line text-gray-600">{text('address')}</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <PhoneIcon className="h-6 w-6 text-[var(--site-primary)] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">{t('contact.phone')}</h3>
                    <p className="text-gray-600"><a href={`tel:${text('phone').replace(/[^+\d]/g, '')}`} className="hover:text-[var(--site-primary)]">{text('phone')}</a></p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <EnvelopeIcon className="h-6 w-6 text-[var(--site-primary)] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">{t('contact.email')}</h3>
                    <p className="text-gray-600"><a href={`mailto:${text('email')}`} className="break-all hover:text-[var(--site-primary)]">{text('email')}</a></p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <ClockIcon className="h-6 w-6 text-[var(--site-primary)] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">{t('contact.hours')}</h3>
                    <p className="whitespace-pre-line text-gray-600">{text('hours')}</p>
                  </div>
                </div>

                {facility ? (
                  <div className="flex items-start space-x-4">
                    <BuildingOfficeIcon className="h-6 w-6 text-[var(--site-primary)] mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-gray-900">{t('contact.facility')}</h3>
                      <p className="text-gray-600">{facility}</p>
                    </div>
                  </div>
                ) : null}

                <div className="flex items-start space-x-4">
                  <GlobeAltIcon className="h-6 w-6 text-[var(--site-primary)] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">{t('contact.serviceArea')}</h3>
                    <p className="text-gray-600">{text('serviceArea')}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              <div className="site-detail-panel p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">{text('formTitle')}</h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                        {t('contact.fullName')} *
                      </label>
                      <input
                        type="text"
                        id="name"
                        name="name"
                        required
                        value={formData.name}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder={t('contact.fullName')}
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                        {t('contact.emailAddress')} *
                      </label>
                      <input
                        type="email"
                        id="email"
                        name="email"
                        required
                        value={formData.email}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder={t('contact.emailAddress')}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-2">
                        {t('contact.company')}
                      </label>
                      <input
                        type="text"
                        id="company"
                        name="company"
                        value={formData.company}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder={t('contact.company')}
                      />
                    </div>

                    <div>
                      <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                        {t('contact.phoneNumber')}
                      </label>
                      <input
                        type="tel"
                        id="phone"
                        name="phone"
                        value={formData.phone}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="inquiry_type" className="block text-sm font-medium text-gray-700 mb-2">
                        {t('contact.inquiryType')}
                      </label>
                      <select
                        id="inquiry_type"
                        name="inquiry_type"
                        value={formData.inquiry_type}
                        onChange={handleChange}
                        className="site-select w-full px-4 py-3"
                      >
                        <option value="general">{t('contact.general')}</option>
                        <option value="parts">{t('contact.parts')}</option>
                        <option value="repair">{t('contact.repair')}</option>
                        <option value="support">{t('contact.support')}</option>
                        <option value="quote">{t('contact.quote')}</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
                        {t('contact.subject')} *
                      </label>
                      <input
                        type="text"
                        id="subject"
                        name="subject"
                        required
                        value={formData.subject}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder={t('contact.subject')}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                      {t('contact.message')} *
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      required
                      rows={6}
                      value={formData.message}
                      onChange={handleChange}
                      className="site-input w-full px-4 py-3"
                      placeholder={t('contact.message')}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="site-primary-action w-full px-8 py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? t('contact.sending') : t('contact.send')}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {text('whyTitle')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <div className="site-subtle-card w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <ClockIcon className="h-8 w-8 text-[var(--site-primary)]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{text('why1Title')}</h3>
              <p className="text-gray-600">
                {text('why1Text')}
              </p>
            </div>

            <div className="text-center p-6">
              <div className="site-subtle-card w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <BuildingOfficeIcon className="h-8 w-8 text-[var(--site-primary)]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{text('why2Title')}</h3>
              <p className="text-gray-600">
                {text('why2Text')}
              </p>
            </div>

            <div className="text-center p-6">
              <div className="site-subtle-card w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <GlobeAltIcon className="h-8 w-8 text-[var(--site-primary)]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{text('why3Title')}</h3>
              <p className="text-gray-600">
                {text('why3Text')}
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

export default function ContactPageClient({ data }: { data: PageData }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-10" aria-busy="true"><div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-[var(--site-primary)]" /></div>}>
      <ContactContent data={data} />
    </Suspense>
  );
}
