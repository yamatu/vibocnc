import { getRequestBaseUrl } from '@/lib/request-url'
import { NextResponse } from 'next/server'
import { renderLocalizedSitemap } from '@/lib/i18n/sitemap'
import { PUBLIC_LOCALES } from '@/lib/i18n/config'

export const dynamic = 'force-dynamic'
export const revalidate = 86400 // 24 hours

// Use a stable deployment/content baseline for pages without a database-backed
// modification timestamp. A request timestamp falsely tells crawlers that every
// static page changed each time they fetch the sitemap.
const STATIC_CONTENT_LAST_MODIFIED = process.env.SITEMAP_STATIC_LAST_MODIFIED || '2026-07-30T00:00:00.000Z'
const HOME_CONTENT_LAST_MODIFIED = process.env.SITEMAP_HOME_LAST_MODIFIED || '2026-08-08T00:00:00.000Z'
const ALL_PUBLIC_LOCALES = PUBLIC_LOCALES.map((locale) => locale.code)
const EN_ZH_LOCALES = ['en', 'zh'] as const
const ENGLISH_HOME_LOCALE = ['en'] as const

export async function GET() {
  const baseUrl = await getRequestBaseUrl()
  const lastModified = new Date(STATIC_CONTENT_LAST_MODIFIED).toISOString()
  const homeLastModified = new Date(HOME_CONTENT_LAST_MODIFIED).toISOString()

  const staticPages = [
    {
      pathname: '/',
      lastModified: homeLastModified,
      changeFrequency: 'daily',
      priority: '1.0',
      availableLocales: ENGLISH_HOME_LOCALE,
    },
    {
      pathname: '/products',
      lastModified,
      changeFrequency: 'hourly',
      priority: '0.9',
      availableLocales: ALL_PUBLIC_LOCALES,
    },
    {
      pathname: '/categories',
      lastModified,
      changeFrequency: 'daily',
      priority: '0.85',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/about',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.8',
      availableLocales: ALL_PUBLIC_LOCALES,
    },
    {
      pathname: '/contact',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.8',
      availableLocales: ALL_PUBLIC_LOCALES,
    },
    {
      pathname: '/repair-request',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.85',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/faq',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.6',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/privacy',
      lastModified,
      changeFrequency: 'yearly',
      priority: '0.4',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/terms',
      lastModified,
      changeFrequency: 'yearly',
      priority: '0.4',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/warranty-policy',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/shipping-policy',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/technical-support',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/returns',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.5',
      availableLocales: EN_ZH_LOCALES,
    },
    {
      pathname: '/docs',
      lastModified,
      changeFrequency: 'monthly',
      priority: '0.4',
      availableLocales: EN_ZH_LOCALES,
    },
  ]

  const sitemap = renderLocalizedSitemap(baseUrl, staticPages)

  return new NextResponse(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}
