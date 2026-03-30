import type { MetadataRoute } from 'next';
import { getRequestBaseUrl } from '@/lib/request-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getRequestBaseUrl();

  const privatePaths = [
    '/admin/',
    '/api/',
    '/account/',
    '/checkout/',
    '/orders/',
    '/login',
    '/register',
    '/forgot-password',
    '/track-order',
  ];

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: privatePaths,
    },
    host: site,
    sitemap: `${site}/sitemap-index.xml`,
  };
}
