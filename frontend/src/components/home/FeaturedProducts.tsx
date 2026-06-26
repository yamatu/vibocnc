'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { HomepageContent } from '@/types';
import {
  ShoppingCartIcon,
  EyeIcon,
  StarIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';
import { useCart } from '@/store/cart.store';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, toProductPathId } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ProductService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { DEFAULT_FEATURED_PRODUCTS_SECTION_DATA } from '@/lib/homepage-defaults';

// Fallback products with test images for development (using image_urls format)
const featuredProductsFallback: any[] = [
  {
    id: 1,
    name: 'FANUC A06B-6220-H006',
    sku: 'A06B-6220-H006',
    price: 1299.00,
    compare_price: 1499.00,
    stock_quantity: 15,
    image_urls: [
      'https://s2.loli.net/2025/09/01/ZxuFKAvIM3zUHj4.jpg',
      'https://s2.loli.net/2025/09/01/pxWRrVkNlO8Ugm4.jpg'
    ],
    features: ['High Performance', 'Reliable'],
    category: { name: 'PCB Boards' }
  },
  {
    id: 2,
    name: 'FANUC A20B-3300-0040',
    sku: 'A20B-3300-0040',
    price: 899.00,
    stock_quantity: 8,
    image_urls: [
      'https://s2.loli.net/2025/09/01/wMHu93Fv5egJ6pn.jpg'
    ],
    features: ['Industrial Grade', 'Long Life'],
    category: { name: 'Control Units' }
  },
  {
    id: 3,
    name: 'FANUC A06B-6240-H210',
    sku: 'A06B-6240-H210',
    price: 2199.00,
    stock_quantity: 0,
    image_urls: [
      'https://s2.loli.net/2025/09/01/3Rli1zNOEm5sA4T.jpg'
    ],
    features: ['Advanced Technology', 'High Precision'],
    category: { name: 'Servo Motors' }
  }
];


