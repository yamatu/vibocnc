import { apiClient } from '@/lib/api';
import { APIResponse } from '@/types';

export interface MediaAsset {
  id: number;
  original_name: string;
  file_name: string;
  relative_path: string;
  url: string;
  thumbnail_url?: string;
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
  base_media_asset_id?: number | null;
  base_media_asset?: MediaAsset;
}

export interface MediaProductUsageItem {
  product_id: number;
  sku: string;
  name: string;
  brand: string;
  is_active: boolean;
  matched_url: string;
}

export interface MediaProductUsageResponse {
  items: MediaProductUsageItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface SKUImageArchiveJob {
  id: string;
  status: 'uploading' | 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  file_name: string;
  file_size: number;
  uploaded_bytes: number;
  chunk_size: number;
  total_folders: number;
  processed_folders: number;
  last_folder_index: number;
  matched_products: number;
  updated_products: number;
  imported_images: number;
  duplicate_images: number;
  skipped_folders: number;
  failed_folders: number;
  message: string;
  error?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface SKUArchiveUploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
}

async function buildSKUArchiveFingerprint(file: File): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
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

export class MediaService {
  static async list(params?: { page?: number; page_size?: number; q?: string; folder?: string; include_generated?: boolean }): Promise<MediaListResponse> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    if (params?.q) qs.set('q', params.q);
    if (params?.folder) qs.set('folder', params.folder);
    if (params?.include_generated) qs.set('include_generated', 'true');

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

  static async rotate(payload: { asset_id?: number; url?: string; folder?: string; degrees: 90 | 180 | 270 }): Promise<MediaAsset> {
    const response = await apiClient.post<APIResponse<MediaAsset>>('/admin/media/rotate', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.error || response.data.message || 'Failed to rotate media');
  }

  static async batchDelete(ids: number[]): Promise<void> {
    const response = await apiClient.delete<APIResponse<{ deleted: number }>>('/admin/media/batch', {
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
    const response = await apiClient.put<APIResponse<{ updated: number }>>('/admin/media/batch', {
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

  static async getProductsUsingMedia(id: number, page = 1, pageSize = 50): Promise<MediaProductUsageResponse> {
    const response = await apiClient.get<APIResponse<MediaProductUsageResponse>>(`/admin/media/${id}/products`, {
      params: { page, page_size: pageSize },
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to load products using this image');
  }

  static async startSKUImageArchive(file: File): Promise<SKUImageArchiveJob> {
    const fingerprint = await buildSKUArchiveFingerprint(file);
    const response = await apiClient.post<APIResponse<SKUImageArchiveJob>>('/admin/media/sku-archive/jobs', {
      file_name: file.name,
      file_size: file.size,
      fingerprint,
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to create SKU image archive upload');
  }

  static async getLatestSKUImageArchiveJob(): Promise<SKUImageArchiveJob | null> {
    const response = await apiClient.get<APIResponse<SKUImageArchiveJob | null>>('/admin/media/sku-archive/jobs/latest');
    if (response.data.success) return response.data.data || null;
    throw new Error(response.data.message || 'Failed to load SKU image archive task');
  }

  static async getSKUImageArchiveJob(id: string): Promise<SKUImageArchiveJob> {
    const response = await apiClient.get<APIResponse<SKUImageArchiveJob>>(`/admin/media/sku-archive/jobs/${encodeURIComponent(id)}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to load SKU image archive task');
  }

  static async pauseSKUImageArchiveJob(id: string): Promise<SKUImageArchiveJob> {
    const response = await apiClient.post<APIResponse<SKUImageArchiveJob>>(`/admin/media/sku-archive/jobs/${encodeURIComponent(id)}/pause`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to pause SKU image archive task');
  }

  static async resumeSKUImageArchiveJob(id: string): Promise<SKUImageArchiveJob> {
    const response = await apiClient.post<APIResponse<SKUImageArchiveJob>>(`/admin/media/sku-archive/jobs/${encodeURIComponent(id)}/resume`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to resume SKU image archive task');
  }

  static async cancelSKUImageArchiveJob(id: string): Promise<SKUImageArchiveJob> {
    const response = await apiClient.delete<APIResponse<SKUImageArchiveJob>>(`/admin/media/sku-archive/jobs/${encodeURIComponent(id)}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to cancel SKU image archive task');
  }

  static async uploadSKUImageArchive(file: File, onProgress?: (progress: SKUArchiveUploadProgress) => void): Promise<SKUImageArchiveJob> {
    let job = await this.startSKUImageArchive(file);
    if (job.file_size !== file.size) {
      throw new Error('The active upload does not match the selected ZIP file');
    }
    let offset = Math.max(0, job.uploaded_bytes);
    const chunkSize = Math.min(Math.max(job.chunk_size || 5 * 1024 * 1024, 1024 * 1024), 8 * 1024 * 1024);
    onProgress?.({ uploadedBytes: offset, totalBytes: file.size, percent: Math.round((offset / file.size) * 100) });

    while (offset < file.size) {
      const chunkStart = offset;
      const chunkEnd = Math.min(file.size, chunkStart + chunkSize);
      const chunk = file.slice(chunkStart, chunkEnd);
      let uploaded = false;
      let lastError: unknown;

      for (let attempt = 0; attempt < 4 && !uploaded; attempt += 1) {
        try {
          const response = await apiClient.put<APIResponse<SKUImageArchiveJob>>(
            `/admin/media/sku-archive/jobs/${encodeURIComponent(job.id)}/chunk`,
            chunk,
            {
              params: { offset: chunkStart },
              headers: { 'Content-Type': 'application/octet-stream' },
              timeout: 120000,
              onUploadProgress: (event) => {
                const loaded = Math.min(event.loaded || 0, chunk.size);
                const uploadedBytes = Math.min(file.size, chunkStart + loaded);
                onProgress?.({ uploadedBytes, totalBytes: file.size, percent: Math.round((uploadedBytes / file.size) * 100) });
              },
            }
          );
          if (!response.data.success || !response.data.data) {
            throw new Error(response.data.message || 'Archive chunk upload failed');
          }
          job = response.data.data;
          offset = job.uploaded_bytes;
          uploaded = offset >= chunkEnd;
        } catch (error: unknown) {
          lastError = error;
          try {
            job = await this.getSKUImageArchiveJob(job.id);
            offset = job.uploaded_bytes;
          } catch (statusError: unknown) {
            lastError = statusError;
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
              continue;
            }
            break;
          }
          if (offset >= chunkEnd) {
            uploaded = true;
            break;
          }
          if (offset !== chunkStart) {
            throw new Error('Server upload offset changed unexpectedly; reselect the same ZIP to resume');
          }
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
      }
      if (!uploaded) {
        throw lastError instanceof Error ? lastError : new Error('Archive upload failed after retries');
      }
      onProgress?.({ uploadedBytes: offset, totalBytes: file.size, percent: Math.round((offset / file.size) * 100) });
    }

    const response = await apiClient.post<APIResponse<SKUImageArchiveJob>>(
      `/admin/media/sku-archive/jobs/${encodeURIComponent(job.id)}/complete`,
      {},
      { timeout: 120000 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to start SKU image archive processing');
  }
}
