import type { Metadata } from 'next';
import { getSiteUrl } from '@/lib/url';
import { SITE_NAME, withSiteName, withoutSiteNameSuffix } from '@/lib/seo';
import { NewsService } from '@/services/news.service';
import { getArticleBySlug } from '@/services/news.server';
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

export const revalidate = 900;

async function loadArticle(slug: string) {
  return getArticleBySlug(slug, 'blog');
}

async function loadRelatedArticles(article: Article, locale: Awaited<ReturnType<typeof getRequestPublicLocale>>) {
  try {
    const result = await NewsService.getArticles({ page: 1, page_size: 8, content_type: 'blog' });
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

function stripMarkup(value?: string): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/[#*_>`~\[\]()!-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(value?: string): number {
  const text = stripMarkup(value);
  return text ? text.split(/\s+/).length : 0;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getRequestPublicLocale();
  const sourceArticle = await loadArticle(slug);
  const hasRequestedTranslation = hasTranslationForLocale(sourceArticle.translations, locale);
  const article = localizeArticleContent(sourceArticle, locale);
  const { canonical: canonicalUrl, languages } = await getLocalizedMetadataPaths(
    article.public_path || `/blog/${article.slug}`,
    getAvailableTranslationLocales(sourceArticle.translations),
  );
  const title = withoutSiteNameSuffix(article.meta_title?.trim() || article.title);
  const description = article.meta_description?.trim() || article.summary || `${article.title} - Vibocnc industrial automation guide.`;
  const images = article.featured_image ? [article.featured_image] : [];
  const canonical = hasRequestedTranslation
    ? canonicalUrl
    : `${getSiteUrl()}${article.public_path || `/blog/${article.slug}`}`;
  return {
    title,
    description,
    keywords: article.meta_keywords || [article.title, 'industrial automation', 'CNC guide'].join(', '),
    robots: { index: hasRequestedTranslation, follow: true, 'max-image-preview': 'large' },
    alternates: { canonical, languages },
    openGraph: { title: withSiteName(title), description, type: 'article', url: canonical, images, publishedTime: article.published_at || article.created_at, modifiedTime: article.updated_at },
    twitter: { card: 'summary_large_image', title: withSiteName(title), description, images },
  };
}

export default async function BlogArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getRequestPublicLocale();
  const sourceArticle = await loadArticle(slug);
  const hasRequestedTranslation = hasTranslationForLocale(sourceArticle.translations, locale);
  const article = localizeArticleContent(sourceArticle, locale);
  const relatedArticles = await loadRelatedArticles(sourceArticle, locale);
  const baseUrl = getSiteUrl();
  const articleUrl = `${baseUrl}${localizePublicPath(article.public_path || `/blog/${article.slug}`, hasRequestedTranslation ? locale : 'en')}`;
  const structuredData = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: article.title,
    description: article.summary || article.meta_description || '', image: article.featured_image || undefined,
    datePublished: article.published_at || article.created_at, dateModified: article.updated_at, url: articleUrl,
    author: article.author?.full_name ? { '@type': 'Person', name: article.author.full_name } : { '@type': 'Organization', name: SITE_NAME },
    publisher: { '@type': 'Organization', '@id': `${baseUrl}/#organization`, name: SITE_NAME, url: baseUrl },
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
    inLanguage: hasRequestedTranslation ? (locale === 'zh' ? 'zh-CN' : locale) : 'en',
    articleSection: translatePublicMessage(locale, 'nav.blog'),
    wordCount: wordCount(article.content),
    isAccessibleForFree: true,
    keywords: article.meta_keywords || undefined,
  };
  const breadcrumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: translatePublicMessage(locale, 'common.home'), item: `${baseUrl}${localizePublicPath('/', locale)}` },
    { '@type': 'ListItem', position: 2, name: translatePublicMessage(locale, 'nav.blog'), item: `${baseUrl}${localizePublicPath('/blog', locale)}` },
    { '@type': 'ListItem', position: 3, name: article.title, item: articleUrl },
  ] };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, '\\u003c') }} /><ArticleDetailClient article={article} relatedArticles={relatedArticles} contentLocale={hasRequestedTranslation ? locale : 'en'} /></>;
}
