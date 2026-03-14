import { MetadataRoute } from 'next'
import { getRequestBaseUrl } from '@/lib/request-url'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

// 主sitemap - 只包含最重要的页面，其他通过专门的sitemap文件处理
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = await getRequestBaseUrl()

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/products`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/news`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
  ]
}
