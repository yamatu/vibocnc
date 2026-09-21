import { apiClient, authUtils } from '@/lib/api';
import { APIResponse } from '@/types';

export type AIAgentActionType =
  | 'create_category'
  | 'create_product'
  | 'update_product'
  | 'update_product_price'
  | 'upsert_product_translation'
  | 'upsert_category_translation'
  | 'assign_product_category'
  | 'start_category_optimization';

export interface AIAgentAction {
  type: AIAgentActionType;
  title: string;
  data: Record<string, unknown>;
}

export interface AIAgentMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: AIAgentAction[];
  toolCalls?: AIAgentToolCall[];
  steps?: AIAgentStreamStep[];
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

export interface AIAgentToolProbeResult {
  ok: boolean;
  agent_tools_enabled: boolean;
  tools_supported: boolean;
  tool_call_returned: boolean;
  tools_called?: string[];
  turns: number;
  latency_ms: number;
  model: string;
  provider: string;
  reply?: string;
  hint?: string;
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

export interface AIAgentToolCall {
  tool: string;
  detail: string;
  error?: string;
}

/** One tool execution shown in the live step timeline. */
export interface AIAgentStreamStep {
  id: string;
  tool: string;
  detail: string;
  status: 'running' | 'ok' | 'error';
  duration_ms?: number;
  error?: string;
}

/** Callbacks for the streaming chat endpoint (progress is pushed live). */
export interface AIAgentStreamHandlers {
  onStage?: (stage: string) => void;
  onStepStart?: (step: { id: string; tool: string; detail: string }) => void;
  onStepEnd?: (step: { id: string; tool: string; status: 'ok' | 'error'; duration_ms: number; error?: string }) => void;
  onNote?: (text: string) => void;
  onDelta?: (text: string) => void;
  onHello?: (info: { conversation_id: number; resumed?: boolean }) => void;
  onIdle?: () => void;
}

export interface AIAgentReply {
  reply: string;
  suggestions: AIAgentAction[];
  tool_calls?: AIAgentToolCall[];
  conversation_id?: number;
}

/** One persisted chat session shown in the history panel. */
export interface AIAgentConversationSummary {
  id: number;
  title: string;
  status: string;
  updated_at: string;
}

/** One stored message of a conversation, as returned by the backend. */
export interface AIAgentStoredMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  steps?: AIAgentStreamStep[];
  suggestions?: AIAgentAction[];
  tool_calls?: AIAgentToolCall[];
  created_at?: string;
}

