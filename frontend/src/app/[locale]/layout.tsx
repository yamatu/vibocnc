import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { ReactQueryProvider } from "@/lib/react-query";
import { Toaster } from "react-hot-toast";
import { getSiteUrl } from "@/lib/url";
import { SITE_NAME } from "@/lib/seo";
import { PublicI18nProvider } from "@/lib/i18n/PublicI18nProvider";
import { getLocaleConfig, isPublicLocale, normalizePublicLocale } from "@/lib/i18n/config";
import { getPublicMessageOverrides, translatePublicMessage } from "@/lib/i18n/messages";
import type { LocaleRouteParams } from "@/lib/i18n/server";
import TrackingCode, { type PublicTrackingConfig } from "@/components/analytics/TrackingCode";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Monospace is only used for SKU / tracking numbers; don't let its preload
// compete with the main font and the LCP image.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

const SITE_DESCRIPTION =
  "Vibocnc supplies current, legacy and obsolete CNC and industrial automation parts across 20+ brands, with inspection, repair support and worldwide shipping.";

// Nothing is prerendered at build time (the Docker build has no backend);
// pages render on first request and are then served from the ISR cache.
export async function generateStaticParams() {
  return [];
}

async function getTrackingConfig(): Promise<PublicTrackingConfig | null> {
  try {
    const backend = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
    const response = await fetch(`${backend}/api/v1/public/analytics/config`, {
      next: { revalidate: 300, tags: ['analytics-config'] },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { success?: boolean; data?: PublicTrackingConfig };
    return payload.success && payload.data ? payload.data : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const siteUrl = getSiteUrl();
  const locale = normalizePublicLocale((await params).locale);
  const localizedTitle = translatePublicMessage(locale, 'products.title');
  const localizedDescription = locale === 'en'
    ? SITE_DESCRIPTION
    : translatePublicMessage(locale, 'products.description');
  // Canonical/alternates are declared per page; private route groups opt out
  // of indexing in their own layouts.
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: `${localizedTitle} | ${SITE_NAME}`,
      template: `%s | ${SITE_NAME}`,
    },
    description: localizedDescription,
    keywords: [
      "industrial automation parts",
      "industrial electronics repair",
      "obsolete automation parts",
      "CNC parts",
      "CNC machine spare parts",
      "industrial automation",
      "servo motors",
      "PCB boards",
      "I/O modules",
      "control units",
      "power supplies",
      "automation components",
      "PLC modules",
      "HMI panels",
      "servo drive repair",
      "Vibocnc",
      "China CNC parts supplier",
      "industrial spare parts",
      "CNC machine parts",
    ].join(", "),
    publisher: SITE_NAME,
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    openGraph: {
      type: "website",
      locale: getLocaleConfig(locale).hreflang.replace('-', '_'),
      siteName: SITE_NAME,
      title: `${localizedTitle} | ${SITE_NAME}`,
      description: localizedDescription,
      images: [
        {
          url: "/images/og-image.jpg",
          width: 1200,
          height: 630,
          alt: "Vibocnc - Industrial Automation Components",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${localizedTitle} | ${SITE_NAME}`,
      description: localizedDescription,
      images: ["/images/og-image.jpg"],
    },
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    },
  };
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: LocaleRouteParams;
}>) {
  const { locale: rawLocale } = await params;
  if (!isPublicLocale(rawLocale)) notFound();
  const locale = normalizePublicLocale(rawLocale);
  const localeConfig = getLocaleConfig(locale);
  const trackingConfig = await getTrackingConfig();

  return (
    <html lang={localeConfig.hreflang} dir={localeConfig.dir} className={`scroll-smooth ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <TrackingCode config={trackingConfig} />
        <link rel="icon" href="/favicon.ico?v=20260629" sizes="any" />
        <link rel="icon" href="/favicon-16x16.png?v=20260629" sizes="16x16" type="image/png" />
        <link rel="icon" href="/favicon-32x32.png?v=20260629" sizes="32x32" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=20260629" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#0b3e75" />
      </head>
      <body className="antialiased font-sans">
        <ReactQueryProvider>
          <PublicI18nProvider initialLocale={locale} messageOverrides={getPublicMessageOverrides(locale)}>
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#10B981',
                    secondary: '#fff',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#EF4444',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </PublicI18nProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
