'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ShoppingCartIcon,
  HeartIcon,
  EyeIcon,
  EnvelopeIcon
} from '@heroicons/react/24/outline';
import { HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, hasProductPrice, toProductPathId } from '@/lib/utils';
import { useCartStore } from '@/store/cart.store';
import { buildQuoteProductContext, useQuoteModalStore } from '@/store/quote-modal.store';
import type { Product } from '@/types';

/* Product shape is shared with cart and API services. */
/* interface Product {
  id: number;
  sku: string;
  name: string;
  slug: string;
  short_description?: string;
  description?: string;
  price: number;
  compare_price?: number;
  brand?: string;
  model?: string;
  part_number?: string;
  category_id: number;
  is_active: boolean;
  is_featured: boolean;
  images?: any[];
  image_urls?: string[];
  created_at: string;
  updated_at: string;
} */

interface ProductCardProps {
  product: Product;
  showFavorite?: boolean;
  className?: string;
}

export default function ProductCard({ 
  product, 
  showFavorite = true, 
  className = '' 
}: ProductCardProps) {
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { addItem } = useCartStore();
  const openQuoteModal = useQuoteModalStore((state) => state.openQuoteModal);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsLoading(true);
    try {
      addItem(product, 1);
      // You could add a toast notification here
    } catch (error) {
      console.error('Failed to add to cart:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenQuote = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openQuoteModal(buildQuoteProductContext(product));
  };

  const toggleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFavorite(!isFavorite);
    // You could add favorite functionality here
  };

  // Use image_urls array directly from API response
  const imageUrl = getProductImageUrl(product.image_urls || [], getDefaultProductImageWithSku(product.sku));

  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-lg transition-shadow duration-200 ${className}`}>
      <div className="relative">
        {/* Product Image */}
        <Link href={`/products/${toProductPathId(product.sku)}`} className="block">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-lg bg-slate-100">
            <Image
              src={imageUrl}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-contain object-center p-2"
            />
          </div>
        </Link>

        {/* Favorite Button */}
        {showFavorite && (
          <button
            onClick={toggleFavorite}
            className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:shadow-lg transition-shadow z-10"
          >
            {isFavorite ? (
              <HeartIconSolid className="h-5 w-5 text-red-500" />
            ) : (
              <HeartIcon className="h-5 w-5 text-gray-400 hover:text-red-500" />
            )}
          </button>
        )}

        {/* Badges — stacked vertically to avoid overlap */}
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
          {product.is_featured && (
            <div className="bg-orange-500 text-white px-2 py-1 rounded-md text-xs font-medium">
              Featured
            </div>
          )}
          {hasProductPrice(product) && product.compare_price && product.compare_price > product.price && (
            <div className="bg-red-500 text-white px-2 py-1 rounded-md text-xs font-medium">
              Sale
            </div>
          )}
        </div>
      </div>

      {/* Product Info */}
      <div className="p-4">
        <Link href={`/products/${toProductPathId(product.sku)}`}>
          <h3 className="text-lg font-medium text-slate-950 mb-2 line-clamp-2 hover:text-[var(--site-primary)] transition-colors cursor-pointer">
            {product.name}
          </h3>
        </Link>

        <p className="text-sm text-slate-500 mb-2">
          SKU: {product.sku}
        </p>

        {product.brand && (
          <p className="text-sm text-slate-500 mb-2">
            Brand: {product.brand}
          </p>
        )}

        {product.short_description && (
          <p className="text-sm text-slate-600 mb-4 line-clamp-2">
            {product.short_description}
          </p>
        )}

        {/* Price */}
        {hasProductPrice(product) && (
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold text-[var(--site-primary)]">
                {formatCurrency(product.price)}
              </span>
              {product.compare_price && product.compare_price > product.price && (
                <span className="text-sm text-gray-500 line-through">
                  {formatCurrency(product.compare_price)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {hasProductPrice(product) ? (
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={isLoading}
                className="site-primary-action site-buy-action h-9 flex-1 gap-1.5 whitespace-nowrap px-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShoppingCartIcon className="h-4 w-4 shrink-0" />
                <span>{isLoading ? 'Adding...' : 'Add to Cart'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleOpenQuote}
                className="site-primary-action h-9 flex-1 gap-1.5 whitespace-nowrap px-3 text-sm"
              >
                <EnvelopeIcon className="h-4 w-4 shrink-0" />
                <span>Contact for quote</span>
              </button>
            )}
            <Link
              href={`/products/${toProductPathId(product.sku)}`}
              className="site-secondary-action h-9 w-9 shrink-0"
              title="View Details"
              aria-label={`View ${product.name} details`}
            >
              <EyeIcon className="h-4 w-4" />
            </Link>
          </div>
          {hasProductPrice(product) && (
            <button
              type="button"
              onClick={handleOpenQuote}
              className="site-secondary-action h-8 w-full gap-1.5 whitespace-nowrap px-3 text-xs"
            >
              <EnvelopeIcon className="h-3.5 w-3.5 shrink-0" />
              <span>Request Quote</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
