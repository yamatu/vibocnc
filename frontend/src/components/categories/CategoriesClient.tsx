'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ProductService, CategoryService } from '@/services';
import {
  CpuChipIcon,
  BoltIcon,
  RectangleGroupIcon,
  CogIcon,
  ComputerDesktopIcon,
  WrenchScrewdriverIcon,
  PowerIcon,
  DeviceTabletIcon
} from '@heroicons/react/24/outline';

// 图标映射
const iconMap: { [key: string]: any } = {
  'PowerIcon': PowerIcon,
  'CogIcon': CogIcon,
  'CpuChipIcon': CpuChipIcon,
  'BoltIcon': BoltIcon,
  'RectangleGroupIcon': RectangleGroupIcon,
  'ComputerDesktopIcon': ComputerDesktopIcon,
  'WrenchScrewdriverIcon': WrenchScrewdriverIcon,
  'DeviceTabletIcon': DeviceTabletIcon,
};

interface Category {
  id: number;
  name: string;
  slug: string;
  path?: string;
  description: string;
  image_url?: string;
  icon_name?: string;
  product_count?: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface CategoriesClientProps {
  initialCategories?: Category[];
}

export default function CategoriesClient({ initialCategories = [] }: CategoriesClientProps) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [loading, setLoading] = useState(!initialCategories.length);
  const [error, setError] = useState<string | null>(null);
  const [productCounts, setProductCounts] = useState<{ [key: number]: number }>({});

  useEffect(() => {
    if (!initialCategories.length) {
      fetchCategories();
    }
  }, [initialCategories.length]);

  // Fetch product counts for all categories
  useEffect(() => {
    if (categories.length > 0) {
      fetchProductCounts();
    }
  }, [categories]);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      // 使用 CategoryService，这样当后端不可用时可以返回 mock 数据
      const cats = await CategoryService.getCategories();
      const activeCategories = (cats || [])
        .filter((cat: Category) => cat.is_active)
        .sort((a: Category, b: Category) => a.sort_order - b.sort_order);
      setCategories(activeCategories);
      setError(null);
    } catch (err) {
      console.error('Error fetching categories:', err);
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const fetchProductCounts = async () => {
    try {
      const counts: { [key: number]: number } = {};

      // 为每个分类获取产品数量
      await Promise.all(
        categories.map(async (category) => {
          try {
            const response = await ProductService.getProducts({
              category_id: category.id.toString(),
              page: 1,
              page_size: 1, // 只需要获取总数，不需要实际产品数据
              is_active: 'true'
            });
            counts[category.id] = response.total || 0;
          } catch (error) {
            console.error(`Error fetching product count for category ${category.id}:`, error);
            counts[category.id] = 0;
          }
        })
      );

      setProductCounts(counts);
    } catch (error) {
      console.error('Error fetching product counts:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="text-red-600 mb-4">Error loading categories: {error}</div>
        <button 
          onClick={fetchCategories}
          className="site-primary-action px-6 py-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!categories.length) {
    return (
      <div className="text-center py-20">
        <div className="text-gray-600 mb-4">No categories available</div>
        <button 
          onClick={fetchCategories}
          className="site-primary-action px-6 py-2"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {categories.map((category) => {
        // 获取图标组件
        const IconComponent = category.icon_name ? iconMap[category.icon_name] || CogIcon : CogIcon;
        
        return (
          <Link
            key={category.id}
            href={`/categories/${category.path || category.slug}`}
            className="site-product-card group"
          >
            <div className="relative h-48 bg-gradient-to-br from-gray-100 to-gray-200">
              {category.image_url ? (
                <Image
                  src={category.image_url}
                  alt={category.name}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => {
                    // 如果图片加载失败，显示图标
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <IconComponent className="h-20 w-20 text-[#0b3e75]" />
                </div>
              )}
              
              <div className="absolute bottom-4 right-4 rounded-full bg-[#0b3e75] px-3 py-1 text-sm font-semibold text-white">
                {productCounts[category.id] !== undefined ? productCounts[category.id] : '...'}
              </div>
            </div>
            
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-[#0b3e75] transition-colors">
                {category.name}
              </h3>
              <p className="text-gray-600 mb-4 line-clamp-3">
                {category.description}
              </p>
              
              <div className="flex items-center justify-between">
                <span className="site-link-accent text-sm">
                  View Products →
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
