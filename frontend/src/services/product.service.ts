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
}

export interface ProductImportResult {
  brand: string;
  total_rows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  items: Array<{
    row_number: number;
    model: string;
    action: string;
    product_id?: number;
    sku?: string;
    message?: string;
  }>;
  template: string;
  overwrite: boolean;
  create_missing: boolean;
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
  message?: string;
  result?: ProductImportResult;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface BulkAutoCategorizeResultItem {
  product_id: number;
  sku: string;
  model: string;
  brand: string;
  category_slug: string;
  category_id: number;
  previous_category_id: number;
  part_type: string;
  match_rule: string;
  action: string;
}

export interface BulkAutoCategorizeResult {
  updated: number;
  skipped: number;
  failed: number;
  items: BulkAutoCategorizeResultItem[];
}

export interface BulkCategoryImageResult {
  updated: number;
  skipped: number;
  image_url: string;
  apply_mode: 'fill_empty' | 'replace_all';
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
        console.warn('🔧 Backend server appears to be down or timed out, returning mock data');
        return this.getMockProductsData(filters);
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
          name: 'Servo Drives',
          slug: 'servo-drives',
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
          name: 'Servo Motors',
          slug: 'servo-motors',
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
    status?: 'active' | 'inactive' | 'all' | '';
    featured?: 'true' | 'false' | '';
    batch_size?: number;
  }): Promise<{ updated: number; skipped: number }> {
    const response = await apiClient.put<APIResponse<{ updated: number; skipped: number }>>('/admin/products/bulk-default-image/apply', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to apply default images');
  }

  static async bulkRemoveDefaultImage(payload: {
    ids?: number[];
    skus?: string[];
    search?: string;
    category_id?: string;
    status?: 'active' | 'inactive' | 'all' | '';
    featured?: 'true' | 'false' | '';
    batch_size?: number;
  }): Promise<{ updated: number; removed: number; skipped: number }> {
    const response = await apiClient.put<APIResponse<{ updated: number; removed: number; skipped: number }>>('/admin/products/bulk-default-image/remove', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to remove default images');
  }

  static async bulkAutoCategorize(payload: {
    ids?: number[];
    skus?: string[];
    search?: string;
    category_id?: string;
    status?: 'active' | 'inactive' | 'all' | '';
    featured?: 'true' | 'false' | '';
    brand?: string;
    batch_size?: number;
  }): Promise<BulkAutoCategorizeResult> {
    const response = await apiClient.put<APIResponse<BulkAutoCategorizeResult>>('/admin/products/bulk-auto-categorize', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to auto categorize products');
  }

  static async bulkApplyCategoryImage(payload: {
    ids?: number[];
    skus?: string[];
    search?: string;
    category_id?: string;
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
  static async downloadImportTemplate(brand: string = 'fanuc'): Promise<Blob> {
    const response = await apiClient.get(
      `/admin/products/import/template?brand=${encodeURIComponent(brand)}`,
      { responseType: 'blob' }
    );
    return response.data as Blob;
  }

  // Admin: Import products via XLSX (model/price/quantity)
  static async importProductsXlsx(
    file: File,
    opts?: { brand?: string; overwrite?: boolean; create_missing?: boolean },
    onUploadProgress?: (progressPct: number) => void
  ): Promise<ProductImportTaskSnapshot> {
    const form = new FormData();
    form.append('file', file);
    form.append('brand', String(opts?.brand || 'fanuc'));
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

  static async getImportProductsTask(taskId: string): Promise<ProductImportTaskSnapshot> {
    const response = await apiClient.get<APIResponse<ProductImportTaskSnapshot>>(`/admin/products/import/xlsx/tasks/${encodeURIComponent(taskId)}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Failed to fetch import task');
  }

  // Get featured products (public)
  static async getFeaturedProducts(limit: number = 8): Promise<Product[]> {
    try {
      // Reuse getProducts so we inherit its fallbacks and mocking
      const res = await this.getProducts({ is_featured: 'true', page_size: limit });
      return res.data || [];
    } catch {
      console.warn('🔧 Falling back to mock featured products');
      const mock = this.getMockProductsData({ is_featured: 'true', page_size: limit });
      return mock.data || [];
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
