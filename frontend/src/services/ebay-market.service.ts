import { apiClient } from '@/lib/api';
import { APIResponse } from '@/types';
import type { AIAgentSEOJob } from './ai-agent.service';

/** One representative eBay listing kept as evidence for a market quote. */
export interface EbayMarketEvidence {
  title: string;
  url: string;
  price_value: number;
  condition?: string;
  category_path?: string;
  description?: string;
  brand?: string;
  model?: string;
  item_specifics?: Record<string, unknown>;
}

/** Aggregated market research for one model number. */
export interface EbayMarketQuote {
  id: number;
  match_key: string;
  model: string;
  brand: string;
  site: string;
  median_price: number;
  p25_price: number;
  p75_price: number;
  min_price: number;
  max_price: number;
  currency: string;
  sample_count: number;
  matched_count: number;
  condition_mix?: Record<string, number>;
  search_url?: string;
  scraped_at: string;
  updated_at: string;
}

/** A quote enriched with the catalogue product it maps to and a price suggestion. */
export interface EbayMarketQuoteRow extends EbayMarketQuote {
  matched_product_id?: number | null;
  matched_product_sku?: string;
  matched_product_name?: string;
  current_price?: number | null;
  suggested_price?: number | null;
  delta_percent?: number | null;
  suggestion_status?: string;
}

export interface EbayMarketQuoteListResponse {
  quotes: EbayMarketQuoteRow[];
  total: number;
  page: number;
  limit: number;
}

export interface EbayMarketSummary {
  total_quotes: number;
  quotes_with_price: number;
  total_products: number;
  last_scraped_at?: string | null;
  policy: {
    enabled: boolean;
    factor: number;
    min_samples: number;
    max_delta_pct: number;
    round_to: number;
  };
}

export interface EbayMarketQuoteFilters {
  page?: number;
  limit?: number;
  search?: string;
  brand?: string;
  only_with_gaps?: boolean;
  sort?: 'scraped_desc' | 'delta_desc' | 'delta_asc';
}

export interface PriceSyncSuggestion {
  product_id: number;
  sku: string;
  name: string;
  brand: string;
  model: string;
  current_price: number;
  median_price: number;
  suggested_price: number;
  delta_percent: number;
  matched_count: number;
  currency: string;
  status:
    | 'ready'
    | 'needs_manual_review'
    | 'insufficient_samples'
    | 'unchanged'
    | 'no_quote'
    | 'price_locked'
    | 'price_sync_disabled';
  status_reason?: string;
  quote_id: number;
  price_locked: boolean;
}

export interface PriceSyncPreviewResponse {
  suggestions: PriceSyncSuggestion[];
  total: number;
  ready: number;
}

export interface PriceSyncApplyResult {
  updated: number;
  skipped: number;
  items: Array<{
    product_id: number;
    sku: string;
    old_price: number;
    new_price: number;
    delta_percent: number;
    median_price: number;
    quote_id: number;
  }>;
  errors?: string[];
}

/** The AI's answer to "what is this part?", built from real listings. */
export interface ProductProfile {
  brand: string;
  part_type: string;
  model_family: string;
  product_category: string;
  what_it_is: string;
  key_functions: string[];
  applications: string[];
  specs: Array<{ label: string; value: string; source_url?: string }>;
  compatible_with: string[];
  confidence: number;
  reason: string;
  evidence_count: number;
  source_urls: string[];
  model: string;
}

export interface ProfileContentPreview {
  short_description: string;
  description: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  compatibility_info: string;
  applications: string;
  technical_specs?: Record<string, string>;
  spec_sources?: Record<string, string>;
}

export interface ProductProfileDraft {
  id: number;
  product_id: number;
  quote_id: number;
  sku?: string;
  brand?: string;
  model: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  confidence: number;
  proposed_title?: string;
  proposed_category_name?: string;
  current_name_snapshot?: string;
  product_updated_at?: string;
  reason?: string;
  spec_draft_id?: number | null;
  reject_reason?: string;
  created_at: string;
  updated_at: string;
  profile: ProductProfile;
  content: ProfileContentPreview;
  evidence: EbayMarketEvidence[];
  applied_fields?: string[];
  product?: {
    id: number;
    sku: string;
    name: string;
    brand: string;
    model: string;
    category_id: number;
    category_name: string;
    short_description: string;
    description: string;
    meta_title: string;
    meta_description: string;
    meta_keywords: string;
  };
}

export interface ProductProfileDraftListResponse {
  drafts: ProductProfileDraft[];
  total: number;
  page: number;
  limit: number;
}

