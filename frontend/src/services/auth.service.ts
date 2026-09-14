import { apiClient, authUtils } from '@/lib/api';
import { 
  APIResponse, 
  LoginRequest, 
  LoginResponse, 
  AdminUser 
} from '@/types';

export class AuthService {
  // Login
  static async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await apiClient.post<APIResponse<LoginResponse>>(
      '/auth/login',
      credentials
    );
    
    if (response.data.success && response.data.data) {
      // Store token in cookies for exactly the JWT's lifetime
      authUtils.setToken(response.data.data.token, response.data.data.expires_at);
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Login failed');
  }

  // Logout
  static async logout(): Promise<void> {
    try {
      // Clears the HttpOnly session cookie server-side; the browser cannot do
      // that from JavaScript.
      await apiClient.post('/auth/logout');
    } catch {
      // Offline / already-expired sessions are fine to ignore.
    }
    authUtils.removeToken();
    // Redirect to login page
    if (typeof window !== 'undefined') {
      window.location.href = '/admin/login';
    }
  }

  // Get current user profile
  static async getProfile(): Promise<AdminUser> {
    const response = await apiClient.get<APIResponse<AdminUser>>(
      '/auth/profile'
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Failed to get profile');
  }

  // Update user profile
  static async updateProfile(profileData: Partial<AdminUser>): Promise<AdminUser> {
    const response = await apiClient.put<APIResponse<AdminUser>>(
      '/auth/profile',
      profileData
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Failed to update profile');
  }

  // Change password
  static async changePassword(passwordData: {
    current_password: string;
    new_password: string;
    confirm_password: string;
  }): Promise<void> {
    const response = await apiClient.post<APIResponse<void>>(
      '/auth/change-password',
      passwordData
    );
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to change password');
    }
  }

  // Admin forgot password: request verification code
  static async requestPasswordReset(email: string): Promise<void> {
    const response = await apiClient.post<APIResponse<void>>('/auth/password-reset/request', { email });
    if (!response.data.success) {
      throw new Error(response.data.message || response.data.error || 'Failed to request password reset');
    }
  }

  // Admin forgot password: confirm verification code and update password
  static async confirmPasswordReset(payload: {
    email: string;
    code: string;
    new_password: string;
    confirm_password: string;
  }): Promise<void> {
    const response = await apiClient.post<APIResponse<void>>('/auth/password-reset/confirm', payload);
    if (!response.data.success) {
      throw new Error(response.data.message || response.data.error || 'Failed to reset password');
    }
  }

  // Check if user is authenticated
  static isAuthenticated(): boolean {
    return authUtils.isAuthenticated();
  }

  // Get stored token
  static getToken(): string | undefined {
    return authUtils.getToken();
  }
}

export default AuthService;
