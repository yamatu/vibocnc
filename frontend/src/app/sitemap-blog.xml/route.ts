import { NextResponse } from 'next/server';
import { getRequestBaseUrl } from '@/lib/request-url';
import { getAllPublishedArticles } from '@/lib/article-sitemap';
import type { Article } from '@/types';
import { renderLocalizedSitemap } from '@/lib/i18n/sitemap';
import { getAvailableTranslationLocales } from '@/lib/i18n/content';
import { PUBLIC_LOCALES } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;
const ALL_PUBLIC_LOCALES = PUBLIC_LOCALES.map((locale) => locale.code);

function latestArticleModifiedAt(articles: Article[]): string | undefined {
  const timestamps = articles
    .map((article) => article.updated_at || article.published_at || article.created_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : undefined;
}

export async function GET() {
  const baseUrl = await getRequestBaseUrl();
  let articles: Article[] = [];
  try {
    articles = await getAllPublishedArticles('blog');
  } catch (error) {
    console.error('Error generating blog sitemap:', error);
    return new NextResponse('Sitemap temporarily unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' },
    });
  }
  const urls = [{ pathname: '/blog', lastModified: latestArticleModifiedAt(articles), changeFrequency: 'daily', priority: '0.8', availableLocales: ALL_PUBLIC_LOCALES }, ...articles.map((article) => ({
    pathname: article.public_path || `/blog/${article.slug}`,
    lastModified: article.updated_at || article.published_at || article.created_at
      ? new Date(article.updated_at || article.published_at || article.created_at).toISOString()
      : undefined,
    changeFrequency: 'weekly', priority: article.is_featured ? '0.8' : '0.7',
    availableLocales: getAvailableTranslationLocales(article.translations),
  }))];
  const sitemap = renderLocalizedSitemap(baseUrl, urls);
  return new NextResponse(sitemap, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
}
