import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';

function extractApiError(error: any, fallback: string): Error {
  const responseData = error?.response?.data;
  const responseStatus = error?.response?.status;
  const rawMessage = error?.message;
  const message =
    responseData?.error ||
    responseData?.message ||
    (typeof rawMessage === 'string' && !rawMessage.startsWith('Request failed with status code')
      ? rawMessage
      : '') ||
    fallback;

  const wrapped = new Error(responseStatus ? `${message} (HTTP ${responseStatus})` : message);
  (wrapped as any).status = responseStatus;
  (wrapped as any).details = responseData;
  return wrapped;
}

export interface IndexNowSettingResponse {
  id: number;
  enabled: boolean;
  key: string;
  site_url: string;
  auto_submit_product_updates: boolean;
  key_location: string;
  host: string;
  last_submitted_at?: string | null;
  last_submission_host?: string;
  last_submission_urls?: number;
  last_submission_code?: number;
  last_submission_note?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpdateIndexNowSettingsRequest {
  enabled?: boolean;
  key?: string;
  site_url?: string;
  auto_submit_product_updates?: boolean;
}

export interface IndexNowSubmitRequest {
  urls?: string[];
  product_ids?: number[];
}

export interface IndexNowSubmitResponse {
  host: string;
  key_location: string;
  submitted_urls: number;
  status_code: number;
  response_body?: string;
  submitted_at: string;
}

export interface IndexNowProductStatusResponse {
  total_products: number;
  submitted_products: number;
  unsubmitted_products: number;
}

export interface IndexNowSubmitProductsRequest {
  mode: 'all' | 'unsubmitted';
  limit?: number;
  batch_size?: number;
}

export interface IndexNowSubmitProductsResponse {
  mode: 'all' | 'unsubmitted';
  processed_products: number;
  submitted_products: number;
  batches_completed: number;
  last_result?: IndexNowSubmitResponse;
}

export interface IndexNowVerifyKeyResponse {
  key_location: string;
  status_code: number;
  body: string;
  valid: boolean;
}

export class IndexNowService {
  static async getSettings(): Promise<IndexNowSettingResponse> {
    try {
      const res = await apiClient.get<APIResponse<IndexNowSettingResponse>>('/admin/indexnow/settings');
      if (res.data.success && res.data.data) return res.data.data;
      throw new Error(res.data.message || res.data.error || 'Failed to load IndexNow settings');
    } catch (error) {
      throw extractApiError(error, 'Failed to load IndexNow settings');
    }
  }

  static async updateSettings(payload: UpdateIndexNowSettingsRequest): Promise<IndexNowSettingResponse> {
    try {
      const res = await apiClient.put<APIResponse<IndexNowSettingResponse>>('/admin/indexnow/settings', payload);
      if (res.data.success && res.data.data) return res.data.data;
      throw new Error(res.data.message || res.data.error || 'Failed to save IndexNow settings');
    } catch (error) {
      throw extractApiError(error, 'Failed to save IndexNow settings');
    }
  }

  static async submit(payload: IndexNowSubmitRequest): Promise<IndexNowSubmitResponse> {
    try {
      const res = await apiClient.post<APIResponse<IndexNowSubmitResponse>>('/admin/indexnow/submit', payload || {});
      if (res.data.success && res.data.data) return res.data.data;
      throw new Error(res.data.message || res.data.error || 'Failed to submit IndexNow URLs');
    } catch (error) {
      throw extractApiError(error, 'Failed to submit IndexNow URLs');
    }
  }

  static async submitProduct(productId: number): Promise<IndexNowSubmitResponse> {
    try {
      const res = await apiClient.post<APIResponse<IndexNowSubmitResponse>>(`/admin/indexnow/products/${productId}/submit`, {});
      if (res.data.success && res.data.data) return res.data.data;
      throw new Error(res.data.message || res.data.error || 'Failed to submit product URL');
    } catch (error) {
      throw extractApiError(error, 'Failed to submit product URL');
    }
  }

  static async getProductStatus(): Promise<IndexNowProductStatusResponse> {
    try {
      const res = await apiClient.get<APIResponse<IndexNowProductStatusResponse>>('/admin/indexnow/product-status');
      if (res.data.success && res.data.data) return res.data.data;
      throw new Error(res.data.message || res.data.error || 'Failed to load IndexNow product status');
    } catch (error) {
      throw extractApiError(error, 'Failed to load IndexNow product status');
    }
  }

  static async submitProducts(payload: IndexNowSubmitProductsRequest): Promise<IndexNowSubmitProductsResponse> {
    try {
      const res = await apiClient.post<APIResponse<IndexNowSubmitProductsResponse>>('/admin/indexnow/submit-products', payload);
      if (res.data.success && res.data.data) return res.data.data;
      throw new Error(res.data.message || res.data.error || 'Failed to submit product batch');
    } catch (error) {
      throw extractApiError(error, 'Failed to submit product batch');
    }
  }

  static async verifyKey(): Promise<IndexNowVerifyKeyResponse> {
    try {
      const res = await apiClient.get<APIResponse<IndexNowVerifyKeyResponse>>('/admin/indexnow/verify-key');
      if (res.data.success && res.data.data) return res.data.data;
      throw new Error(res.data.message || res.data.error || 'Failed to verify key file');
    } catch (error) {
      throw extractApiError(error, 'Failed to verify key file');
    }
  }

  static async submitSample(): Promise<IndexNowSubmitResponse> {
    try {
      const res = await apiClient.post<APIResponse<IndexNowSubmitResponse>>('/admin/indexnow/submit-sample', {});
      if (res.data.success && res.data.data) return res.data.data;
      throw new Error(res.data.message || res.data.error || 'Failed to submit sample product');
    } catch (error) {
      throw extractApiError(error, 'Failed to submit sample product');
    }
  }
}

export default IndexNowService;
