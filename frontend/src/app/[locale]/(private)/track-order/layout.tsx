import type { Metadata } from 'next';
import { buildPublicRobots, getLocalizedMetadataPaths, isIndexablePublicLocale, resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';
import { translatePublicMessage } from '@/lib/i18n/messages';

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const { locale, canonical, languages } = await getLocalizedMetadataPaths(await resolveRouteLocale(params), '/track-order');
  const title = translatePublicMessage(locale, 'order.trackTitle');
  const description = translatePublicMessage(locale, 'order.trackDescription');
  const socialTitle = `${title} | Vibocnc`;

  const isIndexable = isIndexablePublicLocale(locale);
  return {
    title,
    description,
    alternates: { canonical, ...(isIndexable ? { languages } : {}) },
    robots: buildPublicRobots(locale, true),
    openGraph: {
      title: socialTitle,
      description,
      url: canonical,
      type: 'website',
      siteName: 'Vibocnc',
      locale,
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
    },
  };
}

export default function TrackOrderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
