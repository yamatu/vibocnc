import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PublicLayout from '@/components/layout/PublicLayout';
import PreviewBridge from '@/components/admin/homepage/PreviewBridge';
import AboutPageView from '@/components/pages/AboutPageView';
import ContactPageClient from '@/components/pages/ContactPageClient';
import { getEditablePageData } from '@/services/page-content.server';
import { isEditablePage } from '@/lib/page-content';
import { resolveRouteLocale } from '@/lib/i18n/server';

// Reached only through the middleware rewrite of `/about?admin_preview=1` and
// `/contact?admin_preview=1`, so the public pages themselves stay cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Page preview',
  robots: { index: false, follow: false, nocache: true },
};

export default async function EditablePagePreview({ params }: { params: Promise<{ locale: string; page: string }> }) {
  const { page } = await params;
  if (!isEditablePage(page)) notFound();
  const data = await getEditablePageData(page, { preview: true });

  if (page === 'contact') {
    return (
      <>
        <ContactPageClient data={data} />
        <PreviewBridge />
      </>
    );
  }
  return (
    <PublicLayout>
      <AboutPageView locale={await resolveRouteLocale(params)} data={data} />
      <PreviewBridge />
    </PublicLayout>
  );
}
