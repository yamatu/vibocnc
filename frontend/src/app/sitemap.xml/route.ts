import { getRequestBaseUrl } from '@/lib/request-url'
import { getActiveProductSitemapPaths } from '@/lib/product-sitemap'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

// Same baselines the child routes use, so the index never advertises a change
// the child sitemap does not confirm.
const STATIC_CONTENT_LAST_MODIFIED = process.env.SITEMAP_STATIC_LAST_MODIFIED || '2026-07-30T00:00:00.000Z'
const HOME_CONTENT_LAST_MODIFIED = process.env.SITEMAP_HOME_LAST_MODIFIED || '2026-08-08T00:00:00.000Z'

interface SitemapIndexEntry {
  path: string
  lastModified?: string
}

function toIso(value: string): string | undefined {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

function latestIso(...values: string[]): string | undefined {
  const timestamps = values.map((value) => Date.parse(value)).filter(Number.isFinite)
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : undefined
}

// <lastmod> is only emitted when the baseline is actually known. Categories,
// news and blog change with editorial data we cannot price cheaply here, and
// a guessed timestamp teaches crawlers to distrust the whole index.
function contentSitemapEntries(): SitemapIndexEntry[] {
  return [
    { path: '/sitemap-static.xml', lastModified: latestIso(HOME_CONTENT_LAST_MODIFIED, STATIC_CONTENT_LAST_MODIFIED) },
    { path: '/sitemap-categories.xml' },
    { path: '/sitemap-news.xml' },
    { path: '/sitemap-blog.xml' },
  ]
}

function buildSitemapIndex(baseUrl: string, entries: readonly SitemapIndexEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => {
    const lastModified = entry.lastModified ? `    <lastmod>${entry.lastModified}</lastmod>\n` : ''
    return `  <sitemap>\n    <loc>${baseUrl}${entry.path}</loc>\n${lastModified}  </sitemap>`
  }).join('\n')}
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

  const entries: SitemapIndexEntry[] = [
    ...contentSitemapEntries(),
    ...productSitemapPaths.map((path) => ({ path })),
  ]
  const sitemapIndex = buildSitemapIndex(baseUrl, entries)

  return new NextResponse(sitemapIndex, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
