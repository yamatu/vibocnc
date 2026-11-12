import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';

export interface TurnstilePublicConfig {
  enabled: boolean;
  site_key: string;
}

export interface TurnstileSetting {
  id: number;
  enabled: boolean;
  site_key: string;
  has_secret_key: boolean;
  active: boolean;
  updated_at?: string;
}

export interface UpdateTurnstileSettingRequest {
  enabled?: boolean;
  site_key?: string;
  secret_key?: string;
  clear_secret?: boolean;
}

export class TurnstileService {
  static async getPublicConfig(): Promise<TurnstilePublicConfig> {
    const res = await apiClient.get<APIResponse<TurnstilePublicConfig>>('/public/turnstile/config');
    if (res.data.success && res.data.data) return res.data.data;
    return { enabled: false, site_key: '' };
  }

  static async getSettings(): Promise<TurnstileSetting> {
    const res = await apiClient.get<APIResponse<TurnstileSetting>>('/admin/turnstile/settings');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || 'Failed to load Turnstile settings');
  }

  static async updateSettings(payload: UpdateTurnstileSettingRequest): Promise<TurnstileSetting> {
    const res = await apiClient.put<APIResponse<TurnstileSetting>>('/admin/turnstile/settings', payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || 'Failed to save Turnstile settings');
  }

  static async test(token: string): Promise<string> {
    const res = await apiClient.post<APIResponse<null>>('/admin/turnstile/test', { token });
    if (res.data.success) return res.data.message;
    throw new Error(res.data.message || 'Verification failed');
  }
}
