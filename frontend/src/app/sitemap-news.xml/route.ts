import { NextResponse } from 'next/server'
import { getRequestBaseUrl } from '@/lib/request-url'
import { NewsService } from '@/services/news.service'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

export async function GET() {
  const baseUrl = await getRequestBaseUrl()
  try {
    // Fetch all published articles (news typically has fewer items than products,
    // so a single sitemap with a generous page_size is sufficient)
    const response = await NewsService.getArticles({
      page: 1,
      page_size: 1000,
      is_published: 'true',
    })

    const articles = response.data || []

    const urls = [
      // News listing page
      {
        url: `${baseUrl}/news`,
        lastModified: new Date().toISOString(),
        changeFrequency: 'daily',
        priority: '0.8',
      },
      // Individual article pages
      ...articles.map((article: any) => ({
        url: `${baseUrl}/news/${article.slug}`,
        lastModified: article.updated_at
          ? new Date(article.updated_at).toISOString()
          : article.published_at
            ? new Date(article.published_at).toISOString()
            : new Date().toISOString(),
        changeFrequency: 'weekly',
        priority: article.is_featured ? '0.8' : '0.7',
      })),
    ]

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
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (error) {
    console.error('Error generating news sitemap:', error)
    // Fallback: at least include the news listing page
    const sitemap =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url>\n    <loc>${baseUrl}/news</loc>\n    <lastmod>${new Date().toISOString()}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n` +
      `</urlset>`

    return new NextResponse(sitemap, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  }
}
