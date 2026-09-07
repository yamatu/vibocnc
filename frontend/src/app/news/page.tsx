import { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getSiteUrl } from '@/lib/url';
import { SITE_NAME, withSiteName } from '@/lib/seo';
import { NewsService } from '@/services/news.service';
import NewsPageClient from './NewsPageClient';
import { getLocalizedMetadataPathsWithQuery, getRequestPublicLocale } from '@/lib/i18n/server';
import { localizeArticleOrDefault } from '@/lib/i18n/content';
import { localizePublicPath } from '@/lib/i18n/config';
import { translatePublicMessage } from '@/lib/i18n/messages';

export async function generateMetadata({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}): Promise<Metadata> {
  const params = await searchParams;
  const search = params.search;
  const page = Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '1', 10) || 1);
  const pageQuery = page > 1 ? `page=${page}` : '';
  const { locale, canonical: canonicalUrl, languages } = await getLocalizedMetadataPathsWithQuery('/news', pageQuery);

  let title = `${translatePublicMessage(locale, 'news.title')}${page > 1 ? ` - Page ${page}` : ''}`;
  let description = translatePublicMessage(locale, 'news.description');

  if (search) {
    title = `Search: ${search} - News`;
    description = `Search results for "${search}" in news and articles.`;
  }

  const hasSearch = typeof search === 'string' && search.trim().length > 0;
  return {
    title,
    description,
    robots: hasSearch ? { index: false, follow: true } : { index: true, follow: true },
    keywords: ['FANUC news', 'CNC articles', 'industrial automation', 'technical blog', search].filter(Boolean).join(', '),
    openGraph: {
      title: withSiteName(title),
      description,
      type: 'website',
      url: canonicalUrl,
    },
    alternates: {
      canonical: canonicalUrl,
      languages,
    },
  };
}

async function getServerSideData(searchParams: { [key: string]: string | string[] | undefined }, locale: Awaited<ReturnType<typeof getRequestPublicLocale>>) {
  const search = searchParams.search;
  const page = Math.max(1, Number.parseInt(typeof searchParams.page === 'string' ? searchParams.page : '1', 10) || 1);

  const searchStr = typeof search === 'string' && search.trim() ? search.trim() : undefined;

  const data = await NewsService.getArticles({
    search: searchStr,
    page,
    page_size: 12,
    content_type: 'news',
  });
  if (page > Math.max(1, data.total_pages)) notFound();

  return {
    articles: (data.data || [])
      .map((article) => localizeArticleOrDefault(article, locale)),
    totalPages: data.total_pages || 1,
    total: data.total || 0,
    currentPage: page,
    searchQuery: (search as string) || '',
  };
}

export const revalidate = 300;

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams;
  const locale = await getRequestPublicLocale();
  const serverData = await getServerSideData(params, locale);

  const baseUrl = getSiteUrl();
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    'name': translatePublicMessage(locale, 'news.title'),
    'description': translatePublicMessage(locale, 'news.description'),
    'url': `${baseUrl}${localizePublicPath('/news', locale)}`,
    'inLanguage': locale === 'zh' ? 'zh-CN' : locale,
    'isAccessibleForFree': true,
    'publisher': {
      '@type': 'Organization',
      '@id': `${baseUrl}/#organization`,
      'name': SITE_NAME,
      'url': baseUrl,
    },
    'blogPost': serverData.articles.slice(0, 10).map((article) => ({
      '@type': 'NewsArticle',
      'headline': article.title,
      'description': article.summary || '',
      'url': `${baseUrl}${localizePublicPath(article.public_path || `/news/${article.slug}`, locale)}`,
      'datePublished': article.published_at || article.created_at,
      'dateModified': article.updated_at,
      'image': article.featured_image || undefined,
      'inLanguage': locale === 'zh' ? 'zh-CN' : locale,
      'articleSection': translatePublicMessage(locale, 'nav.news'),
      'isAccessibleForFree': true,
      ...(article.author?.full_name
        ? {
            'author': {
              '@type': 'Person',
              'name': article.author.full_name,
            },
          }
        : {}),
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-800" />
          </div>
        }
      >
        <NewsPageClient initialData={serverData} searchParams={params} contentType="news" />
      </Suspense>
    </>
  );
}
