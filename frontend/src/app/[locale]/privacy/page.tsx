import EditableSitePage, { buildEditablePageMetadata } from '@/components/content/EditableSitePage';
import { resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';

export const revalidate = 600;

export async function generateMetadata({ params }: { params: LocaleRouteParams }) {
  return buildEditablePageMetadata('privacy', await resolveRouteLocale(params));
}

export default async function Page({ params }: { params: LocaleRouteParams }) {
  return <EditableSitePage pageKey="privacy" locale={await resolveRouteLocale(params)} />;
}
