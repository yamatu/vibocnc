import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import { generateFAQSchema, generateBreadcrumbSchema } from '@/lib/structured-data';
import { getSiteUrl } from '@/lib/url';
import { buildHomeFaqEntries } from '@/lib/faq-content';
import { getCommercePolicyCached } from '@/services/commerce-policy.server';
import { buildStaticPageMetadata } from '@/lib/seo';
import { getLocalizedMetadataPaths, getRequestPublicLocale } from '@/lib/i18n/server';
import { localizePublicPath } from '@/lib/i18n/config';
import { translatePublicMessage } from '@/lib/i18n/messages';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, canonical, languages } = await getLocalizedMetadataPaths('/faq');
  const title = translatePublicMessage(locale, 'faq.title');
  const description = translatePublicMessage(locale, 'faq.description');
  return {
    ...buildStaticPageMetadata(
    '/faq',
    title,
    description,
    'industrial automation parts FAQ, CNC parts support, PLC HMI servo drives, repair evaluation, worldwide shipping, warranty information, compatibility support',
  ),
    alternates: { canonical, languages },
    openGraph: { title, description, type: 'website', url: canonical },
    robots: { index: true, follow: true },
  };
}

export default async function FAQPage() {
  const baseUrl = getSiteUrl();
  const locale = await getRequestPublicLocale();
  const commercePolicy = await getCommercePolicyCached();
  const faqItems = buildHomeFaqEntries(locale, commercePolicy);

  const faqSchema = generateFAQSchema(locale, commercePolicy);
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: translatePublicMessage(locale, 'common.home'), url: `${baseUrl}${localizePublicPath('/', locale)}` },
    { name: translatePublicMessage(locale, 'faq.title'), url: `${baseUrl}${localizePublicPath('/faq', locale)}` }
  ]);

  const combinedSchema = {
    "@context": "https://schema.org",
    "@graph": [faqSchema, breadcrumbSchema]
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(combinedSchema)
        }}
      />
      <PublicLayout>
        <div className="site-page-shell min-h-screen">
          <section className="site-page-hero">
            <div className="site-hero-inner mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 lg:px-8">
              <span className="site-hero-kicker">{translatePublicMessage(locale, 'faq.kicker')}</span>
              <h1 className="mt-5 text-4xl font-bold text-white sm:text-5xl">
                {translatePublicMessage(locale, 'faq.title')}
              </h1>
              <p className="mx-auto mt-4 max-w-3xl text-lg leading-8 text-blue-100">
                {translatePublicMessage(locale, 'faq.description')}
              </p>
            </div>
          </section>

          <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
            {/* Header */}
            {/* FAQ Items */}
            <div className="space-y-8">
              {faqItems.map(({ question, answer }) => (
                <div key={question} className="site-panel p-6">
                  <h2 className="mb-3 text-xl font-semibold text-gray-900">{question}</h2>
                  <p className="leading-relaxed text-gray-700">{answer}</p>
                </div>
              ))}
            </div>

            {/* Contact CTA */}
            <div className="site-status-panel-strong mt-16 p-8 text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                {translatePublicMessage(locale, 'faq.more')}
              </h2>
              <p className="text-gray-600 mb-6">
                {translatePublicMessage(locale, 'faq.moreDescription')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href={localizePublicPath('/contact', locale)}
                  className="site-primary-action px-6 py-3"
                >
                  {translatePublicMessage(locale, 'common.contactUs')}
                </a>
                <a
                  href="mailto:sales@vibocnc.com"
                  className="site-secondary-action px-6 py-3"
                >
                  {translatePublicMessage(locale, 'faq.email')}
                </a>
              </div>
            </div>
          </div>
        </div>
      </PublicLayout>
    </>
  );
}
