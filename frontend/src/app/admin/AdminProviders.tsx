'use client';

import { AdminI18nProvider } from '@/lib/admin-i18n';
import { Toaster } from 'react-hot-toast';
import { ReactQueryProvider } from '@/lib/react-query';

export default function AdminProviders({ children }: { children: React.ReactNode }) {
  return (
    <ReactQueryProvider>
      <AdminI18nProvider>{children}</AdminI18nProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { background: '#363636', color: '#fff' },
          success: { duration: 3000, iconTheme: { primary: '#10B981', secondary: '#fff' } },
          error: { duration: 5000, iconTheme: { primary: '#EF4444', secondary: '#fff' } },
        }}
      />
    </ReactQueryProvider>
  );
}
