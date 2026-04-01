import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import { buildStaticPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildStaticPageMetadata(
  '/warranty-policy',
  'Warranty Policy | Vcocnc',
  '1-year in-service warranty coverage, claims process, and contact details for Vcocnc FANUC parts.',
  'warranty policy, FANUC parts warranty, CNC parts warranty, repair claims, Vcocnc warranty'
);

export default function WarrantyPolicyPage() {
  return (
    <PublicLayout>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-6">Warranty Policy</h1>
        <p className="text-gray-600 mb-6">We stand behind the quality of our products and offer comprehensive warranty support for our customers.</p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Coverage</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>1-year in-service warranty from delivery date</li>
            <li>Coverage includes manufacturing defects and functional failures under normal use</li>
            <li>Excludes damage caused by improper installation, misuse, or unauthorized repair</li>
          </ul>
        </section>

        <section className="space-y-4 mt-8">
          <h2 className="text-xl font-semibold">Claims Process</h2>
          <ol className="list-decimal list-inside text-gray-700 space-y-1">
            <li>Contact us with order number, SKU, and issue description</li>
            <li>Provide photos/videos for initial assessment if available</li>
            <li>Ship the item to our service center after approval</li>
            <li>We repair or replace and return promptly</li>
          </ol>
        </section>

        <section className="space-y-2 mt-8">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-gray-700">Email: sales@vcocncspare.com • Phone: +86-13348028050</p>
          <p className="text-gray-500">Business hours: Mon–Fri, 8:00–18:00 (GMT+8)</p>
        </section>
      </main>
    </PublicLayout>
  );
}
