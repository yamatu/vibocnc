import type { Metadata } from 'next';
import { getSiteUrl } from '@/lib/url';

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getSiteUrl();
  return {
    title: 'Contact VIBO CNC - Get FANUC Parts Quote & Technical Support',
    description: 'Contact VIBO CNC for FANUC CNC parts inquiries, technical support, and quotes. Located in Kunshan, China. Phone: +86-13348028050, Email: sales@vibocnc.com. Fast response within 24 hours.',
    keywords: 'contact VIBO CNC, FANUC parts quote, CNC parts inquiry, technical support, FANUC supplier contact',
    alternates: { canonical: `${baseUrl}/contact` },
    openGraph: {
      title: 'Contact VIBO CNC - Get FANUC Parts Quote & Technical Support',
      description: 'Contact us for FANUC CNC parts, quotes, and technical support. Fast response within 24 hours. Phone: +86-13348028050.',
      url: `${baseUrl}/contact`,
      type: 'website',
    },
  };
}

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
