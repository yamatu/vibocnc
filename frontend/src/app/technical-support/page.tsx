import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import { buildStaticPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildStaticPageMetadata(
  '/technical-support',
  'Technical Support | Vcocnc',
  'Product consultation, troubleshooting, and remote diagnostics for FANUC parts.',
  'technical support, FANUC troubleshooting, CNC support, industrial automation diagnostics, Vcocnc support'
);

export default function TechnicalSupportPage() {
  return (
    <PublicLayout>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-6">Technical Support</h1>
        <p className="text-gray-600 mb-6">Get expert help from our FANUC engineers.</p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">How We Help</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Product selection and compatibility consultation</li>
            <li>Technical Q&A and troubleshooting guidance</li>
            <li>Remote diagnostics and configuration support</li>
            <li>On-site support options for qualified projects</li>
          </ul>
        </section>

        <section className="space-y-2 mt-8">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-gray-700">Email: sales@vcocncspare.com • Phone: +86-13348028050</p>
          <p className="text-gray-500">24/7 priority support available for urgent production issues</p>
        </section>
      </main>
    </PublicLayout>
  );
}