export interface IdentifyProductResponse {
  profile: ProductProfile;
  evidence: EbayMarketEvidence[];
  has_quote: boolean;
  matched_product_id: number;
  draft_saved: boolean;
  draft?: Omit<ProductProfileDraft, 'profile' | 'content' | 'evidence'>;
  content?: ProfileContentPreview;
  proposed_title?: string;
  draft_error?: string;
}

const BASE = '/admin/ebay-market';

export const ebayMarketService = {
  async getSummary() {
    const { data } = await apiClient.get<APIResponse<EbayMarketSummary>>(`${BASE}/summary`);
    return data.data;
  },

  async listQuotes(filters: EbayMarketQuoteFilters = {}) {
    const params: Record<string, string | number> = {};
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;
    if (filters.search) params.search = filters.search;
    if (filters.brand) params.brand = filters.brand;
    if (filters.only_with_gaps) params.only_with_gaps = 'true';
    if (filters.sort) params.sort = filters.sort;

    const { data } = await apiClient.get<APIResponse<EbayMarketQuoteListResponse>>(
      `${BASE}/quotes`,
      { params }
    );
    return data.data;
  },

  async getQuote(id: number) {
    const { data } = await apiClient.get<
      APIResponse<{ quote: EbayMarketQuoteRow; evidence: EbayMarketEvidence[] }>
    >(`${BASE}/quotes/${id}`);
    return data.data;
  },

  async deleteQuote(id: number) {
    const { data } = await apiClient.delete<APIResponse<null>>(`${BASE}/quotes/${id}`);
    return data;
  },

  async clearQuotes() {
    const { data } = await apiClient.post<APIResponse<null>>(`${BASE}/quotes/clear`);
    return data;
  },

  async previewPriceSync(payload: {
    product_ids?: number[];
    brand?: string;
    category_id?: number;
    include_descendants?: boolean;
    only_with_quote?: boolean;
    limit?: number;
  } = {}) {
    const { data } = await apiClient.post<APIResponse<PriceSyncPreviewResponse>>(
      `${BASE}/price-sync/preview`,
      payload
    );
    return data.data;
  },

  async applyPriceSync(payload: {
    product_ids: number[];
    force_product_ids?: number[];
    reason?: string;
  }) {
    const { data } = await apiClient.post<APIResponse<PriceSyncApplyResult>>(
      `${BASE}/price-sync/apply`,
      payload
    );
    if (!data.data) {
      throw new Error(data.message || 'apply_price_sync_failed');
    }
    return data.data;
  },

  async identifyProduct(payload: {
    product_id?: number;
    model: string;
    brand?: string;
    save_draft?: boolean;
  }) {
    const { data } = await apiClient.post<APIResponse<IdentifyProductResponse>>(
      `${BASE}/identify`,
      payload
    );
    return data.data;
  },

  async startIdentificationJob(payload: { product_ids?: number[]; limit?: number } = {}) {
    const { data } = await apiClient.post<APIResponse<{
      job: AIAgentSEOJob;
      selected: number;
      skipped: number;
    }>>(`${BASE}/identify/jobs`, payload);
    if (!data.data?.job) throw new Error(data.message || 'Failed to start identification task');
    return data.data;
  },

  async listProfileDrafts(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const { data } = await apiClient.get<APIResponse<ProductProfileDraftListResponse>>(
      `${BASE}/profile-drafts`,
      { params: filters }
    );
    return data.data;
  },

  async getProfileDraft(id: number) {
    const { data } = await apiClient.get<APIResponse<ProductProfileDraft>>(
      `${BASE}/profile-drafts/${id}`
    );
    return data.data;
  },

  async approveProfileDraft(id: number, payload: {
    apply_title?: boolean;
    apply_content?: boolean;
    overwrite_existing?: boolean;
    allow_new_product_types?: boolean;
    activate_product?: boolean;
    force_stale?: boolean;
    note?: string;
  }) {
    const { data } = await apiClient.post<APIResponse<{
      draft_id: number;
      product_id: number;
      category_id: number;
      applied_fields: string[];
      spec_draft_id?: number | null;
      specs_published: boolean;
    }>>(`${BASE}/profile-drafts/${id}/approve`, payload);
    return data.data;
  },

  async rejectProfileDraft(id: number, reason = '') {
    const { data } = await apiClient.post<APIResponse<null>>(
      `${BASE}/profile-drafts/${id}/reject`,
      { reason }
    );
    return data;
  },
};
