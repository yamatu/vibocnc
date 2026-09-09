'use client';

import { useEffect, useState } from 'react';
import { ShoppingCartIcon } from '@heroicons/react/24/outline';
import { useCartStore } from '@/store/cart.store';

export default function FloatingCartButton() {
  const [mounted, setMounted] = useState(false);
  const itemCount = useCartStore((state) => state.itemCount);
  const isOpen = useCartStore((state) => state.isOpen);
  const toggleCart = useCartStore((state) => state.toggleCart);

  useEffect(() => setMounted(true), []);

  if (!mounted || itemCount <= 0 || isOpen) return null;

  return (
    <button
      type="button"
      onClick={toggleCart}
      aria-label={`Shopping cart (${itemCount})`}
      className="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[#0b3e75] text-white shadow-xl transition-colors hover:bg-[#082f59] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 sm:right-6 sm:bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] sm:h-16 sm:w-16"
    >
      <ShoppingCartIcon className="h-6 w-6 sm:h-8 sm:w-8" aria-hidden="true" />
      <span aria-live="polite" className="absolute -right-1 -top-1 min-w-6 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-xs font-bold text-white ring-2 ring-white">
        {itemCount}
      </span>
    </button>
  );
}
