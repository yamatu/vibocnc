import { apiClient } from '@/lib/api';
import type { APIResponse, ProductSpecDraft } from '@/types';

/**
 * Datasheets.com product search API.
 *
 * Every call here is a single, administrator-initiated part-number lookup. The
 * provider account allows 5,000 calls a month, so this service is deliberately
 * not used by any bulk or background code path. Results are a reference for the
 * reviewer: nothing is written to a product until a spec draft is approved.
 */

export interface DatasheetSpec {
  name: string;
  value: string;
}

export interface DatasheetRecord {
  mpn: string;
  manufacturer: string;
  title: string;
  description: string;
  url: string;
  category1?: string;
  category2?: string;
  category3?: string;
  category4?: string;
  package_type?: string;
  lifecycle_status?: string;
  datasheet_url?: string;
  primary_image_url?: string;
  specs?: DatasheetSpec[];
  /** True only when the record's part number equals the looked-up one. */
  exact_match: boolean;
}

export interface DatasheetLookup {
  query: string;
  query_key: string;
  page: number;
  limit: number;
  count: number;
  records: DatasheetRecord[];
  cache_hit: boolean;
  cache_age?: string;
  cached_at?: string | null;
  exact_count: number;
  quota_remaining: number;
  quota_limit: number;
  quota_month?: string;
  notice?: string;
  attribution: string;
  fetched_at: string;
}

export interface DatasheetProductContext {
  id: number;
  sku: string;
  name: string;
  brand: string;
  model: string;
  part_number: string;
  datasheet_url: string;
  has_specs: boolean;
}

export interface DatasheetSuggestions {
  has_exact_match: boolean;
  mpn?: string;
  manufacturer?: string;
  fields?: Record<string, string>;
  spec_count?: number;
  datasheet_url?: string;
  record_url?: string;
}

export interface DatasheetSearchResult {
  lookup: DatasheetLookup;
  product?: DatasheetProductContext | null;
  suggestions: DatasheetSuggestions;
  attribution: string;
}

export interface DatasheetSettingResponse {
  id: number;
  enabled: boolean;
  has_api_key: boolean;
  api_key_from_env: boolean;
  per_minute_limit: number;
  per_hour_limit: number;
  monthly_limit: number;
  auto_stop_percent: number;
  cache_ttl_days: number;
  default_page_limit: number;
  quota_month: string;
  monthly_used: number;
  monthly_remaining: number;
  quota_reset_at?: string | null;
  last_call_at?: string | null;
  last_call_status: number;
  last_call_query: string;
  last_call_message: string;
  updated_at?: string;
}

export interface DatasheetSettingsPayload {
  provider: string;
  endpoint: string;
  provider_limits: string;
  has_api_key: boolean;
  api_key_from_env: boolean;
  attribution: string;
  terms_url: string;
  setting: DatasheetSettingResponse;
}

export interface DatasheetCacheRow {
  id: number;
  mpn: string;
  query_key: string;
  result_count: number;
  match_count: number;
  fetched_at: string;
  expires_at?: string | null;
  hit_count: number;
  last_hit_at?: string | null;
}

export class DatasheetService {
  static async getSettings(): Promise<DatasheetSettingsPayload> {
    const res = await apiClient.get<APIResponse<DatasheetSettingsPayload>>('/admin/products/datasheet-settings');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load Datasheets.com settings');
  }

  static async updateSettings(payload: {
    enabled?: boolean;
    api_key?: string;
    clear_api_key?: boolean;
    per_minute_limit?: number;
    per_hour_limit?: number;
    monthly_limit?: number;
    auto_stop_percent?: number;
    cache_ttl_days?: number;
    default_page_limit?: number;
    reset_usage?: boolean;
  }): Promise<DatasheetSettingResponse> {
    const res = await apiClient.put<APIResponse<DatasheetSettingResponse>>(
      '/admin/products/datasheet-settings',
      payload,
    );
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to save Datasheets.com settings');
  }

  /** Costs one provider call; proves the stored key works. */
  static async testKey(q = 'BAV99'): Promise<{ query: string; count: number; sample_mpn: string; quota_remaining: number; quota_limit: number }> {
    const res = await apiClient.post<APIResponse<{ query: string; count: number; sample_mpn: string; quota_remaining: number; quota_limit: number }>>(
      '/admin/products/datasheet-settings/test',
      {},
      { params: { q } },
    );
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Datasheets.com test failed');
  }

  /** Looks one part number up. Served from cache when possible. */
  static async search(params: {
    q: string;
    page?: number;
    limit?: number;
    refresh?: boolean;
    product_id?: number;
  }): Promise<DatasheetSearchResult> {
    const res = await apiClient.post<APIResponse<DatasheetSearchResult>>('/admin/products/datasheet-search', params);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Datasheets.com lookup failed');
  }

  /**
   * Stores the exact-match record as a spec draft. The reviewer still has to
   * approve it on the draft screen before a value reaches the product.
   */
  static async createDraft(params: {
    product_id?: number;
    mpn: string;
    q?: string;
    specs?: DatasheetSpec[];
  }): Promise<ProductSpecDraft> {
    const res = await apiClient.post<APIResponse<ProductSpecDraft>>('/admin/products/datasheet-draft', params);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to create the draft');
  }

  static async listCache(params: { search?: string; page?: number; page_size?: number } = {}) {
    const res = await apiClient.get<
      APIResponse<{
        items: DatasheetCacheRow[];
        total: number;
        page: number;
        page_size: number;
        total_pages: number;
      }>
    >('/admin/products/datasheet-cache', { params });
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load cached lookups');
  }
}
