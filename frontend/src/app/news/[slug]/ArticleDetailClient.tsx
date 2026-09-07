'use client';

import Link from 'next/link';
import Image from 'next/image';
import { CalendarDaysIcon, EyeIcon, ArrowLeftIcon, UserIcon } from '@heroicons/react/24/outline';
import Layout from '@/components/layout/Layout';
import type { Article } from '@/types';
import MarkdownContent from '@/components/content/MarkdownContent';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { hasTranslationForLocale } from '@/lib/i18n/content';

function estimateReadTime(content: string): number {
  const words = content.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export default function ArticleDetailClient({
  article,
  relatedArticles = [],
  contentLocale,
}: {
  article: Article;
  relatedArticles?: Article[];
  contentLocale?: string;
}) {
  const { locale, t, href } = usePublicI18n();
  const readTime = estimateReadTime(article.content);
  const basePath = article.content_type === 'blog' ? '/blog' : '/news';
  const sectionName = t(article.content_type === 'blog' ? 'nav.blog' : 'nav.news');
  const localeTag = (contentLocale || locale) === 'zh' ? 'zh-CN' : (contentLocale || locale);
  const relatedHref = (related: Article) => {
    const path = related.public_path || `/${related.content_type}/${related.slug}`;
    return hasTranslationForLocale(related.translations, locale)
      ? href(path)
      : path;
  };

  return (
    <Layout>
      <div className="bg-white min-h-screen">
        {/* Hero */}
        {article.featured_image && (
          <div className="relative h-[300px] sm:h-[400px] lg:h-[500px] bg-gray-900">
            <Image
              src={article.featured_image}
              alt={article.title}
              fill
              sizes="100vw"
              priority
              unoptimized={article.featured_image.startsWith('/uploads/')}
              className="w-full h-full object-cover opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>
        )}

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav className="py-4 text-sm">
            <ol className="flex items-center gap-2 text-gray-500">
              <li>
                <Link href={href('/')} className="hover:text-blue-600">{t('common.home')}</Link>
              </li>
              <li>/</li>
              <li>
                <Link href={href(basePath)} className="hover:text-blue-600">{sectionName}</Link>
              </li>
              <li>/</li>
              <li className="text-gray-900 truncate max-w-[200px]">{article.title}</li>
            </ol>
          </nav>

          {/* Article Header */}
          <header className={`${article.featured_image ? '-mt-24 relative z-10' : 'mt-4'}`}>
            <div className={`${article.featured_image ? 'bg-white rounded-t-2xl p-6 sm:p-8 shadow-sm' : ''}`}>
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-4">
                {article.title}
              </h1>
              {article.summary && (
                <p className="text-lg text-gray-600 mb-6">{article.summary}</p>
              )}
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 pb-6 border-b border-gray-200">
                {article.author?.full_name && (
                  <span className="flex items-center gap-1.5">
                    <UserIcon className="h-4 w-4" />
                    {article.author.full_name}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <CalendarDaysIcon className="h-4 w-4" />
                  {new Date(article.published_at || article.created_at).toLocaleDateString(localeTag, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
                <span className="flex items-center gap-1.5">
                  <EyeIcon className="h-4 w-4" />
                  {t('common.views', { count: article.view_count })}
                </span>
                <span>{t('common.readTime', { count: readTime })}</span>
              </div>
            </div>
          </header>

          {/* Article Content */}
          <article className="py-8 sm:py-10" lang={contentLocale || locale}>
            <MarkdownContent content={article.content} minHeadingLevel={2} className="max-w-none text-lg" />
          </article>

          {relatedArticles.length > 0 && (
            <aside className="border-t border-gray-200 py-8" aria-labelledby="related-articles-title">
              <h2 id="related-articles-title" className="mb-4 text-xl font-bold text-gray-900">
                {article.content_type === 'blog' ? t('news.blogTitle') : t('news.title')}
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {relatedArticles.map((related) => (
                  <Link
                    key={related.id}
                    href={relatedHref(related)}
                    className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm"
                  >
                    <h3 className="text-sm font-semibold leading-6 text-gray-900">{related.title}</h3>
                    {related.summary && <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-600">{related.summary}</p>}
                  </Link>
                ))}
              </div>
            </aside>
          )}

          <aside className="border-t border-gray-200 py-8" aria-label="Related Vibocnc resources">
            <h2 className="mb-4 text-xl font-bold text-gray-900">Explore related resources</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Link href={href('/products')} className="rounded-lg border border-gray-200 p-4 text-sm font-semibold text-[#0b3e75] hover:border-blue-300">Automation parts →</Link>
              <Link href={href('/categories')} className="rounded-lg border border-gray-200 p-4 text-sm font-semibold text-[#0b3e75] hover:border-blue-300">Product categories →</Link>
              <Link href={href('/repair-request')} className="rounded-lg border border-gray-200 p-4 text-sm font-semibold text-[#0b3e75] hover:border-blue-300">Repair evaluation →</Link>
              <Link href={href('/contact')} className="rounded-lg border border-gray-200 p-4 text-sm font-semibold text-[#0b3e75] hover:border-blue-300">Ask our team →</Link>
            </div>
          </aside>

          {/* Back to News */}
          <div className="border-t border-gray-200 py-8">
            <Link
              href={href(basePath)}
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              {t('common.backTo', { section: sectionName })}
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
