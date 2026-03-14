import { NextResponse } from 'next/server'
import { getRequestBaseUrl } from '@/lib/request-url'
import { ProductService } from '@/services/product.service'
import { toProductPathId } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 1800 // 30 minutes

export async function GET(
  _req: Request,
  context: { params: Promise<{ page: string }> }
) {
  try {
    const baseUrl = await getRequestBaseUrl()
    const { page } = await context.params
    const pageNumber = Math.max(1, parseInt(page || '1', 10) || 1)

    const response = await ProductService.getProducts({
      page: pageNumber,
      page_size: 100,
      is_active: 'true',
    })

    const products = response.data || []
    if (!Array.isArray(products) || products.length === 0) {
      return new NextResponse(`No products found for sitemap page ${pageNumber}`, { status: 404 })
    }

    const urls = products.map((product: any) => ({
      url: `${baseUrl}/products/${toProductPathId(product.sku)}`,
      lastModified: product.updated_at ? new Date(product.updated_at).toISOString() : new Date().toISOString(),
      changeFrequency: product.stock_quantity === 0 ? 'monthly' : product.stock_quantity < 10 ? 'daily' : 'weekly',
      priority: product.is_featured
        ? '0.9'
        : product.stock_quantity > 100
          ? '0.85'
          : product.stock_quantity === 0
            ? '0.6'
            : '0.8',
    }))

    const sitemap =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map(
          (u) =>
            `  <url>\n    <loc>${u.url}</loc>\n    <lastmod>${u.lastModified}</lastmod>\n    <changefreq>${u.changeFrequency}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
        )
        .join('\n') +
      `\n</urlset>`

    return new NextResponse(sitemap, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=1800, s-maxage=1800',
      },
    })
  } catch (error) {
    console.error('Error generating dynamic product sitemap:', error)
    return new NextResponse('Error generating sitemap', { status: 500 })
  }
}
