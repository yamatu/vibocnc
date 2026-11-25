import type { Metadata } from 'next';
import { getSiteUrl } from '@/lib/url';

export function generateMetadata(): Metadata {
  return {
    title: 'Customer Login',
    // Self-canonical is fine next to noindex: the canonical keeps duplicate
    // query-string variants together, the robots tag keeps a private form out
    // of the index. Previously this page asked to be indexed while every
    // sibling private route (register, checkout, account) is noindex.
    alternates: { canonical: `${getSiteUrl()}/login` },
    robots: {
      index: false,
      follow: false,
      nocache: true,
      noarchive: true,
      nosnippet: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
      },
    },
  };
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
