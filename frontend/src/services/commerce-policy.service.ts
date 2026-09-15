import { apiClient } from '@/lib/api';
import type { APIResponse, CommercePolicySetting } from '@/types';

/**
 * Admin CRUD for the single-row commerce promise (shipping / warranty /
 * returns). Everything the storefront promises publicly is editable here, so no
 * commercial term has to be changed in code.
 */
export class CommercePolicyService {
  static async getSettings(): Promise<CommercePolicySetting> {
    const res = await apiClient.get<APIResponse<CommercePolicySetting>>('/admin/commerce-policy');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load commerce policy');
  }

  static async updateSettings(payload: Partial<CommercePolicySetting>): Promise<CommercePolicySetting> {
    const res = await apiClient.put<APIResponse<CommercePolicySetting>>('/admin/commerce-policy', payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to save commerce policy');
  }
}
