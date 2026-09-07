import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getSiteUrl } from '@/lib/url';
import { SITE_NAME, withSiteName } from '@/lib/seo';
import { NewsService } from '@/services/news.service';
import NewsPageClient from '@/app/news/NewsPageClient';
import { getLocalizedMetadataPathsWithQuery, getRequestPublicLocale } from '@/lib/i18n/server';
import { localizeArticleOrDefault } from '@/lib/i18n/content';
import { localizePublicPath } from '@/lib/i18n/config';
import { translatePublicMessage } from '@/lib/i18n/messages';

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const params = await searchParams;
  const search = typeof params.search === 'string' ? params.search.trim() : '';
  const page = Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '1', 10) || 1);
  const pageQuery = page > 1 ? `page=${page}` : '';
  const { locale, canonical: url, languages } = await getLocalizedMetadataPathsWithQuery('/blog', pageQuery);
  const title = search ? `Search: ${search} - Blog` : `${translatePublicMessage(locale, 'news.blogTitle')}${page > 1 ? ` - Page ${page}` : ''}`;
  const description = search
    ? `Search results for "${search}" in the Vibocnc industrial automation blog.`
    : translatePublicMessage(locale, 'news.blogDescription');
  return {
    title,
    description,
    keywords: ['industrial automation blog', 'CNC troubleshooting', 'PLC and HMI guides', 'servo drive repair', 'automation parts sourcing', 'FANUC Siemens Mitsubishi ABB technical articles', search].filter(Boolean).join(', '),
    robots: search ? { index: false, follow: true } : { index: true, follow: true },
    alternates: { canonical: url, languages },
    openGraph: { title: withSiteName(title), description, type: 'website', url },
    twitter: { card: 'summary_large_image', title: withSiteName(title), description },
  };
}

export const revalidate = 300;

export default async function BlogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const locale = await getRequestPublicLocale();
  const page = Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '1', 10) || 1);
  const search = typeof params.search === 'string' && params.search.trim() ? params.search.trim() : undefined;
  const data = await NewsService.getArticles({ page, page_size: 12, search, content_type: 'blog' });
  if (page > Math.max(1, data.total_pages)) notFound();

  const baseUrl = getSiteUrl();
  const articles = (data.data || [])
    .map((article) => localizeArticleOrDefault(article, locale));
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: translatePublicMessage(locale, 'news.blogTitle'),
    description: translatePublicMessage(locale, 'news.blogDescription'),
    url: `${baseUrl}${localizePublicPath('/blog', locale)}`,
    inLanguage: locale === 'zh' ? 'zh-CN' : locale,
    isAccessibleForFree: true,
    publisher: { '@type': 'Organization', '@id': `${baseUrl}/#organization`, name: SITE_NAME, url: baseUrl },
    blogPost: articles.slice(0, 10).map((article) => ({
      '@type': 'BlogPosting',
      headline: article.title,
      description: article.summary || '',
      url: `${baseUrl}${localizePublicPath(article.public_path || `/blog/${article.slug}`, locale)}`,
      datePublished: article.published_at || article.created_at,
      dateModified: article.updated_at,
      image: article.featured_image || undefined,
      inLanguage: locale === 'zh' ? 'zh-CN' : locale,
      articleSection: translatePublicMessage(locale, 'nav.blog'),
      isAccessibleForFree: true,
    })),
  };

  const initialData = { articles, totalPages: data.total_pages || 1, total: data.total || 0, currentPage: page, searchQuery: search || '' };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-800" /></div>}>
      <NewsPageClient initialData={initialData} searchParams={params} contentType="blog" />
    </Suspense>
  </>;
}
