import ContactPageClient from '@/components/pages/ContactPageClient';
import { getEditablePageData } from '@/services/page-content.server';

export default async function Contact() {
  return <ContactPageClient data={await getEditablePageData('contact')} />;
}
