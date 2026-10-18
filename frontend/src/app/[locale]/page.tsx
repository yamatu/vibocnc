import type { Metadata } from 'next';
import HomePage, { getHomeDescription, getHomeTitle } from '@/components/home/HomePage';
import { getSiteUrl } from '@/lib/url';
import { SITE_NAME } from '@/lib/seo';
import { getLocaleConfig } from '@/lib/i18n/config';
import { getLocalizedMetadataPaths, resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';

export const revalidate = 300;

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const baseUrl = getSiteUrl();
  // Translated home routes remain available to visitors, but several dynamic
  // homepage sections are still English-only. Keep them out of search until
  // each locale is complete instead of advertising mixed-language alternates.
  const { locale, canonical, languages } = await getLocalizedMetadataPaths(await resolveRouteLocale(params), '/', ['en']);
  const ogImageUrl = new URL('/images/og-image.jpg', baseUrl).toString();
  const title = getHomeTitle(locale);
  const description = getHomeDescription(locale);

  return {
    title: { absolute: title },
    description,
    alternates: { canonical, languages },
    robots: locale === 'en' ? undefined : {
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    },
    openGraph: {
      type: 'website',
      locale: getLocaleConfig(locale).hreflang.replace('-', '_'),
      siteName: SITE_NAME,
      title,
      description,
      url: canonical,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: 'Vibocnc industrial automation components',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function Home({ params }: { params: LocaleRouteParams }) {
  return <HomePage locale={await resolveRouteLocale(params)} />;
}
