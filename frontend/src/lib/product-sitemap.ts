import { PUBLIC_LOCALES, type PublicLocale } from '@/lib/i18n/config';

// 1000 URLs per shard keeps a 120k+ catalogue inside ~130 shards, well under
// MAX_PRODUCT_SITEMAPS. Shards are read from the dedicated
// /public/products/sitemap endpoint (backend max 5000 per page).
export const PRODUCT_SITEMAP_PAGE_SIZE = 1000;
export const MAX_PRODUCT_SITEMAPS = 1000;

export interface ProductSitemapEntry {
  sku: string;
  updated_at?: string;
  stock_quantity: number;
  is_featured: boolean;
  locales: string[];
}

interface ProductSitemapPage {
  data: ProductSitemapEntry[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

const publicLocaleCodes = new Set<string>(PUBLIC_LOCALES.map((locale) => locale.code));

export function sitemapLocales(entry: ProductSitemapEntry): PublicLocale[] {
  return (entry.locales || []).filter((code): code is PublicLocale => publicLocaleCodes.has(code) && code !== 'en');
}

export async function fetchProductSitemapPage(page: number, pageSize = PRODUCT_SITEMAP_PAGE_SIZE): Promise<ProductSitemapPage> {
  const backend = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
  // No Next data cache: a malformed answer would otherwise be replayed for the
  // whole revalidate window after the backend recovers. The endpoint is light
  // and cached in Redis on the backend.
  const response = await fetch(`${backend}/api/v1/public/products/sitemap?page=${page}&page_size=${pageSize}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Product sitemap request failed: ${response.status}`);
  const payload = (await response.json()) as { success?: boolean; data?: ProductSitemapPage };
  const data = payload.data;
  if (!payload.success || !data || !Array.isArray(data.data)) throw new Error('Product sitemap response is malformed');
  // If the backend ever serves a different page size than requested, every
  // shard offset shifts and most of the catalogue silently disappears from the
  // sitemaps (that is how ~98% of products went missing). Fail loudly instead.
  if (data.page_size !== pageSize) {
    throw new Error(`Product sitemap page_size mismatch: requested ${pageSize}, got ${data.page_size}`);
  }
  return data;
}

export function getProductSitemapPaths(totalProducts: number, pageSize = PRODUCT_SITEMAP_PAGE_SIZE): string[] {
  const normalizedTotal = Number.isFinite(totalProducts) ? Math.max(0, Math.floor(totalProducts)) : 0;
  const normalizedPageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : PRODUCT_SITEMAP_PAGE_SIZE;
  const totalPages = Math.min(
    MAX_PRODUCT_SITEMAPS,
    Math.ceil(normalizedTotal / normalizedPageSize),
  );

  return Array.from(
    { length: totalPages },
    (_, index) => `/sitemap-products/${index + 1}.xml`,
  );
}

export async function getActiveProductSitemapPaths(): Promise<string[]> {
  const { total } = await fetchProductSitemapPage(1, 1);
  return getProductSitemapPaths(total || 0);
}
