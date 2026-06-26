import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import { buildStaticPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildStaticPageMetadata(
  '/shipping-policy',
  'Shipping Policy | VIBO CNC',
  'Shipping times, availability, destinations and packaging details for VIBO CNC orders.',
  'shipping policy, FANUC parts shipping, CNC parts delivery, worldwide shipping, VIBO CNC shipping'
);

export default function ShippingPolicyPage() {
  return (
    <PublicLayout>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-6">Shipping Policy</h1>
        <p className="text-gray-600 mb-6">Fast, reliable global shipping for all FANUC parts.</p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Availability & Handling</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>In-stock items: ship within 1–2 business days</li>
            <li>Backorders: typically 3–7 business days to dispatch</li>
            <li>Express options available upon request</li>
          </ul>
        </section>

        <section className="space-y-4 mt-8">
          <h2 className="text-xl font-semibold">Destinations</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Worldwide shipping to 100+ countries</li>
            <li>Carrier options based on destination and urgency</li>
            <li>Tracking numbers provided for all shipments</li>
          </ul>
        </section>

        <section className="space-y-4 mt-8">
          <h2 className="text-xl font-semibold">Packaging</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Anti-static and protective cushioning for electronics</li>
            <li>Secure, labeled packaging to prevent transit damage</li>
          </ul>
        </section>
      </main>
    </PublicLayout>
  );
}
