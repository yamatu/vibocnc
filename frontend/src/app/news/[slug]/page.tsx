import { Metadata } from 'next';
import { getSiteUrl } from '@/lib/url';
import { SITE_NAME, withSiteName, withoutSiteNameSuffix } from '@/lib/seo';
import { NewsService } from '@/services/news.service';
import { getArticleBySlug } from '@/services/news.server';
import ArticleDetailClient from './ArticleDetailClient';
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

function stripMarkup(value?: string): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/[#*_>`~\[\]()!-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(value?: string): number {
  const text = stripMarkup(value);
  return text ? text.split(/\s+/).length : 0;
}

async function loadRelatedArticles(article: Article, locale: Awaited<ReturnType<typeof getRequestPublicLocale>>) {
  try {
    const result = await NewsService.getArticles({ page: 1, page_size: 8, content_type: 'news' });
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getRequestPublicLocale();
  const sourceArticle = await getArticleBySlug(slug, 'news');
  const hasRequestedTranslation = hasTranslationForLocale(sourceArticle.translations, locale);
  const article = localizeArticleContent(sourceArticle, locale);
  const publicPath = article.public_path || `/news/${article.slug}`;
  const { canonical: canonicalUrl, languages } = await getLocalizedMetadataPaths(
    publicPath,
    getAvailableTranslationLocales(sourceArticle.translations),
  );

  const metaTitle = withoutSiteNameSuffix((article.meta_title || '').trim() || article.title);
  const socialTitle = withSiteName(metaTitle);
  const metaDescription =
    (article.meta_description || '').trim() ||
    article.summary ||
    `${article.title} - Read the latest from Vibocnc.`;
  const metaKeywords =
    (article.meta_keywords || '').trim() ||
    [article.title, 'industrial automation', 'CNC parts', 'PLC HMI drives', 'automation news'].join(', ');

  const images = article.featured_image ? [article.featured_image] : [];

  const canonical = hasRequestedTranslation ? canonicalUrl : `${getSiteUrl()}${publicPath}`;
  return {
    title: metaTitle,
    description: metaDescription,
    keywords: metaKeywords,
    robots: { index: hasRequestedTranslation, follow: true, 'max-image-preview': 'large' },
    openGraph: {
      title: socialTitle,
      description: metaDescription,
      type: 'article',
      url: canonical,
      images,
      publishedTime: article.published_at || article.created_at,
      modifiedTime: article.updated_at,
      ...(article.author?.full_name ? { authors: [article.author.full_name] } : {}),
    },
    alternates: { canonical, languages },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description: metaDescription,
      images,
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const locale = await getRequestPublicLocale();
  const sourceArticle = await getArticleBySlug(slug, 'news');
  const hasRequestedTranslation = hasTranslationForLocale(sourceArticle.translations, locale);
  const article = localizeArticleContent(sourceArticle, locale);
  const relatedArticles = await loadRelatedArticles(sourceArticle, locale);

  const baseUrl = getSiteUrl();
  const articlePath = article.public_path || `/news/${article.slug}`;
  const articleUrl = `${baseUrl}${localizePublicPath(articlePath, hasRequestedTranslation ? locale : 'en')}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.summary || article.meta_description || '',
    image: article.featured_image || undefined,
    datePublished: article.published_at || article.created_at,
    dateModified: article.updated_at,
    url: articleUrl,
    ...(article.author?.full_name
      ? {
          author: {
            '@type': 'Person',
            name: article.author.full_name,
          },
        }
      : {}),
    publisher: {
      '@type': 'Organization',
      '@id': `${baseUrl}/#organization`,
      name: SITE_NAME,
      url: baseUrl,
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': articleUrl,
    },
    inLanguage: hasRequestedTranslation ? (locale === 'zh' ? 'zh-CN' : locale) : 'en',
    articleSection: translatePublicMessage(locale, 'nav.news'),
    wordCount: wordCount(article.content),
    isAccessibleForFree: true,
    keywords: article.meta_keywords || undefined,
  };

  const breadcrumbData = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: translatePublicMessage(locale, 'common.home'), item: `${baseUrl}${localizePublicPath('/', locale)}` },
      { '@type': 'ListItem', position: 2, name: translatePublicMessage(locale, 'nav.news'), item: `${baseUrl}${localizePublicPath('/news', locale)}` },
      {
        '@type': 'ListItem',
        position: 3,
        name: article.title,
        item: articleUrl,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData).replace(/</g, '\\u003c') }}
      />
      <ArticleDetailClient article={article} relatedArticles={relatedArticles} contentLocale={hasRequestedTranslation ? locale : 'en'} />
    </>
  );
}
