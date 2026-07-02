import { apiClient } from '@/lib/api';
import { 
  APIResponse, 
  Category, 
  CategoryCreateRequest 
} from '@/types';

export class CategoryService {
  // Get categories (public) - hierarchical structure
  static async getCategories(): Promise<Category[]> {
    try {
      const response = await apiClient.get<APIResponse<Category[]>>(
        '/public/categories'
      );

      if (response.data.success && response.data.data) {
        return response.data.data;
      }

      throw new Error(response.data.message || 'Failed to fetch categories');
    } catch (error: any) {
      console.error('❌ CategoryService.getCategories error:', error);

      // Check if it's a network error (backend not running) or timeout
      if (error.code === 'ECONNREFUSED' ||
          error.code === 'ECONNABORTED' ||
          error.message?.includes('Network Error') ||
          error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('timeout') ||
          error.message?.includes('aborted') ||
          (error.code === 23 && error.constructor?.name === 'TimeoutError') ||
          error.response?.status === 404 ||
          (error.response?.status && error.response.status >= 500)) {
        console.warn('🔧 Backend server appears to be down or timed out, returning mock categories');
        return this.getMockCategories();
      }

      throw error;
    }
  }

  // Mock categories fallback
  private static getMockCategories(): Category[] {
    return [
      {
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
      {
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
      {
        id: 3,
        name: 'FANUC PCB / Control Board',
        slug: 'fanuc-pcb-control-board',
        path: 'fanuc/fanuc-pcb-control-board',
        description: 'FANUC circuit boards and control modules',
        image_url: '',
        sort_order: 3,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
    ];
  }

  // Get single category (public)
  static async getCategory(id: number): Promise<Category> {
    const response = await apiClient.get<APIResponse<Category>>(
      `/public/categories/${id}`
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Category not found');
  }

  // Admin: Get categories
  static async getAdminCategories(): Promise<Category[]> {
    const response = await apiClient.get<APIResponse<Category[]>>(
      '/admin/categories?include_inactive=true&flat=true'
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Failed to fetch categories');
  }

  // Public: Resolve category by nested path (no /categories prefix)
  // Example path: "fanuc-controls/fanuc-power-mate"
  static async getCategoryByPath(path: string): Promise<{ category: Category; breadcrumb: Category[] }> {
    const safe = (path || '').replace(/^\/+|\/+$/g, '');
    const encoded = safe
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/');
    const response = await apiClient.get<APIResponse<{ category: Category; breadcrumb: Category[] }>>(
      `/public/categories/path/${encoded}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Category not found');
  }

  // Admin: Bulk reorder/nest categories
  static async reorderCategories(items: Array<{ id: number; parent_id?: number; sort_order: number }>): Promise<void> {
    const response = await apiClient.put<APIResponse<void>>('/admin/categories/reorder', items);
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to reorder categories');
    }
  }

  // Public: Get category by slug
  static async getCategoryBySlug(slug: string): Promise<Category> {
    const response = await apiClient.get<APIResponse<Category>>(
      `/public/categories/slug/${slug}`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Category not found');
  }

  // Admin: Get single category
  static async getAdminCategory(id: number): Promise<Category> {
    const response = await apiClient.get<APIResponse<Category>>(
      `/admin/categories/${id}`
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Category not found');
  }

  // Admin: Create category
  static async createCategory(categoryData: CategoryCreateRequest): Promise<Category> {
    const response = await apiClient.post<APIResponse<Category>>(
      '/admin/categories',
      categoryData
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Failed to create category');
  }

  // Admin: Update category
  static async updateCategory(id: number, categoryData: Partial<CategoryCreateRequest>): Promise<Category> {
    const response = await apiClient.put<APIResponse<Category>>(
      `/admin/categories/${id}`,
      categoryData
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Failed to update category');
  }

  // Admin: Delete category
  static async deleteCategory(id: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<void>>(
      `/admin/categories/${id}`
    );
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to delete category');
    }
  }

  // Get category tree (formatted for dropdowns)
  static async getCategoryTree(): Promise<Array<{ value: number; label: string; level: number }>> {
    const categories = await this.getCategories();
    return this.flattenCategoryTree(categories);
  }

  // Helper: Flatten category tree for dropdowns
  private static flattenCategoryTree(
    categories: Category[], 
    level: number = 0, 
    result: Array<{ value: number; label: string; level: number }> = []
  ): Array<{ value: number; label: string; level: number }> {
    categories.forEach(category => {
      const prefix = '—'.repeat(level);
      result.push({
        value: category.id,
        label: `${prefix} ${category.name}`,
        level
      });
      
      if (category.children && category.children.length > 0) {
        this.flattenCategoryTree(category.children, level + 1, result);
      }
    });
    
    return result;
  }

  // Get root categories only
  static async getRootCategories(): Promise<Category[]> {
    const categories = await this.getCategories();
    return categories.filter(cat => !cat.parent_id);
  }

  // Get category breadcrumb
  static async getCategoryBreadcrumb(categoryId: number): Promise<Category[]> {
    const category = await this.getCategory(categoryId);
    const breadcrumb: Category[] = [category];
    
    let currentCategory = category;
    while (currentCategory.parent) {
      breadcrumb.unshift(currentCategory.parent);
      currentCategory = currentCategory.parent;
    }
    
    return breadcrumb;
  }

  // Search categories
  static async searchCategories(query: string): Promise<Category[]> {
    const allCategories = await this.getCategories();
    const searchTerm = query.toLowerCase();
    
    const searchInCategory = (category: Category): boolean => {
      return category.name.toLowerCase().includes(searchTerm) ||
             category.description.toLowerCase().includes(searchTerm);
    };

    const filterCategories = (categories: Category[]): Category[] => {
      return categories.filter(category => {
        const matches = searchInCategory(category);
        const hasMatchingChildren = Array.isArray(category.children) &&
          filterCategories(category.children || []).length > 0;

        if (hasMatchingChildren) {
          category.children = filterCategories(category.children || []);
        }
        
        return matches || hasMatchingChildren;
      });
    };

    return filterCategories(allCategories);
  }
}

export default CategoryService;
