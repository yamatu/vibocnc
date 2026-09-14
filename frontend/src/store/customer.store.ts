import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authUtils } from '@/lib/api';
import type { Customer, LoginRequest, RegisterRequest } from '@/services/customer.service';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface CustomerAuthState {
  customer: Customer | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface CustomerAuthActions {
  login: (credentials: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  setCustomer: (customer: Customer) => void;
  updateCustomer: (customer: Customer) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  checkAuth: () => Promise<void>;
}

export const useCustomerStore = create<CustomerAuthState & CustomerAuthActions>()(
  persist(
    (set) => ({
      // State
      customer: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Actions
      login: async (credentials) => {
        try {
          set({ isLoading: true, error: null });
          const { CustomerService } = await import('@/services/customer.service');
          const response = await CustomerService.login(credentials);

          // The JWT is stored by the backend in an HttpOnly cookie; only the
          // non-sensitive expiry marker is written here.
          authUtils.setCustomerToken(response.token);

          set({
            customer: response.customer,
            token: null,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: unknown) {
          set({
            error: getErrorMessage(error, 'Login failed'),
            isLoading: false,
          });
          throw error;
        }
      },

      register: async (data) => {
        try {
          set({ isLoading: true, error: null });
          const { CustomerService } = await import('@/services/customer.service');
          const response = await CustomerService.register(data);

          authUtils.setCustomerToken(response.token);

          set({
            customer: response.customer,
            token: null,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: unknown) {
          set({
            error: getErrorMessage(error, 'Registration failed'),
            isLoading: false,
          });
          throw error;
        }
      },

      logout: () => {
        // Best-effort server-side cookie clear; never block the UI on it.
        void import('@/services/customer.service')
          .then(({ CustomerService }) => CustomerService.logout())
          .catch(() => undefined);
        authUtils.removeCustomerToken();
        set({
          customer: null,
          token: null,
          isAuthenticated: false,
          error: null,
        });
      },

      setCustomer: (customer) => {
        set({
          customer,
          isAuthenticated: !!customer,
        });
      },

      updateCustomer: (customer) => {
        set({ customer });
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setError: (error) => {
        set({ error });
      },

      clearError: () => {
        set({ error: null });
      },

      checkAuth: async () => {
        try {
          set({ isLoading: true });
          const hasSession = authUtils.isCustomerAuthenticated();

          if (hasSession) {
            try {
              const { CustomerService } = await import('@/services/customer.service');
              const customer = await CustomerService.getProfile();
              set({
                customer,
                token: null,
                isAuthenticated: true,
                isLoading: false,
              });
            } catch {
              // Session is invalid, clear auth state
              authUtils.removeCustomerToken();
              set({
                customer: null,
                token: null,
                isAuthenticated: false,
                isLoading: false,
              });
            }
          } else {
            set({
              customer: null,
              token: null,
              isAuthenticated: false,
              isLoading: false,
            });
          }
        } catch {
          set({
            customer: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },
    }),
    {
      name: 'customer-auth-storage',
      partialize: (state) => ({
        customer: state.customer,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Selectors
export const useCustomer = () => {
  const store = useCustomerStore();
  return {
    customer: store.customer,
    token: store.token,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,
    error: store.error,
    login: store.login,
    register: store.register,
    logout: store.logout,
    setCustomer: store.setCustomer,
    updateCustomer: store.updateCustomer,
    setLoading: store.setLoading,
    setError: store.setError,
    clearError: store.clearError,
    checkAuth: store.checkAuth,
  };
};

// Helper hooks
export const useCustomerData = () => useCustomerStore((state) => state.customer);
export const useIsCustomerAuthenticated = () => useCustomerStore((state) => state.isAuthenticated);
export const useCustomerLoading = () => useCustomerStore((state) => state.isLoading);
export const useCustomerError = () => useCustomerStore((state) => state.error);
