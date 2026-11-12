import { apiClient } from '@/lib/api';
import type { APIResponse, PaginationResponse, ProductReview, ProductReviewStatus } from '@/types';

export interface ReviewEligibility {
  product_id: number;
  eligible: boolean;
  reason?: 'no_purchase' | 'already_reviewed';
  default_name: string;
  orders: Array<{ id: number; order_number: string; created_at: string }>;
  review?: ProductReview;
}

export interface CreateReviewRequest {
  product_id: number;
  rating: number;
  customer_name?: string;
  review_title?: string;
  review_content: string;
  turnstile_token?: string;
}

export interface AdminReviewFilters {
  page?: number;
  page_size?: number;
  status?: ProductReviewStatus | '';
  rating?: number | '';
  search?: string;
  product_id?: number;
}

export interface AdminReviewList extends PaginationResponse<ProductReview> {
  status_counts: Record<ProductReviewStatus, number>;
}

export interface AdminReviewUpdate {
  customer_name?: string;
  rating?: number;
  review_title?: string;
  review_content?: string;
  status?: ProductReviewStatus;
  is_verified?: boolean;
}

function unwrap<T>(res: { data: APIResponse<T> }, fallback: string): T {
  if (res.data.success && res.data.data !== undefined) return res.data.data;
  throw new Error(res.data.message || res.data.error || fallback);
}

export class ReviewService {
  static async getEligibility(productId: number): Promise<ReviewEligibility> {
    const res = await apiClient.get<APIResponse<ReviewEligibility>>('/customer/reviews/eligibility', {
      params: { product_id: productId },
    });
    return unwrap(res, 'Failed to check review eligibility');
  }

  static async getMyReviews(): Promise<ProductReview[]> {
    const res = await apiClient.get<APIResponse<ProductReview[]>>('/customer/reviews');
    return unwrap(res, 'Failed to load reviews') || [];
  }

  static async create(payload: CreateReviewRequest): Promise<ProductReview> {
    const res = await apiClient.post<APIResponse<ProductReview>>('/customer/reviews', payload);
    return unwrap(res, 'Failed to submit review');
  }

  static async adminList(filters: AdminReviewFilters = {}): Promise<AdminReviewList> {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== '' && value !== undefined && value !== null) params[key] = value as string | number;
    }
    const res = await apiClient.get<APIResponse<AdminReviewList>>('/admin/reviews', { params });
    return unwrap(res, 'Failed to load reviews');
  }

  static async adminUpdate(id: number, payload: AdminReviewUpdate): Promise<ProductReview> {
    const res = await apiClient.put<APIResponse<ProductReview>>(`/admin/reviews/${id}`, payload);
    return unwrap(res, 'Failed to save review');
  }

  static async adminBulkStatus(ids: number[], status: ProductReviewStatus): Promise<void> {
    const res = await apiClient.post<APIResponse<{ updated: number }>>('/admin/reviews/bulk-status', { ids, status });
    unwrap(res, 'Failed to update reviews');
  }

  static async adminDelete(id: number): Promise<void> {
    const res = await apiClient.delete<APIResponse<null>>(`/admin/reviews/${id}`);
    if (!res.data.success) throw new Error(res.data.message || 'Failed to delete review');
  }
}
