import type { CommercePolicySetting } from '@/types';

/**
 * Fallback promise used when the backend is unreachable during rendering. It
 * mirrors models.DefaultCommercePolicy() on the backend so a cold cache or an
 * outage never publishes an empty shipping/return promise.
 */
export const FALLBACK_COMMERCE_POLICY: CommercePolicySetting = {
  shipping_handling_time_text: '1-2 days',
  shipping_handling_days_min: 1,
  shipping_handling_days_max: 2,
  shipping_transit_time_text: '4-5 DAYS',
  shipping_transit_days_min: 4,
  shipping_transit_days_max: 5,
  shipping_carriers: 'DHL,FedEx,UPS',
  shipping_destination_countries: 'GLOBAL',
  shipping_rate_amount: 0,
  shipping_currency: 'USD',
  shipping_notes: '',
  default_warranty_period: '12 months',
  default_lead_time: '4-5 DAYS',
  return_window_days: 365,
  return_window_text: '1 year',
  return_shipping_payer: 'shared',
  return_policy_country: 'US',
  return_policy_notes: '',
  // Internal pricing controls are unused by storefront helpers. They are kept
  // here only because the admin/public policy share one transport type.
  price_sync_enabled: false,
  price_sync_factor: 1,
  price_sync_min_samples: 3,
  price_sync_max_delta_pct: 50,
  price_sync_round_to: 0,
};

/** Comma separated carrier list, defaulting to the advertised carriers. */
export function commercePolicyCarriers(policy?: CommercePolicySetting): string[] {
  const raw = policy?.shipping_carriers || FALLBACK_COMMERCE_POLICY.shipping_carriers;
  const carriers = raw
    .split(/[,;/]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return carriers.length > 0 ? Array.from(new Set(carriers)) : ['DHL', 'FedEx', 'UPS'];
}

/**
 * Destination codes for schema.org shippingDetails. An empty array means
 * worldwide coverage, matching the backend's GLOBAL value.
 */
export function commercePolicyDestinationCountries(policy?: CommercePolicySetting): string[] {
  const raw = (policy?.shipping_destination_countries || '').trim().toUpperCase();
  if (!raw || raw === 'GLOBAL') return [];
  const codes = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && value !== 'GLOBAL');
  return Array.from(new Set(codes));
}

/** Human readable return-freight promise. */
export function commercePolicyReturnShippingText(policy?: CommercePolicySetting, locale = 'en'): string {
  const zh = locale === 'zh';
  switch (policy?.return_shipping_payer) {
    case 'customer':
      return zh ? '退货运费由买家承担' : 'return shipping is arranged and paid by the buyer';
    case 'merchant':
      return zh ? '退货运费由 Vibocnc 承担' : 'return shipping is covered by Vibocnc';
    default:
      return zh ? '退货运费由双方各自承担' : 'return shipping costs are shared between buyer and Vibocnc';
  }
}

/**
 * Transit time shown in generated copy. The operator types this text in
 * Admin → Commerce Policy, so it can be "4-5 DAYS" or any other promise without
 * a code change.
 */
export function commercePolicyTransitText(policy?: CommercePolicySetting): string {
  return (
    policy?.shipping_transit_time_text ||
    FALLBACK_COMMERCE_POLICY.shipping_transit_time_text
  );
}

/** Return window shown in generated copy, e.g. "1 year". */
export function commercePolicyReturnWindowText(policy?: CommercePolicySetting): string {
  return policy?.return_window_text || FALLBACK_COMMERCE_POLICY.return_window_text;
}

/** Handling time shown in generated copy, e.g. "1-2 days". */
export function commercePolicyHandlingText(policy?: CommercePolicySetting): string {
  return (
    policy?.shipping_handling_time_text ||
    FALLBACK_COMMERCE_POLICY.shipping_handling_time_text
  );
}

/** Lead time to display for a product, preferring the record over the policy. */
export function resolveLeadTime(
  productLeadTime: string | undefined,
  policy?: CommercePolicySetting,
): string {
  const value = String(productLeadTime || '').trim();
  if (value) return value;
  return policy?.default_lead_time || FALLBACK_COMMERCE_POLICY.default_lead_time;
}

/** Warranty to display for a product, preferring the record over the policy. */
export function resolveWarrantyPeriod(
  productWarranty: string | undefined,
  policy?: CommercePolicySetting,
): string {
  const value = String(productWarranty || '').trim();
  if (value) return value;
  return policy?.default_warranty_period || FALLBACK_COMMERCE_POLICY.default_warranty_period;
}
