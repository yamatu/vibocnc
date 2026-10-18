import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import { buildStaticPageMetadata } from '@/lib/seo';
import { getLocalizedMetadataPaths, resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';
import { translatePublicMessage } from '@/lib/i18n/messages';

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const { locale, canonical, languages } = await getLocalizedMetadataPaths(await resolveRouteLocale(params), '/docs');
  const title = translatePublicMessage(locale, 'docs.title');
  const metadata = buildStaticPageMetadata('/docs', title, 'Documentation and technical resources for Vibocnc industrial automation products.', 'industrial automation documentation, CNC manuals, PLC HMI servo drive resources, product documents, Vibocnc docs');
  return { ...metadata, alternates: { canonical, languages }, openGraph: metadata.openGraph ? { ...metadata.openGraph, url: canonical } : undefined };
}

export default async function DocsPage({ params }: { params: LocaleRouteParams }) {
  const locale = await resolveRouteLocale(params);
  return (
    <PublicLayout>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-6">{translatePublicMessage(locale, 'docs.title')}</h1>
        <p className="text-gray-600">{translatePublicMessage(locale, 'docs.comingSoon')}</p>
      </main>
    </PublicLayout>
  );
}