export interface AIAgentConversation {
  id: number;
  title: string;
  status: string;
  messages: AIAgentStoredMessage[];
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
export type AIAgentSEOItemStatus = 'queued' | 'running' | 'optimized' | 'unresolved' | 'failed' | 'cancelled';

export interface AIAgentSEOJobItem {
  id: number;
  job_id: string;
  product_id: number;
  sku: string;
  status: AIAgentSEOItemStatus;
  error?: string;
  classification_status?: string;
  classification_rule?: string;
  evidence_json?: string;
  created_at: string;
  updated_at: string;
}

export interface AIAgentSEOJob {
  id: string;
  prompt: string;
  focus?: AIAgentSEOFocus[];
  selection_mode: 'selected' | 'auto_candidates' | 'auto_failed' | 'category_optimization' | 'spec_research';
  status: AIAgentSEOJobStatus;
  ai_profile_id?: number;
  ai_profile_name?: string;
  ai_model?: string;
  ai_api_mode?: 'standard_chat' | 'reasoning_chat';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  unresolved?: number;
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
  unresolved?: number;
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

/**
 * Scope of a model-number specification research job. The job only writes review
 * drafts; nothing reaches the storefront without an explicit approval.
 */
export interface AIAgentSpecResearchOptions {
  product_ids?: number[];
  limit?: number;
  category_id?: number;
  include_descendants?: boolean;
  brand?: string;
  search?: string;
  include_inactive?: boolean;
  /** Skip products that already publish a specification table. */
  only_missing?: boolean;
  /** Add the language-model extraction pass on top of pattern extraction. */
  use_ai?: boolean;
  /** Re-run research even when a pending draft already exists. */
  force?: boolean;
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

/**
 * Classification states that still need an administrator's decision. Anything
 * the pipeline could verify is written as `completed` and never appears here.
 */
export type AIClassificationReviewStatus = 'needs_review' | 'conflict' | 'unresolved';

export interface AIClassificationReviewEvidence {
  title?: string;
  url?: string;
  snippet?: string;
  source_type?: string;
  evidence_level?: string;
}

/** The candidate the classifier proposed, as stored next to the product. */
export interface AIClassificationReviewPayload {
  source?: string;
  confirmed?: boolean;
  conflict?: boolean;
  confidence?: number;
  reason?: string;
  brand?: string;
  brand_key?: string;
  part_type?: string;
  model_family?: string;
  category_slug?: string;
  match_rule?: string;
  search_error?: string;
  evidence?: AIClassificationReviewEvidence[];
}

export interface AIClassificationReviewItem {
  item_id: number;
  job_id: string;
  product_id: number;
  sku: string;
  product_name: string;
  brand: string;
  model: string;
  category_id: number;
  category_path: string;
  is_active: boolean;
  classification_status: AIClassificationReviewStatus;
  classification_rule?: string;
  review?: AIClassificationReviewPayload | AIClassificationReviewEvidence[];
  error?: string;
  updated_at: string;
}

export interface AIClassificationReviewPage {
  items: AIClassificationReviewItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AIClassificationReviewDecision {
  item_id: number;
  product_id: number;
  category_id?: number;
  category_path?: string;
  status?: string;
}

interface AIAgentStreamState {
  final: AIAgentReply | null;
  error: string;
}

type AIAgentSSECallback = (event: string, payload: Record<string, unknown>) => void;

function dispatchAIAgentSSEBlock(block: string, onEvent: AIAgentSSECallback) {
  let eventName = '';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '' || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (!eventName || dataLines.length === 0) return;
  try {
    onEvent(eventName, JSON.parse(dataLines.join('\n')) as Record<string, unknown>);
  } catch {
    // Ignore malformed frames; the final event remains the source of truth.
  }
}

async function readAIAgentSSE(response: Response, onEvent: AIAgentSSECallback): Promise<void> {
  if (!response.body) throw new Error('AI stream is unavailable in this browser');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      dispatchAIAgentSSEBlock(buffer.slice(0, separator), onEvent);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) dispatchAIAgentSSEBlock(buffer.trim(), onEvent);
}

function handleAIAgentStreamEvent(name: string, payload: Record<string, unknown>, state: AIAgentStreamState, handlers: AIAgentStreamHandlers) {
  switch (name) {
    case 'hello':
      handlers.onHello?.({ conversation_id: Number(payload.conversation_id ?? 0), resumed: Boolean(payload.resumed) });
      break;
    case 'idle':
      handlers.onIdle?.();
      break;
    case 'stage':
      if (typeof payload.stage === 'string') handlers.onStage?.(payload.stage);
      break;
    case 'note':
      if (typeof payload.text === 'string') handlers.onNote?.(payload.text);
      break;
    case 'delta':
      if (typeof payload.text === 'string') handlers.onDelta?.(payload.text);
      break;
    case 'step_start':
      handlers.onStepStart?.({
        id: String(payload.id ?? ''),
        tool: String(payload.tool ?? ''),
        detail: typeof payload.detail === 'string' ? payload.detail : '',
      });
      break;
    case 'step_end':
      handlers.onStepEnd?.({
        id: String(payload.id ?? ''),
        tool: String(payload.tool ?? ''),
        status: payload.status === 'error' ? 'error' : 'ok',
        duration_ms: typeof payload.duration_ms === 'number' ? payload.duration_ms : 0,
        error: typeof payload.error === 'string' && payload.error ? payload.error : undefined,
      });
      break;
    case 'final':
      state.final = payload as unknown as AIAgentReply;
      break;
    case 'error':
      if (typeof payload.message === 'string') state.error = payload.message;
      break;
    default:
      break;
  }
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

  // Verifies that the provider accepts the tools field the agent loop sends. A
  // provider that rejects it is downgraded automatically, but knowing this up
  // front avoids paying a failed request on the first real question.
  static async testToolCalling(payload: AIAgentConnectionTestRequest): Promise<AIAgentToolProbeResult> {
    const response = await apiClient.post<APIResponse<AIAgentToolProbeResult>>(
      '/admin/ai-agent/test-tools',
      payload,
      { timeout: 90000 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to probe tool calling support');
  }

  static async chat(message: string, options: { conversationId?: number | null; history?: AIAgentMessage[] } = {}): Promise<AIAgentReply> {
    const body: Record<string, unknown> = { message };
    if (options.conversationId) body.conversation_id = options.conversationId;
    if (options.history?.length) {
      body.history = options.history.slice(-8).map(({ role, content }) => ({ role, content }));
    }
    const response = await apiClient.post<APIResponse<AIAgentReply>>('/admin/ai-agent/chat', body);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'AI assistant could not create a proposal');
  }

  /**
   * Streaming chat. The backend persists the conversation and emits progress
   * events while the agent runs (hello / stage / step_start / step_end / note /
   * delta) and one `final` event with the same payload shape as chat(). fetch
   * is used so the POST body and the HttpOnly session cookie work exactly like
   * the axios calls; a caller that fails before any event arrives may fall
   * back to the classic chat().
   */
  static async chatStream(
    message: string,
    options: { conversationId?: number | null; handlers: AIAgentStreamHandlers; signal?: AbortSignal }
  ): Promise<AIAgentReply> {
    const { conversationId = null, handlers, signal } = options;
    const token = authUtils.getToken();
    const response = await fetch('/api/v1/admin/ai-agent/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, ...(conversationId ? { conversation_id: conversationId } : {}) }),
      signal,
    });
    if (!response.ok || !response.body) {
      let detail = '';
      try {
        const data = (await response.json()) as { error?: string; message?: string };
        detail = data.error || data.message || '';
      } catch {
        // Non-JSON error body; keep the generic message.
      }
      throw new Error(detail || `AI stream failed (${response.status})`);
    }
    const state: AIAgentStreamState = { final: null, error: '' };
    await readAIAgentSSE(response, (event, payload) => handleAIAgentStreamEvent(event, payload, state, handlers));
    if (state.error && !state.final) throw new Error(state.error);
    if (!state.final) throw new Error('AI stream ended before the final proposal arrived');
    return state.final;
  }

  /**
   * Re-attaches to the live run of a conversation after a refresh, a page
   * navigation or a re-opened tab. Buffered events replay from `after` and the
   * stream then follows the run to its end. Resolves with null when the server
   * has no buffered run (already finished or never started).
   */
  static async resumeStream(conversationId: number, after: number, handlers: AIAgentStreamHandlers, signal?: AbortSignal): Promise<AIAgentReply | null> {
    const token = authUtils.getToken();
    const response = await fetch(`/api/v1/admin/ai-agent/conversations/${conversationId}/stream?after=${after}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Could not resume the AI stream (${response.status})`);
    }
    const state: AIAgentStreamState = { final: null, error: '' };
    await readAIAgentSSE(response, (event, payload) => handleAIAgentStreamEvent(event, payload, state, handlers));
    if (state.error && !state.final) throw new Error(state.error);
    return state.final;
  }

