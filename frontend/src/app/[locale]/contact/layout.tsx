import type { Metadata } from 'next';
import { buildPublicRobots, getLocalizedMetadataPaths, isIndexablePublicLocale, resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';
import { translatePublicMessage } from '@/lib/i18n/messages';
import { withSiteName } from '@/lib/seo';

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const { locale, canonical, languages } = await getLocalizedMetadataPaths(await resolveRouteLocale(params), '/contact');
  const isIndexable = isIndexablePublicLocale(locale);
  const title = translatePublicMessage(locale, 'contact.title');
  const description = locale === 'en'
    ? 'Contact Vibocnc for industrial automation parts, repair evaluation, technical support and quotations across major brands.'
    : translatePublicMessage(locale, 'contact.description');
  return {
    title,
    description,
    keywords: 'contact Vibocnc, automation parts quote, CNC parts inquiry, repair evaluation, industrial technical support',
    robots: buildPublicRobots(locale, true),
    alternates: { canonical, ...(isIndexable ? { languages } : {}) },
    openGraph: { title: withSiteName(title), description, type: 'website', url: canonical },
  };
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
