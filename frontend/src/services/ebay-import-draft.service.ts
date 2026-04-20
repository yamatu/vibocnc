import { apiClient } from '@/lib/api';
import {
  APIResponse,
  EbayImportDraftDetail,
  EbayImportDraftListResponse,
  EbayImportDraftUpdateRequest,
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

  static async bulkConfirm(ids: number[], action?: string): Promise<EbayImportDraftBulkConfirmResponse> {
    const response = await apiClient.post<APIResponse<EbayImportDraftBulkConfirmResponse>>(
      '/admin/ebay-import-drafts/bulk-confirm',
      { ids, action }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to bulk confirm eBay import drafts');
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
    const response = await apiClient.delete<APIResponse<{ deleted: number }>>('/admin/ebay-import-drafts/bulk', {
      data: { ids },
    });
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to bulk delete eBay import drafts');
  }
}

export default EbayImportDraftService;
