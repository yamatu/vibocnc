import type { Metadata } from 'next';
import { getLocalizedMetadataPaths } from '@/lib/i18n/server';
import { translatePublicMessage } from '@/lib/i18n/messages';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, canonical, languages } = await getLocalizedMetadataPaths('/track-order');
  const title = translatePublicMessage(locale, 'order.trackTitle');
  const description = translatePublicMessage(locale, 'order.trackDescription');
  const socialTitle = `${title} | Vibocnc`;

  return {
    title,
    description,
    alternates: { canonical, languages },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
      },
    },
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
