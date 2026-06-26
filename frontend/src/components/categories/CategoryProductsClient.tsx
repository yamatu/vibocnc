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
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, toProductPathId } from '@/lib/utils';
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

interface CategoryProductsClientProps {
  category: any;
  initialSearchParams: { [key: string]: string | string[] | undefined };
}

export default function CategoryProductsClient({
  category,
  initialSearchParams
}: CategoryProductsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem } = useCartStore();

  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filters, setFilters] = useState({
    page: 1,
    page_size: 12,
    category_id: category.id,
    include_descendants: 'true',
    sort_by: 'created_at',
    sort_order: 'desc',
    min_price: '',
    max_price: '',
    search: '',
    is_active: 'true'
  });

  // Initialize filters from URL params
  useEffect(() => {
    const urlFilters = {
      page: parseInt(searchParams.get('page') || '1'),
      page_size: parseInt(searchParams.get('page_size') || '12'),
      category_id: category.id,
      include_descendants: 'true',
      sort_by: searchParams.get('sort_by') || 'created_at',
      sort_order: searchParams.get('sort_order') || 'desc',
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

  const products = productsResponse?.data || [];
  const pagination = productsResponse ? {
    page: productsResponse.page,
    page_size: productsResponse.page_size,
    total: productsResponse.total,
    total_pages: productsResponse.total_pages
  } : null;
  const categories = categoriesResponse || [];

  // Update URL when filters change
  const updateURL = (newFilters: typeof filters) => {
    const params = new URLSearchParams();

    Object.entries(newFilters).forEach(([key, value]) => {
      if (value && value !== '' && key !== 'category_id' && key !== 'is_active' && key !== 'include_descendants') {
        if (key === 'page' && value === 1) return;
        params.set(key, value.toString());
      }
    });

    const base = `/categories/${category.path || category.slug}`;
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
    let sort_by = 'created_at';
    let sort_order = 'desc';
    switch (val) {
      case 'name': sort_by = 'name'; sort_order = 'asc'; break;
      case 'name_desc': sort_by = 'name'; sort_order = 'desc'; break;
      case 'price_asc': sort_by = 'price'; sort_order = 'asc'; break;
      case 'price_desc': sort_by = 'price'; sort_order = 'desc'; break;
      case 'created_at': sort_by = 'created_at'; sort_order = 'desc'; break;
    }
    handleFilterChange({ sort_by, sort_order });
  };

  const sortValue = (() => {
    if (filters.sort_by === 'name' && filters.sort_order === 'asc') return 'name';
    if (filters.sort_by === 'name' && filters.sort_order === 'desc') return 'name_desc';
    if (filters.sort_by === 'price' && filters.sort_order === 'asc') return 'price_asc';
    if (filters.sort_by === 'price' && filters.sort_order === 'desc') return 'price_desc';
    return 'created_at';
  })();

  const clearFilters = () => {
    const clearedFilters = {
      page: 1,
      page_size: 12,
      category_id: category.id,
      include_descendants: 'true',
      sort_by: 'created_at',
      sort_order: 'desc',
      min_price: '',
      max_price: '',
      search: '',
      is_active: 'true'
    };
    setFilters(clearedFilters);
    const base = `/categories/${category.path || category.slug}`;
    router.push(base, { scroll: false });
  };

  const handleAddToCart = (product: any) => {
    addItem(product, 1);
  };

  const hasActiveFilters = !!(filters.min_price || filters.max_price || filters.search);

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">
          <FunnelIcon className="h-12 w-12 mx-auto" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load products</h3>
        <p className="text-gray-600">Please try again later.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="site-toolbar p-4 mb-6">
        <div className="flex flex-col space-y-4">
          {/* Top row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
            <div className="flex items-center space-x-4">
              <span className="text-sm text-slate-700">
                {pagination ? (
                  <>Showing {((pagination.page - 1) * pagination.page_size) + 1}-{Math.min(pagination.page * pagination.page_size, pagination.total)} of {pagination.total} products</>
                ) : (
                  <>Loading...</>
                )}
                {hasActiveFilters && <span className="text-slate-500"> (filtered)</span>}
              </span>
            </div>

            {/* View Mode */}
            <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white">
              <button
                onClick={() => setViewMode('grid')}
                className={`site-icon-toggle ${viewMode === 'grid' ? 'site-icon-toggle-active' : ''}`}
                title="Grid view"
              >
                <Squares2X2Icon className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`site-icon-toggle ${viewMode === 'list' ? 'site-icon-toggle-active' : ''}`}
                title="List view"
              >
                <ListBulletIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Bottom row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
            <div className="flex items-center space-x-4">
              <select
                value={sortValue}
                onChange={handleSortChange}
                className="site-select px-3 py-2 text-sm"
              >
                <option value="name">Sort by Name (A-Z)</option>
                <option value="name_desc">Sort by Name (Z-A)</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="created_at">Newest First</option>
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

            <div className="flex items-center space-x-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {products.map((product: any) => (
                <div key={product.id} className="site-product-card">
                  <div className="relative">
                    <Link href={`/products/${toProductPathId(product.sku)}`} className="site-product-media block aspect-[4/3] w-full">
                      <Image
                        src={getProductImageUrl(
                          (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                          getDefaultProductImageWithSku(product.sku)
                        )}
                        alt={`${product.name} - ${product.sku}`}
                        width={300}
                        height={300}
                        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="h-full w-full object-cover object-center transition-transform duration-300 hover:scale-105"
                        loading="lazy"
                      />
                    </Link>
                  </div>

                  <div className="p-4">
                    <h3 className="text-base font-semibold text-slate-950 mb-2 line-clamp-2 min-h-[3rem]">
                      <Link href={`/products/${toProductPathId(product.sku)}`} className="site-product-title">
                        {product.name}
                      </Link>
                    </h3>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">SKU: {product.sku}</p>
                    {product.description && (
                      <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                        {product.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xl font-bold text-[#0b3e75]">
                        {formatCurrency(product.price)}
                      </span>

                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/products/${toProductPathId(product.sku)}`}
                          className="site-secondary-action h-9 w-9"
                          title="View details"
                        >
                          <EyeIcon className="h-5 w-5" />
                        </Link>
                        <button
                          onClick={() => handleAddToCart(product)}
                          className="site-primary-action px-3 py-2 text-sm"
                          title="Add to cart"
                        >
                          <ShoppingCartIcon className="h-4 w-4 mr-1" />
                          Add to Cart
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4 mb-8">
              {products.map((product: any) => (
                <div key={product.id} className="site-product-card p-4 sm:p-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <Link href={`/products/${toProductPathId(product.sku)}`} className="flex-shrink-0">
                      <Image
                        src={getProductImageUrl(
                          (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                          getDefaultProductImageWithSku(product.sku)
                        )}
                        alt={`${product.name} - ${product.sku}`}
                        width={120}
                        height={120}
                        sizes="120px"
                        className="h-28 w-full object-cover rounded-md border border-slate-200 sm:h-24 sm:w-24"
                        loading="lazy"
                      />
                    </Link>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-slate-950 mb-1">
                        <Link href={`/products/${toProductPathId(product.sku)}`} className="site-product-title">
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
                        {formatCurrency(product.price)}
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/products/${toProductPathId(product.sku)}`}
                          className="site-secondary-action h-9 w-9"
                          title="View details"
                        >
                          <EyeIcon className="h-5 w-5" />
                        </Link>
                        <button
                          onClick={() => handleAddToCart(product)}
                          className="site-primary-action px-4 py-2 text-sm"
                          title="Add to cart"
                        >
                          <ShoppingCartIcon className="h-4 w-4 mr-2" />
                          Add to Cart
                        </button>
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
          <h3 className="text-lg font-semibold text-slate-950 mb-2">No products found</h3>
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
