'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import { ProductService, CategoryService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import ProductFilters from '@/components/products/ProductFilters';
import Pagination from '@/components/common/Pagination';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, hasProductPrice, toProductPathId } from '@/lib/utils';
import { useCartStore } from '@/store/cart.store';
import {
  AdjustmentsHorizontalIcon,
  FunnelIcon,
  Squares2X2Icon,
  ListBulletIcon,
  ShoppingCartIcon,
  EyeIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { localizeCategoryContent, localizeProductContent } from '@/lib/i18n/content';
import type { ProductFilters as ProductServiceFilters } from '@/services/product.service';
import type { Category, Product } from '@/types';
import { normalizeProductPageSize } from '@/lib/product-listing';

interface CategoryProductsClientProps {
  category: Category;
  initialSearchParams: { [key: string]: string | string[] | undefined };
}

type CategoryProductFilters = Required<Pick<ProductServiceFilters, 'page' | 'page_size' | 'category_id' | 'include_descendants' | 'sort_by' | 'sort_dir' | 'search' | 'is_active'>> & {
  min_price: string;
  max_price: string;
};

function normalizeSortBy(value: string | null): CategoryProductFilters['sort_by'] {
  return value === 'name' || value === 'price' || value === 'updated_at' ? value : 'created_at';
}

function normalizeSortDirection(value: string | null): CategoryProductFilters['sort_dir'] {
  return value === 'asc' ? 'asc' : 'desc';
}

export default function CategoryProductsClient({
  category,
  initialSearchParams,
}: CategoryProductsClientProps) {
  const router = useRouter();
  const { locale, t, href } = usePublicI18n();
  const searchParams = useSearchParams();
  const { addItem } = useCartStore();

  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filters, setFilters] = useState<CategoryProductFilters>({
    page: 1,
    page_size: normalizeProductPageSize(initialSearchParams.page_size),
    category_id: String(category.id),
    include_descendants: 'true',
    sort_by: 'created_at',
    sort_dir: 'desc',
    min_price: '',
    max_price: '',
    search: '',
    is_active: 'true'
  });

  // Initialize filters from URL params
  useEffect(() => {
    const urlFilters = {
      page: parseInt(searchParams.get('page') || '1'),
      page_size: normalizeProductPageSize(searchParams.get('page_size')),
      category_id: String(category.id),
      include_descendants: 'true',
      sort_by: normalizeSortBy(searchParams.get('sort_by')),
      sort_dir: normalizeSortDirection(searchParams.get('sort_dir')),
      min_price: searchParams.get('min_price') || '',
      max_price: searchParams.get('max_price') || '',
      search: searchParams.get('search') || '',
      is_active: 'true'
    };
    setFilters(urlFilters);
  }, [searchParams, category.id]);

  // Fetch products
  const { data: productsResponse, isLoading, error } = useQuery({
    queryKey: queryKeys.products.list(filters),
    queryFn: () => ProductService.getProducts(filters),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch all categories for filters
  const { data: categoriesResponse } = useQuery({
    queryKey: queryKeys.categories.all(),
    queryFn: () => CategoryService.getCategories(),
  });

  const products = (productsResponse?.data || []).map((product) => localizeProductContent(product, locale));
  const pagination = productsResponse ? {
    page: productsResponse.page,
    page_size: productsResponse.page_size,
    total: productsResponse.total,
    total_pages: productsResponse.total_pages
  } : null;
  const categories = (categoriesResponse || []).map((item) => localizeCategoryContent(item, locale));

  // Update URL when filters change
  const updateURL = (newFilters: typeof filters) => {
    const params = new URLSearchParams();

    Object.entries(newFilters).forEach(([key, value]) => {
      if (value && value !== '' && key !== 'category_id' && key !== 'is_active' && key !== 'include_descendants') {
        if (key === 'page' && value === 1) return;
        params.set(key, value.toString());
      }
    });

    const base = href(`/categories/${category.path || category.slug}`);
    const newURL = `${base}${params.toString() ? `?${params.toString()}` : ''}`;
    router.push(newURL, { scroll: false });
  };

  const handleFilterChange = (newFilters: Partial<typeof filters>) => {
    const updatedFilters = {
      ...filters,
      ...newFilters,
      page: 1
    };
    setFilters(updatedFilters);
    updateURL(updatedFilters);
  };

  const handlePageChange = (page: number) => {
    const updatedFilters = { ...filters, page };
    setFilters(updatedFilters);
    updateURL(updatedFilters);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    let sort_by: CategoryProductFilters['sort_by'] = 'created_at';
    let sort_dir: CategoryProductFilters['sort_dir'] = 'desc';
    switch (val) {
      case 'name': sort_by = 'name'; sort_dir = 'asc'; break;
      case 'name_desc': sort_by = 'name'; sort_dir = 'desc'; break;
      case 'price_asc': sort_by = 'price'; sort_dir = 'asc'; break;
      case 'price_desc': sort_by = 'price'; sort_dir = 'desc'; break;
      case 'created_at': sort_by = 'created_at'; sort_dir = 'desc'; break;
    }
    handleFilterChange({ sort_by, sort_dir });
  };

  const sortValue = (() => {
    if (filters.sort_by === 'name' && filters.sort_dir === 'asc') return 'name';
    if (filters.sort_by === 'name' && filters.sort_dir === 'desc') return 'name_desc';
    if (filters.sort_by === 'price' && filters.sort_dir === 'asc') return 'price_asc';
    if (filters.sort_by === 'price' && filters.sort_dir === 'desc') return 'price_desc';
    return 'created_at';
  })();

  const clearFilters = () => {
    const clearedFilters: CategoryProductFilters = {
      page: 1,
      page_size: 48,
      category_id: String(category.id),
      include_descendants: 'true',
      sort_by: 'created_at',
      sort_dir: 'desc',
      min_price: '',
      max_price: '',
      search: '',
      is_active: 'true'
    };
    setFilters(clearedFilters);
    const base = href(`/categories/${category.path || category.slug}`);
    router.push(base, { scroll: false });
  };

  const handleAddToCart = (product: Product) => {
    if (!hasProductPrice(product)) return;
    addItem(product, 1);
  };

  const hasActiveFilters = !!(filters.min_price || filters.max_price || filters.search);

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">
          <FunnelIcon className="h-12 w-12 mx-auto" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">{t('common.loadError')}</h3>
        <p className="text-gray-600">{t('common.tryAgain')}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="site-toolbar mb-6 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* Top row */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:items-center">
            <div className="min-w-0">
              <span className="text-sm text-slate-700">
                {pagination ? (
                  <>Showing {((pagination.page - 1) * pagination.page_size) + 1}-{Math.min(pagination.page * pagination.page_size, pagination.total)} of {pagination.total} products</>
                ) : (
                  <>{t('common.loading')}</>
                )}
                {hasActiveFilters && <span className="text-slate-500"> (filtered)</span>}
              </span>
            </div>

            {/* View Mode */}
            <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white">
              <button
                onClick={() => setViewMode('grid')}
                className={`site-icon-toggle ${viewMode === 'grid' ? 'site-icon-toggle-active' : ''}`}
                title={t('products.gridView')}
                aria-label={t('products.gridView')}
              >
                <Squares2X2Icon className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`site-icon-toggle ${viewMode === 'list' ? 'site-icon-toggle-active' : ''}`}
                title={t('products.listView')}
                aria-label={t('products.listView')}
              >
                <ListBulletIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Bottom row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 sm:flex-none">
              <select
                value={sortValue}
                onChange={handleSortChange}
                className="site-select min-w-0 flex-1 px-3 py-2 text-sm sm:flex-none"
              >
                <option value="name">{t('products.sortNameAsc')}</option>
                <option value="name_desc">{t('products.sortNameDesc')}</option>
                <option value="price_asc">{t('products.sortPriceAsc')}</option>
                <option value="price_desc">{t('products.sortPriceDesc')}</option>
                <option value="created_at">{t('products.sortNewest')}</option>
              </select>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className="site-secondary-action px-4 py-2 text-sm"
              >
                <AdjustmentsHorizontalIcon className="h-4 w-4 mr-2" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-2 site-chip">
                    Active
                  </span>
                )}
              </button>
            </div>

            <div className="ml-auto flex min-w-0 items-center gap-3">
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="site-link-accent text-sm"
                >
                  Clear all filters
                </button>
              )}
              {pagination && (
                <div className="text-sm text-slate-500">
                  Page {pagination.page} of {pagination.total_pages}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="site-panel p-6 mb-6">
          <ProductFilters
            filters={filters}
            categories={categories}
            onFilterChange={handleFilterChange}
            showCategoryFilter={false}
          />
        </div>
      )}

      {/* Products */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : products.length > 0 ? (
        <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4 mb-8">
              {products.map((product) => (
                <div key={product.id} className="site-product-card">
                  <div className="relative">
                    <Link href={href(`/products/${toProductPathId(product.sku)}`)} className="site-product-media block aspect-[4/3] w-full">
                      <Image
                        src={getProductImageUrl(
                          (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                          getDefaultProductImageWithSku(product.sku)
                        )}
                        alt={`${product.name} - ${product.sku}`}
                        width={300}
                        height={300}
                        sizes="(min-width: 1536px) 15vw, (min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                        className="h-full w-full object-contain object-center p-3 transition-transform duration-300 hover:scale-105"
                        loading="lazy"
                      />
                    </Link>
                  </div>

                  <div className="p-4">
                    <h3 className="text-base font-semibold text-slate-950 mb-2 line-clamp-2 min-h-[3rem]">
                      <Link href={href(`/products/${toProductPathId(product.sku)}`)} className="site-product-title">
                        {product.name}
                      </Link>
                    </h3>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">SKU: {product.sku}</p>
                    {product.description && (
                      <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                        {product.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xl font-bold text-[#0b3e75]">
                        {hasProductPrice(product) ? formatCurrency(product.price) : (
                              <Link href={href(`/products/${toProductPathId(product.sku)}`)} className="site-primary-action inline-flex max-w-full px-3 py-2 text-center text-sm font-semibold">
                                {t('products.contactForQuote')}
                              </Link>
                            )}
                      </span>

                      <div className="flex items-center space-x-2">
                        <Link
                          href={href(`/products/${toProductPathId(product.sku)}`)}
                          className="site-secondary-action h-9 w-9"
                          title={t('common.viewDetails')}
                        >
                          <EyeIcon className="h-5 w-5" />
                        </Link>
                        {hasProductPrice(product) && (
                          <button
                            onClick={() => handleAddToCart(product)}
                            className="site-primary-action px-3 py-2 text-sm"
                            title={t('common.addToCart')}
                          >
                            <ShoppingCartIcon className="h-4 w-4 mr-1" />
                            {t('common.addToCart')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4 mb-8">
              {products.map((product) => (
                <div key={product.id} className="site-product-card p-4 sm:p-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <Link href={href(`/products/${toProductPathId(product.sku)}`)} className="flex-shrink-0">
                      <Image
                        src={getProductImageUrl(
                          (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                          getDefaultProductImageWithSku(product.sku)
                        )}
                        alt={`${product.name} - ${product.sku}`}
                        width={120}
                        height={120}
                        sizes="120px"
                        className="h-28 w-full object-contain rounded-md border border-slate-200 bg-white p-2 sm:h-24 sm:w-24"
                        loading="lazy"
                      />
                    </Link>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-slate-950 mb-1">
                        <Link href={href(`/products/${toProductPathId(product.sku)}`)} className="site-product-title">
                          {product.name}
                        </Link>
                      </h3>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">SKU: {product.sku}</p>
                      {product.description && (
                        <p className="text-sm text-slate-600 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                    </div>

                    <div className="flex-shrink-0 text-left sm:text-right">
                      <div className="text-xl font-bold text-[#0b3e75] mb-2">
                        {hasProductPrice(product) ? formatCurrency(product.price) : (
                              <Link href={href(`/products/${toProductPathId(product.sku)}`)} className="site-primary-action inline-flex max-w-full px-3 py-2 text-center text-sm font-semibold">
                                {t('products.contactForQuote')}
                              </Link>
                            )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={href(`/products/${toProductPathId(product.sku)}`)}
                          className="site-secondary-action h-9 w-9"
                          title={t('common.viewDetails')}
                        >
                          <EyeIcon className="h-5 w-5" />
                        </Link>
                        {hasProductPrice(product) && (
                          <button
                            onClick={() => handleAddToCart(product)}
                            className="site-primary-action px-4 py-2 text-sm"
                            title={t('common.addToCart')}
                          >
                            <ShoppingCartIcon className="h-4 w-4 mr-2" />
                            {t('common.addToCart')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.total_pages > 1 && (
            <div className="flex justify-center">
              <Pagination
                currentPage={pagination.page}
                totalPages={pagination.total_pages}
                onPageChange={handlePageChange}
                showJump
              />
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <div className="text-slate-400 mb-4">
            <MagnifyingGlassIcon className="mx-auto h-12 w-12" />
          </div>
          <h3 className="text-lg font-semibold text-slate-950 mb-2">{t('products.noResults')}</h3>
          <p className="text-slate-600 mb-4">
            Try adjusting your filters or search terms.
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="site-primary-action px-4 py-2 text-sm"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
