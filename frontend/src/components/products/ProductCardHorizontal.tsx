'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingCartIcon, EyeIcon } from '@heroicons/react/24/outline';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, toProductPathId } from '@/lib/utils';
import { useCartStore } from '@/store/cart.store';

type Product = {
  id: number;
  sku: string;
  name: string;
  slug: string;
  short_description?: string;
  description?: string;
  price: number;
  compare_price?: number;
  brand?: string;
  category_id: number;
  is_active: boolean;
  is_featured: boolean;
  image_urls?: string[];
  images?: any[];
};

export default function ProductCardHorizontal({ product }: { product: Product }) {
  const [isLoading, setIsLoading] = useState(false);
  const { addItem } = useCartStore();

  const imageUrl = getProductImageUrl(product.image_urls || product.images || [], getDefaultProductImageWithSku(product.sku));
  const href = `/products/${toProductPathId(product.sku)}`;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsLoading(true);
    try {
      addItem(product as any, 1);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Link
      href={href}
      className="site-product-card group flex"
    >
      <div className="site-product-media relative w-44 sm:w-48 shrink-0">
        <div className="relative aspect-[4/3] w-full">
          {imageUrl && imageUrl !== '/images/placeholder.svg' ? (
            <Image
              src={imageUrl}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 44vw, 240px"
              className="object-cover object-center"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No Image</div>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 p-4 flex flex-col">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="site-product-title text-base sm:text-lg font-semibold line-clamp-2">
              {product.name}
            </h3>
            {product.is_featured ? (
              <span className="site-chip shrink-0">Featured</span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-gray-500">SKU: {product.sku}</div>
          {product.short_description || product.description ? (
            <p className="mt-2 text-sm text-gray-600 line-clamp-2">
              {product.short_description || product.description}
            </p>
          ) : null}
        </div>

        <div className="mt-auto pt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-[#0b3e75]">{formatCurrency(product.price)}</span>
              {product.compare_price && product.compare_price > product.price ? (
                <span className="text-sm text-gray-500 line-through">{formatCurrency(product.compare_price)}</span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="site-secondary-action hidden gap-1 px-3 py-2 text-sm sm:inline-flex">
              <EyeIcon className="h-4 w-4" />
              View
            </span>
            <button
              onClick={handleAddToCart}
              disabled={isLoading}
              className="site-primary-action gap-1 px-3 py-2 text-sm disabled:opacity-60"
            >
              <ShoppingCartIcon className="h-4 w-4" />
              {isLoading ? 'Adding' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}
