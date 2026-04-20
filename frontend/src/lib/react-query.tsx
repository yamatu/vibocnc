'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, ReactNode } from 'react';

// Create a client
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 60 * 1000, // 1 minute
        retry: (failureCount, error: any) => {
          // Don't retry on 4xx errors
          if (error?.response?.status >= 400 && error?.response?.status < 500) {
            return false;
          }
          // Retry up to 3 times for other errors
          return failureCount < 3;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

interface ReactQueryProviderProps {
  children: ReactNode;
}

export function ReactQueryProvider({ children }: ReactQueryProviderProps) {
  // NOTE: Avoid useState when initializing the query client if you don't
  // have a suspense boundary between this and the code that may
  // suspend because React will throw away the client on the initial
  // render if it suspends and there is no boundary
  const [queryClient] = useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

// Query keys factory
export const queryKeys = {
  // Auth
  auth: {
    profile: () => ['auth', 'profile'] as const,
  },
  
  // Products
  products: {
    all: () => ['products'] as const,
    lists: () => [...queryKeys.products.all(), 'list'] as const,
    list: (filters: any) => [...queryKeys.products.lists(), filters] as const,
    details: () => [...queryKeys.products.all(), 'detail'] as const,
    detail: (id: number) => [...queryKeys.products.details(), id] as const,
    detailBySku: (sku: string) => [...queryKeys.products.details(), 'sku', sku] as const,
    featured: () => [...queryKeys.products.all(), 'featured'] as const,
    search: (query: string) => [...queryKeys.products.all(), 'search', query] as const,
  },

  // eBay import drafts
  ebayImportDrafts: {
    all: () => ['ebayImportDrafts'] as const,
    lists: () => [...queryKeys.ebayImportDrafts.all(), 'list'] as const,
    list: (filters: any) => [...queryKeys.ebayImportDrafts.lists(), filters] as const,
    details: () => [...queryKeys.ebayImportDrafts.all(), 'detail'] as const,
    detail: (id: number) => [...queryKeys.ebayImportDrafts.details(), id] as const,
  },

  // Categories
  categories: {
    all: () => ['categories'] as const,
    lists: () => [...queryKeys.categories.all(), 'list'] as const,
    admin: () => [...queryKeys.categories.all(), 'admin'] as const,
    details: () => [...queryKeys.categories.all(), 'detail'] as const,
    detail: (id: number) => [...queryKeys.categories.details(), id] as const,
    tree: () => [...queryKeys.categories.all(), 'tree'] as const,
  },

  // Orders
  orders: {
    all: () => ['orders'] as const,
    lists: () => [...queryKeys.orders.all(), 'list'] as const,
    list: (filters: any) => [...queryKeys.orders.lists(), filters] as const,
    details: () => [...queryKeys.orders.all(), 'detail'] as const,
    detail: (id: number) => [...queryKeys.orders.details(), id] as const,
    recent: () => [...queryKeys.orders.all(), 'recent'] as const,
  },

  // Users
  users: {
    all: () => ['users'] as const,
    lists: () => [...queryKeys.users.all(), 'list'] as const,
    list: (filters: any) => [...queryKeys.users.lists(), filters] as const,
    details: () => [...queryKeys.users.all(), 'detail'] as const,
    detail: (id: number) => [...queryKeys.users.details(), id] as const,
  },

  // Banners
  banners: {
    all: () => ['banners'] as const,
    public: () => [...queryKeys.banners.all(), 'public'] as const,
    admin: () => [...queryKeys.banners.all(), 'admin'] as const,
    detail: (id: number) => [...queryKeys.banners.all(), 'detail', id] as const,
    byType: (type: string) => [...queryKeys.banners.all(), 'type', type] as const,
  },

  // Homepage
  homepage: {
    all: () => ['homepage'] as const,
    contents: () => [...queryKeys.homepage.all(), 'contents'] as const,
    section: (key: string) => [...queryKeys.homepage.all(), 'section', key] as const,
    adminContents: () => [...queryKeys.homepage.all(), 'admin', 'contents'] as const,
  },

  // Settings
  // Dashboard
  dashboard: {
    stats: () => ['dashboard', 'stats'] as const,
    revenue: (period: string) => ['dashboard', 'revenue', period] as const,
    topProducts: (limit: number) => ['dashboard', 'top-products', limit] as const,
    recentOrders: (limit: number) => ['dashboard', 'recent-orders', limit] as const,
    orderStatus: () => ['dashboard', 'order-status'] as const,
  },

  // Analytics
  analytics: {
    all: () => ['analytics'] as const,
    overview: (filters: any) => [...queryKeys.analytics.all(), 'overview', filters] as const,
    visitors: (filters: any) => [...queryKeys.analytics.all(), 'visitors', filters] as const,
    countries: (filters: any) => [...queryKeys.analytics.all(), 'countries', filters] as const,
    pages: (filters: any) => [...queryKeys.analytics.all(), 'pages', filters] as const,
    trends: (filters: any) => [...queryKeys.analytics.all(), 'trends', filters] as const,
    countryVisitors: (filters: any) => [...queryKeys.analytics.all(), 'country-visitors', filters] as const,
    productSKUs: (filters: any) => [...queryKeys.analytics.all(), 'product-skus', filters] as const,
    countrySKUs: (filters: any) => [...queryKeys.analytics.all(), 'country-skus', filters] as const,
    settings: () => [...queryKeys.analytics.all(), 'settings'] as const,
  },

  // Contact Messages
  contacts: {
    all: () => ['contacts'] as const,
    lists: () => [...queryKeys.contacts.all(), 'list'] as const,
    list: (filters: any) => [...queryKeys.contacts.lists(), filters] as const,
    details: () => [...queryKeys.contacts.all(), 'detail'] as const,
    detail: (id: number) => [...queryKeys.contacts.details(), id] as const,
    stats: () => [...queryKeys.contacts.all(), 'stats'] as const,
  },

  // Media Library
  media: {
    all: () => ['media'] as const,
    lists: () => [...queryKeys.media.all(), 'list'] as const,
    list: (filters: any) => [...queryKeys.media.lists(), filters] as const,
    details: () => [...queryKeys.media.all(), 'detail'] as const,
    detail: (id: number) => [...queryKeys.media.details(), id] as const,
    watermarkSettings: () => [...queryKeys.media.all(), 'watermark', 'settings'] as const,
  },

  // Shipping Rates
  shippingRates: {
    all: () => ['shippingRates'] as const,
    public: () => [...queryKeys.shippingRates.all(), 'public'] as const,
    admin: () => [...queryKeys.shippingRates.all(), 'admin'] as const,
  },

  // News / Articles
  news: {
    all: () => ['news'] as const,
    lists: () => [...queryKeys.news.all(), 'list'] as const,
    list: (filters: any) => [...queryKeys.news.lists(), filters] as const,
    details: () => [...queryKeys.news.all(), 'detail'] as const,
    detail: (id: number) => [...queryKeys.news.details(), id] as const,
    detailBySlug: (slug: string) => [...queryKeys.news.details(), 'slug', slug] as const,
  },
};

export default ReactQueryProvider;
