import type { Metadata } from 'next';
import PublicLayout from '@/components/layout/PublicLayout';
import { buildStaticPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildStaticPageMetadata(
  '/docs',
  'Documentation | Vcocnc',
  'Documentation and technical resources for Vcocnc products.',
  'documentation, FANUC manuals, CNC technical resources, product documents, Vcocnc docs'
);

export default function DocsPage() {
  return (
    <PublicLayout>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-6">Documentation</h1>
        <p className="text-gray-600">Documentation is coming soon.</p>
      </main>
    </PublicLayout>
  );
}
