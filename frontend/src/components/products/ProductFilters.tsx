'use client';

import { useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

interface FilterProps {
  filters: {
    search: string;
    min_price: string;
    max_price: string;
    category_id?: number;
    [key: string]: unknown;
  };
  categories?: Array<{ id: number | string; name: string }>;
  onFilterChange: (filters: Partial<FilterProps['filters']>) => void;
  showCategoryFilter?: boolean;
}

export default function ProductFilters({
  filters,
  categories = [],
  onFilterChange,
  showCategoryFilter = true
}: FilterProps) {
  const [localFilters, setLocalFilters] = useState({
    search: filters.search || '',
    min_price: filters.min_price || '',
    max_price: filters.max_price || '',
    category_id: filters.category_id || ''
  });

  const handleInputChange = (field: string, value: string) => {
    const newFilters = { ...localFilters, [field]: value };
    setLocalFilters(newFilters);

    if (field === 'search') {
      const timeoutId = setTimeout(() => {
        onFilterChange({ [field]: value });
      }, 300);
      return () => clearTimeout(timeoutId);
    }

    onFilterChange({ [field]: value });
  };

  const handlePriceChange = (field: 'min_price' | 'max_price', value: string) => {
    const numericValue = value.replace(/[^0-9.]/g, '');
    handleInputChange(field, numericValue);
  };

  const clearFilters = () => {
    const clearedFilters = {
      search: '',
      min_price: '',
      max_price: '',
      category_id: showCategoryFilter ? '' : filters.category_id
    };
    setLocalFilters(clearedFilters);
    onFilterChange(clearedFilters);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-950">Filters</h3>
        <button
          onClick={clearFilters}
          className="site-link-accent text-sm"
        >
          Clear All
        </button>
      </div>

      <div>
        <label htmlFor="search" className="block text-sm font-medium text-slate-700 mb-2">
          Search Products
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type="text"
            id="search"
            value={localFilters.search}
            onChange={(e) => handleInputChange('search', e.target.value)}
            placeholder="Search by name, SKU, or description..."
            className="site-input block w-full pl-10 pr-3 py-2 leading-5 placeholder-slate-400"
          />
        </div>
      </div>

      {showCategoryFilter && categories.length > 0 && (
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-slate-700 mb-2">
            Category
          </label>
          <select
            id="category"
            value={localFilters.category_id}
            onChange={(e) => handleInputChange('category_id', e.target.value)}
            className="site-select block w-full px-3 py-2 shadow-sm"
          >
            <option value="">All Categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Price Range
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="min_price" className="block text-xs text-slate-500 mb-1">
              Min Price
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 text-sm">
                $
              </span>
              <input
                type="text"
                id="min_price"
                value={localFilters.min_price}
                onChange={(e) => handlePriceChange('min_price', e.target.value)}
                placeholder="0"
                className="site-input block w-full pl-6 pr-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="max_price" className="block text-xs text-slate-500 mb-1">
              Max Price
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 text-sm">
                $
              </span>
              <input
                type="text"
                id="max_price"
                value={localFilters.max_price}
                onChange={(e) => handlePriceChange('max_price', e.target.value)}
                placeholder="10000"
                className="site-input block w-full pl-6 pr-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Enter price range to filter products
        </p>
      </div>

      {(localFilters.search || localFilters.min_price || localFilters.max_price || (showCategoryFilter && localFilters.category_id)) && (
        <div className="site-subtle-card p-4">
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Active Filters:</h4>
          <div className="space-y-1 text-sm text-slate-600">
            {localFilters.search && (
              <div>Search: &quot;{localFilters.search}&quot;</div>
            )}
            {showCategoryFilter && localFilters.category_id && (
              <div>
                Category: {categories.find(c => c.id.toString() === localFilters.category_id.toString())?.name || 'Unknown'}
              </div>
            )}
            {(localFilters.min_price || localFilters.max_price) && (
              <div>
                Price: ${localFilters.min_price || '0'} - ${localFilters.max_price || 'No max'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