  static async conversations(): Promise<AIAgentConversationSummary[]> {
    const response = await apiClient.get<APIResponse<AIAgentConversationSummary[]>>('/admin/ai-agent/conversations');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load chat history');
  }

  static async conversation(id: number): Promise<AIAgentConversation> {
    const response = await apiClient.get<APIResponse<AIAgentConversation>>(`/admin/ai-agent/conversations/${id}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load the conversation');
  }

  static async deleteConversation(id: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<null>>(`/admin/ai-agent/conversations/${id}`);
    if (!response.data.success) throw new Error(response.data.message || 'Unable to delete the conversation');
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

  static async startSpecResearchJob(options: AIAgentSpecResearchOptions): Promise<AIAgentSEOJob> {
    const response = await apiClient.post<APIResponse<AIAgentSEOJob>>('/admin/ai-agent/seo/spec-jobs', options);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to start specification research job');
  }

  static async getSEOJob(id: string): Promise<AIAgentSEOJob> {
    const response = await apiClient.get<APIResponse<AIAgentSEOJob>>(`/admin/ai-agent/seo/jobs/${encodeURIComponent(id)}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load AI SEO job');
  }

  static async listSEOJobItems(id: string, limit = 200, offset = 0, status = ""): Promise<AIAgentSEOJobItemsPage> {
    const response = await apiClient.get<APIResponse<AIAgentSEOJobItemsPage>>(`/admin/ai-agent/seo/jobs/${encodeURIComponent(id)}/items`, {
      params: { limit, offset, status: status || undefined },
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

  /** Candidates the pipeline refused to publish, awaiting a human decision. */
  static async listClassificationReview(params: {
    limit?: number;
    offset?: number;
    status?: AIClassificationReviewStatus | '';
    job_id?: string;
    search?: string;
  } = {}): Promise<AIClassificationReviewPage> {
    const response = await apiClient.get<APIResponse<AIClassificationReviewPage>>('/admin/ai-agent/classification/review', {
      params: {
        limit: params.limit,
        offset: params.offset,
        status: params.status || undefined,
        job_id: params.job_id || undefined,
        search: params.search || undefined,
      },
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to load the classification review queue');
  }

  /**
   * Accept a candidate. The backend applies the category and records the
   * decision as a verified rule, so the same model is classified the same way
   * next time.
   */
  static async approveClassificationReview(
    itemId: number,
    payload: { allow_new_product_types?: boolean; activate_product?: boolean; note?: string } = {}
  ): Promise<AIClassificationReviewDecision> {
    const response = await apiClient.post<APIResponse<AIClassificationReviewDecision>>(
      `/admin/ai-agent/classification/review/${itemId}/approve`,
      payload,
      // Applying a candidate can create a category and rewrite the product.
      { timeout: 0 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to approve the classification candidate');
  }

  static async dismissClassificationReview(itemId: number, note = ''): Promise<AIClassificationReviewDecision> {
    const response = await apiClient.post<APIResponse<AIClassificationReviewDecision>>(
      `/admin/ai-agent/classification/review/${itemId}/dismiss`,
      { note }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Unable to dismiss the classification candidate');
  }
}

export default AIAgentService;
