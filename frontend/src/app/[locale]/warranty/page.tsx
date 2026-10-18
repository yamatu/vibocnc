import { permanentRedirect } from 'next/navigation';
import { resolveRouteLocale, type LocaleRouteParams } from '@/lib/i18n/server';
import { localizePublicPath } from '@/lib/i18n/config';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: LocaleRouteParams }) {
  permanentRedirect(localizePublicPath('/warranty-policy', await resolveRouteLocale(params)));
}
