import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ReactQueryProvider } from "@/lib/react-query";
import { Toaster } from "react-hot-toast";
import Clarity from "@/components/analytics/Clarity";
import { getRequestBaseUrl } from "@/lib/request-url";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = await getRequestBaseUrl();
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: "FANUC Parts & Industrial Automation Components | Vcocnc",
      template: "%s | Vcocnc FANUC Parts",
    },
    description:
      "Professional FANUC CNC parts supplier since 2005. 100,000+ items in stock, worldwide shipping. Servo motors, PCB boards, I/O modules, control units. Top 3 FANUC supplier in China.",
    keywords: [
      "FANUC parts",
      "CNC parts",
      "industrial automation",
      "servo motors",
      "PCB boards",
      "I/O modules",
      "control units",
      "power supplies",
      "FANUC repair",
      "automation components",
      "Vcocnc",
      "China FANUC supplier",
      "industrial spare parts",
      "CNC machine parts",
    ].join(", "),
    authors: [{ name: "Vcocnc", url: "https://vcocnc.shop" }],
    creator: "Vcocnc Industrial Automation",
    publisher: "Vcocnc",
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
      locale: "en_US",
      siteName: "Vcocnc FANUC Parts",
      title: "FANUC Parts & Industrial Automation Components | Vcocnc",
      description:
        "Professional FANUC CNC parts supplier since 2005. 100,000+ items in stock, worldwide shipping. Top 3 FANUC supplier in China.",
      images: [
        {
          url: "/images/og-image.jpg",
          width: 1200,
          height: 630,
          alt: "Vcocnc FANUC Parts - Industrial Automation Components",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "FANUC Parts & Industrial Automation Components | Vcocnc",
      description: "Professional FANUC CNC parts supplier since 2005. 100,000+ items in stock, worldwide shipping.",
      images: ["/images/og-image.jpg"],
    },
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
        <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#f59e0b" />
      </head>
      <body className={`${inter.className} antialiased`}>
        <ReactQueryProvider>
          <Clarity />
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
        </ReactQueryProvider>
      </body>
    </html>
  );
}
