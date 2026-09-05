'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { HomepageContent, Product } from '@/types';
import {
  ShoppingCartIcon,
  EyeIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';
import { useCart } from '@/store/cart.store';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, hasProductPrice, toProductPathId } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ProductService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { DEFAULT_FEATURED_PRODUCTS_SECTION_DATA } from '@/lib/homepage-defaults';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { localizeProductOrDefault } from '@/lib/i18n/content';

export function FeaturedProducts({
  content,
  initialProducts,
}: {
  content?: HomepageContent | null;
  initialProducts?: Product[];
}) {
  const { locale, t, href } = usePublicI18n();
  const [hoveredProduct, setHoveredProduct] = useState<number | null>(null);
  const { addItem } = useCart();

  const headerTitle = locale === 'en' ? content?.title || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.headerTitle : t('home.featured.title');
  const headerDescription = locale === 'en' ? content?.description || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.headerDescription : t('home.featured.description');
  const ctaText = locale === 'en' ? content?.button_text || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.ctaText : t('home.featured.viewAll');
  const ctaHref = content?.button_url || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.ctaHref;

  const {
    data: featured = initialProducts,
    error: featuredError,
    isFetched: featuredFetched,
    isFetching: featuredFetching,
  } = useQuery({
    queryKey: queryKeys.products.featured(),
    queryFn: () => ProductService.getFeaturedProducts(6),
    initialData: initialProducts && initialProducts.length > 0 ? initialProducts : undefined,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // If no featured available, fallback to latest active products
  const { data: latestResp, isFetching: latestFetching } = useQuery({
    queryKey: queryKeys.products.list({ page_size: 6, is_active: 'true' }),
    queryFn: () => ProductService.getProducts({ page_size: 6, is_active: 'true' }),
    enabled:
      Boolean(featuredError) || (featuredFetched && Array.isArray(featured) && featured.length === 0),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const latest = latestResp?.data ?? [];

  const rawProducts = (Array.isArray(featured) && featured.length > 0)
      ? featured
      : (Array.isArray(latest) ? latest : []);
  // Product availability is shared across locales. Use a translated record
  // when one exists and retain the canonical English product otherwise.
  const products = rawProducts.map((product) => localizeProductOrDefault(product, locale));
  const productsLoading =
    (products.length === 0 && (featuredFetching || latestFetching || !featuredFetched));

  const handleAddToCart = (product: Product) => {
    addItem(product, 1);
  };

  return (
    <section className="home-deferred-section py-20 bg-white">
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
          {productsLoading
            ? Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                  aria-hidden="true"
                >
                  <div className="h-64 animate-pulse bg-slate-100" />
                  <div className="space-y-4 p-6">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
                    <div className="h-6 w-4/5 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-8 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))
            : products.map((product) => (
            <article
              key={product.id}
              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              onMouseEnter={() => setHoveredProduct(product.id)}
              onMouseLeave={() => setHoveredProduct(null)}
            >
              {/* Product Image */}
              <div className="relative h-64 overflow-hidden">
                {(() => {
                  const src = getProductImageUrl((product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []), getDefaultProductImageWithSku(product.sku));
                  const unoptimized = typeof src === 'string' && src.startsWith('/uploads/');
                  return (
                    <>
                      <Image
                        src={src}
                        alt={product.name}
                        width={640}
                        height={512}
                        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="h-full w-full object-contain p-3 group-hover:scale-105 transition-transform duration-500"
                        unoptimized={unoptimized}
                      />
                      <Link
                        href={href(`/products/${toProductPathId(product.sku)}`)}
                        className="absolute inset-0 z-10"
                        aria-label={`${product.name} — ${product.sku}`}
                      >
                        <span className="sr-only">{product.name}</span>
                      </Link>
                    </>
                  );
                })()}
                
                {/* Overlay Actions */}
                <div className={`absolute inset-0 bg-slate-950/55 flex items-center justify-center space-x-4 transition-opacity duration-300 ${
                  hoveredProduct === product.id ? 'opacity-100' : 'opacity-0'
                }`}>
                  <Link
                    href={href(`/products/${toProductPathId(product.sku)}`)}
                    className="relative z-20 bg-white text-slate-900 p-3 rounded-full hover:bg-slate-100 transition-colors"
                    aria-label={`${t('common.learnMore')}: ${product.name}`}
                  >
                    <EyeIcon className="h-5 w-5" />
                  </Link>
                  
                  {(product.stock_quantity ?? 0) > 0 && hasProductPrice(product) && (
                    <button
                      onClick={() => handleAddToCart(product)}
                      className="relative z-20 bg-orange-500 text-white p-3 rounded-full hover:bg-[#003a78] transition-colors"
                    >
                      <ShoppingCartIcon className="h-5 w-5" />
                    </button>
                  )}
                </div>

                {/* Badges */}
                <div className="absolute top-4 left-4 flex flex-col space-y-2">
                  {hasProductPrice(product) && product.compare_price && product.compare_price > product.price && (
                    <span className="bg-orange-500 text-white px-2 py-1 rounded text-sm font-semibold" suppressHydrationWarning>
                      {t('home.featured.save', { percent: Math.round(((product.compare_price - product.price) / product.compare_price) * 100) })}
                    </span>
                  )}

                  {(product.stock_quantity ?? 0) <= 0 && hasProductPrice(product) && (
                    <span className="bg-gray-500 text-white px-2 py-1 rounded text-sm font-semibold">
                      {t('common.outOfStock')}
                    </span>
                  )}
                </div>
              </div>

              {/* Product Info */}
              <div className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[#003a78] font-medium">{product.category?.name || t('common.cncParts')}</span>
                </div>

                <h3 className="text-lg font-semibold text-slate-950 mb-2 line-clamp-2">
                  <Link href={href(`/products/${toProductPathId(product.sku)}`)} className="relative z-20 hover:text-[#003a78]">
                    {product.name}
                  </Link>
                </h3>
                
                <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                  {product.short_description || product.description}
                </p>

                {/* Features */}
                <div className="flex flex-wrap gap-1 mb-4">
                  {Array.isArray(product.attributes) && product.attributes.slice(0, 2).map((attribute) => (
                    <span
                      key={`${attribute.attribute_name}-${attribute.attribute_value}`}
                      className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs"
                    >
                      {attribute.attribute_name}: {attribute.attribute_value}
                    </span>
                  ))}
                </div>

                {/* Price and Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl font-bold text-slate-950">
                      {hasProductPrice(product) ? formatCurrency(product.price) : t('products.contactForQuote')}
                    </span>
                    {hasProductPrice(product) && product.compare_price && product.compare_price > product.price && (
                      <span className="text-lg text-gray-500 line-through">
                        {formatCurrency(product.compare_price)}
                      </span>
                    )}
                  </div>

                  {hasProductPrice(product) && (
                    <div className="ml-1 text-sm text-slate-600">
                      {(product.stock_quantity ?? 0) > 0 ? t('common.inStock', { count: product.stock_quantity }) : t('common.outOfStock')}
                    </div>
                  )}

                  {(product.stock_quantity ?? 0) > 0 && hasProductPrice(product) ? (
                    <button
                      onClick={() => handleAddToCart(product)}
                      className="relative z-20 bg-orange-500 hover:bg-[#003a78] text-white px-4 py-2 rounded-md font-medium transition-colors duration-300"
                    >
                      {t('common.addToCart')}
                    </button>
                  ) : hasProductPrice(product) ? (
                    <button
                      disabled
                      className="bg-gray-300 text-gray-500 px-4 py-2 rounded-lg font-medium cursor-not-allowed"
                    >
                      {t('common.outOfStock')}
                    </button>
                  ) : (
                    <Link
                      href={href(`/products/${toProductPathId(product.sku)}`)}
                      className="relative z-20 rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-[#0b3e75] hover:bg-slate-50"
                    >
                      {t('products.contactForQuote')}
                    </Link>
                  )}
                </div>
              </div>
            </article>
              ))}
        </div>

        {/* View All Products CTA */}
        <div className="text-center">
          <Link
            href={href(ctaHref)}
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

