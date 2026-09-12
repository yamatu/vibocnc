import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';

export interface CloudflareCacheSettingResponse {
  id: number;
  email: string;
  zone_id: string;
  enabled: boolean;
  has_api_key: boolean;
  auto_purge_on_mutation: boolean;
  auto_clear_redis_on_mutation: boolean;
  auto_purge_interval_minutes: number;
  purge_everything: boolean;
  last_purge_at?: string | null;
  updated_at?: string;
  created_at?: string;
}

export interface UpdateCloudflareCacheSettingRequest {
  email?: string;
  api_key?: string; // only send when updating
  zone_id?: string;
  enabled?: boolean;
  auto_purge_on_mutation?: boolean;
  auto_clear_redis_on_mutation?: boolean;
  auto_purge_interval_minutes?: number;
  purge_everything?: boolean;
}

export interface PurgeCacheRequest {
  purge_everything?: boolean;
  urls?: string[];
  clear_redis?: boolean;
}

export class CacheService {
  static async getSettings(): Promise<CloudflareCacheSettingResponse> {
    const res = await apiClient.get<APIResponse<CloudflareCacheSettingResponse>>('/admin/cache/settings');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load cache settings');
  }

  static async updateSettings(payload: UpdateCloudflareCacheSettingRequest): Promise<CloudflareCacheSettingResponse> {
    const res = await apiClient.put<APIResponse<CloudflareCacheSettingResponse>>('/admin/cache/settings', payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to save cache settings');
  }

  static async test(): Promise<void> {
    const res = await apiClient.post<APIResponse<unknown>>('/admin/cache/test', {});
    if (res.data.success) return;
    throw new Error(res.data.message || res.data.error || 'Cloudflare test failed');
  }

  static async purgeNow(payload: PurgeCacheRequest): Promise<void> {
    const res = await apiClient.post<APIResponse<unknown>>('/admin/cache/purge', payload || {});
    if (res.data.success) return;
    throw new Error(res.data.message || res.data.error || 'Purge failed');
  }
}
