import { ReactNode } from 'react';
import Header from './Header';
import Footer from './Footer';
import DeferredPublicWidgets from './DeferredPublicWidgets';
import type { SocialMediaSettings } from '@/types';
import FloatingCartButton from '../cart/FloatingCartButton';
import { CartSidebar } from '../cart/CartSidebar';

interface PublicLayoutProps {
  children: ReactNode;
  socialMediaSettings?: SocialMediaSettings | null;
}

export function PublicLayout({ children, socialMediaSettings }: PublicLayoutProps) {
  return (
    <div className="site-public min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-md bg-white px-4 py-2 font-semibold text-slate-950 shadow-lg ring-2 ring-[#003a78] transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>
      <Header />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        {children}
      </main>
      <Footer initialSocialSettings={socialMediaSettings} />
      <FloatingCartButton />
      <CartSidebar />
      <DeferredPublicWidgets />
    </div>
  );
}

export default PublicLayout;
