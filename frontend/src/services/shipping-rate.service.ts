import { apiClient } from '@/lib/api';
import { APIResponse } from '@/types';

export interface ShippingRate {
  id: number;
  carrier?: string;
  service_code?: string;
  country_code: string;
  country_name: string;
  currency: string;
  is_active: boolean;
  weight_brackets?: number;
  quote_surcharges?: number;
  created_at: string;
  updated_at: string;
}

export interface ShippingRatePublic {
  country_code: string;
  country_name: string;
  currency: string;
}

export interface ShippingQuote {
  country_code: string;
  currency: string;
  weight_kg: number;
  billing_weight_kg?: number;
  rate_per_kg: number;
  base_quote: number;
  additional_fee: number;
  shipping_fee: number;
  source?: 'default' | 'carrier' | 'default_fallback' | string;
  carrier?: string;
  service_code?: string;
}

export interface ShippingRateImportResult {
  countries: number;
  created: number;
  updated: number;
  deleted: number;
  failed: number;
  errors: string[];
}

export interface ShippingAllowedCountry {
  id: number;
  country_code: string;
  country_name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ShippingFreeCountry {
  country_code: string;
  country_name: string;
}

export interface ShippingFreeSetting {
  id: number;
  country_code: string;
  country_name: string;
  free_shipping_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShippingMutationResult {
  count?: number;
  deleted?: number;
  countries?: number;
  created?: number;
  updated?: number;
}

export class ShippingRateService {
  static async publicCountries(opts?: { carrier?: string; service?: string }): Promise<ShippingRatePublic[]> {
    const qs = new URLSearchParams();
    if (opts?.carrier) qs.set('carrier', opts.carrier);
    if (opts?.service) qs.set('service', opts.service);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiClient.get<APIResponse<ShippingRatePublic[]>>(`/public/shipping/countries${suffix}`);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || 'Failed to fetch shipping rates');
  }

  static async quote(country: string, weightKg: number, opts?: { carrier?: string; service?: string }): Promise<ShippingQuote> {
    const qs = new URLSearchParams();
    qs.set('country', country);
    qs.set('weight_kg', String(weightKg || 0));
    if (opts?.carrier) qs.set('carrier', opts.carrier);
    if (opts?.service) qs.set('service', opts.service);
    const res = await apiClient.get<APIResponse<ShippingQuote>>(`/public/shipping/quote?${qs.toString()}`);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to calculate shipping');
  }

  static async adminList(
    q?: string,
    opts?: { type?: 'country' | 'carrier'; carrier?: string; service?: string }
  ): Promise<ShippingRate[]> {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (opts?.type) qs.set('type', opts.type);
    if (opts?.carrier) qs.set('carrier', opts.carrier);
    if (opts?.service) qs.set('service', opts.service);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiClient.get<APIResponse<ShippingRate[]>>(`/admin/shipping-rates${suffix}`);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || 'Failed to fetch shipping rates');
  }


  static async bulkDelete(
    payload: { all?: boolean; country_codes?: string[] },
    opts?: { type?: 'country' | 'carrier'; carrier?: string; service?: string }
  ): Promise<{ deleted: number }> {
    const qs = new URLSearchParams();
    if (opts?.type) qs.set('type', opts.type);
    if (opts?.carrier) qs.set('carrier', opts.carrier);
    if (opts?.service) qs.set('service', opts.service);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiClient.post<APIResponse<ShippingMutationResult>>(`/admin/shipping-rates/bulk-delete${suffix}`, payload);
    if (res.data.success && res.data.data) return { deleted: res.data.data.deleted ?? 0 };
    throw new Error(res.data.message || 'Failed to delete shipping templates');
  }

  static async downloadTemplate(opts?: { type?: 'country' | 'carrier-zone'; carrier?: string; service?: string; currency?: string }): Promise<Blob> {
    const qs = new URLSearchParams();
    if (opts?.type) qs.set('type', opts.type);
    if (opts?.carrier) qs.set('carrier', opts.carrier);
    if (opts?.service) qs.set('service', opts.service);
    if (opts?.currency) qs.set('currency', opts.currency);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiClient.get(`/admin/shipping-rates/import/template${suffix}`, { responseType: 'blob' });
    return res.data as Blob;
  }

  static async importXlsx(
    file: File,
    opts?: { replace?: boolean; type?: 'country' | 'carrier-zone'; carrier?: string; service?: string; currency?: string }
  ): Promise<ShippingRateImportResult> {
    const form = new FormData();
    form.append('file', file);
    const qs = new URLSearchParams();
    if (opts?.replace) qs.set('replace', '1');
    if (opts?.type) qs.set('type', opts.type);
    if (opts?.carrier) qs.set('carrier', opts.carrier);
    if (opts?.service) qs.set('service', opts.service);
    if (opts?.currency) qs.set('currency', opts.currency);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiClient.post<APIResponse<ShippingRateImportResult>>(`/admin/shipping-rates/import/xlsx${suffix}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to import shipping rates');
  }

  // Allowed countries whitelist (if non-empty, public countries are restricted)
  static async listAllowedCountries(): Promise<ShippingAllowedCountry[]> {
    const res = await apiClient.get<APIResponse<ShippingAllowedCountry[]>>('/admin/shipping-rates/allowed-countries');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || 'Failed to fetch allowed countries');
  }

  static async bulkSetAllowedCountries(countries: Array<{ country_code: string; country_name?: string; sort_order?: number }>): Promise<{ count: number }> {
    const res = await apiClient.post<APIResponse<ShippingMutationResult>>('/admin/shipping-rates/allowed-countries/bulk', { countries });
    if (res.data.success && res.data.data) return { count: res.data.data.count ?? 0 };
    throw new Error(res.data.message || 'Failed to update allowed countries');
  }

  static async removeAllowedCountry(code: string): Promise<void> {
    const res = await apiClient.delete<APIResponse<unknown>>(`/admin/shipping-rates/allowed-countries/${encodeURIComponent(code)}`);
    if (res.data.success) return;
    throw new Error(res.data.message || 'Failed to remove allowed country');
  }

  // Free shipping settings
  static async getFreeShippingCountries(): Promise<ShippingFreeSetting[]> {
    const res = await apiClient.get<APIResponse<ShippingFreeSetting[]>>('/admin/shipping-rates/free-shipping');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || 'Failed to fetch free shipping settings');
  }

  static async setFreeShippingCountries(countries: Array<{ country_code: string; country_name?: string; free_shipping_enabled: boolean }>): Promise<{ count: number }> {
    const res = await apiClient.post<APIResponse<ShippingMutationResult>>('/admin/shipping-rates/free-shipping', { countries });
    if (res.data.success && res.data.data) return { count: res.data.data.count ?? 0 };
    throw new Error(res.data.message || 'Failed to update free shipping settings');
  }

  static async publicFreeShippingCountries(): Promise<ShippingFreeCountry[]> {
    const res = await apiClient.get<APIResponse<ShippingFreeCountry[]>>('/public/shipping/free-countries');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || 'Failed to fetch free shipping countries');
  }
}
