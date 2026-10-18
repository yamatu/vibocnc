import { cache } from 'react';
import type { Product } from '@/types';

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

// Product pages are ISR-cached: a backend outage must throw (so the previous
// page keeps being served) rather than resolve to "not found", which would be
// cached as a 404.
async function fetchBackend(url: string, tags: string[]): Promise<Response | null> {
  const res = await fetch(url, {
    next: { revalidate: 3600, tags },
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status >= 500) throw new Error(`Backend ${res.status} for ${url}`);
  return res.ok ? res : null;
}

export const searchFirstProduct = cache(async (term: string): Promise<Product | null> => {
  const trimmed = term?.trim() || '';
  if (!trimmed) return null;
  const searchUrl = `${getApiBaseUrl()}/public/products?search=${encodeURIComponent(trimmed)}&is_active=true&page=1&page_size=1`;
  const res = await fetchBackend(searchUrl, [buildProductSkuTag(trimmed), 'all-products']);
  if (!res) return null;
  const json = (await res.json()) as APIResponse<{ data?: Product[] } | Product[]>;
  const payload = json.data;
  return (Array.isArray(payload) ? payload[0] : payload?.data?.[0]) || null;
});

export const getProductBySkuCached = cache(async (sku: string): Promise<Product | null> => {
  const trimmed = sku?.trim() || '';
  if (!trimmed) return null;
  // Use query param endpoint to support SKUs containing '/'
  const url = `${getApiBaseUrl()}/public/products/sku?sku=${encodeURIComponent(trimmed)}`;
  const res = await fetchBackend(url, [buildProductSkuTag(trimmed), 'all-products']);
  if (res) {
    const json = (await res.json()) as APIResponse<Product>;
    if (json?.success && json?.data) return json.data;
  }
  return searchFirstProduct(trimmed);
});
