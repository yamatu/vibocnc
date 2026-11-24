import { cache } from 'react';

export interface MerchantShippingQuoteItem {
  country_code: string;
  currency: string;
  shipping_fee: number;
  is_free: boolean;
  handling_days_min: number;
  handling_days_max: number;
  transit_days_min: number;
  transit_days_max: number;
  service: string;
}

export interface MerchantShippingQuotesPayload {
  weight_kg: number;
  return_days: number;
  quotes: MerchantShippingQuoteItem[];
}

export const DEFAULT_SHIPPING_WEIGHT_KG = 0.5;

const getApiBaseUrl = () => {
  const backendUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  return `${backendUrl}/api/v1`;
};

function normalizeWeight(weightKg?: number | null): number {
  const n = Number(weightKg || 0);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SHIPPING_WEIGHT_KG;
  return Math.round(n * 100) / 100;
}

// Fetch checkout-accurate multi-country shipping quotes for Product JSON-LD
// OfferShippingDetails. Cached per weight bucket in Next's data cache and
// backend Redis so product ISR incurs almost zero overhead.
export const getMerchantShippingQuotesCached = cache(
  async (weightKg?: number | null): Promise<MerchantShippingQuoteItem[]> => {
    const w = normalizeWeight(weightKg);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/public/shipping/merchant-quotes?weight_kg=${encodeURIComponent(String(w))}`,
        {
          next: { revalidate: 1800, tags: ['shipping-merchant-quotes'] },
          headers: { 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { success?: boolean; data?: MerchantShippingQuotesPayload };
      if (!json?.success || !Array.isArray(json.data?.quotes)) return [];
      return json.data.quotes;
    } catch {
      return [];
    }
  },
);
