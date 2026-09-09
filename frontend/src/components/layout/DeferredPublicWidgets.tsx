'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import FloatingCartButton from '@/components/cart/FloatingCartButton';

const CartSidebar = lazy(() =>
  import('@/components/cart/CartSidebar').then((module) => ({ default: module.CartSidebar })),
);
const MobileLanguageSwitcher = lazy(() => import('./MobileLanguageSwitcher'));
const WhatsAppButton = lazy(() => import('@/components/ui/WhatsAppButton'));

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export default function DeferredPublicWidgets() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const idleWindow = window as IdleWindow;
    const showWidgets = () => setReady(true);
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;

    const schedule = () => {
      window.removeEventListener('load', schedule);
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(showWidgets, { timeout: 5000 });
      } else {
        timeoutHandle = window.setTimeout(showWidgets, 1500);
      }
    };

    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });

    return () => {
      window.removeEventListener('load', schedule);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <CartSidebar />
      <FloatingCartButton />
      <MobileLanguageSwitcher />
      <WhatsAppButton />
    </Suspense>
  );
}
