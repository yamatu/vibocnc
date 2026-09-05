import type { Metadata } from "next";
import "./globals.css";
import { ReactQueryProvider } from "@/lib/react-query";
import { Toaster } from "react-hot-toast";
import { getSiteUrl } from "@/lib/url";
import { SITE_NAME } from "@/lib/seo";
import { headers } from "next/headers";
import { PublicI18nProvider } from "@/lib/i18n/PublicI18nProvider";
import { buildLanguageAlternates, getLocaleConfig, isLocalizablePublicPath, localizePublicPath, normalizePublicLocale } from "@/lib/i18n/config";
import { translatePublicMessage } from "@/lib/i18n/messages";
import TrackingCode, { type PublicTrackingConfig } from "@/components/analytics/TrackingCode";

const SITE_DESCRIPTION =
  "Vibocnc supplies current, legacy and obsolete CNC and industrial automation parts across 20+ brands, with inspection, repair support and worldwide shipping.";

async function getTrackingConfig(): Promise<PublicTrackingConfig | null> {
  try {
    const backend = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
    const response = await fetch(`${backend}/api/v1/public/analytics/config`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { success?: boolean; data?: PublicTrackingConfig };
    return payload.success && payload.data ? payload.data : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = getSiteUrl();
  const requestHeaders = await headers();
  const locale = normalizePublicLocale(requestHeaders.get('x-site-locale'));
  const pathname = requestHeaders.get('x-site-pathname') || '/';
  const localizedPath = localizePublicPath(pathname, locale);
  const canonical = `${siteUrl}${localizedPath === '/' ? '' : localizedPath}`;
  const isPublicPage = isLocalizablePublicPath(pathname);
  const isIndexablePage = isPublicPage && pathname !== '/track-order';
  const localizedTitle = translatePublicMessage(locale, 'products.title');
  const localizedDescription = locale === 'en'
    ? SITE_DESCRIPTION
    : translatePublicMessage(locale, 'products.description');
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
    alternates: isPublicPage ? {
      canonical,
      languages: buildLanguageAlternates(siteUrl, pathname),
    } : undefined,
    robots: {
      index: isIndexablePage,
      follow: isIndexablePage,
      googleBot: {
        index: isIndexablePage,
        follow: isIndexablePage,
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
      url: canonical,
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
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const locale = normalizePublicLocale(requestHeaders.get('x-site-locale'));
  const localeConfig = getLocaleConfig(locale);
  const trackingConfig = await getTrackingConfig();

  return (
    <html lang={localeConfig.hreflang} dir={localeConfig.dir} className="scroll-smooth" suppressHydrationWarning>
      <head>
        <TrackingCode config={trackingConfig} />
        <link rel="icon" href="/favicon.ico?v=20260629" sizes="any" />
        <link rel="icon" href="/favicon-16x16.png?v=20260629" sizes="16x16" type="image/png" />
        <link rel="icon" href="/favicon-32x32.png?v=20260629" sizes="32x32" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=20260629" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#0f766e" />
      </head>
      <body className="antialiased">
        <ReactQueryProvider>
          <PublicI18nProvider initialLocale={locale}>
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
