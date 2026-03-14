import { NextResponse } from 'next/server'
import { ProductService } from '@/services/product.service'
import { getRequestBaseUrl } from '@/lib/request-url'

export const dynamic = 'force-dynamic'
export const revalidate = 1800 // 30 minutes

export async function GET() {
  const baseUrl = await getRequestBaseUrl()
  try {
    // Determine total products to compute page count
    const head = await ProductService.getProducts({ page: 1, page_size: 1, is_active: 'true' })
    const total = head.total || 0
    const pageSize = 100
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    const limit = Math.min(totalPages, 1000) // safety cap

    const sitemapEntries: string[] = []
    for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
      sitemapEntries.push(`  <sitemap>\n    <loc>${baseUrl}/sitemap-products/${pageNumber}.xml</loc>\n    <lastmod>${new Date().toISOString()}</lastmod>\n  </sitemap>`)
    }

    if (sitemapEntries.length === 0) {
      return new NextResponse('No product sitemaps available', { status: 404 })
    }

    const sitemapIndex = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n${sitemapEntries.join('\n')}\n</sitemapindex>`

    return new NextResponse(sitemapIndex, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=1800, s-maxage=1800',
      },
    })
  } catch (error) {
    console.error('Error generating product sitemap index:', error)
    // Fallback: at least provide first page (if available)
    const sitemapIndex = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <sitemap>\n    <loc>${baseUrl}/sitemap-products/1.xml</loc>\n    <lastmod>${new Date().toISOString()}</lastmod>\n  </sitemap>\n</sitemapindex>`
    return new NextResponse(sitemapIndex, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=1800, s-maxage=1800',
      },
    })
  }
}
