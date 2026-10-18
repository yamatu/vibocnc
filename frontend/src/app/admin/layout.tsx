import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '../globals.css';
import { getSiteUrl } from '@/lib/url';
import { SITE_NAME } from '@/lib/seo';
import AdminProviders from './AdminProviders';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: { default: `Admin | ${SITE_NAME}`, template: `%s | ${SITE_NAME}` },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico?v=20260629" sizes="any" />
      </head>
      <body className="antialiased font-sans">
        <AdminProviders>{children}</AdminProviders>
      </body>
    </html>
  );
}
