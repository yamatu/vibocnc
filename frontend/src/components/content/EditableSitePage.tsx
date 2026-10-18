import type { Metadata } from 'next';
import Link from 'next/link';
import axios from 'axios';
import { notFound } from 'next/navigation';
import PublicLayout from '@/components/layout/PublicLayout';
import MarkdownContent from '@/components/content/MarkdownContent';
import { SitePageService } from '@/services/site-page.service';
import { getSitePageDefault } from '@/lib/site-page-defaults';
import { buildStaticPageMetadata } from '@/lib/seo';
import { getLocalizedMetadataPaths } from '@/lib/i18n/server';
import { localizePublicPath, type PublicLocale } from '@/lib/i18n/config';
import { translatePublicMessage } from '@/lib/i18n/messages';

export async function getEditablePage(pageKey: string) {
  try { return await SitePageService.getPublicPage(pageKey); } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 410) return null;
    return getSitePageDefault(pageKey);
  }
}

export async function buildEditablePageMetadata(pageKey: string, locale: PublicLocale): Promise<Metadata> {
  const page = await getEditablePage(pageKey);
  if (!page) return { robots: { index: false, follow: false } };
  const metadata = buildStaticPageMetadata(`/${pageKey}`, 'meta_title' in page && page.meta_title ? page.meta_title : page.title, 'meta_description' in page && page.meta_description ? page.meta_description : page.summary, 'meta_keywords' in page ? page.meta_keywords : undefined);
  const { canonical, languages } = await getLocalizedMetadataPaths(locale, `/${pageKey}`);
  return {
    ...metadata,
    alternates: { canonical, languages },
    openGraph: metadata.openGraph ? { ...metadata.openGraph, url: canonical } : undefined,
  };
}

export default async function EditableSitePage({ pageKey, locale }: { pageKey: string; locale: PublicLocale }) {
  const page = await getEditablePage(pageKey);
  if (!page) notFound();
  const updatedAt = 'updated_at' in page ? page.updated_at : undefined;
  return <PublicLayout>
    <main className="min-h-screen bg-gray-50 py-10 sm:py-14">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <nav className="mb-7 text-sm text-gray-500"><Link href={localizePublicPath('/', locale)} className="hover:text-blue-700">{translatePublicMessage(locale, 'common.home')}</Link><span className="mx-2">/</span><span>{page.title}</span></nav>
        <article className="border border-gray-200 bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-3xl font-bold text-gray-950 sm:text-4xl">{page.title}</h1>
          {page.summary && <p className="mt-4 text-lg leading-8 text-gray-600">{page.summary}</p>}
          {updatedAt && <p className="mt-4 text-sm text-gray-500">{translatePublicMessage(locale, 'common.lastUpdated', { date: new Date(updatedAt).toLocaleDateString(locale === 'zh' ? 'zh-CN' : locale, { year: 'numeric', month: 'long', day: 'numeric' }) })}</p>}
          <MarkdownContent content={page.content} className="mt-8 text-base" />
        </article>
      </div>
    </main>
  </PublicLayout>;
}
