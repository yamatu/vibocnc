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
  status: 'queued' | 'processing' | 'paused' | 'completed' | 'failed';
  filename: string;
  file_size: number;
  progress_pct: number;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  message?: string;
  errors?: string[];
  created_at: string;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
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
    const response = await apiClient.post<APIResponse<EbayImportDraftJSONTaskSnapshot>>(
      `/admin/ebay-import-drafts/json-import?filename=${encodeURIComponent(file.name)}`,
      file,
      {
        headers: { 'Content-Type': file.type || 'application/json' },
        timeout: 0,
        onUploadProgress: (event: AxiosProgressEvent) => {
          if (!onUploadProgress || !event.total) return;
          onUploadProgress(Math.min(100, Math.max(0, Math.round((event.loaded * 100) / event.total))));
        },
      }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to start JSON import task');
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
}

export default EbayImportDraftService;
