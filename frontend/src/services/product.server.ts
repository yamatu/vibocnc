import { cache } from 'react';
import type { Product } from '@/types';

interface APIResponse<T> {
  success: boolean;
  data?: T;
}

// React memoization deduplicates metadata/page reads within ONE request only.
// Publication status must not be taken from an hour-old persistent fetch cache.
export const getProductBySkuCached = cache(async (sku: string): Promise<Product | null> => {
  const trimmed = sku?.trim() || '';
  if (!trimmed) return null;
  const baseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/api/v1/public/products/sku?sku=${encodeURIComponent(trimmed)}`, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as APIResponse<Product>;
    return json.success && json.data?.is_active ? json.data : null;
  } catch {
    return null;
  }
  // No search fallback: a disabled/missing exact SKU must remain not found.
});
