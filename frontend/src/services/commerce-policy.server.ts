import { cache } from 'react';
import type { CommercePolicySetting } from '@/types';
import { FALLBACK_COMMERCE_POLICY } from '@/lib/commerce-policy';

interface APIResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

const getApiBaseUrl = () => {
  const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8080';
  return `${backendUrl}/api/v1`;
};

/**
 * Server-side cached read of the commerce policy. Cached with the
 * `commerce-policy` tag so an admin edit can be revalidated on demand.
 */
export const getCommercePolicyCached = cache(async (): Promise<CommercePolicySetting> => {
  try {
    const res = await fetch(`${getApiBaseUrl()}/public/commerce-policy`, {
      next: { revalidate: 3600, tags: ['commerce-policy'] },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const json = (await res.json()) as APIResponse<CommercePolicySetting>;
      if (json?.success && json?.data) {
        return { ...FALLBACK_COMMERCE_POLICY, ...json.data };
      }
    }
  } catch {
    // Network failure: use the safe default promise.
  }
  return FALLBACK_COMMERCE_POLICY;
});
