import { MetadataRoute } from 'next'
import { getRequestBaseUrl } from '@/lib/request-url'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

// Keep the MetadataRoute sitemap aligned with the dedicated XML index entry points.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = await getRequestBaseUrl()
  const lastModified = new Date()

  return [
    {
      url: baseUrl,
      lastModified,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/products`,
      lastModified,
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/categories`,
      lastModified,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/news`,
      lastModified,
      changeFrequency: 'daily',
      priority: 0.8,
    },
  ]
}