export function FeaturedProducts({ content }: { content?: HomepageContent | null }) {
  const [hoveredProduct, setHoveredProduct] = useState<number | null>(null);
  const { addItem } = useCart();

  const headerTitle = content?.title || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.headerTitle;
  const headerDescription = content?.description || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.headerDescription;
  const ctaText = content?.button_text || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.ctaText;
  const ctaHref = content?.button_url || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.ctaHref;

  // Load featured products dynamically with error handling
  const { data: featured = [], error: featuredError } = useQuery({
    queryKey: queryKeys.products.featured(),
    queryFn: () => ProductService.getFeaturedProducts(6),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false, // Don't retry on failure
  });

  // If no featured available, fallback to latest active products
  const { data: latestResp, error: latestError } = useQuery({
    queryKey: queryKeys.products.list({ page_size: 6, is_active: 'true' }),
    queryFn: () => ProductService.getProducts({ page_size: 6, is_active: 'true' }),
    enabled: Array.isArray(featured) && featured.length === 0 && !featuredError,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false, // Don't retry on failure
  });

  const latest = latestResp?.data ?? [];

  // Use fallback data if both API calls fail
  const products = featuredError && latestError
    ? featuredProductsFallback
    : (Array.isArray(featured) && featured.length > 0)
      ? featured
      : (Array.isArray(latest) ? latest : featuredProductsFallback);

  const handleAddToCart = (product: any) => {
    addItem(product, 1);
  };

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-950 mb-4">
            {headerTitle}
          </h2>
          <p className="text-xl text-slate-600 max-w-3xl mx-auto mb-8">
            {headerDescription}
          </p>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
          {products.map((product: any) => (
            <div
              key={product.id}
              className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden group"
              onMouseEnter={() => setHoveredProduct(product.id)}
              onMouseLeave={() => setHoveredProduct(null)}
            >
              {/* Product Image */}
              <div className="relative h-64 overflow-hidden">
                {(() => {
                  const src = getProductImageUrl((product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []), getDefaultProductImageWithSku(product.sku));
                  const unoptimized = typeof src === 'string' && src.startsWith('/uploads/');
                  return (
                <Image
                  src={src}
                  alt={product.name}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover group-hover:scale-110 transition-transform duration-500"
                  unoptimized={unoptimized}
                />
                  );
                })()}
                
                {/* Overlay Actions */}
                <div className={`absolute inset-0 bg-slate-950/55 flex items-center justify-center space-x-4 transition-opacity duration-300 ${
                  hoveredProduct === product.id ? 'opacity-100' : 'opacity-0'
                }`}>
                  <Link
                    href={`/products/${toProductPathId(product.sku)}`}
                    className="bg-white text-slate-900 p-3 rounded-full hover:bg-slate-100 transition-colors"
                  >
                    <EyeIcon className="h-5 w-5" />
                  </Link>
                  
                  {(product.stock_quantity ?? 0) > 0 && (
                    <button
                      onClick={() => handleAddToCart(product)}
                      className="bg-orange-500 text-white p-3 rounded-full hover:bg-[#003a78] transition-colors"
                    >
                      <ShoppingCartIcon className="h-5 w-5" />
                    </button>
                  )}
                </div>

                {/* Badges */}
                <div className="absolute top-4 left-4 flex flex-col space-y-2">
                  {product.compare_price && product.compare_price > product.price && (
                    <span className="bg-orange-500 text-white px-2 py-1 rounded text-sm font-semibold" suppressHydrationWarning>
                      Save {Math.round(((product.compare_price - product.price) / product.compare_price) * 100)}%
                    </span>
                  )}

                  {(product.stock_quantity ?? 0) <= 0 && (
                    <span className="bg-gray-500 text-white px-2 py-1 rounded text-sm font-semibold">
                      Out of Stock
                    </span>
                  )}
                </div>
              </div>

              {/* Product Info */}
              <div className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[#003a78] font-medium">{product.category?.name || 'CNC Parts'}</span>
                  <div className="flex items-center space-x-1">
                    <StarIcon className="h-4 w-4 text-orange-400 fill-current" />
                    <span className="text-sm text-slate-600">4.9 (18)</span>
                  </div>
                </div>

                <h3 className="text-lg font-semibold text-slate-950 mb-2 line-clamp-2">
                  {product.name}
                </h3>
                
                <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                  {product.description}
                </p>

                {/* Features */}
                <div className="flex flex-wrap gap-1 mb-4">
                  {Array.isArray(product.features) && product.features.slice(0, 2).map((feature: any) => (
                    <span
                      key={String(feature)}
                      className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs"
                    >
                      {feature}
                    </span>
                  ))}
                </div>

                {/* Price and Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl font-bold text-slate-950">
                      {formatCurrency(product.price)}
                    </span>
                    {product.compare_price && product.compare_price > product.price && (
                      <span className="text-lg text-gray-500 line-through">
                        {formatCurrency(product.compare_price)}
                      </span>
                    )}
                  </div>

                  <div className="ml-1 text-sm text-slate-600">
                    {(product.stock_quantity ?? 0) > 0 ? `In Stock: ${product.stock_quantity}` : 'Out of Stock'}
                  </div>

                  {(product.stock_quantity ?? 0) > 0 ? (
                    <button
                      onClick={() => handleAddToCart(product)}
                      className="bg-orange-500 hover:bg-[#003a78] text-white px-4 py-2 rounded-md font-medium transition-colors duration-300"
                    >
                      Add to Cart
                    </button>
                  ) : (
                    <button
                      disabled
                      className="bg-gray-300 text-gray-500 px-4 py-2 rounded-lg font-medium cursor-not-allowed"
                    >
                      Out of Stock
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* View All Products CTA */}
        <div className="text-center">
          <Link
            href={ctaHref}
            className="inline-flex items-center space-x-2 bg-slate-950 hover:bg-orange-600 text-white px-8 py-4 rounded-md text-lg font-semibold transition-colors duration-300"
          >
            <span>{ctaText}</span>
            <ArrowRightIcon className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default FeaturedProducts;

