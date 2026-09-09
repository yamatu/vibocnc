import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { AuthService } from '@/services';
import { useAuthStore } from '@/store/auth.store';
import { queryKeys } from '@/lib/react-query';
import { AdminUser, LoginRequest } from '@/types';

// Hook for getting current user profile
export function useProfile() {
  const { user, setUser } = useAuthStore();
  
  const query = useQuery<AdminUser>({
    queryKey: queryKeys.auth.profile(),
    queryFn: async (): Promise<AdminUser> => AuthService.getProfile() as Promise<AdminUser>,
    enabled: !!user, // Only fetch if user exists in store
  });
  React.useEffect(() => { if (query.data) setUser(query.data as AdminUser); }, [query.data, setUser]);
  return query;
}

// Hook for login mutation
export function useLogin() {
  const router = useRouter();
  const { setUser, setLoading, setError } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: LoginRequest) => AuthService.login(credentials),
    onMutate: () => {
      setLoading(true);
      setError(null);
    },
    onSuccess: (data) => {
      setUser(data.user);
      setLoading(false);
      
      // Invalidate and refetch user profile
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.profile() });
      
      toast.success('Login successful');
      
      // Redirect to admin dashboard or intended page
      const searchParams = new URLSearchParams(window.location.search);
      const redirect = searchParams.get('redirect') || '/admin';
      router.push(redirect);
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || error.message || 'Login failed';
      setError(message);
      setLoading(false);
      toast.error(message);
    },
  });
}

// Hook for logout
export function useLogout() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => Promise.resolve(),
    onSuccess: () => {
      logout();
      
      // Clear all queries
      queryClient.clear();
      
      toast.success('Logged out successfully');
      router.push('/admin/login');
    },
  });
}

// Hook for updating profile
export function useUpdateProfile() {
  const { setUser } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileData: Partial<AdminUser>) => 
      AuthService.updateProfile(profileData),
    onSuccess: (data) => {
      setUser(data);
      
      // Update the profile query cache
      queryClient.setQueryData(queryKeys.auth.profile(), data);
      
      toast.success('Profile updated successfully');
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || 'Failed to update profile';
      toast.error(message);
    },
  });
}

// Hook for changing password
export function useChangePassword() {
  return useMutation({
    mutationFn: (passwordData: {
      current_password: string;
      new_password: string;
      confirm_password: string;
    }) => AuthService.changePassword(passwordData),
    onSuccess: () => {
      toast.success('Password changed successfully');
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || 'Failed to change password';
      toast.error(message);
    },
  });
}

// Hook for checking authentication status
export function useAuthCheck() {
  const { checkAuth, isAuthenticated, user } = useAuthStore();
  
  // Check auth status on mount
  React.useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return {
    isAuthenticated,
    user,
    isLoading: false, // We can add loading state if needed
  };
}

// Hook for role-based access control
export function usePermissions() {
  const { user } = useAuthStore();

  const hasRole = (role: string | string[]) => {
    if (!user) return false;
    
    if (Array.isArray(role)) {
      return role.includes(user.role);
    }
    
    return user.role === role;
  };

  const isAdmin = () => hasRole('admin');
  const isEditor = () => hasRole(['admin', 'editor']);
  const isViewer = () => hasRole(['admin', 'editor', 'viewer']);

  const canManageUsers = () => isAdmin();
  const canManageContent = () => isEditor();
  const canViewContent = () => isViewer();

  return {
    user,
    hasRole,
    isAdmin,
    isEditor,
    isViewer,
    canManageUsers,
    canManageContent,
    canViewContent,
  };
}

// Hook for protected route wrapper
export function useRequireAuth(requiredRole?: string | string[]) {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const { hasRole } = usePermissions();

  React.useEffect(() => {
    if (!isAuthenticated) {
      router.push('/admin/login');
      return;
    }

    if (requiredRole && !hasRole(requiredRole)) {
      toast.error('You do not have permission to access this page');
      router.push('/admin');
      return;
    }
  }, [isAuthenticated, user, requiredRole, router, hasRole]);

  return {
    isAuthenticated,
    user,
    hasPermission: !requiredRole || hasRole(requiredRole),
  };
}

// Main useAuth hook that combines all auth functionality
export function useAuth() {
  const { user, isAuthenticated } = useAuthStore();

  return {
    user,
    isAuthenticated,
  };
}
