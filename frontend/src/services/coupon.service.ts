import { apiClient } from '@/lib/api';
import { APIResponse, PaginationResponse } from '@/types';

export interface Coupon {
  id: number;
  code: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  min_order_amount: number;
  max_discount_amount?: number;
  usage_limit?: number;
  used_count: number;
  user_usage_limit?: number;
  is_active: boolean;
  starts_at?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CouponCreateRequest {
  code: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  min_order_amount?: number;
  max_discount_amount?: number;
  usage_limit?: number;
  user_usage_limit?: number;
  is_active?: boolean;
  starts_at?: string;
  expires_at?: string;
}

export interface CouponValidateRequest {
  code: string;
  order_amount: number;
  customer_email: string;
}

export interface CouponValidateResponse {
  valid: boolean;
  coupon_id?: number;
  code?: string;
  name?: string;
  type?: string;
  value?: number;
  discount_amount?: number;
  final_amount?: number;
  message: string;
}

export interface CouponFilters {
  page?: number;
  page_size?: number;
  search?: string;
  status?: 'active' | 'inactive' | 'expired';
}

export interface CouponUsageRecord {
  id: number;
  order_id: number;
  customer_email: string;
  discount_amount: number;
  created_at: string;
}

export class CouponService {
  // Validate coupon (public)
  static async validateCoupon(validateData: CouponValidateRequest): Promise<CouponValidateResponse> {
    const response = await apiClient.post<APIResponse<CouponValidateResponse>>(
      '/public/coupons/validate',
      validateData
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to validate coupon');
  }

  // Admin: Get coupons
  static async getCoupons(filters: CouponFilters = {}): Promise<PaginationResponse<Coupon>> {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.append(key, value.toString());
      }
    });

    const response = await apiClient.get<APIResponse<PaginationResponse<Coupon>>>(
      `/admin/coupons?${params.toString()}`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to fetch coupons');
  }

  // Admin: Get single coupon
  static async getCoupon(id: number): Promise<Coupon> {
    const response = await apiClient.get<APIResponse<Coupon>>(
      `/admin/coupons/${id}`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Coupon not found');
  }

  // Admin: Create coupon
  static async createCoupon(couponData: CouponCreateRequest): Promise<Coupon> {
    const response = await apiClient.post<APIResponse<Coupon>>(
      '/admin/coupons',
      couponData
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to create coupon');
  }

  // Admin: Update coupon
  static async updateCoupon(id: number, couponData: CouponCreateRequest): Promise<Coupon> {
    const response = await apiClient.put<APIResponse<Coupon>>(
      `/admin/coupons/${id}`,
      couponData
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to update coupon');
  }

  // Admin: Delete coupon
  static async deleteCoupon(id: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<void>>(
      `/admin/coupons/${id}`
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to delete coupon');
    }
  }

  // Admin: Get coupon usage
  static async getCouponUsage(id: number): Promise<{ usage_records: CouponUsageRecord[]; total_discount: number; total_uses: number }> {
    const response = await apiClient.get<APIResponse<{ usage_records: CouponUsageRecord[]; total_discount: number; total_uses: number }>>(
      `/admin/coupons/${id}/usage`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to fetch coupon usage');
  }

  // Utility: Format coupon code
  static formatCouponCode(code: string): string {
    return code.toUpperCase().replace(/\s+/g, '');
  }

  // Utility: Get discount description
  static getDiscountDescription(coupon: Coupon): string {
    if (coupon.type === 'percentage') {
      let desc = `${coupon.value}% off`;
      if (coupon.max_discount_amount) {
        desc += ` (max $${coupon.max_discount_amount})`;
      }
      return desc;
    } else {
      return `$${coupon.value} off`;
    }
  }

  // Utility: Check if coupon is valid (basic client-side check)
  static isCouponValid(coupon: Coupon): boolean {
    if (!coupon.is_active) return false;

    const now = new Date();

    if (coupon.starts_at && new Date(coupon.starts_at) > now) return false;
    if (coupon.expires_at && new Date(coupon.expires_at) < now) return false;
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) return false;

    return true;
  }

  // Utility: Get coupon status
  static getCouponStatus(coupon: Coupon): { status: string; color: string; label: string } {
    if (!coupon.is_active) {
      return { status: 'inactive', color: 'gray', label: 'Inactive' };
    }

    const now = new Date();

    if (coupon.starts_at && new Date(coupon.starts_at) > now) {
      return { status: 'scheduled', color: 'blue', label: 'Scheduled' };
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
      return { status: 'expired', color: 'red', label: 'Expired' };
    }

    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
      return { status: 'exhausted', color: 'orange', label: 'Usage Limit Reached' };
    }

    return { status: 'active', color: 'green', label: 'Active' };
  }

  // Utility: Calculate discount amount
  static calculateDiscount(coupon: Coupon, orderAmount: number): number {
    if (!this.isCouponValid(coupon)) return 0;
    if (orderAmount < coupon.min_order_amount) return 0;

    let discount = 0;

    if (coupon.type === 'percentage') {
      discount = orderAmount * (coupon.value / 100);
      if (coupon.max_discount_amount && discount > coupon.max_discount_amount) {
        discount = coupon.max_discount_amount;
      }
    } else {
      discount = coupon.value;
      if (discount > orderAmount) {
        discount = orderAmount;
      }
    }

    return Math.round(discount * 100) / 100; // Round to 2 decimal places
  }
}

export default CouponService;
