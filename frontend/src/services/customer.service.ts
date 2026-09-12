import { apiClient } from '@/lib/api';
import { APIResponse, Order } from '@/types';

export interface Customer {
  id: number;
  email: string;
  full_name: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  is_active: boolean;
  is_verified: boolean;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RegisterRequest {
  email: string;
  email_code?: string;
  password: string;
  full_name: string;
  phone?: string;
  company?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  customer: Customer;
}

export interface ProfileUpdateRequest {
  full_name?: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

export class CustomerService {
  // 注册
  static async register(data: RegisterRequest): Promise<LoginResponse> {
    const response = await apiClient.post<APIResponse<LoginResponse>>(
      '/customer/register',
      data
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Registration failed');
  }

  // 登录
  static async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await apiClient.post<APIResponse<LoginResponse>>(
      '/customer/login',
      data
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Login failed');
  }

  // 获取个人资料
  static async getProfile(): Promise<Customer> {
    const response = await apiClient.get<APIResponse<Customer>>(
      '/customer/profile'
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error('Failed to fetch profile');
  }

  // 更新个人资料
  static async updateProfile(data: ProfileUpdateRequest): Promise<Customer> {
    const response = await apiClient.put<APIResponse<Customer>>(
      '/customer/profile',
      data
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error('Failed to update profile');
  }

  // 修改密码
  static async changePassword(data: ChangePasswordRequest): Promise<void> {
    const response = await apiClient.post<APIResponse<void>>(
      '/customer/change-password',
      data
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to change password');
    }
  }

  // 获取我的订单
  static async getMyOrders(params?: { status?: string }): Promise<Order[]> {
    try {
      const response = await apiClient.get<APIResponse<Order[]>>(
        '/customer/orders',
        { params }
      );

      if (response.data.success && response.data.data) {
        return response.data.data;
      }

      return [];
    } catch (error: unknown) {
      console.error('Failed to fetch customer orders:', error);
      // 如果是401未授权错误，返回空数组（用户未登录）
      if (typeof error === 'object' && error !== null && 'response' in error && (error as { response?: { status?: number } }).response?.status === 401) {
        return [];
      }
      throw error;
    }
  }

  // 获取订单详情
  static async getOrderDetails(orderId: number): Promise<Order> {
    try {
      const response = await apiClient.get<APIResponse<Order>>(
        `/customer/orders/${orderId}`
      );

      if (response.data.success && response.data.data) {
        return response.data.data;
      }

      throw new Error('Order not found');
    } catch (error: unknown) {
      console.error('Failed to fetch order details:', error);
      throw error;
    }
  }
}
