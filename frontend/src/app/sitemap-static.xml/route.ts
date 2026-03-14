import { getRequestBaseUrl } from '@/lib/request-url'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 86400 // 24 hours

export async function GET() {
  const baseUrl = await getRequestBaseUrl()
  
  const staticPages = [
    {
      url: baseUrl,
      lastModified: new Date().toISOString(),
      changeFrequency: 'daily',
      priority: '1.0',
    },
    {
      url: `${baseUrl}/products`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'hourly',
      priority: '0.9',
    },
    {
      url: `${baseUrl}/news`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'daily',
      priority: '0.8',
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'monthly',
      priority: '0.8',
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'monthly',
      priority: '0.8',
    },
    {
      url: `${baseUrl}/faq`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'monthly',
      priority: '0.6',
    },
    {
      url: `${baseUrl}/warranty-policy`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/shipping-policy`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/technical-support`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/returns`,
      lastModified: new Date().toISOString(),
      changeFrequency: 'monthly',
      priority: '0.5',
    },
    {
      url: `${baseUrl}/docs`,
      lastModified: new Date().toISOString(),
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

