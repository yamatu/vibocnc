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
      <div className="min-h-screen bg-gray-50">
        {/* Hero Section */}
        <div className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-black py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold mb-6">Hot Selling Products</h1>
              <p className="text-xl md:text-2xl text-yellow-900 max-w-4xl mx-auto mb-8">
                More than 18 years experience we have ability to coordinate specific strengths
                into a whole, providing clients with solutions that consider various import and
                export transportation options.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                <div className="bg-yellow-700 bg-opacity-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-black">100K+</div>
                  <div className="text-yellow-900">Items in Stock</div>
                </div>
                <div className="bg-yellow-700 bg-opacity-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-black">50-100</div>
                  <div className="text-yellow-900">Daily Parcels</div>
                </div>
                <div className="bg-yellow-700 bg-opacity-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-black">Top 3</div>
                  <div className="text-yellow-900">Fanuc Supplier in China</div>
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
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Search</h3>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500"
                    placeholder="Search by name, SKU, model, description..."
                  />
                </div>
                {searchQuery && (
                  <div className="mt-2 text-sm text-gray-500">
                    Searching for "{searchQuery}"...
                  </div>
                )}
              </div>

              {/* Categories */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Categories</h3>
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
              <div className="bg-white rounded-lg shadow p-4 mb-6">
                <div className="flex flex-col space-y-4">
                  {/* Top row - Results info and view controls */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                    <div className="flex items-center space-x-4">
                      <span className="text-sm text-gray-700">
                        Showing {sortedProducts.length} of {totalProducts} products
                        {(searchQuery || selectedCategory) && (
                          <span className="text-gray-500"> (filtered)</span>
                        )}
                      </span>
                      {searchQuery && (
                        <span className="text-sm text-gray-500">
                          for "{searchQuery}"
                        </span>
                      )}
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

                  {/* Bottom row - Sort and page size */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                    <div className="flex items-center space-x-4">
                      {/* Sort */}
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500"
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
                          className="text-sm text-yellow-600 hover:text-yellow-500 font-medium"
                        >
                          Clear all filters
                        </button>
                      )}
                      <div className="text-sm text-gray-500">
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
                    <div key={product.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
                      <div className="relative">
                        <Link href={`/products/${toProductPathId(product.sku)}`} className="block aspect-w-1 aspect-h-1 w-full overflow-hidden rounded-t-lg bg-gray-200">
                          <Image
                            src={getProductImageUrl(
                              (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                              getDefaultProductImageWithSku(product.sku)
                            )}
                            alt={`${product.name} - ${product.sku} | Professional ${product.category?.name || 'Industrial'} Part | In Stock at Vcocnc`}
                            width={300}
                            height={300}
                            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                            className="h-48 w-full object-cover object-center"
                            priority={false}
                            loading="lazy"
                          />
                        </Link>

                        <button
                          onClick={() => toggleFavorite(product.id)}
                          className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:shadow-lg transition-shadow"
                        >
                          {favorites.includes(product.id) ? (
                            <HeartIconSolid className="h-5 w-5 text-red-500" />
                          ) : (
                            <HeartIcon className="h-5 w-5 text-gray-400" />
                          )}
                        </button>
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
                              title={`View ${product.name} details`}
                            >
                              <EyeIcon className="h-5 w-5" />
                            </Link>
                            <button
                              onClick={() => handleAddToCart(product)}
                              className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-black bg-yellow-500 hover:bg-yellow-600 transition-colors"
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
                    <div key={product.id} className="bg-white rounded-lg shadow p-6">
                      <div className="flex items-center space-x-6">
                        <Link href={`/products/${toProductPathId(product.sku)}`} className="flex-shrink-0">
                          <Image
                            src={getProductImageUrl(
                              (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []),
                              getDefaultProductImageWithSku(product.sku)
                            )}
                            alt={`${product.name} - ${product.sku} | Professional ${product.category?.name || 'Industrial'} Part | In Stock at Vcocnc`}
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
                            <button
                              onClick={() => toggleFavorite(product.id)}
                              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                            >
                              {favorites.includes(product.id) ? (
                                <HeartIconSolid className="h-5 w-5 text-red-500" />
                              ) : (
                                <HeartIcon className="h-5 w-5" />
                              )}
                            </button>
                            <Link
                              href={`/products/${toProductPathId(product.sku)}`}
                              className="p-2 text-gray-400 hover:text-yellow-600 transition-colors"
                              title={`View ${product.name} details`}
                            >
                              <EyeIcon className="h-5 w-5" />
                            </Link>
                            <button
                              onClick={() => handleAddToCart(product)}
                              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-black bg-yellow-500 hover:bg-yellow-600 transition-colors"
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
                  <div className="text-gray-400 mb-4">
                    <MagnifyingGlassIcon className="mx-auto h-12 w-12" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
                  <p className="text-gray-500">
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
