import { permanentRedirect } from 'next/navigation';
import { getRequestPublicLocale } from '@/lib/i18n/server';
import { localizePublicPath } from '@/lib/i18n/config';
export const dynamic = 'force-dynamic';
export default async function Page() {
  permanentRedirect(localizePublicPath('/warranty-policy', await getRequestPublicLocale()));
}
