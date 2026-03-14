import { NextResponse } from 'next/server'
import { getRequestBaseUrl } from '@/lib/request-url'
import { CategoryService } from '@/services/category.service'

export const revalidate = 3600 // ISR: 1 hour

export async function GET() {
  const baseUrl = await getRequestBaseUrl()
  
  let categories: any[] = []
  try {
    categories = await CategoryService.getCategories()
  } catch (error) {
    console.error('Error fetching categories for sitemap:', error)
    return new NextResponse('Error generating sitemap', { status: 500 })
  }

  const flat: any[] = []
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      flat.push(n)
      if (Array.isArray(n.children) && n.children.length > 0) walk(n.children)
    }
  }
  walk(categories)

  const categoryPages = flat
    .filter((c) => c && (c.path || c.slug))
    .map((category) => ({
      url: `${baseUrl}/categories/${category.path || category.slug}`,
      lastModified: category.updated_at ? new Date(category.updated_at).toISOString() : new Date().toISOString(),
      changeFrequency: 'weekly',
      priority: '0.8',
    }))

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${categoryPages.map(page => `  <url>
    <loc>${page.url}</loc>
    <lastmod>${page.lastModified}</lastmod>
    <changefreq>${page.changeFrequency}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('\n')}
</urlset>`

  return new NextResponse(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}

