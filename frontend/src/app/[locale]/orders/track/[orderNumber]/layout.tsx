import type { Metadata } from 'next';
import { resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';
import { translatePublicMessage } from '@/lib/i18n/messages';

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);

  return {
    title: translatePublicMessage(locale, 'order.details'),
    description: translatePublicMessage(locale, 'order.trackDescription'),
    robots: {
      index: false,
      follow: false,
      nocache: true,
      noarchive: true,
      nosnippet: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
      },
    },
  };
}

export default function OrderTrackingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
