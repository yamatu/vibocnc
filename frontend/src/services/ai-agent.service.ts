import { apiClient } from '@/lib/api';
import { APIResponse } from '@/types';

export type AIAgentActionType =
  | 'create_category'
  | 'create_product'
  | 'update_product'
  | 'update_product_price'
  | 'upsert_product_translation'
  | 'upsert_category_translation';

export interface AIAgentAction {
  type: AIAgentActionType;
  title: string;
  data: Record<string, unknown>;
}

export interface AIAgentMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: AIAgentAction[];
}

export interface AIAgentStatus {
  configured: boolean;
  model: string;
  provider: string;
  api_mode: 'standard_chat' | 'reasoning_chat';
  reasoning_effort: string;
  active_profile_id?: number;
  active_profile_name?: string;
  product_creation_ready: boolean;
  default_product_price: number;
  default_warranty_period: string;
  default_lead_time: string;
  capabilities?: string[];
}

export interface AIAgentSettings {
  active_profile_id?: number;
  active_profile_name?: string;
  enabled: boolean;
  base_url: string;
  has_api_key: boolean;
  model: string;
  api_mode: 'standard_chat' | 'reasoning_chat';
  reasoning_effort: string;
  timeout_seconds: number;
  seo_job_concurrency: number;
  seo_candidate_limit: number;
  default_product_price: number;
  default_warranty_period: string;
  default_lead_time: string;
  updated_at?: string;
}

export interface AIAgentProfile {
  id: number;
  name: string;
  base_url: string;
  has_api_key: boolean;
  model: string;
  api_mode: 'standard_chat' | 'reasoning_chat';
  reasoning_effort: string;
  timeout_seconds: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AIAgentProfileWrite {
  name: string;
  base_url: string;
  api_key?: string;
  clear_api_key?: boolean;
  reuse_active_api_key?: boolean;
  model: string;
  api_mode: 'standard_chat' | 'reasoning_chat';
  reasoning_effort: string;
  timeout_seconds: number;
}

export interface AIAgentConnectionTestRequest {
  profile_id?: number;
  base_url: string;
  api_key?: string;
  model: string;
  api_mode: 'standard_chat' | 'reasoning_chat';
  reasoning_effort?: string;
  timeout_seconds?: number;
}

export interface AIAgentConnectionTestResult {
  ok: boolean;
  latency_ms: number;
  model: string;
  provider: string;
  reply?: string;
  error?: string;
}

export const AI_AGENT_CONFIG_CHANGED_EVENT = 'ai-agent-config-changed';

export function notifyAIAgentConfigChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AI_AGENT_CONFIG_CHANGED_EVENT));
  }
}

export interface AIAgentSettingsUpdate {
  enabled?: boolean;
  base_url?: string;
  api_key?: string;
  clear_api_key?: boolean;
  model?: string;
  api_mode?: 'standard_chat' | 'reasoning_chat';
  reasoning_effort?: string;
  timeout_seconds?: number;
  seo_job_concurrency?: number;
  seo_candidate_limit?: number;
  default_product_price?: number;
  default_warranty_period?: string;
  default_lead_time?: string;
}

export interface AIAgentReply {
  reply: string;
  suggestions: AIAgentAction[];
}

export interface AIAgentArticleDraftRequest {
  topic: string;
  keywords?: string;
  language?: string;
  content_type?: 'news' | 'blog';
  tone?: string;
  outline?: string;
}

export interface AIAgentArticleDraft {
  title: string;
  slug: string;
  summary: string;
  content: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
}

export type AIAgentPriceRowStatus =
  | 'matched'
  | 'unmatched'
  | 'ambiguous'
  | 'conflict'
  | 'invalid'
  | 'duplicate';

export interface AIAgentPricePreviewRow {
  line: number;
  model: string;
  price: number;
  currency?: string;
  status: AIAgentPriceRowStatus;
  message?: string;
  product_id?: number;
  sku?: string;
  product_name?: string;
  current_price?: number;
}

export interface AIAgentPricePreview {
  total: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  conflicts: number;
  invalid: number;
  duplicates: number;
  rows: AIAgentPricePreviewRow[];
  suggestions: AIAgentAction[];
}

export type AIAgentSEOJobStatus = 'queued' | 'running' | 'paused' | 'cancelled' | 'completed' | 'completed_with_errors' | 'failed';
export type AIAgentSEOItemStatus = 'queued' | 'running' | 'optimized' | 'failed' | 'cancelled';

