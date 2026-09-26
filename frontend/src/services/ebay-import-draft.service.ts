import { apiClient } from '@/lib/api';
import type { AxiosProgressEvent } from 'axios';
import {
  APIResponse,
  EbayImportDraftDetail,
  EbayImportDraftListResponse,
  EbayImportDraftUpdateRequest,
  EbayBulkConfirmTaskSnapshot,
  Product,
} from '@/types';

export interface EbayImportDraftFilters {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string;
  match_status?: string;
  brand?: string;
  /**
   * Filter by automated review state. `ready` lists the drafts whose AI proposal
   * is waiting for approval; `unreviewed` lists the rest.
   */
  ai_review_status?: string;
}

/**
 * Automated AI review.
 *
 * A review pass reads each draft, identifies the part, resolves or creates a
 * `Brand > Component type` category, and writes a complete proposal. Nothing is
 * published until approveReview is called, which is what keeps an automated
 * pass from silently creating indexed product pages.
 */
export interface EbayDraftReviewJob {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  ready: number;
  rejected: number;
  failed: number;
  stage?: string;
  message?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

/** One log line of a review pass. */
export interface EbayDraftReviewJobItem {
  id: number;
  job_id: string;
  draft_id: number;
  model?: string;
  title?: string;
  status: 'queued' | 'running' | 'ready' | 'rejected' | 'failed';
  level: 'info' | 'success' | 'warn' | 'error';
  message?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

/** A review job plus its log, returned by one poll. */
export interface EbayDraftReviewJobSnapshot {
  job: EbayDraftReviewJob;
  items: EbayDraftReviewJobItem[];
}

/** Counts of drafts by review state, for the queue header. */
export interface EbayDraftReviewSummary {
  counts: Record<string, number>;
  total: number;
}

export interface EbayImportDraftConfirmResponse {
  draft?: EbayImportDraftDetail;
  product?: Product;
  created?: boolean;
}

export interface EbayImportDraftBulkConfirmResultItem {
  id: number;
  success: boolean;
  status_code: number;
  error?: string;
  data?: EbayImportDraftConfirmResponse;
}

export interface EbayImportDraftBulkConfirmResponse {
  success_count: number;
  total: number;
  results: EbayImportDraftBulkConfirmResultItem[];
}

export interface EbayImportDraftSelectionResponse {
  ids: number[];
  total: number;
  /** True when the matching set was larger than the server-side id cap. */
  truncated?: boolean;
  limit?: number;
}

export interface EbayImportDraftUploadResult {
  draft_id?: number;
  title: string;
  match_status: string;
  status: string;
  errors?: string[];
}

export interface EbayImportDraftUploadResponse {
  total: number;
  success_count: number;
  error_count: number;
  results: EbayImportDraftUploadResult[];
}

export interface EbayImportDraftJSONTaskSnapshot {
  id: string;
  status: 'uploading' | 'queued' | 'processing' | 'paused' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  filename: string;
  file_size: number;
  uploaded_bytes: number;
  chunk_size: number;
  input_offset: number;
  progress_pct: number;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  message?: string;
  error?: string;
  errors?: string[];
  created_at: string;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
}

const MAX_JSON_IMPORT_BYTES = 1024 * 1024 * 1024;
const MAX_JSON_IMPORT_CHUNK_BYTES = 8 * 1024 * 1024;

async function buildJSONImportFingerprint(file: File): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
  // Hash a bounded sample so computing the resumable-upload identity does not
  // require reading a 1 GiB file into browser memory.
  const sampleSize = Math.min(1024 * 1024, file.size);
  const first = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
  const lastStart = Math.max(0, file.size - sampleSize);
  const last = new Uint8Array(await file.slice(lastStart, file.size).arrayBuffer());
  const metadata = new TextEncoder().encode(`${file.name}\u0000${file.size}\u0000${lastStart}`);
  const combined = new Uint8Array(metadata.length + first.length + last.length);
  combined.set(metadata, 0);
  combined.set(first, metadata.length);
  combined.set(last, metadata.length + first.length);
  const digest = new Uint8Array(await subtle.digest('SHA-256', combined));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export class EbayImportDraftService {
  static async list(filters: EbayImportDraftFilters = {}): Promise<EbayImportDraftListResponse> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });

