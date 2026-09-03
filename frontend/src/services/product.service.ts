import { apiClient } from '@/lib/api';
import {
  APIResponse,
  PaginationResponse,
  Product,
  ProductCreateRequest
} from '@/types';
import type { AxiosProgressEvent } from 'axios';

export interface ProductFilters {
  page?: number;
  page_size?: number;
  category_id?: string;
  include_descendants?: string;
  brand?: string;
  search?: string;
  is_active?: string;
  is_featured?: string;
  ai_seo_status?: 'optimized' | 'not_optimized' | 'running' | 'failed';
  sort_by?: 'created_at' | 'updated_at' | 'price' | 'name';
  sort_dir?: 'asc' | 'desc';
}

export interface ProductImportResult {
  brand: string;
  total_rows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  created_categories: number;
  items: Array<{
    row_number: number;
    model: string;
    category?: string;
    action: string;
    product_id?: number;
    sku?: string;
    message?: string;
  }>;
  template: string;
  overwrite: boolean;
  create_missing: boolean;
  categories_created?: number;
}

export interface ProductImportTaskSnapshot {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  brand: string;
  filename: string;
  progress_pct: number;
  processed_rows: number;
  total_rows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  created_categories: number;
  message?: string;
  result?: ProductImportResult;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ProductOptimizationStatus {
  total_products: number;
  optimized_products: number;
  needs_optimization: number;
  average_seo_score: number;
}

export interface ProductOptimizationResponse {
  product_id: number;
  sku: string;
  optimization_status: string;
  content_updated: boolean;
  seo_score_before: number;
  seo_score_after: number;
  message: string;
}

export interface ProductCategoryOptimizationRequest {
  product_ids?: number[];
  category_id?: number;
  brand?: string;
  include_inactive?: boolean;
  limit?: number;
  after_id?: number;
  use_web_search?: boolean;
  create_missing_categories?: boolean;
  activate_resolved?: boolean;
}

export interface ProductCategoryOptimizationItem {
  product_id: number;
  sku: string;
  status: 'completed' | 'unresolved' | 'failed';
  message: string;
  brand?: string;
  model?: string;
  part_type?: string;
  match_rule?: string;
  category_id?: number;
  category_path?: string;
  category_created: boolean;
  evidence?: Array<{ title: string; url: string; snippet: string }>;
  inference?: {
    brand_key: string;
    brand_name: string;
    part_type: string;
    category_slug: string;
    model_family?: string;
    match_rule: string;
  };
}

export interface ProductCategoryOptimizationResult {
  processed: number;
  completed: number;
  unresolved: number;
  failed: number;
  categories_created: number;
  has_more: boolean;
  next_after_id?: number;
  results?: ProductCategoryOptimizationItem[];
}

export interface ProductTitleStandardizationRequest {
  product_ids?: number[];
  category_id?: number;
  include_descendants?: boolean;
  brand?: string;
  include_inactive?: boolean;
  limit?: number;
  after_id?: number;
  apply?: boolean;
}

export interface ProductTitleProposal {
  product_id: number;
  sku: string;
  status: 'ready' | 'updated' | 'skipped' | 'unresolved' | 'failed';
  message?: string;
  brand?: string;
  model?: string;
  part_type?: string;
  old_name: string;
  new_name?: string;
}

export interface ProductTitleStandardizationResult {
  processed: number;
  ready: number;
  updated: number;
  skipped: number;
  unresolved: number;
  has_more: boolean;
  next_after_id?: number;
  applied: boolean;
  results: ProductTitleProposal[];
}

export interface ProductClassificationIssue {
  product_id: number;
  sku: string;
  name: string;
  brand: string;
  model: string;
  category_id: number;
  category_path: string;
  issue: 'uncategorized' | 'wrong_category' | 'root_category' | 'generic_category' | 'inactive_unresolved' | 'seo_failed';
  detail: string;
}

export interface ProductClassificationAudit {
  scanned: number;
  ok: number;
  uncategorized: number;
  wrong_category: number;
  root_category: number;
  generic_category: number;
  inactive_unresolved: number;
  seo_failed: number;
  product_ids: number[];
  samples: ProductClassificationIssue[];
}

export interface BulkSelectionIdsResult {
  ids: number[];
  total: number;
}

export interface BulkCategoryImageResult {
  updated: number;
  skipped: number;
  image_url: string;
  apply_mode: 'fill_empty' | 'replace_all';
}

export type ProductImageAutofillJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export interface ProductImageAutofillJob {
  id: string;
  status: ProductImageAutofillJobStatus;
  brand: string;
  category_id: number;
  include_descendants: boolean;
  product_status: 'active' | 'inactive' | 'all';
  batch_size: number;
  max_product_id: number;
  last_product_id: number;
  image_version: string;
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  message: string;
  error?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface ProductImageAutofillBrand {
  name: string;
  count: number;
}

export interface ProductImageRecord {
  id: number;
  product_id: number;
  url: string;
  filename?: string;
  original_name?: string;
  alt_text?: string;
  sort_order?: number;
  is_primary?: boolean;
  created_at?: string;
  updated_at?: string;
}

function isNetworkishError(error: unknown): error is {
  code?: string;
  message?: string;
  response?: { status?: number; data?: { message?: string } };
  constructor?: { name?: string };
} {
  return typeof error === 'object' && error !== null;
}

export class ProductService {
  // Get products (public)
  static async getProducts(filters: ProductFilters = {}): Promise<PaginationResponse<Product>> {
    try {
      const params = new URLSearchParams();

      // Safely add parameters to URLSearchParams
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          const stringValue = String(value).trim();
          if (stringValue) {
            params.append(key, stringValue);
          }
        }
      });

      const queryString = params.toString();
      const url = `/public/products${queryString ? `?${queryString}` : ''}`;

      if (process.env.NODE_ENV !== 'production') {
        console.log('🔍 ProductService.getProducts URL:', url);
        console.log('🔍 ProductService.getProducts filters:', filters);
        console.log('🔍 ProductService.getProducts queryString:', queryString);
      }

      const response = await apiClient.get<APIResponse<PaginationResponse<Product>>>(url);

      if (response.data.success && response.data.data) {
        return response.data.data;
      }

      throw new Error(response.data.message || 'Failed to fetch products');
    } catch (error: unknown) {
      console.error('❌ ProductService.getProducts error:', error);

      // Check if it's a network error (backend not running) or timeout
      if (isNetworkishError(error) && (
          error.code === 'ECONNREFUSED' ||
          error.code === 'ECONNABORTED' ||
          error.message?.includes('Network Error') ||
          error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('timeout') ||
          error.message?.includes('aborted') ||
          (error.code === '23' && error.constructor?.name === 'TimeoutError') ||
          error.response?.status === 404 ||
          (error.response?.status && error.response.status >= 500))) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('🔧 Backend server appears to be down or timed out, returning development-only mock data');
          return this.getMockProductsData(filters);
        }
        // Never expose invented catalog values in a production HTML response.
        return {
          data: [],
          page: Number(filters.page || 1),
          page_size: Number(filters.page_size || 12),
          total: 0,
          total_pages: 0,
        };
      }

      throw error;
    }
  }

  // Mock data fallback when backend is unavailable
  private static getMockProductsData(filters: ProductFilters = {}): PaginationResponse<Product> {
    const mockProducts: Product[] = [
      {
        id: 1,
        sku: 'A06B-6290-H205',
        name: 'FANUC Servo Drive Alpha iSV 20A',
        slug: 'fanuc-servo-drive-alpha-isv-20a',
        short_description: 'High-performance servo drive for industrial automation',
        description: 'FANUC Alpha iSV 20A servo drive with advanced motion control capabilities',
        price: 2850.00,
        compare_price: 3200.00,
        stock_quantity: 15,
        min_stock_level: 5,
        weight: 2.5,
        dimensions: '200x150x80mm',
        brand: 'FANUC',
        model: 'Alpha iSV',
        part_number: 'A06B-6290-H205',
        category_id: 1,
        category: {
          id: 1,
          name: 'FANUC Servo Amplifier / Drive',
          slug: 'fanuc-servo-amplifier-drive',
          path: 'fanuc/fanuc-servo-amplifier-drive',
          description: 'FANUC servo drives and amplifiers',
          image_url: '',
          sort_order: 1,
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        is_active: true,
        is_featured: true,
        meta_title: 'FANUC Servo Drive A06B-6290-H205',
        meta_description: 'Buy FANUC Alpha iSV 20A servo drive A06B-6290-H205',
        meta_keywords: 'FANUC, servo drive, alpha isv, automation',
        image_urls: ['/images/placeholder-image.png'],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      },
      {
        id: 2,
        sku: 'A06B-6140-H006',
        name: 'FANUC Servo Motor Alpha is 6/3000',
        slug: 'fanuc-servo-motor-alpha-is-6-3000',
        short_description: 'Precision servo motor for CNC applications',
        description: 'FANUC Alpha is servo motor with 6Nm torque and 3000rpm speed',
        price: 1750.00,
        stock_quantity: 8,
        min_stock_level: 3,
        weight: 3.2,
        dimensions: '180x180x120mm',
        brand: 'FANUC',
        model: 'Alpha is',
        part_number: 'A06B-6140-H006',
        category_id: 2,
        category: {
          id: 2,
          name: 'FANUC Servo Motor',
          slug: 'fanuc-servo-motor',
          path: 'fanuc/fanuc-servo-motor',
          description: 'FANUC servo motors and spindle motors',
          image_url: '',
          sort_order: 2,
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        is_active: true,
        is_featured: false,
        meta_title: 'FANUC Servo Motor A06B-6140-H006',
        meta_description: 'Buy FANUC Alpha is servo motor A06B-6140-H006',
        meta_keywords: 'FANUC, servo motor, alpha is, CNC',
        image_urls: ['/images/placeholder-image.png'],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
    ];

    // Apply filters to mock data
    let filteredProducts = mockProducts;

    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      filteredProducts = filteredProducts.filter(product =>
        product.name.toLowerCase().includes(searchTerm) ||
        product.sku.toLowerCase().includes(searchTerm) ||
        product.part_number.toLowerCase().includes(searchTerm)
      );
    }

    if (filters.category_id) {
      filteredProducts = filteredProducts.filter(product =>
        product.category_id.toString() === filters.category_id
      );
    }

    if (filters.is_featured === 'true') {
      filteredProducts = filteredProducts.filter(product => product.is_featured);
    }

    const page = parseInt(filters.page?.toString() || '1');
    const pageSize = parseInt(filters.page_size?.toString() || '12');
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    return {
      data: filteredProducts.slice(startIndex, endIndex),
      page,
      page_size: pageSize,
      total: filteredProducts.length,
      total_pages: Math.ceil(filteredProducts.length / pageSize)
    };
  }

  // Get single product (public)
  static async getProduct(id: number): Promise<Product> {
    const response = await apiClient.get<APIResponse<Product>>(
      `/public/products/${id}`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Product not found');
  }

  // Get product by SKU (public)
  // Simplified to a single request; backend already implements robust fallbacks.
  static async getProductBySku(sku: string): Promise<Product> {
    const trimmed = (sku || '').trim();
    try {
      // Use query param endpoint to support SKUs containing '/'
      const response = await apiClient.get<APIResponse<Product>>(
        `/public/products/sku`, { params: { sku: trimmed } }
      );

      if (response.data.success && response.data.data) {
        return response.data.data;
      }
    } catch (error: unknown) {
      // Network/timeout/5xx fallback to search
      if (isNetworkishError(error) && (
        error?.code === 'ECONNREFUSED' ||
        error?.code === 'ECONNABORTED' ||
        error?.message?.includes('Network Error') ||
        error?.message?.includes('ECONNREFUSED') ||
        error?.message?.includes('timeout') ||
        error?.message?.includes('aborted') ||
        (error?.code === '23' && error?.constructor?.name === 'TimeoutError') ||
        error?.response?.status === 404 ||
        (error?.response?.status && error.response.status >= 500)
      )) {
        try {
          const searchRes = await this.getProducts({ search: trimmed, is_active: 'true', page: 1, page_size: 1 });
          const first = (searchRes.data || [])[0];
          if (first) return first as unknown as Product;
        } catch {}
      }
      // If it's some other error, rethrow
      if (isNetworkishError(error) && error?.response?.data?.message) throw new Error(error.response.data.message);
      throw error;
    }

    // As a minimal fallback, try searching by the exact term even when API returned success=false
    try {
      const searchRes = await this.getProducts({ search: trimmed, is_active: 'true', page: 1, page_size: 1 });
      const first = (searchRes.data || [])[0];
      if (first) return first as unknown as Product;
    } catch {}

    throw new Error('Product not found');
  }

  // Admin: Get products
  static async getAdminProducts(filters: ProductFilters = {}): Promise<PaginationResponse<Product>> {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.append(key, value.toString());
      }
    });

    const response = await apiClient.get<APIResponse<PaginationResponse<Product>>>(
      `/admin/products?${params.toString()}`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to fetch products');
  }

  // Admin: Get single product
  static async getAdminProduct(id: number): Promise<Product> {
    const response = await apiClient.get<APIResponse<Product>>(
      `/admin/products/${id}`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Product not found');
  }

  // Admin: Create product
  static async createProduct(productData: ProductCreateRequest): Promise<Product> {
    const response = await apiClient.post<APIResponse<Product>>(
      '/admin/products',
      productData
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to create product');
  }

  // Admin: Update product
  static async updateProduct(id: number, productData: Partial<ProductCreateRequest>): Promise<Product> {
    const response = await apiClient.put<APIResponse<Product>>(
      `/admin/products/${id}`,
      productData
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to update product');
  }

  // Admin: Delete product
  static async deleteProduct(id: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<void>>(
      `/admin/products/${id}`
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to delete product');
    }
  }

  // Admin: Toggle product status
  static async toggleProductStatus(id: number): Promise<Product> {
    const response = await apiClient.patch<APIResponse<Product>>(
      `/admin/products/${id}/toggle-status`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to toggle product status');
  }

  // Admin: Toggle featured status
  static async toggleFeaturedStatus(id: number): Promise<Product> {
    const response = await apiClient.patch<APIResponse<Product>>(
      `/admin/products/${id}/toggle-featured`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to toggle featured status');
  }

  // Admin: Bulk update is_active / is_featured by IDs or SKUs
  static async bulkUpdateProducts(payload: {
    ids?: number[];
    skus?: string[];
    is_active?: boolean;
    is_featured?: boolean;
    // optional filters for select-all
    search?: string;
    category_id?: string;
    include_descendants?: boolean;
    status?: 'active' | 'inactive' | 'all';
    featured?: 'true' | 'false' | '';
    batch_size?: number;
  }): Promise<void> {
    const response = await apiClient.put<APIResponse<void>>(
      `/admin/products/bulk-update`,
      payload
    );
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to bulk update products');
    }
  }

  // Admin: bulk apply/remove default watermark image
  static async bulkApplyDefaultImage(payload: {
    ids?: number[];
    skus?: string[];
    search?: string;
    category_id?: string;
    include_descendants?: boolean;
    status?: 'active' | 'inactive' | 'all' | '';
    featured?: 'true' | 'false' | '';
    batch_size?: number;
  }): Promise<{ updated: number; skipped: number }> {
    const response = await apiClient.put<APIResponse<{ updated: number; skipped: number }>>('/admin/products/bulk-default-image/apply', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to apply default images');
  }

  static async listProductImageAutofillBrands(): Promise<ProductImageAutofillBrand[]> {
    const response = await apiClient.get<APIResponse<ProductImageAutofillBrand[]>>('/admin/products/bulk-default-image/brands');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to load product brands');
  }

  static async startProductImageAutofill(payload: {
    brand?: string;
    category_id?: number;
    include_descendants?: boolean;
    product_status?: 'active' | 'inactive' | 'all';
    batch_size?: number;
  }): Promise<ProductImageAutofillJob> {
    const response = await apiClient.post<APIResponse<ProductImageAutofillJob>>('/admin/products/bulk-default-image/jobs', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to start SKU image autofill');
  }

  static async getLatestProductImageAutofillJob(): Promise<ProductImageAutofillJob | null> {
    const response = await apiClient.get<APIResponse<ProductImageAutofillJob | null>>('/admin/products/bulk-default-image/jobs/latest');
    if (response.data.success) return response.data.data || null;
    throw new Error(response.data.message || 'Failed to load SKU image autofill task');
  }

  static async getProductImageAutofillJob(id: string): Promise<ProductImageAutofillJob> {
    const response = await apiClient.get<APIResponse<ProductImageAutofillJob>>(`/admin/products/bulk-default-image/jobs/${encodeURIComponent(id)}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to load SKU image autofill task');
  }

  static async pauseProductImageAutofillJob(id: string): Promise<ProductImageAutofillJob> {
    const response = await apiClient.post<APIResponse<ProductImageAutofillJob>>(`/admin/products/bulk-default-image/jobs/${encodeURIComponent(id)}/pause`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to pause SKU image autofill task');
  }

  static async resumeProductImageAutofillJob(id: string): Promise<ProductImageAutofillJob> {
    const response = await apiClient.post<APIResponse<ProductImageAutofillJob>>(`/admin/products/bulk-default-image/jobs/${encodeURIComponent(id)}/resume`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to resume SKU image autofill task');
  }

  static async bulkRemoveDefaultImage(payload: {
    ids?: number[];
    skus?: string[];
    search?: string;
    category_id?: string;
    include_descendants?: boolean;
    status?: 'active' | 'inactive' | 'all' | '';
    featured?: 'true' | 'false' | '';
    batch_size?: number;
  }): Promise<{ updated: number; removed: number; skipped: number }> {
    const response = await apiClient.put<APIResponse<{ updated: number; removed: number; skipped: number }>>('/admin/products/bulk-default-image/remove', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to remove default images');
  }

  static async bulkClearProductImages(payload: {
    ids?: number[];
    skus?: string[];
    search?: string;
    category_id?: string;
    include_descendants?: boolean;
    status?: 'active' | 'inactive' | 'all' | '';
    featured?: 'true' | 'false' | '';
    batch_size?: number;
  }): Promise<{ updated: number; removed: number; skipped: number }> {
    const response = await apiClient.put<APIResponse<{ updated: number; removed: number; skipped: number }>>('/admin/products/bulk-images/clear', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to clear product images');
  }

  static async getOptimizationStatus(): Promise<ProductOptimizationStatus> {
    const response = await apiClient.get<APIResponse<ProductOptimizationStatus>>('/admin/products/optimization-status');
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to fetch optimization status');
  }

  static async optimizeProduct(productId: number, forceUpdate = false, brand?: string): Promise<ProductOptimizationResponse> {
    const response = await apiClient.post<APIResponse<ProductOptimizationResponse>>('/admin/products/optimize', {
      product_id: productId,
      force_update: forceUpdate,
      brand,
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to optimize product');
  }

  static async bulkOptimizeProducts(payload: {
    product_ids?: number[];
    category_id?: number;
    limit?: number;
    force_update?: boolean;
    brand?: string;
  }): Promise<ProductOptimizationResponse[]> {
    const response = await apiClient.post<APIResponse<ProductOptimizationResponse[]>>('/admin/products/bulk-optimize', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to bulk optimize products');
  }

  static async autoOptimizeCategories(
    payload: ProductCategoryOptimizationRequest
  ): Promise<ProductCategoryOptimizationResult> {
    const response = await apiClient.post<APIResponse<ProductCategoryOptimizationResult>>(
      '/admin/products/auto-optimize-categories',
      payload,
      // A batch can perform bounded public web lookups for unfamiliar models.
      // Do not let the global 60-second API timeout interrupt that work.
      { timeout: 0 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Failed to optimize product categories');
  }

  static async standardizeTitles(
    payload: ProductTitleStandardizationRequest
  ): Promise<ProductTitleStandardizationResult> {
    const response = await apiClient.post<APIResponse<ProductTitleStandardizationResult>>(
      '/admin/products/standardize-titles',
      payload,
      { timeout: 0 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Failed to standardize product titles');
  }

  static async auditClassification(): Promise<ProductClassificationAudit> {
    const response = await apiClient.post<APIResponse<ProductClassificationAudit>>(
      '/admin/products/classification-audit',
      {},
      // The audit walks the whole catalog; do not let the global timeout cut it off.
      { timeout: 0 }
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Classification audit failed');
  }

  static async getAdminProductSelectionIds(payload: {
    ids?: number[];
    skus?: string[];
    search?: string;
    category_id?: string;
    include_descendants?: boolean;
    status?: 'active' | 'inactive' | 'all' | '';
    featured?: 'true' | 'false' | '';
    brand?: string;
    ai_seo_status?: 'optimized' | 'not_optimized' | 'running' | 'failed';
    batch_size?: number;
  }): Promise<BulkSelectionIdsResult> {
    const response = await apiClient.post<APIResponse<BulkSelectionIdsResult>>('/admin/products/selection-ids', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to fetch product selection');
  }

  static async bulkApplyCategoryImage(payload: {
    ids?: number[];
    skus?: string[];
    search?: string;
    category_id?: string;
    include_descendants?: boolean;
    status?: 'active' | 'inactive' | 'all' | '';
    featured?: 'true' | 'false' | '';
    brand?: string;
    batch_size?: number;
    media_asset_id: number;
    apply_mode?: 'fill_empty' | 'replace_all';
  }): Promise<BulkCategoryImageResult> {
    const response = await apiClient.put<APIResponse<BulkCategoryImageResult>>('/admin/products/bulk-category-image', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to apply category image');
  }

  // Admin: Download XLSX import template
  static async downloadImportTemplate(brand?: string): Promise<Blob> {
    const query = brand ? `?brand=${encodeURIComponent(brand)}` : '';
    const response = await apiClient.get(
      `/admin/products/import/template${query}`,
      { responseType: 'blob' }
    );
    return response.data as Blob;
  }

  // Admin: Import products via XLSX (model/price/quantity/weight/category)
  static async importProductsXlsx(
    file: File,
    opts?: { brand?: string; overwrite?: boolean; create_missing?: boolean },
    onUploadProgress?: (progressPct: number) => void
  ): Promise<ProductImportTaskSnapshot> {
    const form = new FormData();
    form.append('file', file);
    if (opts?.brand) form.append('brand', String(opts.brand));
    if (typeof opts?.overwrite === 'boolean') form.append('overwrite', String(opts.overwrite));
    if (typeof opts?.create_missing === 'boolean') form.append('create_missing', String(opts.create_missing));

    const response = await apiClient.post<APIResponse<ProductImportTaskSnapshot>>('/admin/products/import/xlsx', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (!onUploadProgress || !event?.total) return;
        const pct = Math.min(100, Math.max(0, Math.round((event.loaded * 100) / event.total)));
        onUploadProgress(pct);
      },
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Failed to import products');
  }

  // Admin: import quote exports (品牌/型号/价格/交期) from CSV.
  static async importProductQuotesCsv(
    file: File,
    onUploadProgress?: (progressPct: number) => void
  ): Promise<ProductImportTaskSnapshot> {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<APIResponse<ProductImportTaskSnapshot>>('/admin/products/import/csv', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (!onUploadProgress || !event?.total) return;
        onUploadProgress(Math.min(100, Math.max(0, Math.round((event.loaded * 100) / event.total))));
      },
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Failed to import quote CSV');
  }

  static async getImportProductsTask(taskId: string): Promise<ProductImportTaskSnapshot> {
    const response = await apiClient.get<APIResponse<ProductImportTaskSnapshot>>(`/admin/products/import/xlsx/tasks/${encodeURIComponent(taskId)}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Failed to fetch import task');
  }

  // Get featured products (public)
  static async getFeaturedProducts(limit: number = 8): Promise<Product[]> {
    try {
      // Reuse getProducts so filtering and response handling stay consistent.
      const res = await this.getProducts({ is_featured: 'true', page_size: limit });
      return res.data || [];
    } catch {
      // A missing backend must not turn into fabricated prices or stock claims.
      return [];
    }
  }

  // Search products (public)
  static async searchProducts(query: string, filters: Omit<ProductFilters, 'search'> = {}): Promise<PaginationResponse<Product>> {
    const searchFilters = { ...filters, search: query };
    return this.getProducts(searchFilters);
  }

  // Get product images (admin)
  static async getProductImages(productId: number): Promise<ProductImageRecord[]> {
    const response = await apiClient.get<APIResponse<ProductImageRecord[]>>(
      `/admin/products/${productId}/images`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to fetch product images');
  }

  // Add image (admin)
  static async addImage(productId: number, imageData: {
    url: string;
    alt_text?: string;
    is_primary?: boolean;
    sort_order?: number;
  }): Promise<ProductImageRecord> {
    const response = await apiClient.post<APIResponse<ProductImageRecord>>(
      `/admin/products/${productId}/images`,
      imageData
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to add image');
  }

  // Delete image (admin)
  static async deleteImage(productId: number, imageId: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<void>>(
      `/admin/products/${productId}/images/${imageId}`
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to delete image');
    }
  }
}

export default ProductService;
