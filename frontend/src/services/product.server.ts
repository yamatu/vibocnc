import { cache } from 'react';

// Minimal types to avoid circular imports
interface APIResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

// Get API base URL for server-side fetching
const getApiBaseUrl = () => {
  // Use the backend URL from environment variable
  const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8080';
  return `${backendUrl}/api/v1`;
};

const buildProductSkuTag = (sku: string) => {
  const trimmed = sku?.trim().toLowerCase() || '';
  return `product-${trimmed.replace(/[^a-z0-9]/g, '-')}`;
};

// Use server-only fetch with per-request memoization to dedupe calls
// Supports ISR via cache tags for on-demand revalidation
export const getProductBySkuCached = cache(async (sku: string) => {
  const trimmed = sku?.trim() || '';
  const baseUrl = getApiBaseUrl();
  // Use query param endpoint to support SKUs containing '/'
  const url = `${baseUrl}/public/products/sku?sku=${encodeURIComponent(trimmed)}`;

  // Build a tag from the SKU for on-demand revalidation
  const skuTag = buildProductSkuTag(trimmed);

  try {
    const res = await fetch(url, {
      next: { revalidate: 3600, tags: [skuTag, 'all-products'] },
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      const json = (await res.json()) as APIResponse<any>;
      if (json?.success && json?.data) {
        return json.data;
      }
    } else {
      // Try to extract API error payload for more context (non-fatal here)
      try { await res.json(); } catch (_) {}
    }
  } catch (_) {
    // Network error: fall through to search-based fallback
  }

  // Fallback: try search endpoint to find the product by term
  try {
    const searchUrl = `${baseUrl}/public/products?search=${encodeURIComponent(trimmed)}&is_active=true&page_size=1`;
    const res2 = await fetch(searchUrl, {
      next: { revalidate: 3600, tags: [skuTag, 'all-products'] },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res2.ok) {
      const json2 = (await res2.json()) as APIResponse<{ data: any[] }>;
      const first = (json2 as any)?.data?.data?.[0] || (json2 as any)?.data?.[0];
      if (first) return first;
    }
  } catch (_) {}

  // As a final fallback, return null to avoid crashing SSR
  return null as any;
});