export interface AIAgentSEOJobItem {
  id: number;
  job_id: string;
  product_id: number;
  sku: string;
  status: AIAgentSEOItemStatus;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface AIAgentSEOJob {
  id: string;
  prompt: string;
  focus?: AIAgentSEOFocus[];
  selection_mode: 'selected' | 'auto_candidates' | 'auto_failed' | 'category_optimization';
  status: AIAgentSEOJobStatus;
  ai_profile_id?: number;
  ai_profile_name?: string;
  ai_model?: string;
  ai_api_mode?: 'standard_chat' | 'reasoning_chat';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  created_by_id: number;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  items?: AIAgentSEOJobItem[];
}

export interface AIAgentSEOStats {
  total: number;
  optimized: number;
  not_optimized: number;
  failed: number;
  running: number;
}

export type AIAgentSEOFocus = 'all' | 'category' | 'seo' | 'content';

export interface AIAgentSEOCandidateOptions {
  prompt: string;
  limit?: number;
  category_id?: number;
  include_descendants?: boolean;
  brand?: string;
  search?: string;
  include_failed?: boolean;
  failed_only?: boolean;
  /** Include products that already have an AI SEO result in a scoped rewrite. */
  include_optimized?: boolean;
  ai_seo_status?: 'all' | 'optimized' | 'not_optimized' | 'running' | 'failed';
  focus?: AIAgentSEOFocus[];
}

export interface AIAgentCategoryOptimizationOptions {
  product_ids?: number[];
  limit: number;
  category_id?: number;
  include_descendants?: boolean;
  brand?: string;
  search?: string;
  status?: 'active' | 'inactive' | 'all';
  featured?: 'true' | 'false' | 'all';
  include_inactive?: boolean;
  ai_seo_status?: 'all' | 'optimized' | 'not_optimized' | 'running' | 'failed';
  use_web_search?: boolean;
  create_missing_categories?: boolean;
  activate_resolved?: boolean;
  /** Ask the active AI profile to identify products the rules cannot verify. */
  use_llm_fallback?: boolean;
  /** Queue only products the classification audit flags for rework. */
  rework_only?: boolean;
  /** After category repair, audit and rewrite only weak or incorrect descriptions. */
  repair_content?: boolean;
}

export interface AIAgentSEOJobItemsPage {
  items: AIAgentSEOJobItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProductSEOIssueSample {
  product_id: number;
  sku: string;
  name: string;
  brand: string;
  model: string;
  meta_title: string;
  issue: 'seo_failed' | 'missing_meta' | 'never_optimized' | 'generic_meta' | 'model_missing' | 'brand_mismatch';
  detail: string;
}

export interface ProductSEOAudit {
  scanned: number;
  ok: number;
  seo_failed: number;
  missing_meta: number;
  never_optimized: number;
  generic_meta: number;
  model_missing: number;
  brand_mismatch: number;
  product_ids: number[];
  samples: ProductSEOIssueSample[];
}

export interface AIAgentSEOAutoFixResult {
  job: AIAgentSEOJob;
  audit: ProductSEOAudit;
}

export interface AICategorySEOItem {
  category_id: number;
  name: string;
  path: string;
  status: 'updated' | 'skipped' | 'failed';
  message?: string;
  description?: string;
}

export interface AICategorySEOBatch {
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  has_more: boolean;
  next_after_id: number;
  results: AICategorySEOItem[];
}

export class AIAgentService {
  static async status(): Promise<AIAgentStatus> {
    const response = await apiClient.get<APIResponse<AIAgentStatus>>('/admin/ai-agent/status');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to check AI assistant status');
  }

  static async getSettings(): Promise<AIAgentSettings> {
    const response = await apiClient.get<APIResponse<AIAgentSettings>>('/admin/ai-agent/settings');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load AI settings');
  }

