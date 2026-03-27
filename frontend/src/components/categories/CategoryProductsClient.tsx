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
  XMarkIcon,
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
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-col space-y-4">
          {/* Top row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">
                {pagination ? (
                  <>Showing {((pagination.page - 1) * pagination.page_size) + 1}-{Math.min(pagination.page * pagination.page_size, pagination.total)} of {pagination.total} products</>
                ) : (
                  <>Loading...</>
                )}
                {hasActiveFilters && <span className="text-gray-500"> (filtered)</span>}
              </span>
            </div>

            {/* View Mode */}
            <div className="flex items-center border border-gray-300 rounded-md">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-yellow-100 text-yellow-600' : 'text-gray-400'}`}
                title="Grid view"
              >
                <Squares2X2Icon className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-yellow-100 text-yellow-600' : 'text-gray-400'}`}
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
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500"
              >
                <option value="name">Sort by Name (A-Z)</option>
                <option value="name_desc">Sort by Name (Z-A)</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="created_at">Newest First</option>
              </select>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <AdjustmentsHorizontalIcon className="h-4 w-4 mr-2" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    Active
                  </span>
                )}
              </button>
            </div>

            <div className="flex items-center space-x-4">
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-yellow-600 hover:text-yellow-500 font-medium"
                >
                  Clear all filters
                </button>
              )}
              {pagination && (
                <div className="text-sm text-gray-500">
                  Page {pagination.page} of {pagination.total_pages}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
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
                <div key={product.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
                  <div className="relative">
                    <Link href={`/products/${toProductPathId(product.sku)}`} className="block aspect-w-1 aspect-h-1 w-full overflow-hidden rounded-t-lg bg-gray-200">
                      <Image
                        src={getProductImageUrl(
                          (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                          getDefaultProductImageWithSku(product.sku)
                        )}
                        alt={`${product.name} - ${product.sku}`}
                        width={300}
                        height={300}
                        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="h-48 w-full object-cover object-center"
                        loading="lazy"
                      />
                    </Link>
                  </div>

                  <div className="p-4">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      <Link href={`/products/${toProductPathId(product.sku)}`} className="hover:text-yellow-600">
                        {product.name}
                      </Link>
                    </h3>
                    <p className="text-sm text-gray-500 mb-2">SKU: {product.sku}</p>
                    {product.description && (
                      <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                        {product.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-xl font-bold text-yellow-600">
                        {formatCurrency(product.price)}
                      </span>

                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/products/${toProductPathId(product.sku)}`}
                          className="p-2 text-gray-400 hover:text-yellow-600 transition-colors"
                          title="View details"
                        >
                          <EyeIcon className="h-5 w-5" />
                        </Link>
                        <button
                          onClick={() => handleAddToCart(product)}
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-black bg-yellow-500 hover:bg-yellow-600 transition-colors"
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
                <div key={product.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center space-x-6">
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
                        className="h-20 w-20 object-cover rounded-lg"
                        loading="lazy"
                      />
                    </Link>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-medium text-gray-900 mb-1">
                        <Link href={`/products/${toProductPathId(product.sku)}`} className="hover:text-yellow-600">
                          {product.name}
                        </Link>
                      </h3>
                      <p className="text-sm text-gray-500 mb-2">SKU: {product.sku}</p>
                      {product.description && (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                    </div>

                    <div className="flex-shrink-0 text-right">
                      <div className="text-xl font-bold text-yellow-600 mb-2">
                        {formatCurrency(product.price)}
                      </div>
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/products/${toProductPathId(product.sku)}`}
                          className="p-2 text-gray-400 hover:text-yellow-600 transition-colors"
                          title="View details"
                        >
                          <EyeIcon className="h-5 w-5" />
                        </Link>
                        <button
                          onClick={() => handleAddToCart(product)}
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-black bg-yellow-500 hover:bg-yellow-600 transition-colors"
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
          <div className="text-gray-400 mb-4">
            <MagnifyingGlassIcon className="mx-auto h-12 w-12" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
          <p className="text-gray-600 mb-4">
            Try adjusting your filters or search terms.
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
