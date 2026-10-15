import { ProductService } from '@/services/product.service';

// 1000 URLs per shard keeps a 120k+ catalogue inside ~130 shards, well under
// MAX_PRODUCT_SITEMAPS. At 100 per shard the 1000-shard ceiling silently
// dropped every SKU past the 100,000th from the sitemap index entirely.
export const PRODUCT_SITEMAP_PAGE_SIZE = 1000;
export const MAX_PRODUCT_SITEMAPS = 1000;

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
  const response = await ProductService.getProducts({
    page: 1,
    page_size: 1,
    is_active: 'true',
  });

  return getProductSitemapPaths(response.total || 0);
}
