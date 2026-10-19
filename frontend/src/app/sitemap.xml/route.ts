import { getRequestBaseUrl } from '@/lib/request-url'
import { getActiveProductSitemapPaths } from '@/lib/product-sitemap'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

const CONTENT_SITEMAP_PATHS = [
  '/sitemap-static.xml',
  '/sitemap-categories.xml',
  '/sitemap-news.xml',
  '/sitemap-blog.xml',
] as const

function buildSitemapIndex(baseUrl: string, productSitemapPaths: readonly string[] = []) {
  const sitemapPaths = [...CONTENT_SITEMAP_PATHS, ...productSitemapPaths]
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPaths.map((path) => `  <sitemap>
    <loc>${baseUrl}${path}</loc>
  </sitemap>`).join('\n')}
</sitemapindex>`
}

export async function GET() {
  const baseUrl = await getRequestBaseUrl()
  let productSitemapPaths: string[]
  try {
    productSitemapPaths = await getActiveProductSitemapPaths()
  } catch (error) {
    // Publishing an index without the product shards (cached for an hour)
    // tells crawlers the whole catalogue left the sitemap. Ask them to retry.
    console.error('Error resolving product sitemaps for the primary index:', error)
    return new NextResponse('Sitemap temporarily unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' },
    })
  }
  const sitemapIndex = buildSitemapIndex(baseUrl, productSitemapPaths)

  return new NextResponse(sitemapIndex, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
