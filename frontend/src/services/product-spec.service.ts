import { apiClient } from '@/lib/api';
import { AIAgentService, type AIAgentSEOJob, type AIAgentSEOJobItemsPage } from '@/services/ai-agent.service';
import type {
  APIResponse,
  PaginationResponse,
  ProductSpecDraft,
  ProductSpecDraftDetail,
  SpecDraftApproveRequest,
  SpecResearchCandidate,
  SpecResearchItemPayload,
  SpecResearchJobRequest,
  SpecResearchRequest,
} from '@/types';

/**
 * Model-number specification research.
 *
 * These endpoints only ever create or close *drafts*. Publishing a parameter to
 * the storefront happens exclusively through `approveDraft`, so the catalogue
 * cannot change without a human review step.
 */
export class ProductSpecService {
  /**
   * Researches a model number that has no product row yet.
   *
   * This is the only synchronous entry point. Catalogue products go through
   * `startResearchJob` (or `startProductResearchJob`) so a slow lookup cannot
   * block an HTTP request and so the run survives a restart.
   */
  static async research(payload: SpecResearchRequest): Promise<ProductSpecDraft> {
    const res = await apiClient.post<APIResponse<ProductSpecDraft>>('/admin/products/spec-research', payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Specification research failed');
  }

  /** Queues research for a filtered product scope (AI job queue). */
  static async startResearchJob(payload: SpecResearchJobRequest): Promise<AIAgentSEOJob> {
    return AIAgentService.startSpecResearchJob(payload);
  }

  /** Queues research for the given products. Used by the product list action. */
  static async startBatchResearchJob(payload: SpecResearchJobRequest): Promise<AIAgentSEOJob> {
    const res = await apiClient.post<APIResponse<AIAgentSEOJob>>('/admin/products/spec-research/batch', payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Batch specification research failed');
  }

  /** Queues research for a single catalogue product. */
  static async startProductResearchJob(productId: number, payload: SpecResearchJobRequest = {}): Promise<AIAgentSEOJob> {
    const res = await apiClient.post<APIResponse<AIAgentSEOJob>>(
      `/admin/products/${productId}/spec-research`,
      payload,
    );
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Specification research failed');
  }

  static async getResearchJob(id: string): Promise<AIAgentSEOJob> {
    return AIAgentService.getSEOJob(id);
  }

  static async listResearchJobItems(id: string, limit = 200, offset = 0, status = ''): Promise<AIAgentSEOJobItemsPage> {
    return AIAgentService.listSEOJobItems(id, limit, offset, status);
  }

  static async pauseResearchJob(id: string): Promise<AIAgentSEOJob> {
    return AIAgentService.pauseSEOJob(id);
  }

  static async resumeResearchJob(id: string): Promise<AIAgentSEOJob> {
    return AIAgentService.resumeSEOJob(id);
  }

  static async endResearchJob(id: string): Promise<AIAgentSEOJob> {
    return AIAgentService.endPausedSEOJob(id);
  }

  /** Reads the per-item summary the job worker stored (draft id, conflicts). */
  static parseItemPayload(item: { evidence_json?: string }): SpecResearchItemPayload | null {
    if (!item.evidence_json) return null;
    try {
      const parsed = JSON.parse(item.evidence_json) as SpecResearchItemPayload;
      return typeof parsed?.draft_id === 'number' ? parsed : null;
    } catch {
      return null;
    }
  }

  static async listDrafts(params: {
    status?: string;
    search?: string;
    product_id?: number;
    page?: number;
    page_size?: number;
  } = {}): Promise<PaginationResponse<ProductSpecDraft>> {
    const res = await apiClient.get<APIResponse<PaginationResponse<ProductSpecDraft>>>('/admin/products/spec-drafts', {
      params,
    });
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load specification drafts');
  }

  static async getDraft(id: number): Promise<ProductSpecDraftDetail> {
    const res = await apiClient.get<APIResponse<ProductSpecDraftDetail>>(`/admin/products/spec-drafts/${id}`);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load specification draft');
  }

  static async approveDraft(
    id: number,
    payload: SpecDraftApproveRequest = {},
  ): Promise<{ draft: ProductSpecDraft; added: number; skipped: number; technical_specs: string }> {
    const res = await apiClient.post<
      APIResponse<{ draft: ProductSpecDraft; added: number; skipped: number; technical_specs: string }>
    >(`/admin/products/spec-drafts/${id}/approve`, payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to apply specification draft');
  }

  static async rejectDraft(id: number, reason = ''): Promise<ProductSpecDraft> {
    const res = await apiClient.post<APIResponse<ProductSpecDraft>>(`/admin/products/spec-drafts/${id}/reject`, { reason });
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to reject specification draft');
  }

  /** Convenience: trim empty rows before sending a reviewer-edited list. */
  static sanitizeCandidates(candidates: SpecResearchCandidate[]): SpecResearchCandidate[] {
    return candidates
      .map((candidate) => ({ ...candidate, label: candidate.label.trim(), value: candidate.value.trim() }))
      .filter((candidate) => candidate.label !== '' && candidate.value !== '');
  }
}
