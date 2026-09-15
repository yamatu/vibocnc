import { apiClient } from '@/lib/api';
import type {
  APIResponse,
  PaginationResponse,
  ProductSpecDraft,
  ProductSpecDraftDetail,
  SpecDraftApproveRequest,
  SpecResearchBatchOutcome,
  SpecResearchBatchRequest,
  SpecResearchCandidate,
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
  static async research(payload: SpecResearchRequest): Promise<ProductSpecDraft> {
    const { product_id, ...rest } = payload;
    const url = product_id ? `/admin/products/${product_id}/spec-research` : '/admin/products/spec-research';
    const res = await apiClient.post<APIResponse<ProductSpecDraft>>(url, rest);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Specification research failed');
  }

  static async researchBatch(payload: SpecResearchBatchRequest): Promise<{
    requested: number;
    processed: number;
    limit: number;
    results: SpecResearchBatchOutcome[];
  }> {
    const res = await apiClient.post<
      APIResponse<{ requested: number; processed: number; limit: number; results: SpecResearchBatchOutcome[] }>
    >('/admin/products/spec-research/batch', payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Batch specification research failed');
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
