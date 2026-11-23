import { NextResponse } from 'next/server'
import { getRequestBaseUrl } from '@/lib/request-url'
import { CategoryService } from '@/services/category.service'
import { renderLocalizedSitemap } from '@/lib/i18n/sitemap'
import { isCategoryIndexable } from '@/lib/category-listing'
import type { Category } from '@/types'
import { getAvailableTranslationLocales } from '@/lib/i18n/content'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

export async function GET() {
  const baseUrl = await getRequestBaseUrl()

  let categories: Category[] = []
  try {
    categories = await CategoryService.getCategories()
  } catch (error) {
    console.error('Error fetching categories for sitemap:', error)
    return new NextResponse('Error generating sitemap', { status: 500 })
  }

  const flat: Category[] = []
  const walk = (nodes: Category[]) => {
    for (const n of nodes) {
      flat.push(n)
      if (Array.isArray(n.children) && n.children.length > 0) walk(n.children)
    }
  }
  walk(categories)

  const categoryPages = flat
    .filter((c) => c && (c.path || c.slug) && isCategoryIndexable(c, Number(c.product_count || 0)))
    .map((category) => ({
      pathname: `/categories/${category.path || category.slug}`,
      lastModified: category.updated_at ? new Date(category.updated_at).toISOString() : undefined,
      changeFrequency: 'weekly',
      priority: category.parent_id ? '0.7' : '0.8',
      availableLocales: getAvailableTranslationLocales(category.translations),
    }))

  const sitemap = renderLocalizedSitemap(baseUrl, categoryPages)

  return new NextResponse(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