  static async updateSettings(payload: AIAgentSettingsUpdate): Promise<AIAgentSettings> {
    const response = await apiClient.put<APIResponse<AIAgentSettings>>('/admin/ai-agent/settings', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to save AI settings');
  }

  static async listProfiles(): Promise<AIAgentProfile[]> {
    const response = await apiClient.get<APIResponse<AIAgentProfile[]>>('/admin/ai-agent/profiles');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load AI profiles');
  }

  static async createProfile(payload: AIAgentProfileWrite): Promise<AIAgentProfile> {
    const response = await apiClient.post<APIResponse<AIAgentProfile>>('/admin/ai-agent/profiles', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to create AI profile');
  }

  static async updateProfile(id: number, payload: AIAgentProfileWrite): Promise<AIAgentProfile> {
    const response = await apiClient.put<APIResponse<AIAgentProfile>>(`/admin/ai-agent/profiles/${id}`, payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to update AI profile');
  }

  static async deleteProfile(id: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<null>>(`/admin/ai-agent/profiles/${id}`);
    if (!response.data.success) throw new Error(response.data.message || 'Unable to delete AI profile');
  }

  static async activateProfile(id: number): Promise<AIAgentSettings> {
    const response = await apiClient.post<APIResponse<AIAgentSettings>>(`/admin/ai-agent/profiles/${id}/activate`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to activate AI profile');
  }

  static async testConnection(payload: AIAgentConnectionTestRequest): Promise<AIAgentConnectionTestResult> {
    const response = await apiClient.post<APIResponse<AIAgentConnectionTestResult>>(
      '/admin/ai-agent/test-connection',
      payload,
      // Slow reasoning models may take close to the provider timeout to answer.
      { timeout: 90000 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to test the AI connection');
  }

  static async chat(message: string, history: AIAgentMessage[]): Promise<AIAgentReply> {
    const response = await apiClient.post<APIResponse<AIAgentReply>>('/admin/ai-agent/chat', {
      message,
      history: history.slice(-8).map(({ role, content }) => ({ role, content })),
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'AI assistant could not create a proposal');
  }

  static async apply(actions: AIAgentAction[]): Promise<Array<Record<string, unknown>>> {
    const response = await apiClient.post<APIResponse<Array<Record<string, unknown>>>>('/admin/ai-agent/apply', { actions });
    if (response.data.success) return response.data.data || [];
    throw new Error(response.data.message || 'AI suggestions could not be applied');
  }

  static async generateArticleDraft(payload: AIAgentArticleDraftRequest): Promise<AIAgentArticleDraft> {
    const response = await apiClient.post<APIResponse<AIAgentArticleDraft>>('/admin/ai-agent/article-draft', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'AI article draft could not be generated');
  }

  static async previewPrices(text: string): Promise<AIAgentPricePreview> {
    const response = await apiClient.post<APIResponse<AIAgentPricePreview>>('/admin/ai-agent/prices/preview', { text });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Price list could not be matched');
  }

  static async startSEOJob(productIds: number[], prompt: string, focus: AIAgentSEOFocus = 'all'): Promise<AIAgentSEOJob> {
    const response = await apiClient.post<APIResponse<AIAgentSEOJob>>('/admin/ai-agent/seo/jobs', {
      product_ids: productIds,
      prompt,
      focus: [focus],
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to start AI SEO job');
  }

  static async startSEOCandidateJob(options: AIAgentSEOCandidateOptions): Promise<AIAgentSEOJob> {
    const response = await apiClient.post<APIResponse<AIAgentSEOJob>>('/admin/ai-agent/seo/candidates', options);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to start AI SEO candidate job');
  }

  static async startCategoryOptimizationJob(options: AIAgentCategoryOptimizationOptions): Promise<AIAgentSEOJob> {
    const response = await apiClient.post<APIResponse<AIAgentSEOJob>>('/admin/ai-agent/seo/category-jobs', options);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to start category optimization job');
  }

  static async getSEOJob(id: string): Promise<AIAgentSEOJob> {
    const response = await apiClient.get<APIResponse<AIAgentSEOJob>>(`/admin/ai-agent/seo/jobs/${encodeURIComponent(id)}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load AI SEO job');
  }

  static async listSEOJobItems(id: string, limit = 200, offset = 0): Promise<AIAgentSEOJobItemsPage> {
    const response = await apiClient.get<APIResponse<AIAgentSEOJobItemsPage>>(`/admin/ai-agent/seo/jobs/${encodeURIComponent(id)}/items`, {
      params: { limit, offset },
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load AI SEO job items');
  }

  static async pauseSEOJob(id: string): Promise<AIAgentSEOJob> {
    const response = await apiClient.post<APIResponse<AIAgentSEOJob>>(`/admin/ai-agent/seo/jobs/${encodeURIComponent(id)}/pause`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to pause AI SEO job');
  }

  static async resumeSEOJob(id: string): Promise<AIAgentSEOJob> {
    const response = await apiClient.post<APIResponse<AIAgentSEOJob>>(`/admin/ai-agent/seo/jobs/${encodeURIComponent(id)}/resume`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to resume AI SEO job');
  }

  static async endPausedSEOJob(id: string): Promise<AIAgentSEOJob> {
    const response = await apiClient.post<APIResponse<AIAgentSEOJob>>(`/admin/ai-agent/seo/jobs/${encodeURIComponent(id)}/end`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to end paused AI SEO job');
  }

  static async listSEOJobs(): Promise<AIAgentSEOJob[]> {
    const response = await apiClient.get<APIResponse<AIAgentSEOJob[]>>('/admin/ai-agent/seo/jobs');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load AI SEO jobs');
  }

  static async getSEOStats(): Promise<AIAgentSEOStats> {
    const response = await apiClient.get<APIResponse<AIAgentSEOStats>>('/admin/ai-agent/seo/stats');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load AI SEO statistics');
  }

  static async auditSEO(): Promise<ProductSEOAudit> {
    const response = await apiClient.post<APIResponse<ProductSEOAudit>>(
      '/admin/ai-agent/seo/audit',
      {},
      // The audit walks the whole catalog; do not let the global timeout cut it off.
      { timeout: 0 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'SEO audit failed');
  }

  static async startSEOAutoFix(focus: AIAgentSEOFocus[] = ['seo']): Promise<AIAgentSEOAutoFixResult> {
    const response = await apiClient.post<APIResponse<AIAgentSEOAutoFixResult>>(
      '/admin/ai-agent/seo/auto-fix',
      { focus },
      { timeout: 0 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to start the one-click SEO fix');
  }

  static async optimizeCategorySEO(payload: { limit?: number; after_id?: number; force?: boolean }): Promise<AICategorySEOBatch> {
    const response = await apiClient.post<APIResponse<AICategorySEOBatch>>(
      '/admin/ai-agent/category-seo',
      payload,
      // Each batch performs several LLM calls.
      { timeout: 0 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Category SEO batch failed');
  }
}

export default AIAgentService;
