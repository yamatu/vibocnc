import type { Metadata } from 'next';
import { getSiteUrl } from '@/lib/url';
import { SITE_NAME, withSiteName, withoutSiteNameSuffix } from '@/lib/seo';
import { NewsService } from '@/services/news.service';
import { getArticleByPath } from '@/services/news.server';
import ArticleDetailClient from '@/app/news/[slug]/ArticleDetailClient';
import { getLocalizedMetadataPaths, getRequestPublicLocale } from '@/lib/i18n/server';
import {
  getAvailableTranslationLocales,
  hasTranslationForLocale,
  localizeArticleContent,
} from '@/lib/i18n/content';
import { localizePublicPath } from '@/lib/i18n/config';
import { translatePublicMessage } from '@/lib/i18n/messages';
import type { Article } from '@/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function loadArticle(parts: string[]) {
  return getArticleByPath(parts.join('/'));
}

function stripMarkup(value?: string): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/[#*_>`~\[\]()!-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(value?: string): number {
  const text = stripMarkup(value);
  return text ? text.split(/\s+/).length : 0;
}

async function loadRelatedArticles(article: Article, locale: Awaited<ReturnType<typeof getRequestPublicLocale>>) {
  try {
    const result = await NewsService.getArticles({ page: 1, page_size: 8, content_type: article.content_type });
    return (result.data || [])
      .filter((candidate) => candidate.id !== article.id)
      .map((candidate) => hasTranslationForLocale(candidate.translations, locale)
        ? localizeArticleContent(candidate, locale)
        : candidate)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ articlePath: string[] }> }): Promise<Metadata> {
  const { articlePath } = await params;
  const locale = await getRequestPublicLocale();
  const sourceArticle = await loadArticle(articlePath);
  const hasRequestedTranslation = hasTranslationForLocale(sourceArticle.translations, locale);
  const article = localizeArticleContent(sourceArticle, locale);
  const path = article.public_path || `/${articlePath.join('/')}`;
  const { canonical: canonicalUrl, languages } = await getLocalizedMetadataPaths(
    path,
    getAvailableTranslationLocales(sourceArticle.translations),
  );
  const title = withoutSiteNameSuffix(article.meta_title?.trim() || article.title);
  const description = article.meta_description?.trim() || article.summary || `${article.title} - Vibocnc.`;
  const images = article.featured_image ? [article.featured_image] : [];
  const canonical = hasRequestedTranslation ? canonicalUrl : `${getSiteUrl()}${path}`;
  return {
    title, description, keywords: article.meta_keywords || undefined,
    robots: { index: hasRequestedTranslation, follow: true, 'max-image-preview': 'large' },
    alternates: { canonical, languages },
    openGraph: { title: withSiteName(title), description, type: 'article', url: canonical, images, publishedTime: article.published_at || article.created_at, modifiedTime: article.updated_at },
    twitter: { card: 'summary_large_image', title: withSiteName(title), description, images },
  };
}

export default async function CustomArticlePage({ params }: { params: Promise<{ articlePath: string[] }> }) {
  const { articlePath } = await params;
  const locale = await getRequestPublicLocale();
  const sourceArticle = await loadArticle(articlePath);
  const hasRequestedTranslation = hasTranslationForLocale(sourceArticle.translations, locale);
  const article = localizeArticleContent(sourceArticle, locale);
  const relatedArticles = await loadRelatedArticles(sourceArticle, locale);
  const baseUrl = getSiteUrl();
  const articleUrl = `${baseUrl}${localizePublicPath(article.public_path || `/${articlePath.join('/')}`, hasRequestedTranslation ? locale : 'en')}`;
  const type = article.content_type === 'blog' ? 'BlogPosting' : 'NewsArticle';
  const sectionPath = article.content_type === 'blog' ? '/blog' : '/news';
  const sectionName = translatePublicMessage(locale, article.content_type === 'blog' ? 'nav.blog' : 'nav.news');
  const structuredData = {
    '@context': 'https://schema.org', '@type': type, headline: article.title,
    description: article.summary || article.meta_description || '', image: article.featured_image || undefined,
    datePublished: article.published_at || article.created_at, dateModified: article.updated_at, url: articleUrl,
    author: article.author?.full_name ? { '@type': 'Person', name: article.author.full_name } : { '@type': 'Organization', name: SITE_NAME },
    publisher: { '@type': 'Organization', '@id': `${baseUrl}/#organization`, name: SITE_NAME, url: baseUrl },
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
    inLanguage: hasRequestedTranslation ? (locale === 'zh' ? 'zh-CN' : locale) : 'en',
    articleSection: sectionName,
    wordCount: wordCount(article.content),
    isAccessibleForFree: true,
    keywords: article.meta_keywords || undefined,
  };
  const breadcrumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: translatePublicMessage(locale, 'common.home'), item: `${baseUrl}${localizePublicPath('/', locale)}` },
    { '@type': 'ListItem', position: 2, name: sectionName, item: `${baseUrl}${localizePublicPath(sectionPath, locale)}` },
    { '@type': 'ListItem', position: 3, name: article.title, item: articleUrl },
  ] };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, '\\u003c') }} /><ArticleDetailClient article={article} relatedArticles={relatedArticles} contentLocale={hasRequestedTranslation ? locale : 'en'} /></>;
}
