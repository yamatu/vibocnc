import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';

export type PayPalMode = 'sandbox' | 'live';

export interface PayPalPublicConfig {
  enabled: boolean;
  mode: PayPalMode;
  client_id: string;
  currency: string;
}

export interface PayPalSetting {
  id: number;
  enabled: boolean;
  mode: PayPalMode;
  client_id_sandbox: string;
  client_id_live: string;
  has_client_secret_sandbox?: boolean;
  has_client_secret_live?: boolean;
  webhook_id?: string;
  currency: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpdatePayPalSettingRequest {
  enabled?: boolean;
  mode?: PayPalMode;
  client_id_sandbox?: string;
  client_id_live?: string;
  client_secret_sandbox?: string;
  client_secret_live?: string;
  webhook_id?: string;
  currency?: string;
}

export class PayPalService {
  static async getPublicConfig(): Promise<PayPalPublicConfig> {
    const res = await apiClient.get<APIResponse<PayPalPublicConfig>>('/public/paypal/config');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load PayPal config');
  }

  static async getSettings(): Promise<PayPalSetting> {
    const res = await apiClient.get<APIResponse<PayPalSetting>>('/admin/paypal/settings');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load PayPal settings');
  }

  static async updateSettings(payload: UpdatePayPalSettingRequest): Promise<PayPalSetting> {
    const res = await apiClient.put<APIResponse<PayPalSetting>>('/admin/paypal/settings', payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to save PayPal settings');
  }
}
