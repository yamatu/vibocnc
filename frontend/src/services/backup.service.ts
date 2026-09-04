import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';

export interface ProductCatalogImportJob {
  id: string;
  status: 'uploading' | 'ready' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled';
  file_name: string;
  file_size: number;
  uploaded_bytes: number;
  chunk_size: number;
  last_sku: string;
  total_products: number;
  processed_products: number;
  created_products: number;
  updated_products: number;
  skipped_products: number;
  failed_products: number;
  restored_files: number;
  message: string;
  error?: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ProductCatalogManifest {
  format: string;
  version: number;
  source_site: string;
  source_url: string;
  exported_at: string;
  product_count: number;
  category_count: number;
  local_file_count: number;
}

export interface ProductCatalogPreview {
  manifest: ProductCatalogManifest;
  new_products: number;
  existing_products: number;
  missing_categories: number;
  source_brands: string[];
  warnings: string[];
}

export interface ProductCatalogImportOptions {
  conflict_policy: 'skip' | 'update' | 'upsert';
  create_categories: boolean;
  overwrite_local_files: boolean;
  brand_map: Record<string, string>;
  text_replacements: Array<{ from: string; to: string }>;
}

export interface ProductCatalogUploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
}

interface ProductCatalogJobEnvelope {
  job: ProductCatalogImportJob;
  progress: number;
}

interface ProductCatalogCompleteEnvelope {
  job: ProductCatalogImportJob;
  preview: ProductCatalogPreview;
}

