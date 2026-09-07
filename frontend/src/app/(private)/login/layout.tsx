import type { Metadata } from 'next';
import { getSiteUrl } from '@/lib/url';

export function generateMetadata(): Metadata {
  return {
    title: 'Customer Login',
    alternates: { canonical: `${getSiteUrl()}/login` },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true },
    },
  };
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
