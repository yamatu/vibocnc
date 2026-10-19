import { NextResponse } from 'next/server'
import { getRequestBaseUrl } from '@/lib/request-url'
import { toProductPathId } from '@/lib/utils'
import { renderLocalizedSitemap } from '@/lib/i18n/sitemap'
import { fetchProductSitemapPage, sitemapLocales, type ProductSitemapEntry } from '@/lib/product-sitemap'

export const dynamic = 'force-dynamic'
export const revalidate = 1800 // 30 minutes

export async function GET(
  _req: Request,
  context: { params: Promise<{ page: string }> }
) {
  try {
    const baseUrl = await getRequestBaseUrl()
    const { page } = await context.params
    const parsedPage = Number(page)
    if (!Number.isSafeInteger(parsedPage) || parsedPage < 1) {
      return new NextResponse('Invalid product sitemap page', { status: 404 })
    }
    const pageNumber = parsedPage

    const { data: products } = await fetchProductSitemapPage(pageNumber)
    if (products.length === 0) {
      return new NextResponse(`No products found for sitemap page ${pageNumber}`, { status: 404 })
    }

    const urls = products.map((product: ProductSitemapEntry) => ({
      pathname: `/products/${toProductPathId(product.sku)}`,
      lastModified: product.updated_at ? new Date(product.updated_at).toISOString() : undefined,
      changeFrequency: product.stock_quantity === 0 ? 'monthly' : product.stock_quantity < 10 ? 'daily' : 'weekly',
      priority: product.is_featured
        ? '0.9'
        : product.stock_quantity > 100
          ? '0.85'
          : product.stock_quantity === 0
            ? '0.6'
            : '0.8',
      availableLocales: sitemapLocales(product),
    }))

    const sitemap = renderLocalizedSitemap(baseUrl, urls)

    return new NextResponse(sitemap, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=1800, s-maxage=1800',
      },
    })
  } catch (error) {
    console.error('Error generating dynamic product sitemap:', error)
    // 503 + no-store: crawlers retry later instead of a CDN caching the error.
    return new NextResponse('Error generating sitemap', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' },
    })
  }
}
