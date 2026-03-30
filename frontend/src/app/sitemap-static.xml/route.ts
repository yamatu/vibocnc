import { getRequestBaseUrl } from '@/lib/request-url'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 86400 // 24 hours

export async function GET() {
  const baseUrl = await getRequestBaseUrl()
  const lastModified = new Date().toISOString()

  const staticPages = [
    {
      url: baseUrl,
      lastModified,
      changeFrequency: 'daily',
      priority: '1.0',
    },
    {
      url: `${baseUrl}/products`,
      lastModified,
      changeFrequency: 'hourly',
      priority: '0.9',
    },
    {
      url: `${baseUrl}/categories`,
      lastModified,
      changeFrequency: 'daily',
      priority: '0.85',
    },
    {
      url: `${baseUrl}/news`,
      lastModified,
      changeFrequency: 'daily',
      priority: '0.8',
    },
    {
      url: `${baseUrl}/about`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.8',
    },
    {
      url: `${baseUrl}/contact`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.8',
    },
    {
      url: `${baseUrl}/faq`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.6',
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: '0.4',
    },
    {
      url: `${baseUrl}/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: '0.4',
    },
    {
      url: `${baseUrl}/warranty`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/warranty-policy`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/shipping-policy`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/technical-support`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/returns`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/docs`,
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.4',
    },
  ]

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPages.map(page => `  <url>
    <loc>${page.url}</loc>
    <lastmod>${page.lastModified}</lastmod>
    <changefreq>${page.changeFrequency}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('\n')}
</urlset>`

  return new NextResponse(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}
