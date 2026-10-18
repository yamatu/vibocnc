import type { Metadata } from 'next';
import HomePage from '@/components/home/HomePage';
import { resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';

// Reached only through the middleware rewrite of `/?admin_preview=1`, so the
// public homepage itself can stay ISR-cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Homepage preview',
  robots: { index: false, follow: false, nocache: true },
};

export default async function HomepagePreview({ params }: { params: LocaleRouteParams }) {
  return <HomePage locale={await resolveRouteLocale(params)} isAdminPreview />;
}
