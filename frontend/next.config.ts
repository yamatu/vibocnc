import path from 'node:path';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  compress: true,
  generateEtags: true,
  poweredByHeader: false,

  experimental: {
    optimizePackageImports: ['@heroicons/react', 'lucide-react', 'react-icons'],
  },

  // Silence workspace root inference warning when monorepo-like structure exists
  outputFileTracingRoot: path.join(__dirname, '..'),

  // 确保环境变量正确注入
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },

  // API 重写配置，开发环境代理到后端
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

    return {
      beforeFiles: [
        {
          source: '/:indexnowKey([A-Za-z0-9_-]{8,128}).txt',
          destination: '/api/indexnow-key?key=:indexnowKey',
        },
      ],
      afterFiles: [
        // Serve /sitemap-products/:page.xml from an internal route without the ".xml" segment.
        // This avoids Next route segment edge cases and keeps the public URL stable.
        {
          source: '/sitemap-products/:page.xml',
          destination: '/sitemap-products/:page',
        },
        // When you run without an external Nginx (directly hitting Next on :3000),
        // proxy /uploads/* to the backend so uploaded images keep working.
        {
          source: '/uploads/:path*',
          destination: `${apiBase}/uploads/:path*`,
        },
        {
          source: '/media-thumb/:path*',
          destination: `${apiBase}/media-thumb/:path*`,
        },
        {
          source: '/api/:path*',
          destination: `${apiBase}/api/:path*`,
        },
      ],
    };
  },

  eslint: {
    // Lint failures are still surfaced by `npm run lint` in CI/local runs, but
    // a lint error should not silently ship an unbuildable bundle. Keep the
    // build strict unless explicitly opted out.
    ignoreDuringBuilds: process.env.NEXT_IGNORE_LINT_ERRORS === 'true',
  },
  typescript: {
    // Type errors must fail the build: `ignoreBuildErrors` previously let
    // type-broken code reach production. `npx tsc --noEmit` is clean, so this
    // is safe to enforce.
    ignoreBuildErrors: process.env.NEXT_IGNORE_TS_ERRORS === 'true',
  },

  async headers() {
    return [
      {
        source: '/:indexnowKey([A-Za-z0-9_-]{8,128}).txt',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
      // SEO-friendly caching for static assets
      {
        source: '/images/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Public pages and sitemap handlers declare their own revalidation and
      // Cache-Control policy. Defining them again here creates duplicate cache
      // headers, which makes CDN behaviour inconsistent.
    ];
  },

  images: {
    // Cache generated responsive variants so the Hero LCP is not reprocessed
    // on every deployment request or repeat crawl.
    minimumCacheTTL: 86400,
    // Only hosts that are genuinely used are allowed. `remotePatterns` is an
    // allowlist for the image optimizer, so every extra entry is an SSRF-ish
    // surface plus wasted optimizer cache space.
    remotePatterns: [
      { protocol: 'https', hostname: 's2.loli.net' },
      { protocol: 'https', hostname: 'dz.yamatu.xyz' },
      // Development-only origins (local backend uploads, throwaway placeholders).
      ...(process.env.NODE_ENV === 'production'
        ? []
        : [
            { protocol: 'https' as const, hostname: 'localhost' },
            { protocol: 'http' as const, hostname: 'localhost' },
            { protocol: 'http' as const, hostname: '127.0.0.1' },
          ]),
    ],
  },
};

export default nextConfig;
