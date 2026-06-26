'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ListBulletIcon,
  ShoppingCartIcon,
  HeartIcon,
  EyeIcon
} from '@heroicons/react/24/outline';
import { HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import Layout from '@/components/layout/Layout';
import SmartPagination from '@/components/ui/SmartPagination';
import CategoryFilterTree from '@/components/categories/CategoryFilterTree';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, toProductPathId } from '@/lib/utils';
import { useCartStore } from '@/store/cart.store';

interface ProductsPageClientProps {
  initialData: {
    products: any[];
    totalPages: number;
    total: number;
    categories: any[];
    currentPage: number;
    selectedCategory: string;
    searchQuery: string;
  };
  searchParams: { [key: string]: string | string[] | undefined };
}

export default function ProductsPageClient({ initialData, searchParams }: ProductsPageClientProps) {
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState(initialData.searchQuery);
  const [selectedCategory, setSelectedCategory] = useState(initialData.selectedCategory);
  const [sortBy, setSortBy] = useState('name');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [currentPage, setCurrentPage] = useState(initialData.currentPage);
  const [favorites, setFavorites] = useState<number[]>([]);


  const { addItem } = useCartStore();

  useEffect(() => {
    setCurrentPage(initialData.currentPage);
  }, [initialData.currentPage]);

  // Client-side sorting only (filtering is done server-side)
  const sortedProducts = [...initialData.products].sort((a: any, b: any) => {
    switch (sortBy) {
      case 'name_desc':
        return b.name.localeCompare(a.name);
      case 'price_asc':
        return a.price - b.price;
      case 'price_desc':
        return b.price - a.price;
      case 'created_at':
        return new Date(b.created_at || b.updated_at).getTime() - new Date(a.created_at || a.updated_at).getTime();
      case 'stock_desc':
        return (b.stock_quantity || 0) - (a.stock_quantity || 0);
      case 'featured':
        // Featured products first, then by name
        if (a.is_featured && !b.is_featured) return -1;
        if (!a.is_featured && b.is_featured) return 1;
        return a.name.localeCompare(b.name);
      case 'name':
      default:
        return a.name.localeCompare(b.name);
    }
  });

  // Use server-side pagination data
  const totalPages = initialData.totalPages;
  const totalProducts = initialData.total;

  const handleAddToCart = (product: any) => {
    addItem(product, 1);
  };

  const toggleFavorite = (productId: number) => {
    setFavorites(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('');
    setSortBy('name');
    setCurrentPage(1);

    // Update URL
    router.push('/products');
  };

  // Handle search with debounce and URL update
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (selectedCategory) {
        params.set('category_id', selectedCategory);
        params.set('include_descendants', 'true');
      }
      if (currentPage > 1) {
        params.set('page', String(currentPage));
      }

      const newUrl = `/products${params.toString() ? '?' + params.toString() : ''}`;
      if (newUrl !== window.location.pathname + window.location.search) {
        router.push(newUrl, { scroll: false });
      }
    }, 500); // Increased debounce time

    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory, currentPage, router]);



  // Handle category change
  const handleCategoryChange = (categoryId: string) => {
    try {
      window.sessionStorage.setItem('products-scroll-y', String(window.scrollY || 0));
    } catch {
      // ignore
    }
    setSelectedCategory(categoryId);
    // The useEffect above will handle the URL update
  };

  // Handle pagination with URL update
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (selectedCategory) {
      params.set('category_id', selectedCategory);
      params.set('include_descendants', 'true');
    }
    if (page > 1) params.set('page', page.toString());

    router.push(`/products?${params.toString()}`, { scroll: false });
  };



  return (
    <Layout>
      <div className="site-page-shell min-h-screen">
        {/* Hero Section */}
        <div className="site-page-hero py-16">
          <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="site-hero-kicker mb-5">Industrial Parts Catalog</div>
              <h1 className="text-4xl md:text-5xl font-bold mb-6">Hot Selling Products</h1>
              <p className="text-lg md:text-xl text-blue-100 max-w-4xl mx-auto mb-8 leading-relaxed">
                More than 18 years experience we have ability to coordinate specific strengths
                into a whole, providing clients with solutions that consider various import and
                export transportation options.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                <div className="site-stat-card">
                  <div className="text-2xl font-bold text-white">100K+</div>
                  <div className="text-blue-100">Items in Stock</div>
                </div>
                <div className="site-stat-card">
                  <div className="text-2xl font-bold text-white">50-100</div>
                  <div className="text-blue-100">Daily Parcels</div>
                </div>
                <div className="site-stat-card">
                  <div className="text-2xl font-bold text-white">Top 3</div>
                  <div className="text-blue-100">Fanuc Supplier in China</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Sidebar Filters */}
            <div className="lg:w-64 space-y-6">
              {/* Search */}
              <div className="site-panel p-6">
                <h3 className="text-lg font-semibold text-slate-950 mb-4">Search</h3>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="site-input block w-full pl-10 pr-3 py-2 leading-5 placeholder-slate-400"
                    placeholder="Search by name, SKU, model, description..."
                  />
                </div>
                {searchQuery && (
                  <div className="mt-2 text-sm text-slate-500">
                    Searching for "{searchQuery}"...
                  </div>
                )}
              </div>

              {/* Categories */}
              <div className="site-panel p-6">
                <h3 className="text-lg font-semibold text-slate-950 mb-4">Categories</h3>
                <CategoryFilterTree
                  tree={initialData.categories as any}
                  selectedCategoryId={selectedCategory ? Number(selectedCategory) : null}
                  onSelectCategory={(id) => handleCategoryChange(id ? String(id) : '')}
                  storageKey="products-category-open-ids"
                  allLabel="All Products"
                />
              </div>


            </div>

            {/* Main Content */}
            <div className="flex-1">
              {/* Enhanced Toolbar */}
              <div className="site-toolbar p-4 mb-6">
                <div className="flex flex-col space-y-4">
                  {/* Top row - Results info and view controls */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                    <div className="flex items-center space-x-4">
                      <span className="text-sm text-slate-700">
                        Showing {sortedProducts.length} of {totalProducts} products
                        {(searchQuery || selectedCategory) && (
                          <span className="text-slate-500"> (filtered)</span>
                        )}
                      </span>
                      {searchQuery && (
                        <span className="text-sm text-slate-500">
                          for "{searchQuery}"
                        </span>
                      )}
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

                  {/* Bottom row - Sort and page size */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                    <div className="flex items-center space-x-4">
                      {/* Sort */}
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="site-select px-3 py-2 text-sm"
                      >
                        <option value="name">Sort by Name (A-Z)</option>
                        <option value="name_desc">Sort by Name (Z-A)</option>
                        <option value="price_asc">Price: Low to High</option>
                        <option value="price_desc">Price: High to Low</option>
                        <option value="created_at">Newest First</option>
                        <option value="stock_desc">Stock: High to Low</option>
                        <option value="featured">Featured First</option>
                      </select>


                    </div>

                    {/* Clear filters and page info */}
                    <div className="flex items-center space-x-4">
                      {(searchQuery || selectedCategory) && (
                        <button
                          onClick={clearAllFilters}
                          className="site-link-accent text-sm"
                        >
                          Clear all filters
                        </button>
                      )}
                      <div className="text-sm text-slate-500">
                        Page {currentPage} of {totalPages}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Products Grid/List */}
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {sortedProducts.map((product: any) => (
                    <div key={product.id} className="site-product-card">
                      <div className="relative">
                        <Link href={`/products/${toProductPathId(product.sku)}`} className="site-product-media block aspect-[4/3] w-full">
                          <Image
                            src={getProductImageUrl(
                              (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                              getDefaultProductImageWithSku(product.sku)
                            )}
                            alt={`${product.name} - ${product.sku} | Professional ${product.category?.name || 'Industrial'} Part | In Stock at VIBO CNC`}
                            width={300}
                            height={300}
                            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                            className="h-full w-full object-cover object-center transition-transform duration-300 hover:scale-105"
                            priority={false}
                            loading="lazy"
                          />
                        </Link>

                        <button
                          onClick={() => toggleFavorite(product.id)}
                          className="absolute top-3 right-3 z-10 rounded-md border border-slate-200 bg-white/95 p-2 text-slate-500 shadow-sm transition-colors hover:text-red-500"
                        >
                          {favorites.includes(product.id) ? (
                            <HeartIconSolid className="h-5 w-5 text-red-500" />
                          ) : (
                            <HeartIcon className="h-5 w-5 text-gray-400" />
                          )}
                        </button>
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
                              title={`View ${product.name} details`}
                            >
                              <EyeIcon className="h-5 w-5" />
                            </Link>
                            <button
                              onClick={() => handleAddToCart(product)}
                              className="site-primary-action px-3 py-2 text-sm"
                              title={`Add ${product.name} to cart`}
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
                <div className="space-y-4">
                  {sortedProducts.map((product: any) => (
                    <div key={product.id} className="site-product-card p-4 sm:p-6">
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                        <Link href={`/products/${toProductPathId(product.sku)}`} className="flex-shrink-0">
                          <Image
                            src={getProductImageUrl(
                              (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                              getDefaultProductImageWithSku(product.sku)
                            )}
                            alt={`${product.name} - ${product.sku} | Professional ${product.category?.name || 'Industrial'} Part | In Stock at VIBO CNC`}
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
                            <button
                              onClick={() => toggleFavorite(product.id)}
                              className="site-secondary-action h-9 w-9"
                            >
                              {favorites.includes(product.id) ? (
                                <HeartIconSolid className="h-5 w-5 text-red-500" />
                              ) : (
                                <HeartIcon className="h-5 w-5" />
                              )}
                            </button>
                            <Link
                              href={`/products/${toProductPathId(product.sku)}`}
                              className="site-secondary-action h-9 w-9"
                              title={`View ${product.name} details`}
                            >
                              <EyeIcon className="h-5 w-5" />
                            </Link>
                            <button
                              onClick={() => handleAddToCart(product)}
                              className="site-primary-action px-4 py-2 text-sm"
                              title={`Add ${product.name} to cart`}
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

              {/* Smart Pagination */}
              {totalPages > 1 && (
                <div className="mt-8">
                  <SmartPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}

              {/* No Products Found */}
              {sortedProducts.length === 0 && (
                <div className="text-center py-12">
                  <div className="text-slate-400 mb-4">
                    <MagnifyingGlassIcon className="mx-auto h-12 w-12" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-950 mb-2">No products found</h3>
                  <p className="text-slate-500">
                    Try adjusting your search criteria or browse all categories.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