function parseFilenameFromContentDisposition(v?: string): string | null {
  if (!v) return null;
  // Examples:
  // attachment; filename="fanuc-db-backup-20260117-000000.zip"
  // attachment; filename=fanuc-db-backup.zip
  const m = /filename\*?=(?:UTF-8''|")?([^\";]+)"?/i.exec(v);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export class BackupService {
  static async downloadDbZip(): Promise<void> {
    const res = await apiClient.get<Blob>('/admin/backup/db', {
      responseType: 'blob',
      timeout: 30 * 60 * 1000,
    });
    const filename =
      parseFilenameFromContentDisposition(String(res.headers['content-disposition'] || '')) ||
      'fanuc-db-backup.zip';
    downloadBlob(res.data, filename);
  }

  static async downloadMediaZip(): Promise<void> {
    const res = await apiClient.get<Blob>('/admin/backup/media', {
      responseType: 'blob',
      timeout: 30 * 60 * 1000,
    });
    const filename =
      parseFilenameFromContentDisposition(String(res.headers['content-disposition'] || '')) ||
      'fanuc-media-backup.zip';
    downloadBlob(res.data, filename);
  }

  static async restoreDbZip(file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiClient.post<APIResponse<unknown>>('/admin/backup/db/restore?force=1', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30 * 60 * 1000,
    });
    if (res.data.success) return;
    throw new Error(res.data.message || res.data.error || 'Failed to restore database');
  }

  static async restoreMediaZip(file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiClient.post<APIResponse<unknown>>('/admin/backup/media/restore?force=1', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30 * 60 * 1000,
    });
    if (res.data.success) return;
    throw new Error(res.data.message || res.data.error || 'Failed to restore media');
  }

  static async downloadProductCatalog(): Promise<void> {
    const res = await apiClient.get<Blob>('/admin/backup/products/export', {
      responseType: 'blob',
      timeout: 60 * 60 * 1000,
    });
    const filename =
      parseFilenameFromContentDisposition(String(res.headers['content-disposition'] || '')) ||
      'product-catalog.zip';
    downloadBlob(res.data, filename);
  }

  static async createProductCatalogImport(file: File): Promise<ProductCatalogImportJob> {
    const response = await apiClient.post<APIResponse<ProductCatalogJobEnvelope>>('/admin/backup/products/import/jobs', {
      file_name: file.name,
      file_size: file.size,
      fingerprint: `${file.name}:${file.size}:${file.lastModified}`,
    });
    if (response.data.success && response.data.data?.job) return response.data.data.job;
    throw new Error(response.data.message || 'Failed to create product catalog upload');
  }

  static async getProductCatalogImport(id: string): Promise<ProductCatalogImportJob> {
    const response = await apiClient.get<APIResponse<ProductCatalogJobEnvelope>>(
      `/admin/backup/products/import/jobs/${encodeURIComponent(id)}`
    );
    if (response.data.success && response.data.data?.job) return response.data.data.job;
    throw new Error(response.data.message || 'Failed to load product catalog task');
  }

  static async getProductCatalogPreview(id: string): Promise<ProductCatalogPreview> {
    const response = await apiClient.get<APIResponse<ProductCatalogPreview>>(
      `/admin/backup/products/import/jobs/${encodeURIComponent(id)}/preview`
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to load product catalog preview');
  }

  static async uploadProductCatalog(
    file: File,
    onProgress?: (progress: ProductCatalogUploadProgress) => void
  ): Promise<ProductCatalogCompleteEnvelope> {
    let job = await this.createProductCatalogImport(file);
    if (job.file_size !== file.size) throw new Error('The resumable task does not match the selected ZIP file');
    let offset = Math.max(0, job.uploaded_bytes);
    const chunkSize = Math.min(Math.max(job.chunk_size || 5 * 1024 * 1024, 1024 * 1024), 8 * 1024 * 1024);
    const report = (uploadedBytes: number) => onProgress?.({
      uploadedBytes,
      totalBytes: file.size,
      percent: Math.round((uploadedBytes / file.size) * 100),
    });
    report(offset);

    while (offset < file.size) {
      const chunkStart = offset;
      const chunkEnd = Math.min(file.size, chunkStart + chunkSize);
      const chunk = file.slice(chunkStart, chunkEnd);
      let uploaded = false;
      let lastError: unknown;
      for (let attempt = 0; attempt < 4 && !uploaded; attempt += 1) {
        try {
          const response = await apiClient.put<APIResponse<ProductCatalogJobEnvelope>>(
            `/admin/backup/products/import/jobs/${encodeURIComponent(job.id)}/chunk`,
            chunk,
            {
              params: { offset: chunkStart },
              headers: { 'Content-Type': 'application/octet-stream' },
              timeout: 120000,
              onUploadProgress: event => report(Math.min(file.size, chunkStart + Math.min(event.loaded || 0, chunk.size))),
            }
          );
          if (!response.data.success || !response.data.data?.job) {
            throw new Error(response.data.message || 'Catalog chunk upload failed');
          }
          job = response.data.data.job;
          offset = job.uploaded_bytes;
          uploaded = offset >= chunkEnd;
        } catch (error) {
          lastError = error;
          try {
            job = await this.getProductCatalogImport(job.id);
            offset = job.uploaded_bytes;
          } catch (statusError) {
            lastError = statusError;
          }
          if (offset >= chunkEnd) {
            uploaded = true;
            break;
          }
          if (offset !== chunkStart) throw new Error('Server upload offset changed; select the same ZIP to resume');
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      if (!uploaded) throw lastError instanceof Error ? lastError : new Error('Catalog upload failed after retries');
      report(offset);
    }

    const response = await apiClient.post<APIResponse<ProductCatalogCompleteEnvelope>>(
      `/admin/backup/products/import/jobs/${encodeURIComponent(job.id)}/complete`,
      {},
      { timeout: 10 * 60 * 1000 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Product catalog validation failed');
  }

  static async applyProductCatalogImport(id: string, options: ProductCatalogImportOptions): Promise<ProductCatalogImportJob> {
    const response = await apiClient.post<APIResponse<ProductCatalogJobEnvelope>>(
      `/admin/backup/products/import/jobs/${encodeURIComponent(id)}/apply`,
      options
    );
    if (response.data.success && response.data.data?.job) return response.data.data.job;
    throw new Error(response.data.message || 'Failed to start product catalog import');
  }

  static async pauseProductCatalogImport(id: string): Promise<ProductCatalogImportJob> {
    const response = await apiClient.post<APIResponse<ProductCatalogJobEnvelope>>(
      `/admin/backup/products/import/jobs/${encodeURIComponent(id)}/pause`
    );
    if (response.data.success && response.data.data?.job) return response.data.data.job;
    throw new Error(response.data.message || 'Failed to pause product catalog import');
  }

  static async resumeProductCatalogImport(id: string): Promise<ProductCatalogImportJob> {
    const response = await apiClient.post<APIResponse<ProductCatalogJobEnvelope>>(
      `/admin/backup/products/import/jobs/${encodeURIComponent(id)}/resume`
    );
    if (response.data.success && response.data.data?.job) return response.data.data.job;
    throw new Error(response.data.message || 'Failed to resume product catalog import');
  }

  static async cancelProductCatalogImport(id: string): Promise<ProductCatalogImportJob> {
    const response = await apiClient.delete<APIResponse<ProductCatalogJobEnvelope>>(
      `/admin/backup/products/import/jobs/${encodeURIComponent(id)}`
    );
    if (response.data.success && response.data.data?.job) return response.data.data.job;
    throw new Error(response.data.message || 'Failed to cancel product catalog import');
  }
}

