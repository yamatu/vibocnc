import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import AboutPageView from '@/components/pages/AboutPageView';
import { withSiteName } from '@/lib/seo';
import { getLocalizedMetadataPaths, resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';
import { translatePublicMessage } from '@/lib/i18n/messages';
import { getEditablePageData } from '@/services/page-content.server';

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
  const locale = await resolveRouteLocale(params);
  return (
    <PublicLayout>
      <AboutPageView locale={locale} data={await getEditablePageData('about')} />
    </PublicLayout>
  );
}
