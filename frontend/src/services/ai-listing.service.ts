import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';
import type { AIAgentSEOJob } from './ai-agent.service';

export interface ProductListingRecord {
  name: string;
  sku: string;
  price?: number | null;
  price_text?: string;
  category_text?: string;
  stock_quantity?: number | null;
  brand: string;
  model: string;
  part_number: string;
  warranty_period: string;
  lead_time: string;
  weight_kg?: number | null;
  short_description: string;
  description: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
}

export interface CategoryPathResolution {
  category_id: number;
  path: string[];
  existing: string[];
  missing: string[];
  created: boolean;
}

export interface ListingQualityIssue {
  code: string;
  detail: string;
}

export interface AIListingGenerateRequest {
  product_id?: number;
  name?: string;
  sku?: string;
  brand?: string;
  model?: string;
  part_number?: string;
  description?: string;
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  warranty_period?: string;
  lead_time?: string;
  category_id?: number;
  instruction?: string;
  create_category?: boolean;
  use_web_search?: boolean;
}

export interface AIListingGenerateResult {
  listing: ProductListingRecord;
  category_path: string[];
  category: CategoryPathResolution;
  category_message?: string;
  quality_issues: ListingQualityIssue[];
  evidence: Array<{ title: string; url: string; source_type?: string }>;
}

export type ListingImportFieldKey =
  | 'name' | 'brand' | 'model' | 'part_number' | 'price' | 'stock_quantity' | 'warranty_period'
  | 'lead_time' | 'weight' | 'short_description' | 'description' | 'meta_title' | 'meta_description' | 'meta_keywords';

export interface ListingImportField {
  key: ListingImportFieldKey;
  current: string;
  incoming: string;
  status: 'fill' | 'overwrite' | 'same';
  apply: boolean;
}

export interface ListingImportItem {
  index: number;
  record: ProductListingRecord;
  action: 'create' | 'update' | 'unchanged' | 'invalid';
  product_id: number;
  product_sku?: string;
  product_name?: string;
  match_type?: 'sku' | 'part_number';
  fields: ListingImportField[];
  category_path: string[];
  category: CategoryPathResolution;
  current_category_id: number;
  current_category_path: string[];
  apply_category: boolean;
  warnings: string[];
}

export interface ListingCategoryDecision {
  index: number;
  category_path: string[];
  category: CategoryPathResolution;
}

export interface ListingImportApplyItem {
  index: number;
  record: ProductListingRecord;
  product_id: number;
  fields: ListingImportFieldKey[];
  category_path: string[];
  apply_category: boolean;
}

export interface ListingImportApplyResult {
  index: number;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  product_id?: number;
  sku: string;
  message?: string;
  category_path?: string[];
}

export interface AIListingJobOptions {
  product_ids?: number[];
  limit?: number;
  category_id?: number;
  include_descendants?: boolean;
  brand?: string;
  search?: string;
  status?: 'active' | 'inactive' | 'all';
  featured?: 'true' | 'false';
  ai_seo_status?: 'optimized' | 'not_optimized' | 'running' | 'failed';
  failed_only?: boolean;
  /** Rewrite even listings that already pass the quality check. */
  force?: boolean;
  create_categories?: boolean;
  use_web_search?: boolean;
  activate_resolved?: boolean;
  instruction?: string;
}

// Web research plus one or two model calls can take minutes.
const AI_LISTING_TIMEOUT = 300000;

function unwrap<T>(response: { data: APIResponse<T> }, fallback: string): T {
  if (response.data.success && response.data.data) return response.data.data;
  throw new Error(response.data.message || fallback);
}

export class AIListingService {
  static async generate(payload: AIListingGenerateRequest): Promise<AIListingGenerateResult> {
    const response = await apiClient.post<APIResponse<AIListingGenerateResult>>('/admin/ai-agent/listing/generate', payload, { timeout: AI_LISTING_TIMEOUT });
    return unwrap(response, 'AI listing failed');
  }

  static async startJob(options: AIListingJobOptions): Promise<AIAgentSEOJob> {
    const response = await apiClient.post<APIResponse<AIAgentSEOJob>>('/admin/ai-agent/listing/jobs', options);
    return unwrap(response, 'Unable to start AI optimization job');
  }

  static async previewImport(text: string): Promise<ListingImportItem[]> {
    const response = await apiClient.post<APIResponse<{ items: ListingImportItem[] }>>('/admin/ai-agent/listing/import/preview', { text }, { timeout: 120000 });
    return unwrap(response, 'Unable to parse listings').items;
  }

  static async suggestCategories(items: Array<{ index: number; name: string; brand: string; model: string; part_number: string; category_text?: string; description?: string }>): Promise<ListingCategoryDecision[]> {
    const response = await apiClient.post<APIResponse<{ items: ListingCategoryDecision[] }>>('/admin/ai-agent/listing/import/categories', { items }, { timeout: AI_LISTING_TIMEOUT });
    return unwrap(response, 'AI category suggestion failed').items;
  }

  static async applyImport(items: ListingImportApplyItem[], options: { activate_new?: boolean; disable_auto_seo?: boolean } = {}): Promise<ListingImportApplyResult[]> {
    const response = await apiClient.post<APIResponse<{ results: ListingImportApplyResult[] }>>('/admin/ai-agent/listing/import/apply', { items, ...options }, { timeout: 180000 });
    return unwrap(response, 'Import failed').results;
  }
}

export default AIListingService;
