import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import { buildStaticPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildStaticPageMetadata(
  '/warranty',
  'Warranty | Vcocnc',
  'Warranty information for Vcocnc products and services.',
  'warranty information, FANUC warranty, CNC parts support, Vcocnc'
);

export default function WarrantyPage() {
  return (
    <PublicLayout>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-6">Warranty</h1>
        <p className="text-gray-600">We are preparing the content for this page. Please check back later.</p>
      </main>
    </PublicLayout>
  );
}
