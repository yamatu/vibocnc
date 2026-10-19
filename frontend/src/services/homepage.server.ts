import type { Article, Product } from '@/types';

type PublicApiPayload<T> = {
  success?: boolean;
  data?: T;
};

type ProductPage = { data?: Product[] };
type ArticlePage = { data?: Article[] };

async function fetchPublicData<T>(path: string, tags: string[]): Promise<T | null> {
  const backendUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${backendUrl}/api/v1/public/${path}`, {
      next: { revalidate: 300, tags },
      signal: controller.signal,
    });
    // Outages throw so the ISR homepage keeps its last good section instead of
    // caching an empty one; only a real "no data" answer resolves to null.
    if (response.status >= 500) throw new Error(`Backend ${response.status} for ${path}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as PublicApiPayload<T>;
    return payload.success !== false ? payload.data ?? null : null;
  } catch (error) {
    if (process.env.NEXT_PHASE === 'phase-production-build') return null;
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getHomepageFeaturedProducts(): Promise<Product[]> {
  const page = await fetchPublicData<ProductPage>(
    'products?is_featured=true&page_size=6',
    ['all-products', 'homepage-products'],
  );
  return Array.isArray(page?.data) ? page.data : [];
}

export async function getHomepageFeaturedArticles(): Promise<Article[]> {
  const page = await fetchPublicData<ArticlePage>(
    'news?page=1&page_size=3&content_type=blog&is_featured=true',
    ['homepage-articles', 'all-news'],
  );
  return Array.isArray(page?.data) ? page.data : [];
}
