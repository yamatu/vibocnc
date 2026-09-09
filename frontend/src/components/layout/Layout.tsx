'use client';

import { ReactNode } from 'react';
import Header from './Header';
import Footer from './Footer';
import WhatsAppButton from '../ui/WhatsAppButton';
import MobileLanguageSwitcher from './MobileLanguageSwitcher';
import FloatingCartButton from '../cart/FloatingCartButton';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="site-public min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
      <MobileLanguageSwitcher />
      <WhatsAppButton />
      <FloatingCartButton />
    </div>
  );
}
