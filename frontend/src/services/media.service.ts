import { apiClient } from '@/lib/api';
import { APIResponse } from '@/types';

export interface MediaAsset {
  id: number;
  original_name: string;
  file_name: string;
  relative_path: string;
  url: string;
  sha256: string;
  mime_type: string;
  size_bytes: number;
  title: string;
  alt_text: string;
  folder: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface MediaListResponse {
  items: MediaAsset[];
  total: number;
  page: number;
  page_size: number;
}

export interface MediaUploadItemResult {
  original_name: string;
  sha256?: string;
  duplicate: boolean;
  asset?: MediaAsset;
  error?: string;
}

export interface MediaUploadResponse {
  total_files: number;
  success_count: number;
  error_count: number;
  results: MediaUploadItemResult[];
}

export interface MediaCleanupMissingResponse {
  scanned: number;
  deleted: number;
  errors?: string[];
}

export interface WatermarkSettings {
  id: number;
  enabled: boolean;
  watermark_position?: string;
  base_media_asset_id?: number;
  base_media_asset?: MediaAsset;
}

export class MediaService {
  static async list(params?: { page?: number; page_size?: number; q?: string; folder?: string }): Promise<MediaListResponse> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    if (params?.q) qs.set('q', params.q);
    if (params?.folder) qs.set('folder', params.folder);

    const url = qs.toString() ? `/admin/media?${qs.toString()}` : '/admin/media';
    const response = await apiClient.get<APIResponse<MediaListResponse>>(url);

    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to fetch media assets');
  }

  static async upload(files: File[], opts?: { folder?: string; tags?: string }): Promise<MediaUploadResponse> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (opts?.folder) form.append('folder', opts.folder);
    if (opts?.tags) form.append('tags', opts.tags);

    const response = await apiClient.post<APIResponse<MediaUploadResponse>>(
      '/admin/media/upload',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );

    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to upload media');
  }

  static async batchDelete(ids: number[]): Promise<void> {
    const response = await apiClient.delete<APIResponse<any>>('/admin/media/batch', {
      data: { ids },
    });
    if (response.data.success) return;
    throw new Error(response.data.message || 'Failed to delete media');
  }

  static async cleanupMissing(): Promise<MediaCleanupMissingResponse> {
    const response = await apiClient.post<APIResponse<MediaCleanupMissingResponse>>('/admin/media/cleanup-missing');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to clean missing media records');
  }

  static async batchUpdate(ids: number[], updates: Partial<Pick<MediaAsset, 'folder' | 'tags' | 'title' | 'alt_text'>>): Promise<void> {
    const response = await apiClient.put<APIResponse<any>>('/admin/media/batch', {
      ids,
      ...updates,
    });
    if (response.data.success) return;
    throw new Error(response.data.message || 'Failed to update media');
  }

  static async update(id: number, updates: Partial<Pick<MediaAsset, 'folder' | 'tags' | 'title' | 'alt_text'>>): Promise<MediaAsset> {
    const response = await apiClient.put<APIResponse<MediaAsset>>(`/admin/media/${id}`, updates);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to update media');
  }

  static async getWatermarkSettings(): Promise<WatermarkSettings> {
    const response = await apiClient.get<APIResponse<WatermarkSettings>>('/admin/media/watermark/settings');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to load watermark settings');
  }

  static async updateWatermarkSettings(payload: { enabled?: boolean; watermark_position?: string; base_media_asset_id?: number | null }): Promise<WatermarkSettings> {
    const response = await apiClient.put<APIResponse<WatermarkSettings>>('/admin/media/watermark/settings', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to update watermark settings');
  }

  static async watermarkAsset(payload: { asset_id: number; text_source: 'sku' | 'custom'; sku?: string; text?: string; watermark_position?: string }): Promise<MediaAsset> {
    const response = await apiClient.post<APIResponse<MediaAsset>>('/admin/media/watermark', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to watermark image');
  }
}