    const query = params.toString();
    const response = await apiClient.get<APIResponse<EbayImportDraftListResponse>>(
      `/admin/ebay-import-drafts${query ? `?${query}` : ''}`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to fetch eBay import drafts');
  }

  static async selectionIds(filters: EbayImportDraftFilters = {}, eligibleOnly = false): Promise<EbayImportDraftSelectionResponse> {
    const response = await apiClient.post<APIResponse<EbayImportDraftSelectionResponse>>(
      '/admin/ebay-import-drafts/selection-ids',
      {
        search: filters.search || '',
        status: filters.status || '',
        match_status: filters.match_status || '',
        brand: filters.brand || '',
        eligible_only: eligibleOnly,
      }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to fetch draft selection');
  }

  static async upload(items: Record<string, unknown>[]): Promise<EbayImportDraftUploadResponse> {
    const response = await apiClient.post<APIResponse<EbayImportDraftUploadResponse>>(
      '/admin/ebay-import-drafts/upload',
      { items }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to import eBay draft JSON');
  }

  static async startJSONImport(file: File, onUploadProgress?: (progressPct: number) => void): Promise<EbayImportDraftJSONTaskSnapshot> {
    if (file.size <= 0) throw new Error('JSON file is empty');
    if (file.size > MAX_JSON_IMPORT_BYTES) throw new Error('JSON file cannot exceed 1 GB');

    const fingerprint = await buildJSONImportFingerprint(file);
    const createResponse = await apiClient.post<APIResponse<EbayImportDraftJSONTaskSnapshot>>(
      '/admin/ebay-import-drafts/json-import/tasks',
      { filename: file.name, file_size: file.size, fingerprint },
      { timeout: 30000 }
    );
    if (!createResponse.data.success || !createResponse.data.data) {
      throw new Error(createResponse.data.message || 'Failed to create JSON import upload');
    }

    let task = createResponse.data.data;
    if (task.status !== 'uploading') return task;
    const chunkSize = Math.min(
      Math.max(task.chunk_size || 5 * 1024 * 1024, 1024 * 1024),
      MAX_JSON_IMPORT_CHUNK_BYTES
    );
    let offset = Math.max(0, Math.min(file.size, task.uploaded_bytes || 0));
    const report = (uploadedBytes: number) => {
      const bounded = Math.max(0, Math.min(file.size, uploadedBytes));
      onUploadProgress?.(Math.round((bounded * 100) / file.size));
    };
    report(offset);

    while (offset < file.size) {
      const chunkStart = offset;
      const chunkEnd = Math.min(file.size, chunkStart + chunkSize);
      const chunk = file.slice(chunkStart, chunkEnd);
      let uploaded = false;
      let lastError: unknown;

      for (let attempt = 0; attempt < 4 && !uploaded; attempt += 1) {
        try {
          const response = await apiClient.put<APIResponse<EbayImportDraftJSONTaskSnapshot>>(
            `/admin/ebay-import-drafts/json-import/tasks/${encodeURIComponent(task.id)}/chunk`,
            chunk,
            {
              params: { offset: chunkStart },
              headers: { 'Content-Type': 'application/octet-stream' },
              timeout: 120000,
              onUploadProgress: (event: AxiosProgressEvent) => {
                const loaded = Math.min(event.loaded || 0, chunk.size);
                report(chunkStart + loaded);
              },
            }
          );
          if (!response.data.success || !response.data.data) {
            throw new Error(response.data.message || 'JSON chunk upload failed');
          }
          task = response.data.data;
          offset = Math.max(0, Math.min(file.size, task.uploaded_bytes || 0));
          uploaded = offset >= chunkEnd;
        } catch (error: unknown) {
          lastError = error;
          try {
            task = await this.getJSONImportTask(task.id);
            offset = Math.max(0, Math.min(file.size, task.uploaded_bytes || 0));
            report(offset);
          } catch (statusError: unknown) {
            lastError = statusError;
          }
          if (offset >= chunkEnd) {
            uploaded = true;
            break;
          }
          if (offset !== chunkStart) {
            throw new Error('Server upload offset changed; reselect the same JSON file to resume');
          }
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
      }
      if (!uploaded) {
        throw lastError instanceof Error ? lastError : new Error('JSON upload failed after retries');
      }
      report(offset);
    }

    try {
      const completeResponse = await apiClient.post<APIResponse<EbayImportDraftJSONTaskSnapshot>>(
        `/admin/ebay-import-drafts/json-import/tasks/${encodeURIComponent(task.id)}/complete`,
        {},
        { timeout: 30000 }
      );
      if (completeResponse.data.success && completeResponse.data.data) return completeResponse.data.data;
      throw new Error(completeResponse.data.message || 'Failed to queue JSON import task');
    } catch (error: unknown) {
      // A proxy can drop the response after the server has queued the job.
      // Resolve the durable state before showing a false upload failure.
      try {
        const latest = await this.getJSONImportTask(task.id);
        if (latest.status !== 'uploading') return latest;
      } catch {
        // Preserve the original error when the status request also fails.
      }
      throw error;
    }
  }

  static async getJSONImportTask(taskId: string): Promise<EbayImportDraftJSONTaskSnapshot> {
    const response = await apiClient.get<APIResponse<EbayImportDraftJSONTaskSnapshot>>(
      `/admin/ebay-import-drafts/json-import/tasks/${encodeURIComponent(taskId)}`
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to fetch JSON import task');
  }

  static async getLatestJSONImportTask(): Promise<EbayImportDraftJSONTaskSnapshot | null> {
    const response = await apiClient.get<APIResponse<EbayImportDraftJSONTaskSnapshot | null>>(
      '/admin/ebay-import-drafts/json-import/tasks/latest'
    );
    if (response.data.success) return response.data.data || null;
    throw new Error(response.data.message || 'Failed to fetch latest JSON import task');
  }

  static async pauseJSONImportTask(taskId: string): Promise<EbayImportDraftJSONTaskSnapshot> {
    const response = await apiClient.post<APIResponse<EbayImportDraftJSONTaskSnapshot>>(
      `/admin/ebay-import-drafts/json-import/tasks/${encodeURIComponent(taskId)}/pause`
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to pause JSON import task');
  }

  static async resumeJSONImportTask(taskId: string): Promise<EbayImportDraftJSONTaskSnapshot> {
    const response = await apiClient.post<APIResponse<EbayImportDraftJSONTaskSnapshot>>(
      `/admin/ebay-import-drafts/json-import/tasks/${encodeURIComponent(taskId)}/resume`
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to resume JSON import task');
  }

  static async cancelJSONImportTask(taskId: string): Promise<EbayImportDraftJSONTaskSnapshot> {
    const response = await apiClient.delete<APIResponse<EbayImportDraftJSONTaskSnapshot>>(
      `/admin/ebay-import-drafts/json-import/tasks/${encodeURIComponent(taskId)}`
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to cancel JSON import task');
  }

  static async get(id: number): Promise<EbayImportDraftDetail> {
    const response = await apiClient.get<APIResponse<EbayImportDraftDetail>>(`/admin/ebay-import-drafts/${id}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to fetch eBay import draft');
  }

  static async update(id: number, payload: EbayImportDraftUpdateRequest): Promise<EbayImportDraftDetail> {
    const response = await apiClient.put<APIResponse<EbayImportDraftDetail>>(`/admin/ebay-import-drafts/${id}`, payload);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to update eBay import draft');
  }

  static async recheck(id: number): Promise<EbayImportDraftDetail> {
    const response = await apiClient.post<APIResponse<EbayImportDraftDetail>>(`/admin/ebay-import-drafts/${id}/recheck`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to recheck eBay import draft');
  }

  static async confirm(id: number, action?: string): Promise<EbayImportDraftConfirmResponse> {
    const response = await apiClient.post<APIResponse<EbayImportDraftConfirmResponse>>(
      `/admin/ebay-import-drafts/${id}/confirm`,
      action ? { action } : {}
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to confirm eBay import draft');
  }

  static async bulkConfirm(ids: number[], action?: string): Promise<EbayBulkConfirmTaskSnapshot> {
    const response = await apiClient.post<APIResponse<EbayBulkConfirmTaskSnapshot>>(
      '/admin/ebay-import-drafts/bulk-confirm',
      { ids, action }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to start bulk confirm task');
  }

  static async getBulkConfirmTask(taskId: string): Promise<EbayBulkConfirmTaskSnapshot> {
    const response = await apiClient.get<APIResponse<EbayBulkConfirmTaskSnapshot>>(
      `/admin/ebay-import-drafts/bulk-confirm/tasks/${encodeURIComponent(taskId)}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to get bulk confirm task status');
  }

  static async getLatestBulkConfirmTask(): Promise<EbayBulkConfirmTaskSnapshot | null> {
    const response = await apiClient.get<APIResponse<EbayBulkConfirmTaskSnapshot | null>>(
      '/admin/ebay-import-drafts/bulk-confirm/tasks/latest'
    );
    if (response.data.success) return response.data.data || null;
    throw new Error(response.data.message || 'Failed to get latest bulk confirm task');
  }

  static async pauseBulkConfirmTask(taskId: string): Promise<EbayBulkConfirmTaskSnapshot> {
    const response = await apiClient.post<APIResponse<EbayBulkConfirmTaskSnapshot>>(
      `/admin/ebay-import-drafts/bulk-confirm/tasks/${encodeURIComponent(taskId)}/pause`
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to pause bulk confirm task');
  }

  static async resumeBulkConfirmTask(taskId: string): Promise<EbayBulkConfirmTaskSnapshot> {
    const response = await apiClient.post<APIResponse<EbayBulkConfirmTaskSnapshot>>(
      `/admin/ebay-import-drafts/bulk-confirm/tasks/${encodeURIComponent(taskId)}/resume`
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to resume bulk confirm task');
  }

  static async bulkRecheck(ids: number[]): Promise<{ updated: number; total: number }> {
    const response = await apiClient.post<APIResponse<{ updated: number; total: number }>>(
      '/admin/ebay-import-drafts/bulk-recheck',
      { ids }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to bulk recheck eBay import drafts');
  }

  static async delete(id: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<void>>(`/admin/ebay-import-drafts/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to delete eBay import draft');
    }
  }

  static async bulkDelete(ids: number[]): Promise<{ deleted: number }> {
    // Use the POST compatibility endpoint because some reverse proxies strip
    // or reject JSON request bodies on DELETE. The legacy DELETE endpoint
    // remains available for older clients.
    const response = await apiClient.post<APIResponse<{ deleted: number }>>('/admin/ebay-import-drafts/bulk-delete', { ids });
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to bulk delete eBay import drafts');
  }

  /**
   * Delete every draft matching the current filters, described as a filter
   * rather than a list of ids.
   *
   * "Select all" in a review queue can address more rows than a request body or
   * a single `WHERE id IN (...)` can carry, which is why the id-array path
   * returned 500 once the queue grew. Sending the filter keeps the request tiny
   * and deletes the exact set the admin is looking at.
   */
  static async bulkDeleteByFilter(
    filters: EbayImportDraftFilters = {},
    statuses: string[]
  ): Promise<{ deleted: number; matched: number }> {
    const response = await apiClient.post<APIResponse<{ deleted: number; matched: number }>>(
      '/admin/ebay-import-drafts/bulk-delete',
      {
        delete_all_selected: true,
        search: filters.search || '',
        status: filters.status || '',
        match_status: filters.match_status || '',
        brand: filters.brand || '',
        statuses,
      }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to bulk delete eBay import drafts');
  }

  // ------------------------------------------------------------ AI review --

  /**
   * Start an automated review pass.
   *
   * Pass explicit ids when the admin selected rows, or `allFiltered` with the
   * active filters to review everything matching the current view. The server
   * re-reads the drafts either way, so a stale page cannot queue rows that have
   * since been imported.
   */
  static async startAIReview(payload: {
    ids?: number[];
    all_filtered?: boolean;
    search?: string;
    status?: string;
    match_status?: string;
    brand?: string;
    ai_review_status?: string;
  }): Promise<EbayDraftReviewJob> {
    const response = await apiClient.post<APIResponse<EbayDraftReviewJob>>(
      '/admin/ebay-import-drafts/ai-review',
      payload
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to start AI review');
  }

  /** Poll one review job together with its log lines. */
  static async getAIReviewJob(jobId: string, logLimit = 500): Promise<EbayDraftReviewJobSnapshot> {
    const response = await apiClient.get<APIResponse<EbayDraftReviewJobSnapshot>>(
      `/admin/ebay-import-drafts/ai-review/${jobId}`,
      { params: { log_limit: logLimit } }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to load AI review job');
  }

  /**
   * Reconnect to an in-flight pass after a page reload. Without this a long run
   * looks like it disappeared.
   */
  static async getLatestAIReviewJob(logLimit = 500): Promise<EbayDraftReviewJobSnapshot | null> {
    const response = await apiClient.get<APIResponse<EbayDraftReviewJobSnapshot | null>>(
      '/admin/ebay-import-drafts/ai-review/latest',
      { params: { log_limit: logLimit } }
    );
    if (response.data.success) {
      return response.data.data ?? null;
    }
    throw new Error(response.data.message || 'Failed to load the latest AI review job');
  }

  static async pauseAIReviewJob(jobId: string): Promise<EbayDraftReviewJob> {
    const response = await apiClient.post<APIResponse<EbayDraftReviewJob>>(
      `/admin/ebay-import-drafts/ai-review/${jobId}/pause`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to pause the AI review job');
  }

  static async resumeAIReviewJob(jobId: string): Promise<EbayDraftReviewJob> {
    const response = await apiClient.post<APIResponse<EbayDraftReviewJob>>(
      `/admin/ebay-import-drafts/ai-review/${jobId}/resume`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to resume the AI review job');
  }

  static async cancelAIReviewJob(jobId: string): Promise<EbayDraftReviewJob> {
    const response = await apiClient.post<APIResponse<EbayDraftReviewJob>>(
      `/admin/ebay-import-drafts/ai-review/${jobId}/cancel`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to cancel the AI review job');
  }

  /** Counts of drafts by review state, for the queue header. */
  static async getAIReviewSummary(): Promise<EbayDraftReviewSummary> {
    const response = await apiClient.get<APIResponse<EbayDraftReviewSummary>>(
      '/admin/ebay-import-drafts/ai-review/summary'
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to load the AI review summary');
  }

  /**
   * Publish approved proposals. This is the only call that creates products from
   * a reviewed draft.
   */
  static async approveAIReview(
    ids: number[],
    action?: string
  ): Promise<EbayBulkConfirmTaskSnapshot> {
    const response = await apiClient.post<APIResponse<EbayBulkConfirmTaskSnapshot>>(
      '/admin/ebay-import-drafts/ai-review/approve',
      { ids, action }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to approve the reviewed drafts');
  }

  /** Discard proposals. The listings stay in the queue for a human. */
  static async rejectAIReview(ids: number[], reason?: string): Promise<{ rejected: number }> {
    const response = await apiClient.post<APIResponse<{ rejected: number }>>(
      '/admin/ebay-import-drafts/ai-review/reject',
      { ids, reason }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to reject the reviewed drafts');
  }
}

export default EbayImportDraftService;
