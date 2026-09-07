import { apiClient } from '@/lib/api';
import { APIResponse, PaginationResponse, Article, ArticleCreateRequest } from '@/types';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface NewsFilters {
  page?: number;
  page_size?: number;
  search?: string;
  is_published?: string;
  is_featured?: string | boolean;
  content_type?: 'news' | 'blog';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class NewsService {
  // ---- Public ----

  static async getArticles(filters: NewsFilters = {}): Promise<PaginationResponse<Article>> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value).trim());
      }
    });
    const qs = params.toString();
    const url = `/public/news${qs ? '?' + qs : ''}`;
    const response = await apiClient.get<APIResponse<PaginationResponse<Article>>>(url);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to fetch articles');
  }

  static async getArticleById(id: number): Promise<Article> {
    const response = await apiClient.get<APIResponse<Article>>(`/public/news/${id}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Article not found');
  }

  static async getArticleBySlug(slug: string, contentType?: 'news' | 'blog'): Promise<Article> {
    const suffix = contentType ? `?content_type=${contentType}` : '';
    const response = await apiClient.get<APIResponse<Article>>(`/public/news/slug/${encodeURIComponent(slug)}${suffix}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Article not found');
  }

  static async getArticleByPath(path: string): Promise<Article> {
    const normalized = path.split('/').map(encodeURIComponent).join('/');
    const response = await apiClient.get<APIResponse<Article>>(`/public/news/path/${normalized}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Article not found');
  }

  // ---- Admin ----

  static async getAdminArticles(filters: NewsFilters = {}): Promise<PaginationResponse<Article>> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value).trim());
      }
    });
    const qs = params.toString();
    const url = `/admin/news${qs ? '?' + qs : ''}`;
    const response = await apiClient.get<APIResponse<PaginationResponse<Article>>>(url);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to fetch articles');
  }

  static async getAdminArticle(id: number): Promise<Article> {
    const response = await apiClient.get<APIResponse<Article>>(`/admin/news/${id}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Article not found');
  }

  static async createArticle(data: ArticleCreateRequest): Promise<Article> {
    const response = await apiClient.post<APIResponse<Article>>('/admin/news', data);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to create article');
  }

  static async updateArticle(id: number, data: Partial<ArticleCreateRequest>): Promise<Article> {
    const response = await apiClient.put<APIResponse<Article>>(`/admin/news/${id}`, data);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || 'Failed to update article');
  }

  static async deleteArticle(id: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<void>>(`/admin/news/${id}`);
    if (!response.data.success) throw new Error(response.data.message || 'Failed to delete article');
  }
}

export default NewsService;
