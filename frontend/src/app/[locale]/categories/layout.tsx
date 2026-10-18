'use client';

import type { ReactNode } from 'react';
import { ReactQueryProvider } from '@/lib/react-query';

export default function CategoriesLayout({ children }: { children: ReactNode }) {
  return <ReactQueryProvider>{children}</ReactQueryProvider>;
}
