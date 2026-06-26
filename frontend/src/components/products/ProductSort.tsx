'use client';

import { ChevronDownIcon } from '@heroicons/react/24/outline';

interface ProductSortProps {
  sortBy: string;
  sortOrder: string;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  className?: string;
}

const sortOptions = [
  { value: 'created_at|desc', label: 'Newest First', sortBy: 'created_at', sortOrder: 'desc' },
  { value: 'created_at|asc', label: 'Oldest First', sortBy: 'created_at', sortOrder: 'asc' },
  { value: 'name|asc', label: 'Name: A to Z', sortBy: 'name', sortOrder: 'asc' },
  { value: 'name|desc', label: 'Name: Z to A', sortBy: 'name', sortOrder: 'desc' },
  { value: 'price|asc', label: 'Price: Low to High', sortBy: 'price', sortOrder: 'asc' },
  { value: 'price|desc', label: 'Price: High to Low', sortBy: 'price', sortOrder: 'desc' },
  { value: 'sku|asc', label: 'SKU: A to Z', sortBy: 'sku', sortOrder: 'asc' },
  { value: 'sku|desc', label: 'SKU: Z to A', sortBy: 'sku', sortOrder: 'desc' },
];

export default function ProductSort({
  sortBy,
  sortOrder,
  onSortChange,
  className = ''
}: ProductSortProps) {
  const currentValue = `${sortBy}|${sortOrder}`;
  
  const handleSortChange = (value: string) => {
    const [newSortBy, newSortOrder] = value.split('|');
    onSortChange(newSortBy, newSortOrder);
  };

  const currentOption = sortOptions.find(option => option.value === currentValue);

  return (
    <div className={`relative ${className}`}>
      <label htmlFor="sort" className="sr-only">
        Sort products
      </label>
      <div className="relative">
        <select
          id="sort"
          value={currentValue}
          onChange={(e) => handleSortChange(e.target.value)}
          className="site-select appearance-none block w-full px-3 py-2 pr-8 text-sm font-medium cursor-pointer"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <ChevronDownIcon className="h-4 w-4 text-slate-400" />
        </div>
      </div>
      
      {/* Sort indicator */}
      <div className="mt-1 text-xs text-slate-500">
        Sorted by: {currentOption?.label || 'Default'}
      </div>
    </div>
  );
}
