import { getRequestBaseUrl } from '@/lib/request-url'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

const SITEMAP_PATHS = [
  '/sitemap-static.xml',
  '/sitemap-categories.xml',
  '/sitemap-products-index.xml',
  '/sitemap-news.xml',
] as const

export function buildSitemapIndex(baseUrl: string) {
  const lastmod = new Date().toISOString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_PATHS.map((path) => `  <sitemap>
    <loc>${baseUrl}${path}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`).join('\n')}
</sitemapindex>`
}

export async function GET() {
  const baseUrl = await getRequestBaseUrl()
  const sitemapIndex = buildSitemapIndex(baseUrl)

  return new NextResponse(sitemapIndex, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
