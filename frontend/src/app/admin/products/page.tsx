'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'react-hot-toast';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  PhotoIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  SparklesIcon,
  XMarkIcon,
  TagIcon
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import Pagination from '@/components/common/Pagination';
import MediaPickerModal from '@/components/admin/MediaPickerModal';
import { ProductService, CategoryService } from '@/services';
import type {
  BulkAutoCategorizeResult,
  BulkCategorizeOptimizeResult,
  BulkDisableAutoSEOResult,
  ProductImportResult,
  ProductImportTaskSnapshot,
  ProductOptimizationStatus,
} from '@/services/product.service';
import type { MediaAsset } from '@/services/media.service';
import type { Product } from '@/types';
import { queryKeys } from '@/lib/react-query';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl } from '@/lib/utils';
import { useAdminI18n } from '@/lib/admin-i18n';

type BulkSelectionPayload = {
  ids?: number[];
  skus?: string[];
  search?: string;
  category_id?: string;
  include_descendants?: boolean;
  status?: 'active' | 'inactive' | 'all' | '';
  featured?: 'true' | 'false' | '';
  brand?: string;
  batch_size?: number;
};

type AutoCategorizeProgress = {
  status: 'idle' | 'preparing' | 'running' | 'completed' | 'failed';
  processed: number;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  currentBatch: number;
  totalBatches: number;
  message: string;
};

const AUTO_CATEGORIZE_BATCH_SIZE = 100;
const BULK_UPDATE_BATCH_SIZE = 100;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function AdminProductsContent() {
  const { locale, t } = useAdminI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'created_at' | 'updated_at' | 'price' | 'name'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20); // Dynamic page size
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectAllResults, setSelectAllResults] = useState<boolean>(false);

  // XLSX import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBrand, setImportBrand] = useState<string>('');
  const [importOverwrite, setImportOverwrite] = useState<boolean>(false);
  const [importCreateMissing, setImportCreateMissing] = useState<boolean>(true);
  const [importResult, setImportResult] = useState<ProductImportResult | null>(null);
  const [importTask, setImportTask] = useState<ProductImportTaskSnapshot | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const importPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showCategoryImagePicker, setShowCategoryImagePicker] = useState(false);
  const [categoryImageBrand, setCategoryImageBrand] = useState('');
  const [categoryImageMode, setCategoryImageMode] = useState<'fill_empty' | 'replace_all'>('fill_empty');
  const [lastAutoCategorizeResult, setLastAutoCategorizeResult] = useState<BulkAutoCategorizeResult | null>(null);
  const [lastCategorizeOptimizeResult, setLastCategorizeOptimizeResult] = useState<BulkCategorizeOptimizeResult | null>(null);
  const [lastDisableAutoSEOResult, setLastDisableAutoSEOResult] = useState<BulkDisableAutoSEOResult | null>(null);
  const [autoCategorizeProgress, setAutoCategorizeProgress] = useState<AutoCategorizeProgress>({
    status: 'idle',
    processed: 0,
    total: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    currentBatch: 0,
    totalBatches: 0,
    message: '',
  });
  const [bulkUpdateProgress, setBulkUpdateProgress] = useState<AutoCategorizeProgress>({
    status: 'idle',
    processed: 0,
    total: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    currentBatch: 0,
    totalBatches: 0,
    message: '',
  });
  const [optimizeProgress, setOptimizeProgress] = useState<AutoCategorizeProgress>({
    status: 'idle',
    processed: 0,
    total: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    currentBatch: 0,
    totalBatches: 0,
    message: '',
  });
  const [disableAutoSEOProgress, setDisableAutoSEOProgress] = useState<AutoCategorizeProgress>({
    status: 'idle',
    processed: 0,
    total: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    currentBatch: 0,
    totalBatches: 0,
    message: '',
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    return () => {
      if (importPollRef.current) {
        clearInterval(importPollRef.current);
        importPollRef.current = null;
      }
    };
  }, []);

  // Scroll position management
  const saveScrollPosition = () => {
    const scrollY = window.scrollY;
    sessionStorage.setItem('adminProductsScrollY', scrollY.toString());
  };

  const restoreScrollPosition = () => {
    const savedScrollY = sessionStorage.getItem('adminProductsScrollY');
    if (savedScrollY) {
      // Use setTimeout to ensure DOM is rendered before scrolling
      setTimeout(() => {
        window.scrollTo({
          top: parseInt(savedScrollY, 10),
          behavior: 'auto' // Use 'auto' for immediate scroll without animation
        });
        // Clear the saved position after restoring
        sessionStorage.removeItem('adminProductsScrollY');
      }, 100);
    }
  };

  // Save scroll position when navigating to edit page
  const handleEditClick = () => {
    saveScrollPosition();
    // The actual navigation will be handled by the Link component
  };

  // Function to update URL with current state
  const updateURL = (updates: Partial<{
    search: string;
    category: string;
    brand: string;
    status: string;
    sortBy: 'created_at' | 'updated_at' | 'price' | 'name';
    sortDir: 'asc' | 'desc';
    page: number;
    pageSize: number;
  }>) => {
    const params = new URLSearchParams();

    const finalSearch = updates.search !== undefined ? updates.search : searchQuery;
    const finalCategory = updates.category !== undefined ? updates.category : selectedCategory;
    const finalBrand = updates.brand !== undefined ? updates.brand : selectedBrand;
    const finalStatus = updates.status !== undefined ? updates.status : statusFilter;
    const finalSortBy = updates.sortBy !== undefined ? updates.sortBy : sortBy;
    const finalSortDir = updates.sortDir !== undefined ? updates.sortDir : sortDir;
    const finalPage = updates.page !== undefined ? updates.page : currentPage;
    const finalPageSize = updates.pageSize !== undefined ? updates.pageSize : pageSize;

    if (finalSearch) params.set('search', finalSearch);
    if (finalCategory) params.set('category', finalCategory);
    if (finalBrand) params.set('brand', finalBrand);
    if (finalStatus && finalStatus !== 'all') params.set('status', finalStatus);
    if (finalSortBy !== 'created_at') params.set('sortBy', finalSortBy);
    if (finalSortDir !== 'desc') params.set('sortDir', finalSortDir);
    if (finalPage && finalPage > 1) params.set('page', String(finalPage));
    if (finalPageSize !== 20) params.set('pageSize', String(finalPageSize));

    const qs = params.toString();
    const newUrl = `/admin/products${qs ? `?${qs}` : ''}`;

    // Use replace to avoid adding to browser history for every filter change
    router.replace(newUrl, { scroll: false });
  };

  // Build a return URL preserving current list position and filters
  const buildListUrl = () => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (selectedCategory) params.set('category', selectedCategory);
    if (selectedBrand) params.set('brand', selectedBrand);
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
    if (sortBy !== 'created_at') params.set('sortBy', sortBy);
    if (sortDir !== 'desc') params.set('sortDir', sortDir);
    if (currentPage && currentPage > 1) params.set('page', String(currentPage));
    if (pageSize !== 20) params.set('pageSize', String(pageSize));
    const qs = params.toString();
    return `/admin/products${qs ? `?${qs}` : ''}`;
  };

  // Initialize state from URL query (so returning from edit preserves position)
  useEffect(() => {
    if (!searchParams) return;
    const s = searchParams.get('search') || '';
    const c = searchParams.get('category') || '';
    const b = searchParams.get('brand') || '';
    const st = (searchParams.get('status') as 'all' | 'active' | 'inactive' | 'featured') || 'all';
    const sb = (searchParams.get('sortBy') as 'created_at' | 'updated_at' | 'price' | 'name') || 'created_at';
    const sd = (searchParams.get('sortDir') as 'asc' | 'desc') || 'desc';
    const p = parseInt(searchParams.get('page') || '1', 10);
    const ps = parseInt(searchParams.get('pageSize') || '20', 10);

    setSearchQuery(s);
    setSelectedCategory(c);
    setSelectedBrand(b);
    setStatusFilter(st);
    setSortBy(['created_at', 'updated_at', 'price', 'name'].includes(sb) ? sb : 'created_at');
    setSortDir(sd === 'asc' ? 'asc' : 'desc');
    setCurrentPage(Number.isFinite(p) && p > 0 ? p : 1);
    setPageSize([20, 50, 100, 200, 500].includes(ps) ? ps : 20);
  }, [searchParams]);

  // Fetch products from API with pagination
  const { data: productsData, isLoading, error } = useQuery({
    queryKey: queryKeys.products.list({
      search: searchQuery,
      category: selectedCategory,
      brand: selectedBrand,
      status: statusFilter,
      sortBy,
      sortDir,
      page: currentPage,
      pageSize
    }),
    queryFn: () => ProductService.getAdminProducts({
      search: searchQuery,
      category_id: selectedCategory || undefined,
      include_descendants: selectedCategory ? 'true' : undefined,
      brand: selectedBrand || undefined,
      is_active: statusFilter === 'active' ? 'true' : statusFilter === 'inactive' ? 'false' : undefined,
      is_featured: statusFilter === 'featured' ? 'true' : undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      page: currentPage,
      page_size: pageSize
    }),
  });

  const products = productsData?.data || []; // Use empty array if no data
  const totalPages = productsData?.total_pages || 1;
  const totalProducts = productsData?.total || 0;

  // Restore scroll position after data is loaded and page is rendered
  useEffect(() => {
    if (!isLoading && productsData) {
      restoreScrollPosition();
    }
  }, [isLoading, productsData]);

  // Fetch categories for filter dropdown (admin sees full list)
  const { data: categoriesData = [] } = useQuery({
    queryKey: queryKeys.categories.lists(),
    queryFn: () => CategoryService.getAdminCategories(),
  });

  const { data: optimizationStatus, refetch: refetchOptimizationStatus } = useQuery<ProductOptimizationStatus>({
    queryKey: ['admin', 'products', 'optimization-status'],
    queryFn: () => ProductService.getOptimizationStatus(),
    staleTime: 30_000,
  });

  const categories = Array.isArray(categoriesData) ? categoriesData : [];

  // Bulk update mutation
  const bulkUpdateMutation = useMutation({
    mutationFn: (payload: { ids?: number[]; skus?: string[]; is_active?: boolean; is_featured?: boolean }) =>
      ProductService.bulkUpdateProducts(payload),
    onSuccess: () => {
      toast.success(t('products.toast.bulkUpdated', 'Products updated successfully'));
      setSelectedIds([]);
      setSelectAllResults(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('products.toast.bulkFailed', 'Bulk update failed')));
    },
  });

  const bulkApplyDefaultImageMutation = useMutation({
    mutationFn: (payload: BulkSelectionPayload) => ProductService.bulkApplyDefaultImage(payload),
    onSuccess: (data) => {
      toast.success(
        t(
          'products.defaultImage.applied',
          locale === 'zh'
            ? `已应用默认图片：更新 ${data?.updated || 0} 个`
            : `Default images applied: ${data?.updated || 0} updated`
        )
      );
      setSelectedIds([]);
      setSelectAllResults(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('products.defaultImage.applyFailed', locale === 'zh' ? '应用默认图片失败' : 'Failed to apply default images')));
    },
  });

  const bulkRemoveDefaultImageMutation = useMutation({
    mutationFn: (payload: BulkSelectionPayload) => ProductService.bulkRemoveDefaultImage(payload),
    onSuccess: (data) => {
      toast.success(
        t(
          'products.defaultImage.removed',
          locale === 'zh'
            ? `已移除默认图片：更新 ${data?.updated || 0} 个`
            : `Default images removed: ${data?.updated || 0} updated`
        )
      );
      setSelectedIds([]);
      setSelectAllResults(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('products.defaultImage.removeFailed', locale === 'zh' ? '移除默认图片失败' : 'Failed to remove default images')));
    },
  });

  const bulkCategoryImageMutation = useMutation({
    mutationFn: (payload: {
      ids?: number[];
      skus?: string[];
      search?: string;
      category_id?: string;
      status?: 'active' | 'inactive' | 'all' | '';
      featured?: 'true' | 'false' | '';
      brand?: string;
      batch_size?: number;
      media_asset_id: number;
      apply_mode?: 'fill_empty' | 'replace_all';
    }) => ProductService.bulkApplyCategoryImage(payload),
    onSuccess: (data) => {
      toast.success(
        t(
          'products.bulk.categoryImageApplied',
          locale === 'zh'
            ? `批量替换产品图完成：更新 ${data.updated}，跳过 ${data.skipped}`
            : `Category image update completed: ${data.updated} updated, ${data.skipped} skipped`
        )
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
      setShowCategoryImagePicker(false);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('products.bulk.categoryImageFailed', locale === 'zh' ? '批量替换产品图失败' : 'Failed to apply category image')));
    },
  });

  const buildSelectAllPayload = (): BulkSelectionPayload => ({
    batch_size: 500,
    search: searchQuery || undefined,
    category_id: selectedCategory || undefined,
    include_descendants: Boolean(selectedCategory),
    brand: selectedBrand || undefined,
    status: (statusFilter === 'all' || statusFilter === 'featured') ? 'all' : (statusFilter as 'active' | 'inactive'),
    featured: (statusFilter === 'featured') ? 'true' : undefined,
  });

  const effectiveBulkBrand = selectedBrand || categoryImageBrand || undefined;

  const buildScopedPayload = (): BulkSelectionPayload => (
    selectAllResults
      ? { ...buildSelectAllPayload(), brand: effectiveBulkBrand }
      : { ids: selectedIds, brand: effectiveBulkBrand }
  );

  const bulkApplyDefaultImages = () => {
    if (!selectAllResults && selectedIds.length === 0) { toast.error(t('products.toast.selectOne', locale === 'zh' ? '请至少选择一个产品' : 'Select at least one product')); return; }
    const payload = selectAllResults ? buildSelectAllPayload() : { ids: selectedIds };
    bulkApplyDefaultImageMutation.mutate(payload);
  };

  const bulkRemoveDefaultImages = () => {
    if (!selectAllResults && selectedIds.length === 0) { toast.error(t('products.toast.selectOne', locale === 'zh' ? '请至少选择一个产品' : 'Select at least one product')); return; }
    const payload = selectAllResults ? buildSelectAllPayload() : { ids: selectedIds };
    bulkRemoveDefaultImageMutation.mutate(payload);
  };

  const bulkAutoCategorize = () => {
    if (!selectAllResults && selectedIds.length === 0) {
      toast.error(t('products.toast.selectOne', locale === 'zh' ? '请至少选择一个产品' : 'Select at least one product'));
      return;
    }

    const run = async () => {
      try {
        setLastAutoCategorizeResult(null);
        setAutoCategorizeProgress({
          status: 'preparing',
          processed: 0,
          total: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          currentBatch: 0,
          totalBatches: 0,
          message: locale === 'zh' ? '正在准备分批任务...' : 'Preparing batch job...',
        });

        let targetIds = [...selectedIds];
        if (selectAllResults) {
          const snapshot = await ProductService.getAdminProductSelectionIds({
            ...buildSelectAllPayload(),
            brand: effectiveBulkBrand,
          });
          targetIds = snapshot.ids;
        }

        if (targetIds.length === 0) {
          setAutoCategorizeProgress({
            status: 'idle',
            processed: 0,
            total: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            currentBatch: 0,
            totalBatches: 0,
            message: '',
          });
          toast.error(t('products.bulk.noProducts', locale === 'zh' ? '没有可处理的产品' : 'No products to process'));
          return;
        }

        const total = targetIds.length;
        const totalBatches = Math.ceil(total / AUTO_CATEGORIZE_BATCH_SIZE);
        const aggregate: BulkAutoCategorizeResult = {
          updated: 0,
          skipped: 0,
          failed: 0,
          items: [],
        };

        setAutoCategorizeProgress({
          status: 'running',
          processed: 0,
          total,
          updated: 0,
          skipped: 0,
          failed: 0,
          currentBatch: 0,
          totalBatches,
          message: locale === 'zh' ? `共 ${total} 个产品，开始分 ${totalBatches} 批处理` : `Processing ${total} products across ${totalBatches} batches`,
        });

        for (let start = 0; start < total; start += AUTO_CATEGORIZE_BATCH_SIZE) {
          const batchIds = targetIds.slice(start, start + AUTO_CATEGORIZE_BATCH_SIZE);
          const batchIndex = Math.floor(start / AUTO_CATEGORIZE_BATCH_SIZE) + 1;

          setAutoCategorizeProgress((prev) => ({
            ...prev,
            status: 'running',
            currentBatch: batchIndex,
            totalBatches,
            message: locale === 'zh'
              ? `正在处理第 ${batchIndex}/${totalBatches} 批（${batchIds.length} 个产品）`
              : `Processing batch ${batchIndex}/${totalBatches} (${batchIds.length} products)`,
          }));

          const result = await ProductService.bulkAutoCategorize({
            ids: batchIds,
            brand: effectiveBulkBrand,
            batch_size: batchIds.length,
          });

          aggregate.updated += result.updated;
          aggregate.skipped += result.skipped;
          aggregate.failed += result.failed;
          if (aggregate.items.length < 50 && result.items?.length) {
            aggregate.items = aggregate.items.concat(result.items).slice(0, 50);
          }

          const processed = Math.min(start + batchIds.length, total);
          setAutoCategorizeProgress({
            status: 'running',
            processed,
            total,
            updated: aggregate.updated,
            skipped: aggregate.skipped,
            failed: aggregate.failed,
            currentBatch: batchIndex,
            totalBatches,
            message: locale === 'zh'
              ? `已完成 ${processed}/${total} 个产品`
              : `${processed}/${total} products completed`,
          });
        }

        setLastAutoCategorizeResult(aggregate);
        setAutoCategorizeProgress((prev) => ({
          ...prev,
          status: 'completed',
          processed: total,
          total,
          currentBatch: totalBatches,
          totalBatches,
          message: locale === 'zh' ? '自动分类已全部完成' : 'Auto categorization completed',
        }));
        queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
        toast.success(
          t(
            'products.bulk.autoCategorized',
            locale === 'zh'
              ? `自动分类完成：更新 ${aggregate.updated}，跳过 ${aggregate.skipped}，失败 ${aggregate.failed}`
              : `Auto categorization completed: ${aggregate.updated} updated, ${aggregate.skipped} skipped, ${aggregate.failed} failed`
          )
        );
      } catch (error: unknown) {
        setAutoCategorizeProgress((prev) => ({
          ...prev,
          status: 'failed',
          message: getErrorMessage(error, t('products.bulk.autoCategorizeFailed', locale === 'zh' ? '自动分类失败' : 'Failed to auto categorize')),
        }));
        toast.error(getErrorMessage(error, t('products.bulk.autoCategorizeFailed', locale === 'zh' ? '自动分类失败' : 'Failed to auto categorize')));
      }
    };

    void run();
  };

  const bulkCategorizeAndOptimize = () => {
    if (!selectAllResults && selectedIds.length === 0) {
      toast.error(t('products.toast.selectOne', locale === 'zh' ? '请至少选择一个产品' : 'Select at least one product'));
      return;
    }

    const run = async () => {
      try {
        setLastCategorizeOptimizeResult(null);
        setOptimizeProgress({
          status: 'preparing',
          processed: 0,
          total: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          currentBatch: 0,
          totalBatches: 0,
          message: locale === 'zh' ? '正在准备批量 SEO 优化任务...' : 'Preparing bulk SEO optimization...',
        });

        let targetIds = [...selectedIds];
        if (selectAllResults) {
          const snapshot = await ProductService.getAdminProductSelectionIds({
            ...buildSelectAllPayload(),
            brand: effectiveBulkBrand,
          });
          targetIds = snapshot.ids;
        }

        if (targetIds.length === 0) {
          setOptimizeProgress({
            status: 'idle',
            processed: 0,
            total: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            currentBatch: 0,
            totalBatches: 0,
            message: '',
          });
          toast.error(t('products.bulk.noProducts', locale === 'zh' ? '没有可处理的产品' : 'No products to process'));
          return;
        }

        const total = targetIds.length;
        const totalBatches = Math.ceil(total / AUTO_CATEGORIZE_BATCH_SIZE);
        const aggregate: BulkCategorizeOptimizeResult = {
          updated: 0,
          skipped: 0,
          failed: 0,
          items: [],
        };

        setOptimizeProgress({
          status: 'running',
          processed: 0,
          total,
          updated: 0,
          skipped: 0,
          failed: 0,
          currentBatch: 0,
          totalBatches,
          message: locale === 'zh' ? `共 ${total} 个产品，开始分类并优化 SEO` : `Categorizing and optimizing ${total} products`,
        });

        for (let start = 0; start < total; start += AUTO_CATEGORIZE_BATCH_SIZE) {
          const batchIds = targetIds.slice(start, start + AUTO_CATEGORIZE_BATCH_SIZE);
          const batchIndex = Math.floor(start / AUTO_CATEGORIZE_BATCH_SIZE) + 1;

          setOptimizeProgress((prev) => ({
            ...prev,
            status: 'running',
            currentBatch: batchIndex,
            totalBatches,
            message: locale === 'zh'
              ? `正在处理第 ${batchIndex}/${totalBatches} 批 SEO 优化`
              : `Processing SEO batch ${batchIndex}/${totalBatches}`,
          }));

          const result = await ProductService.bulkCategorizeOptimizeProducts({
            ids: batchIds,
            brand: effectiveBulkBrand,
            batch_size: batchIds.length,
            force_update: false,
          });

          aggregate.updated += result.updated;
          aggregate.skipped += result.skipped;
          aggregate.failed += result.failed;
          if (aggregate.items.length < 50 && result.items?.length) {
            aggregate.items = aggregate.items.concat(result.items).slice(0, 50);
          }

          const processed = Math.min(start + batchIds.length, total);
          setOptimizeProgress({
            status: 'running',
            processed,
            total,
            updated: aggregate.updated,
            skipped: aggregate.skipped,
            failed: aggregate.failed,
            currentBatch: batchIndex,
            totalBatches,
            message: locale === 'zh'
              ? `已完成 ${processed}/${total} 个产品的分类与 SEO 优化`
              : `${processed}/${total} products categorized and optimized`,
          });
        }

        setLastCategorizeOptimizeResult(aggregate);
        setOptimizeProgress((prev) => ({
          ...prev,
          status: 'completed',
          processed: total,
          total,
          currentBatch: totalBatches,
          totalBatches,
          message: locale === 'zh' ? '分类和 SEO 优化已全部完成' : 'Categorization and SEO optimization completed',
        }));
        queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
        void refetchOptimizationStatus();
        toast.success(
          locale === 'zh'
            ? `SEO 优化完成：更新 ${aggregate.updated}，跳过 ${aggregate.skipped}，失败 ${aggregate.failed}`
            : `SEO optimization completed: ${aggregate.updated} updated, ${aggregate.skipped} skipped, ${aggregate.failed} failed`
        );
      } catch (error: unknown) {
        setOptimizeProgress((prev) => ({
          ...prev,
          status: 'failed',
          message: getErrorMessage(error, locale === 'zh' ? '批量 SEO 优化失败' : 'Bulk SEO optimization failed'),
        }));
        toast.error(getErrorMessage(error, locale === 'zh' ? '批量 SEO 优化失败' : 'Bulk SEO optimization failed'));
      }
    };

    void run();
  };

  const bulkDisableAutoSEO = () => {
    if (!selectAllResults && selectedIds.length === 0) {
      toast.error(t('products.toast.selectOne', locale === 'zh' ? '请至少选择一个产品' : 'Select at least one product'));
      return;
    }

    const run = async () => {
      try {
        setLastDisableAutoSEOResult(null);
        setDisableAutoSEOProgress({
          status: 'preparing',
          processed: 0,
          total: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          currentBatch: 0,
          totalBatches: 0,
          message: locale === 'zh' ? '正在准备批量关闭自动 SEO...' : 'Preparing bulk auto-SEO disable...',
        });

        let targetIds = [...selectedIds];
        if (selectAllResults) {
          const snapshot = await ProductService.getAdminProductSelectionIds({
            ...buildSelectAllPayload(),
            brand: effectiveBulkBrand,
          });
          targetIds = snapshot.ids;
        }

        if (targetIds.length === 0) {
          setDisableAutoSEOProgress({
            status: 'idle',
            processed: 0,
            total: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            currentBatch: 0,
            totalBatches: 0,
            message: '',
          });
          toast.error(t('products.bulk.noProducts', locale === 'zh' ? '没有可处理的产品' : 'No products to process'));
          return;
        }

        const total = targetIds.length;
        const totalBatches = Math.ceil(total / AUTO_CATEGORIZE_BATCH_SIZE);
        const aggregate: BulkDisableAutoSEOResult = {
          updated: 0,
          skipped: 0,
          failed: 0,
          items: [],
        };

        setDisableAutoSEOProgress({
          status: 'running',
          processed: 0,
          total,
          updated: 0,
          skipped: 0,
          failed: 0,
          currentBatch: 0,
          totalBatches,
          message: locale === 'zh' ? `共 ${total} 个产品，开始批量关闭自动 SEO` : `Disabling auto SEO for ${total} products`,
        });

        for (let start = 0; start < total; start += AUTO_CATEGORIZE_BATCH_SIZE) {
          const batchIds = targetIds.slice(start, start + AUTO_CATEGORIZE_BATCH_SIZE);
          const batchIndex = Math.floor(start / AUTO_CATEGORIZE_BATCH_SIZE) + 1;

          setDisableAutoSEOProgress((prev) => ({
            ...prev,
            status: 'running',
            currentBatch: batchIndex,
            totalBatches,
            message: locale === 'zh'
              ? `正在处理第 ${batchIndex}/${totalBatches} 批自动 SEO 关闭`
              : `Processing auto-SEO disable batch ${batchIndex}/${totalBatches}`,
          }));

          const result = await ProductService.bulkDisableAutoSEO({
            ids: batchIds,
            brand: effectiveBulkBrand,
            batch_size: batchIds.length,
          });

          aggregate.updated += result.updated;
          aggregate.skipped += result.skipped;
          aggregate.failed += result.failed;
          if (aggregate.items.length < 50 && result.items?.length) {
            aggregate.items = aggregate.items.concat(result.items).slice(0, 50);
          }

          const processed = Math.min(start + batchIds.length, total);
          setDisableAutoSEOProgress({
            status: 'running',
            processed,
            total,
            updated: aggregate.updated,
            skipped: aggregate.skipped,
            failed: aggregate.failed,
            currentBatch: batchIndex,
            totalBatches,
            message: locale === 'zh'
              ? `已完成 ${processed}/${total} 个产品的自动 SEO 关闭`
              : `${processed}/${total} products updated`,
          });
        }

        setLastDisableAutoSEOResult(aggregate);
        setDisableAutoSEOProgress((prev) => ({
          ...prev,
          status: 'completed',
          processed: total,
          total,
          currentBatch: totalBatches,
          totalBatches,
          message: locale === 'zh' ? '批量关闭自动 SEO 已完成' : 'Bulk auto-SEO disable completed',
        }));
        setSelectedIds([]);
        setSelectAllResults(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
        void refetchOptimizationStatus();
        toast.success(
          locale === 'zh'
            ? `批量关闭自动 SEO 完成：更新 ${aggregate.updated}，跳过 ${aggregate.skipped}，失败 ${aggregate.failed}`
            : `Bulk auto-SEO disable completed: ${aggregate.updated} updated, ${aggregate.skipped} skipped, ${aggregate.failed} failed`
        );
      } catch (error: unknown) {
        setDisableAutoSEOProgress((prev) => ({
          ...prev,
          status: 'failed',
          message: getErrorMessage(error, locale === 'zh' ? '批量关闭自动 SEO 失败' : 'Failed to disable automatic SEO in bulk'),
        }));
        toast.error(getErrorMessage(error, locale === 'zh' ? '批量关闭自动 SEO 失败' : 'Failed to disable automatic SEO in bulk'));
      }
    };

    void run();
  };

  const handleCategoryImageSelected = (assets: MediaAsset[]) => {
    const asset = assets[0];
    if (!asset) return;
    bulkCategoryImageMutation.mutate({
      ...buildScopedPayload(),
      media_asset_id: asset.id,
      apply_mode: categoryImageMode,
    });
  };

  // (Removed) Auto Import from Site feature

  // Delete product mutation
  const deleteProductMutation = useMutation({
    mutationFn: (productId: number) => ProductService.deleteProduct(productId),
    onSuccess: () => {
      toast.success(t('products.toast.deleted', 'Product deleted successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('products.toast.deleteFailed', 'Failed to delete product')));
    },
  });

  const handleDelete = (product: Product) => {
    const msg = t('products.confirm.delete', 'Are you sure you want to delete \"{name}\"? This action cannot be undone.', { name: product.name });
    if (window.confirm(msg)) {
      deleteProductMutation.mutate(product.id);
    }
  };

  const stopImportPolling = () => {
    if (importPollRef.current) {
      clearInterval(importPollRef.current);
      importPollRef.current = null;
    }
  };

  const handleImportTaskUpdate = (task: ProductImportTaskSnapshot) => {
    setImportTask(task);
    if (task.result) {
      setImportResult(task.result);
    }
    if (task.status === 'completed') {
      stopImportPolling();
      toast.success(
        t(
          'products.import.completed',
          locale === 'zh'
            ? `导入完成：新增 ${task.created || 0}，更新 ${task.updated || 0}`
            : `Import completed: ${task.created || 0} created, ${task.updated || 0} updated`
        )
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    }
    if (task.status === 'failed') {
      stopImportPolling();
      toast.error(task.message || t('products.import.failed', locale === 'zh' ? '导入失败' : 'Import failed'));
    }
  };

  const startImportPolling = (taskId: string) => {
    stopImportPolling();

    const poll = async () => {
      try {
        const task = await ProductService.getImportProductsTask(taskId);
        handleImportTaskUpdate(task);
      } catch (error: unknown) {
        stopImportPolling();
        toast.error(getErrorMessage(error, t('products.import.failed', locale === 'zh' ? '导入失败' : 'Import failed')));
      }
    };

    void poll();
    importPollRef.current = setInterval(() => {
      void poll();
    }, 1500);
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!importFile) throw new Error(locale === 'zh' ? '请选择 .xlsx 文件' : 'Please select an .xlsx file');
      return ProductService.importProductsXlsx(importFile, {
        brand: importBrand,
        overwrite: importOverwrite,
        create_missing: importCreateMissing,
      }, (pct) => {
        setUploadProgress(pct);
      });
    },
    onMutate: () => {
      setUploadProgress(0);
      setImportResult(null);
      setImportTask(null);
      stopImportPolling();
    },
    onSuccess: (task: ProductImportTaskSnapshot) => {
      setUploadProgress(100);
      setImportTask(task);
      startImportPolling(task.id);
    },
    onError: (error: unknown) => {
      stopImportPolling();
      toast.error(getErrorMessage(error, t('products.import.failed', locale === 'zh' ? '导入失败' : 'Import failed')));
    },
  });

  const downloadTemplate = async () => {
    try {
      const blob = await ProductService.downloadImportTemplate(importBrand);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const templateBrand = importBrand || 'generic';
      a.download = `product-import-template-${templateBrand}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t('products.import.templateDownloaded', locale === 'zh' ? '模板已下载' : 'Template downloaded'));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('products.import.templateDownloadFailed', locale === 'zh' ? '下载模板失败' : 'Failed to download template')));
    }
  };

  // Reset page to 1 when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
    updateURL({ search: value, page: 1 });
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    setCurrentPage(1);
    updateURL({ category: value, page: 1 });
  };

  const handleBrandChange = (value: string) => {
    setSelectedBrand(value);
    setCurrentPage(1);
    setSelectedIds([]);
    setSelectAllResults(false);
    updateURL({ brand: value, page: 1 });
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
    updateURL({ status: value, page: 1 });
  };

  const handleSortChange = (value: string) => {
    const [nextSortByRaw, nextSortDirRaw] = value.split(':');
    const nextSortBy = (['created_at', 'updated_at', 'price', 'name'].includes(nextSortByRaw)
      ? nextSortByRaw
      : 'created_at') as 'created_at' | 'updated_at' | 'price' | 'name';
    const nextSortDir = (nextSortDirRaw === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
    setSortBy(nextSortBy);
    setSortDir(nextSortDir);
    setCurrentPage(1);
    updateURL({ sortBy: nextSortBy, sortDir: nextSortDir, page: 1 });
  };

  const handlePageSizeChange = (value: number) => {
    setPageSize(value);
    setCurrentPage(1);
    setSelectedIds([]);
    setSelectAllResults(false);
    updateURL({ pageSize: value, page: 1 });
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    updateURL({ page });
  };

  // Clear all filters
  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('');
    setSelectedBrand('');
    setStatusFilter('all');
    setSortBy('created_at');
    setSortDir('desc');
    setCurrentPage(1);
    updateURL({ search: '', category: '', brand: '', status: 'all', sortBy: 'created_at', sortDir: 'desc', page: 1 });
  };

  const toggleSelectAllOnPage = (checked: boolean, current: Product[]) => {
    setSelectAllResults(false);
    if (checked) setSelectedIds(current.map((p) => p.id));
    else setSelectedIds([]);
  };

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => checked ? Array.from(new Set([...prev, id])) : prev.filter(x => x !== id));
  };

  const bulkSetActive = (value: boolean) => {
    void runBulkFlagUpdate('is_active', value);
  };

  const bulkSetFeatured = (value: boolean) => {
    void runBulkFlagUpdate('is_featured', value);
  };

  const runBulkFlagUpdate = async (field: 'is_active' | 'is_featured', value: boolean) => {
    if (!selectAllResults && selectedIds.length === 0) {
      toast.error(t('products.toast.selectOne', locale === 'zh' ? '请至少选择一个产品' : 'Select at least one product'));
      return;
    }

    try {
      setBulkUpdateProgress({
        status: 'preparing',
        processed: 0,
        total: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        currentBatch: 0,
        totalBatches: 0,
        message: locale === 'zh' ? '正在准备批量更新...' : 'Preparing bulk update...',
      });

      let targetIds = [...selectedIds];
      if (selectAllResults) {
        const snapshot = await ProductService.getAdminProductSelectionIds(buildSelectAllPayload());
        targetIds = snapshot.ids;
      }

      if (targetIds.length === 0) {
        setBulkUpdateProgress({
          status: 'idle',
          processed: 0,
          total: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          currentBatch: 0,
          totalBatches: 0,
          message: '',
        });
        toast.error(t('products.bulk.noProducts', locale === 'zh' ? '没有可处理的产品' : 'No products to process'));
        return;
      }

      const total = targetIds.length;
      const totalBatches = Math.ceil(total / BULK_UPDATE_BATCH_SIZE);

      setBulkUpdateProgress({
        status: 'running',
        processed: 0,
        total,
        updated: 0,
        skipped: 0,
        failed: 0,
        currentBatch: 0,
        totalBatches,
        message: locale === 'zh'
          ? `共 ${total} 个产品，开始分 ${totalBatches} 批处理`
          : `Processing ${total} products across ${totalBatches} batches`,
      });

      for (let start = 0; start < total; start += BULK_UPDATE_BATCH_SIZE) {
        const batchIds = targetIds.slice(start, start + BULK_UPDATE_BATCH_SIZE);
        const batchIndex = Math.floor(start / BULK_UPDATE_BATCH_SIZE) + 1;

        setBulkUpdateProgress((prev) => ({
          ...prev,
          status: 'running',
          currentBatch: batchIndex,
          totalBatches,
          message: locale === 'zh'
            ? `正在处理第 ${batchIndex}/${totalBatches} 批（${batchIds.length} 个产品）`
            : `Processing batch ${batchIndex}/${totalBatches} (${batchIds.length} products)`,
        }));

        await ProductService.bulkUpdateProducts({
          ids: batchIds,
          [field]: value,
        });

        const processed = Math.min(start + batchIds.length, total);
        setBulkUpdateProgress({
          status: 'running',
          processed,
          total,
          updated: processed,
          skipped: 0,
          failed: 0,
          currentBatch: batchIndex,
          totalBatches,
          message: locale === 'zh'
            ? `已完成 ${processed}/${total} 个产品`
            : `${processed}/${total} products completed`,
        });
      }

      setBulkUpdateProgress((prev) => ({
        ...prev,
        status: 'completed',
        processed: total,
        total,
        updated: total,
        currentBatch: totalBatches,
        totalBatches,
        message: locale === 'zh' ? '批量更新已完成' : 'Bulk update completed',
      }));
      setSelectedIds([]);
      setSelectAllResults(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
      toast.success(
        field === 'is_active'
          ? (value
            ? t('products.bulk.setActiveDone', locale === 'zh' ? `已批量启用 ${total} 个产品` : `Activated ${total} products`)
            : t('products.bulk.setInactiveDone', locale === 'zh' ? `已批量停用 ${total} 个产品` : `Deactivated ${total} products`))
          : (value
            ? t('products.bulk.markFeaturedDone', locale === 'zh' ? `已批量设为推荐 ${total} 个产品` : `Marked ${total} products as featured`)
            : t('products.bulk.unmarkFeaturedDone', locale === 'zh' ? `已批量取消推荐 ${total} 个产品` : `Unmarked ${total} featured products`))
      );
    } catch (error: unknown) {
      setBulkUpdateProgress((prev) => ({
        ...prev,
        status: 'failed',
        message: getErrorMessage(error, t('products.toast.bulkFailed', locale === 'zh' ? '批量更新失败' : 'Bulk update failed')),
      }));
      toast.error(getErrorMessage(error, t('products.toast.bulkFailed', locale === 'zh' ? '批量更新失败' : 'Bulk update failed')));
    }
  };

  // Use products directly from API (already filtered and paginated)
  const filteredProducts = products;

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('nav.products', 'Products')}</h1>
            <p className="mt-1 text-sm text-gray-500">
				{t('products.page.subtitle', locale === 'zh' ? '管理工业自动化产品库存' : 'Manage your industrial automation product inventory')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowImportModal(true);
                setImportResult(null);
                setImportFile(null);
                setImportTask(null);
                setUploadProgress(0);
                stopImportPolling();
              }}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
				{t('products.import.bulk', locale === 'zh' ? '批量导入' : 'Bulk Import')}
            </button>
            <Link
              href="/admin/products/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
				{t('products.new.title', locale === 'zh' ? '新增产品' : 'Add Product')}
            </Link>
          </div>
        </div>

        {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
				  <div className="text-lg font-semibold text-gray-900">{t('products.import.modalTitle', locale === 'zh' ? '批量导入产品（XLSX）' : 'Bulk Import Products (XLSX)')}</div>
				  <div className="text-xs text-gray-500">{t('products.import.columns', locale === 'zh' ? '模板列：型号 / 价格 / 数量 / 重量kg' : 'Template columns: Model, Price, Quantity, WeightKg')}</div>
                </div>
                <button
                  onClick={() => {
                    stopImportPolling();
                    setShowImportModal(false);
                  }}
                  className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                  <div className="w-full sm:w-auto">
					<label className="block text-sm font-medium text-gray-700 mb-1">{t('products.import.brand', locale === 'zh' ? '品牌' : 'Brand')}</label>
                    <select
                      value={importBrand}
                      onChange={(e) => setImportBrand(e.target.value)}
                      className="w-full sm:w-48 px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">{locale === 'zh' ? '自动 / 通用' : 'Auto / Generic'}</option>
                      <option value="fanuc">FANUC</option>
                      <option value="mitsubishi">Mitsubishi</option>
                      <option value="siemens">Siemens</option>
                      <option value="abb">ABB</option>
                    </select>
					<p className="mt-1 text-xs text-gray-500">{t('products.import.brandHint', locale === 'zh' ? '留空时按通用工业自动化模板处理；选择品牌时会按对应品牌补全。' : 'Leave blank for generic industrial automation handling, or choose a brand-specific template.')}</p>
                  </div>
                  <button
                    onClick={downloadTemplate}
                    className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
					{t('products.import.downloadTemplate', locale === 'zh' ? '下载模板' : 'Download Template')}
                  </button>
                </div>

                <div>
				  <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.import.uploadXlsx', locale === 'zh' ? '上传 .xlsx 文件' : 'Upload .xlsx')}</label>
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setImportFile(f);
                      setImportResult(null);
                      setImportTask(null);
                      setUploadProgress(0);
                      stopImportPolling();
                    }}
                    className="block w-full text-sm"
                  />
				  <p className="mt-1 text-xs text-gray-500">{t('products.import.hint', locale === 'zh' ? '系统会按 SKU/型号/料号匹配；更新价格/库存/重量，并可补全 SEO 字段。' : 'We will match by SKU/model/part number; then update price/stock/weight, and fill missing SEO fields.')}</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={importCreateMissing}
                      onChange={(e) => setImportCreateMissing(e.target.checked)}
                      className="h-4 w-4"
                    />
					{t('products.import.createMissing', locale === 'zh' ? '自动创建缺失的产品' : 'Create missing products')}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={importOverwrite}
                      onChange={(e) => setImportOverwrite(e.target.checked)}
                      className="h-4 w-4"
                    />
					{t('products.import.overwrite', locale === 'zh' ? '覆盖名称/描述/SEO' : 'Overwrite name/description/SEO')}
                  </label>
                </div>

                {(importMutation.isPending || importTask) && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-3">
                    <div>
                      <div className="flex items-center justify-between text-sm text-gray-700">
                        <span>{locale === 'zh' ? '文件上传进度' : 'Upload progress'}</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-blue-100">
                        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </div>

                    {importTask && (
                      <div>
                        <div className="flex items-center justify-between text-sm text-gray-700">
                          <span>{locale === 'zh' ? '后台导入进度' : 'Import progress'}</span>
                          <span>{Math.round(importTask.progress_pct || 0)}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-emerald-100">
                          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, importTask.progress_pct || 0))}%` }} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                          <span>{locale === 'zh'
                            ? `状态：${importTask.status === 'queued' ? '排队中' : importTask.status === 'processing' ? '处理中' : importTask.status === 'completed' ? '已完成' : '失败'}`
                            : `Status: ${importTask.status}`}</span>
                          <span>{locale === 'zh' ? `已处理：${importTask.processed_rows}/${importTask.total_rows || '?'}` : `Processed: ${importTask.processed_rows}/${importTask.total_rows || '?'}`}</span>
                          <span>{locale === 'zh' ? `新增：${importTask.created}` : `Created: ${importTask.created}`}</span>
                          <span>{locale === 'zh' ? `更新：${importTask.updated}` : `Updated: ${importTask.updated}`}</span>
                          <span>{locale === 'zh' ? `跳过：${importTask.skipped}` : `Skipped: ${importTask.skipped}`}</span>
                          <span>{locale === 'zh' ? `失败：${importTask.failed}` : `Failed: ${importTask.failed}`}</span>
                        </div>
                        {importTask.message && (
                          <div className="mt-2 text-xs text-gray-500">{importTask.message}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {importResult && (
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
					<div className="text-sm font-semibold text-gray-900">{t('common.result', locale === 'zh' ? '结果' : 'Result')}</div>
                    <div className="mt-1 text-sm text-gray-700">
						{t('products.import.summary', locale === 'zh'
							? `总行数：${importResult.total_rows} | 新增：${importResult.created} | 更新：${importResult.updated} | 失败：${importResult.failed}`
							: `Total rows: ${importResult.total_rows} | Created: ${importResult.created} | Updated: ${importResult.updated} | Failed: ${importResult.failed}`)}
                    </div>

                    {Array.isArray(importResult.items) && importResult.items.length > 0 && (
                      <div className="mt-3 max-h-56 overflow-auto rounded border border-gray-200 bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="sticky top-0 bg-gray-50">
                            <tr>
							  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('common.row', locale === 'zh' ? '行号' : 'Row')}</th>
							  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('products.import.model', locale === 'zh' ? '型号' : 'Model')}</th>
							  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('common.action', locale === 'zh' ? '操作' : 'Action')}</th>
							  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('common.message', locale === 'zh' ? '信息' : 'Message')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importResult.items.slice(0, 200).map((it, i: number) => (
                              <tr key={`${it.row_number || i}-${it.model || i}`} className="border-t">
                                <td className="px-3 py-2 text-gray-700">{it.row_number}</td>
                                <td className="px-3 py-2 font-mono text-gray-900">{it.model}</td>
                                <td className="px-3 py-2 text-gray-700">{it.action}</td>
                                <td className="px-3 py-2 text-gray-600">{it.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                <button
                  onClick={() => {
                    stopImportPolling();
                    setShowImportModal(false);
                  }}
                  className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50"
                >
				  {t('common.close', locale === 'zh' ? '关闭' : 'Close')}
                </button>
                <button
                  onClick={() => importMutation.mutate()}
                  disabled={!importFile || importMutation.isPending}
                  className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
                >
                  <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
				  {importMutation.isPending
					? t('products.import.importing', locale === 'zh' ? '导入中...' : 'Importing...')
					: t('shipping.import', locale === 'zh' ? '导入' : 'Import')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm text-emerald-800">{locale === 'zh' ? '已优化产品' : 'Optimized Products'}</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-950">{optimizationStatus?.optimized_products ?? '-'}</div>
            <div className="mt-1 text-xs text-emerald-700">
              {locale === 'zh' ? '近 30 天内自动或手动优化过' : 'Optimized within the last 30 days'}
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm text-amber-800">{locale === 'zh' ? '待优化产品' : 'Needs Optimization'}</div>
            <div className="mt-2 text-2xl font-semibold text-amber-950">{optimizationStatus?.needs_optimization ?? '-'}</div>
            <div className="mt-1 text-xs text-amber-700">
              {locale === 'zh' ? '缺少 SEO 字段或长期未刷新' : 'Missing SEO fields or stale optimization'}
            </div>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
            <div className="text-sm text-sky-800">{locale === 'zh' ? '平均 SEO 分' : 'Average SEO Score'}</div>
            <div className="mt-2 text-2xl font-semibold text-sky-950">
              {typeof optimizationStatus?.average_seo_score === 'number' ? optimizationStatus.average_seo_score.toFixed(2) : '-'}
            </div>
            <div className="mt-1 text-xs text-sky-700">
              {locale === 'zh' ? '按后台内容完整度自动计算' : 'Calculated from product content completeness'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm text-slate-800">{locale === 'zh' ? '自动优化状态' : 'Auto Optimization'}</div>
            <div className="mt-2 text-base font-semibold text-slate-950">
              {locale === 'zh' ? '已启用' : 'Enabled'}
            </div>
            <div className="mt-1 text-xs text-slate-700">
              {locale === 'zh'
                ? '后台新建/编辑产品后会自动补分类、SEO 字段与 FAQ'
                : 'New and edited products now auto-fill category, SEO fields, and FAQs'}
            </div>
          </div>
        </div>

        {/* Bulk actions and Page Size Selector */}
        <div className="bg-white shadow rounded-lg border border-gray-200">
          {/* Top Row - Page Size and Bulk Actions Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 p-4 border-b border-gray-200">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700 font-medium">{t('common.show', locale === 'zh' ? '显示：' : 'Show:')}</span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
				  <option value={20}>{locale === 'zh' ? '每页 20' : '20 per page'}</option>
				  <option value={50}>{locale === 'zh' ? '每页 50' : '50 per page'}</option>
				  <option value={100}>{locale === 'zh' ? '每页 100' : '100 per page'}</option>
				  <option value={200}>{locale === 'zh' ? '每页 200' : '200 per page'}</option>
				  <option value={500}>{locale === 'zh' ? '每页 500' : '500 per page'}</option>
                </select>
              </div>
              <div className="text-sm text-gray-500">
				{t('common.total', locale === 'zh' ? '总计：' : 'Total:')} {totalProducts} {t('products.page.count', locale === 'zh' ? '个产品' : 'products')}
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm">
              {!selectAllResults ? (
                <>
                  <span className="text-gray-600 font-medium">
					{t('common.selected', locale === 'zh' ? '已选择' : 'Selected')}: <span className="text-blue-600">{selectedIds.length}</span>
                  </span>
                  {filteredProducts.length > 0 && totalProducts > filteredProducts.length && (
                    <button
                      onClick={() => { setSelectAllResults(true); }}
                      className="inline-flex items-center px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors font-medium"
                    >
						{t('common.selectAll', locale === 'zh' ? `选择全部 ${totalProducts} 条结果` : `Select all ${totalProducts} results`)}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span className="text-green-700 font-medium bg-green-50 px-3 py-1.5 rounded-md">
					{t('common.allSelected', locale === 'zh' ? `已选择全部 ${totalProducts} 条结果` : `All ${totalProducts} results selected`)}
                  </span>
                  <button
                    onClick={() => { setSelectAllResults(false); setSelectedIds([]); }}
                    className="inline-flex items-center px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors font-medium"
                  >
					{t('common.clearSelection', locale === 'zh' ? '清空选择' : 'Clear selection')}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Bottom Row - Bulk Action Buttons */}
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-gray-700 font-medium mr-2">{t('common.bulkActions', locale === 'zh' ? '批量操作：' : 'Bulk actions:')}</span>

              <button
                onClick={() => bulkSetActive(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={(bulkUpdateMutation.isPending || bulkUpdateProgress.status === 'preparing' || bulkUpdateProgress.status === 'running') || (!selectAllResults && selectedIds.length === 0)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
				{t('products.bulk.setActive', locale === 'zh' ? '设为启用' : 'Set Active')}
              </button>

              <button
                onClick={() => bulkSetActive(false)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={(bulkUpdateMutation.isPending || bulkUpdateProgress.status === 'preparing' || bulkUpdateProgress.status === 'running') || (!selectAllResults && selectedIds.length === 0)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
				{t('products.bulk.setInactive', locale === 'zh' ? '设为停用' : 'Set Inactive')}
              </button>

              <button
                onClick={() => bulkSetFeatured(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={(bulkUpdateMutation.isPending || bulkUpdateProgress.status === 'preparing' || bulkUpdateProgress.status === 'running') || (!selectAllResults && selectedIds.length === 0)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
				{t('products.bulk.markFeatured', locale === 'zh' ? '设为推荐' : 'Mark Featured')}
              </button>

              <button
                onClick={() => bulkSetFeatured(false)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-600 hover:bg-slate-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={(bulkUpdateMutation.isPending || bulkUpdateProgress.status === 'preparing' || bulkUpdateProgress.status === 'running') || (!selectAllResults && selectedIds.length === 0)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                </svg>
				{t('products.bulk.unmarkFeatured', locale === 'zh' ? '取消推荐' : 'Unmark Featured')}
              </button>

              <button
                onClick={bulkAutoCategorize}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={autoCategorizeProgress.status === 'preparing' || autoCategorizeProgress.status === 'running' || (!selectAllResults && selectedIds.length === 0)}
				title={t('products.bulk.autoCategorizeTitle', locale === 'zh' ? '按品牌和型号规则批量自动分类并补全缺失 SEO 字段' : 'Auto categorize by brand/model rules and fill missing SEO fields')}
              >
                <TagIcon className="h-4 w-4 mr-2" />
				{autoCategorizeProgress.status === 'preparing' || autoCategorizeProgress.status === 'running'
				  ? (locale === 'zh' ? '自动分类进行中...' : 'Auto Categorizing...')
				  : t('products.bulk.autoCategorize', locale === 'zh' ? '自动分类' : 'Auto Categorize')}
              </button>

              <button
                onClick={bulkCategorizeAndOptimize}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={optimizeProgress.status === 'preparing' || optimizeProgress.status === 'running' || (!selectAllResults && selectedIds.length === 0)}
				title={locale === 'zh' ? '按当前批量品牌设置，批量自动分类并重写 SEO 描述、Meta、FAQ 等字段' : 'Bulk categorize and rewrite SEO descriptions, meta fields, and FAQs using the selected bulk brand'}
              >
                <SparklesIcon className="h-4 w-4 mr-2" />
                {optimizeProgress.status === 'preparing' || optimizeProgress.status === 'running'
                  ? (locale === 'zh' ? 'SEO 优化进行中...' : 'Optimizing SEO...')
                  : (locale === 'zh' ? '分类 + SEO 优化' : 'Categorize + SEO')}
              </button>

              <button
                onClick={bulkDisableAutoSEO}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={disableAutoSEOProgress.status === 'preparing' || disableAutoSEOProgress.status === 'running' || (!selectAllResults && selectedIds.length === 0)}
				title={locale === 'zh' ? '批量关闭所选产品的自动 SEO 覆盖，并清理已有的品牌 SEO 文案' : 'Disable automatic SEO override for selected products and reset existing brand-specific SEO copy'}
              >
                <XMarkIcon className="h-4 w-4 mr-2" />
                {disableAutoSEOProgress.status === 'preparing' || disableAutoSEOProgress.status === 'running'
                  ? (locale === 'zh' ? '关闭自动 SEO 中...' : 'Disabling Auto SEO...')
                  : (locale === 'zh' ? '批量关闭自动 SEO' : 'Disable Auto SEO')}
              </button>

              <button
                onClick={() => setShowCategoryImagePicker(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-fuchsia-600 hover:bg-fuchsia-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={bulkCategoryImageMutation.isPending || (!selectAllResults && selectedIds.length === 0)}
				title={t('products.bulk.categoryImageTitle', locale === 'zh' ? '按当前筛选的品牌/分类批量替换产品图，可只补空图或全部覆盖' : 'Bulk replace product images by current brand/category filter')}
              >
                <PhotoIcon className="h-4 w-4 mr-2" />
				{t('products.bulk.categoryImage', locale === 'zh' ? '分类批量换图' : 'Batch Category Image')}
              </button>

              <button
                onClick={bulkApplyDefaultImages}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={
                  bulkApplyDefaultImageMutation.isPending ||
                  (!selectAllResults && selectedIds.length === 0)
                }
				title={t('products.bulk.applyDefaultTitle', locale === 'zh' ? '为当前没有图片的产品应用默认 SKU 水印图' : 'Apply default SKU-watermarked image to products that currently have no images')}
              >
                <SparklesIcon className="h-4 w-4 mr-2" />
				{t('products.bulk.applyDefault', locale === 'zh' ? '应用默认图片' : 'Apply Default Image')}
              </button>

              <button
                onClick={bulkRemoveDefaultImages}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={
                  bulkRemoveDefaultImageMutation.isPending ||
                  (!selectAllResults && selectedIds.length === 0)
                }
				title={t('products.bulk.removeDefaultTitle', locale === 'zh' ? '移除默认水印图 URL（保留其他图片）' : 'Remove the default watermark image URL (keeps other images)')}
              >
                <XMarkIcon className="h-4 w-4 mr-2" />
				{t('products.bulk.removeDefault', locale === 'zh' ? '移除默认图片' : 'Remove Default Image')}
              </button>

              {(selectedIds.length > 0 || selectAllResults) && (
                <div className="ml-auto text-sm text-gray-500 bg-gray-100 px-3 py-2 rounded-lg">
					{selectAllResults
						? (locale === 'zh' ? `已选择 ${totalProducts} 个产品` : `${totalProducts} products selected`)
						: (locale === 'zh' ? `已选择 ${selectedIds.length} 个产品` : `${selectedIds.length} products selected`)}
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">{locale === 'zh' ? '批量品牌 / SEO 品牌' : 'Bulk Brand / SEO Brand'}</span>
                <select
                  value={categoryImageBrand}
                  onChange={(e) => setCategoryImageBrand(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-md"
                >
                  <option value="">{locale === 'zh' ? '自动 / 当前筛选' : 'Auto / Current Filters'}</option>
                  <option value="fanuc">FANUC</option>
                  <option value="mitsubishi">Mitsubishi</option>
                  <option value="siemens">Siemens</option>
                  <option value="abb">ABB</option>
                </select>
              </div>
              {selectedBrand && (
                <div className="text-sm text-blue-600">
                  {locale === 'zh'
                    ? `当前已按品牌 ${selectedBrand.toUpperCase()} 筛选；你也可以在这里选择另一品牌来批量重写 SEO`
                    : `Brand filter ${selectedBrand.toUpperCase()} is active; you can still choose another brand here to bulk rewrite SEO content`}
                </div>
              )}
              <div className="text-sm text-orange-600">
                {locale === 'zh'
                  ? '如果你先按品牌筛选，再点“选择全部结果”后执行“批量关闭自动 SEO”，就可以整批关闭这个品牌的自动 SEO。'
                  : 'Filter by brand first, then select all results and run "Disable Auto SEO" to turn it off for that whole brand.'}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">{t('products.bulk.imageMode', locale === 'zh' ? '换图模式' : 'Image mode')}</span>
                <select
                  value={categoryImageMode}
                  onChange={(e) => setCategoryImageMode(e.target.value as 'fill_empty' | 'replace_all')}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-md"
                >
                  <option value="fill_empty">{t('products.bulk.imageModeFill', locale === 'zh' ? '只补空图' : 'Fill Empty Only')}</option>
                  <option value="replace_all">{t('products.bulk.imageModeReplace', locale === 'zh' ? '全部覆盖' : 'Replace All')}</option>
                </select>
              </div>
              {selectedCategory ? (
                <div className="text-sm text-gray-500">
                  {t('products.bulk.categoryScoped', locale === 'zh' ? '当前会按已选分类范围执行' : 'Current category filter will scope this action')}
                </div>
              ) : (
                <div className="text-sm text-amber-600">
                  {t('products.bulk.categoryScopedHint', locale === 'zh' ? '未选分类时会作用于当前筛选结果；这里选择的品牌会同时用于批量分类、SEO 重写和分类图批量处理' : 'Without a category filter, this applies to the current filtered results; the brand chosen here is also used for bulk categorization, SEO rewriting, and category image actions')}
                </div>
              )}
            </div>
            {bulkUpdateProgress.status !== 'idle' && (
              <div className={`mt-4 rounded-lg border p-4 ${
                bulkUpdateProgress.status === 'failed'
                  ? 'border-rose-200 bg-rose-50'
                  : bulkUpdateProgress.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-blue-200 bg-blue-50'
              }`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {locale === 'zh' ? '批量更新进度' : 'Bulk update progress'}
                    </div>
                    <div className="mt-1 text-sm text-gray-700">{bulkUpdateProgress.message}</div>
                  </div>
                  <div className="text-sm text-gray-700">
                    {bulkUpdateProgress.total > 0
                      ? `${bulkUpdateProgress.processed}/${bulkUpdateProgress.total}`
                      : (locale === 'zh' ? '准备中' : 'Preparing')}
                  </div>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/80">
                  <div
                    className={`h-full rounded-full transition-all ${
                      bulkUpdateProgress.status === 'failed'
                        ? 'bg-rose-500'
                        : bulkUpdateProgress.status === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-blue-500'
                    }`}
                    style={{
                      width: `${bulkUpdateProgress.total > 0
                        ? Math.min(100, Math.round((bulkUpdateProgress.processed / bulkUpdateProgress.total) * 100))
                        : 8}%`
                    }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-gray-700">
                  <span>{locale === 'zh' ? '已处理' : 'Processed'}: {bulkUpdateProgress.processed}</span>
                  {bulkUpdateProgress.totalBatches > 0 && (
                    <span>
                      {locale === 'zh' ? '批次' : 'Batch'}: {bulkUpdateProgress.currentBatch}/{bulkUpdateProgress.totalBatches}
                    </span>
                  )}
                </div>
              </div>
            )}
            {autoCategorizeProgress.status !== 'idle' && (
              <div className={`mt-4 rounded-lg border p-4 ${
                autoCategorizeProgress.status === 'failed'
                  ? 'border-rose-200 bg-rose-50'
                  : autoCategorizeProgress.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-cyan-200 bg-cyan-50'
              }`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {locale === 'zh' ? '自动分类进度' : 'Auto categorization progress'}
                    </div>
                    <div className="mt-1 text-sm text-gray-700">{autoCategorizeProgress.message}</div>
                  </div>
                  <div className="text-sm text-gray-700">
                    {autoCategorizeProgress.total > 0
                      ? `${autoCategorizeProgress.processed}/${autoCategorizeProgress.total}`
                      : (locale === 'zh' ? '准备中' : 'Preparing')}
                  </div>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/80">
                  <div
                    className={`h-full rounded-full transition-all ${
                      autoCategorizeProgress.status === 'failed'
                        ? 'bg-rose-500'
                        : autoCategorizeProgress.status === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-cyan-500'
                    }`}
                    style={{
                      width: `${autoCategorizeProgress.total > 0
                        ? Math.min(100, Math.round((autoCategorizeProgress.processed / autoCategorizeProgress.total) * 100))
                        : 8}%`
                    }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-gray-700">
                  <span>{locale === 'zh' ? '已更新' : 'Updated'}: {autoCategorizeProgress.updated}</span>
                  <span>{locale === 'zh' ? '已跳过' : 'Skipped'}: {autoCategorizeProgress.skipped}</span>
                  <span>{locale === 'zh' ? '失败' : 'Failed'}: {autoCategorizeProgress.failed}</span>
                  {autoCategorizeProgress.totalBatches > 0 && (
                    <span>
                      {locale === 'zh' ? '批次' : 'Batch'}: {autoCategorizeProgress.currentBatch}/{autoCategorizeProgress.totalBatches}
                    </span>
                  )}
                </div>
              </div>
            )}
            {optimizeProgress.status !== 'idle' && (
              <div className={`mt-4 rounded-lg border p-4 ${
                optimizeProgress.status === 'failed'
                  ? 'border-rose-200 bg-rose-50'
                  : optimizeProgress.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-blue-200 bg-blue-50'
              }`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {locale === 'zh' ? 'SEO 优化进度' : 'SEO optimization progress'}
                    </div>
                    <div className="mt-1 text-sm text-gray-700">{optimizeProgress.message}</div>
                  </div>
                  <div className="text-sm text-gray-700">
                    {optimizeProgress.total > 0
                      ? `${optimizeProgress.processed}/${optimizeProgress.total}`
                      : (locale === 'zh' ? '准备中' : 'Preparing')}
                  </div>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/80">
                  <div
                    className={`h-full rounded-full transition-all ${
                      optimizeProgress.status === 'failed'
                        ? 'bg-rose-500'
                        : optimizeProgress.status === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-blue-500'
                    }`}
                    style={{
                      width: `${optimizeProgress.total > 0
                        ? Math.min(100, Math.round((optimizeProgress.processed / optimizeProgress.total) * 100))
                        : 8}%`
                    }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-gray-700">
                  <span>{locale === 'zh' ? '已更新' : 'Updated'}: {optimizeProgress.updated}</span>
                  <span>{locale === 'zh' ? '已跳过' : 'Skipped'}: {optimizeProgress.skipped}</span>
                  <span>{locale === 'zh' ? '失败' : 'Failed'}: {optimizeProgress.failed}</span>
                  {optimizeProgress.totalBatches > 0 && (
                    <span>
                      {locale === 'zh' ? '批次' : 'Batch'}: {optimizeProgress.currentBatch}/{optimizeProgress.totalBatches}
                    </span>
                  )}
                </div>
              </div>
            )}
            {disableAutoSEOProgress.status !== 'idle' && (
              <div className={`mt-4 rounded-lg border p-4 ${
                disableAutoSEOProgress.status === 'failed'
                  ? 'border-rose-200 bg-rose-50'
                  : disableAutoSEOProgress.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-orange-200 bg-orange-50'
              }`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {locale === 'zh' ? '批量关闭自动 SEO 进度' : 'Bulk auto-SEO disable progress'}
                    </div>
                    <div className="mt-1 text-sm text-gray-700">{disableAutoSEOProgress.message}</div>
                  </div>
                  <div className="text-sm text-gray-700">
                    {disableAutoSEOProgress.total > 0
                      ? `${disableAutoSEOProgress.processed}/${disableAutoSEOProgress.total}`
                      : (locale === 'zh' ? '准备中' : 'Preparing')}
                  </div>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/80">
                  <div
                    className={`h-full rounded-full transition-all ${
                      disableAutoSEOProgress.status === 'failed'
                        ? 'bg-rose-500'
                        : disableAutoSEOProgress.status === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-orange-500'
                    }`}
                    style={{
                      width: `${disableAutoSEOProgress.total > 0
                        ? Math.min(100, Math.round((disableAutoSEOProgress.processed / disableAutoSEOProgress.total) * 100))
                        : 8}%`
                    }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-gray-700">
                  <span>{locale === 'zh' ? '已更新' : 'Updated'}: {disableAutoSEOProgress.updated}</span>
                  <span>{locale === 'zh' ? '已跳过' : 'Skipped'}: {disableAutoSEOProgress.skipped}</span>
                  <span>{locale === 'zh' ? '失败' : 'Failed'}: {disableAutoSEOProgress.failed}</span>
                  {disableAutoSEOProgress.totalBatches > 0 && (
                    <span>
                      {locale === 'zh' ? '批次' : 'Batch'}: {disableAutoSEOProgress.currentBatch}/{disableAutoSEOProgress.totalBatches}
                    </span>
                  )}
                </div>
              </div>
            )}
            {lastAutoCategorizeResult && (
              <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <div className="text-sm font-medium text-cyan-900">
                  {t('products.bulk.autoCategorizeLast', locale === 'zh' ? '最近一次自动分类结果' : 'Last auto categorization result')}
                </div>
                <div className="mt-1 text-sm text-cyan-800">
                  {locale === 'zh'
                    ? `更新 ${lastAutoCategorizeResult.updated}，跳过 ${lastAutoCategorizeResult.skipped}，失败 ${lastAutoCategorizeResult.failed}`
                    : `${lastAutoCategorizeResult.updated} updated, ${lastAutoCategorizeResult.skipped} skipped, ${lastAutoCategorizeResult.failed} failed`}
                </div>
                {lastAutoCategorizeResult.items?.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-auto rounded border border-cyan-100 bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-cyan-50">
                        <tr>
                          <th className="px-3 py-2 text-left">SKU</th>
                          <th className="px-3 py-2 text-left">{locale === 'zh' ? '分类' : 'Category'}</th>
                          <th className="px-3 py-2 text-left">{locale === 'zh' ? '规则' : 'Rule'}</th>
                          <th className="px-3 py-2 text-left">{locale === 'zh' ? '结果' : 'Result'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastAutoCategorizeResult.items.map((item) => (
                          <tr key={`${item.product_id}-${item.sku}`} className="border-t">
                            <td className="px-3 py-2 font-mono text-gray-900">{item.sku}</td>
                            <td className="px-3 py-2 text-gray-700">{item.category_slug}</td>
                            <td className="px-3 py-2 text-gray-500">{item.match_rule}</td>
                            <td className="px-3 py-2 text-gray-700">{item.action}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {lastDisableAutoSEOResult && (
              <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3">
                <div className="text-sm font-medium text-orange-900">
                  {locale === 'zh' ? '最近一次批量关闭自动 SEO 结果' : 'Last auto-SEO disable result'}
                </div>
                <div className="mt-1 text-sm text-orange-800">
                  {locale === 'zh'
                    ? `更新 ${lastDisableAutoSEOResult.updated}，跳过 ${lastDisableAutoSEOResult.skipped}，失败 ${lastDisableAutoSEOResult.failed}`
                    : `${lastDisableAutoSEOResult.updated} updated, ${lastDisableAutoSEOResult.skipped} skipped, ${lastDisableAutoSEOResult.failed} failed`}
                </div>
                {lastDisableAutoSEOResult.items?.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-auto rounded border border-orange-100 bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-orange-50">
                        <tr>
                          <th className="px-3 py-2 text-left">SKU</th>
                          <th className="px-3 py-2 text-left">{locale === 'zh' ? '品牌' : 'Brand'}</th>
                          <th className="px-3 py-2 text-left">SEO</th>
                          <th className="px-3 py-2 text-left">{locale === 'zh' ? '结果' : 'Result'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastDisableAutoSEOResult.items.map((item) => (
                          <tr key={`${item.product_id}-${item.sku}`} className="border-t">
                            <td className="px-3 py-2 font-mono text-gray-900">{item.sku}</td>
                            <td className="px-3 py-2 text-gray-700">{item.brand || '-'}</td>
                            <td className="px-3 py-2 text-gray-500">{item.disable_auto_seo ? (locale === 'zh' ? '已关闭' : 'Disabled') : (locale === 'zh' ? '未关闭' : 'Enabled')}</td>
                            <td className="px-3 py-2 text-gray-700">{item.action}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {lastCategorizeOptimizeResult && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="text-sm font-medium text-blue-900">
                  {locale === 'zh' ? '最近一次 SEO 优化结果' : 'Last SEO optimization result'}
                </div>
                <div className="mt-1 text-sm text-blue-800">
                  {locale === 'zh'
                    ? `更新 ${lastCategorizeOptimizeResult.updated}，跳过 ${lastCategorizeOptimizeResult.skipped}，失败 ${lastCategorizeOptimizeResult.failed}`
                    : `${lastCategorizeOptimizeResult.updated} updated, ${lastCategorizeOptimizeResult.skipped} skipped, ${lastCategorizeOptimizeResult.failed} failed`}
                </div>
                {lastCategorizeOptimizeResult.items?.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-auto rounded border border-blue-100 bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-blue-50">
                        <tr>
                          <th className="px-3 py-2 text-left">SKU</th>
                          <th className="px-3 py-2 text-left">{locale === 'zh' ? '分类' : 'Category'}</th>
                          <th className="px-3 py-2 text-left">SEO</th>
                          <th className="px-3 py-2 text-left">{locale === 'zh' ? '结果' : 'Result'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastCategorizeOptimizeResult.items.map((item) => (
                          <tr key={`${item.product_id}-${item.sku}`} className="border-t">
                            <td className="px-3 py-2 font-mono text-gray-900">{item.sku}</td>
                            <td className="px-3 py-2 text-gray-700">{item.category_slug}</td>
                            <td className="px-3 py-2 text-gray-500">{item.seo_updated ? (locale === 'zh' ? '已更新' : 'Updated') : (locale === 'zh' ? '未变更' : 'No change')}</td>
                            <td className="px-3 py-2 text-gray-700">{item.action}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {/* Search */}
            <div>
                <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
				{t('common.search', locale === 'zh' ? '搜索' : 'Search')}
                </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  id="search"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
				  placeholder={t('products.page.searchPh', locale === 'zh' ? '搜索产品...' : 'Search products...')}
                />
              </div>
            </div>

            {/* Category Filter */}
            <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
				{t('products.field.category', locale === 'zh' ? '分类' : 'Category')}
                </label>
              <select
                id="category"
                value={selectedCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
				<option value="">{t('products.page.allCategories', locale === 'zh' ? '全部分类' : 'All Categories')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id.toString()}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
                <label htmlFor="brand" className="block text-sm font-medium text-gray-700 mb-1">
				{t('products.import.brand', locale === 'zh' ? '品牌' : 'Brand')}
                </label>
              <select
                id="brand"
                value={selectedBrand}
                onChange={(e) => handleBrandChange(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
				<option value="">{locale === 'zh' ? '全部品牌' : 'All Brands'}</option>
				<option value="fanuc">FANUC</option>
				<option value="mitsubishi">Mitsubishi</option>
				<option value="siemens">Siemens</option>
				<option value="abb">ABB</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
                <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
				{t('products.status.title', locale === 'zh' ? '状态' : 'Status')}
                </label>
              <select
                id="status"
                value={statusFilter}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
				<option value="all">{t('common.all', locale === 'zh' ? '全部' : 'All')}</option>
				<option value="active">{t('common.active', locale === 'zh' ? '启用' : 'Active')}</option>
				<option value="inactive">{t('common.inactive', locale === 'zh' ? '停用' : 'Inactive')}</option>
				<option value="featured">{t('products.status.featured', locale === 'zh' ? '推荐' : 'Featured')}</option>
              </select>
            </div>

            {/* Sort */}
            <div>
              <label htmlFor="sort" className="block text-sm font-medium text-gray-700 mb-1">
                {locale === 'zh' ? '排序' : 'Sort'}
              </label>
              <select
                id="sort"
                value={`${sortBy}:${sortDir}`}
                onChange={(e) => handleSortChange(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="created_at:desc">{locale === 'zh' ? '上传时间：新到旧' : 'Upload time: Newest'}</option>
                <option value="created_at:asc">{locale === 'zh' ? '上传时间：旧到新' : 'Upload time: Oldest'}</option>
                <option value="updated_at:desc">{locale === 'zh' ? '更新时间：新到旧' : 'Updated: Newest'}</option>
                <option value="updated_at:asc">{locale === 'zh' ? '更新时间：旧到新' : 'Updated: Oldest'}</option>
                <option value="price:desc">{locale === 'zh' ? '价格：高到低' : 'Price: High to Low'}</option>
                <option value="price:asc">{locale === 'zh' ? '价格：低到高' : 'Price: Low to High'}</option>
                <option value="name:asc">{locale === 'zh' ? '名称：A-Z' : 'Name: A-Z'}</option>
                <option value="name:desc">{locale === 'zh' ? '名称：Z-A' : 'Name: Z-A'}</option>
              </select>
            </div>

            {/* Actions */}
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FunnelIcon className="h-4 w-4 mr-2" />
				{t('common.clearFilters', locale === 'zh' ? '清除筛选' : 'Clear Filters')}
              </button>
            </div>
          </div>
        </div>

        {/* Products Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              {t(
                'products.page.tableTitle',
                locale === 'zh' ? '产品（{count}）' : 'Products ({count})',
                { count: isLoading ? '...' : filteredProducts.length }
              )}
            </h3>
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
			  <p className="mt-2 text-sm text-gray-500">{t('products.page.loading', locale === 'zh' ? '正在加载产品...' : 'Loading products...')}</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
			  <p className="text-sm text-red-600">{t('products.page.loadFailed', locale === 'zh' ? '加载产品失败，请重试。' : 'Failed to load products. Please try again.')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3">
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300" onChange={(e)=>toggleSelectAllOnPage(e.target.checked, filteredProducts)} checked={!selectAllResults && selectedIds.length>0 && selectedIds.length===filteredProducts.length} />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('products.table.product', locale === 'zh' ? '产品' : 'Product')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('products.table.category', locale === 'zh' ? '分类' : 'Category')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('products.table.price', locale === 'zh' ? '价格' : 'Price')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('products.table.stock', locale === 'zh' ? '库存' : 'Stock')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('products.table.status', locale === 'zh' ? '状态' : 'Status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {locale === 'zh' ? '上传时间' : 'Uploaded'}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('common.actions', locale === 'zh' ? '操作' : 'Actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={selectedIds.includes(product.id)}
                        onChange={(e)=>toggleSelectOne(product.id, e.target.checked)}
                        disabled={selectAllResults}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-12 w-12">
                          <Image
                            src={getProductImageUrl(product.image_urls, getDefaultProductImageWithSku(product.sku))}
                            alt={product.name}
                            width={48}
                            height={48}
                            className="h-12 w-12 rounded-lg object-cover"
                            // /uploads is served by nginx -> backend; skip Next image optimizer.
                            unoptimized={String(getProductImageUrl(product.image_urls, getDefaultProductImageWithSku(product.sku))).startsWith('/uploads/')}
                          />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {product.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {t('products.field.skuLabel', locale === 'zh' ? 'SKU：' : 'SKU:')} {product.sku}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{product.category.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {formatCurrency(product.price)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm font-medium ${
                        product.stock_quantity > 10 ? 'text-green-600' :
                        product.stock_quantity > 0 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {t('products.stock.units', locale === 'zh' ? '{count} 件' : '{count} units', { count: product.stock_quantity })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex space-x-2">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          product.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {product.is_active
                            ? t('common.active', locale === 'zh' ? '启用' : 'Active')
                            : t('common.inactive', locale === 'zh' ? '停用' : 'Inactive')}
                        </span>
                        {product.is_featured && (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                            {t('products.status.featured', locale === 'zh' ? '推荐' : 'Featured')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div>{new Date(product.created_at).toLocaleDateString()}</div>
                      <div className="text-xs text-gray-400">{new Date(product.created_at).toLocaleTimeString()}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </Link>
                        <Link
                          href={`/admin/products/${product.id}/edit?returnTo=${encodeURIComponent(buildListUrl())}`}
                          className="text-indigo-600 hover:text-indigo-900"
                          onClick={() => handleEditClick()}
                        >
                          <PencilIcon className="h-4 w-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(product)}
                          disabled={deleteProductMutation.isPending}
                          className="text-red-600 hover:text-red-900 disabled:opacity-50"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && filteredProducts.length === 0 && (
            <div className="text-center py-12">
              <PhotoIcon className="mx-auto h-12 w-12 text-gray-400" />
			  <h3 className="mt-2 text-sm font-medium text-gray-900">{t('products.page.empty', locale === 'zh' ? '没有找到产品' : 'No products found')}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('products.page.emptyHint', locale === 'zh' ? '从添加一个新产品开始吧。' : 'Get started by adding a new product.')}
              </p>
              <div className="mt-6">
                <Link
                  href="/admin/products/new"
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  <PlusIcon className="h-4 w-4 mr-2" />
                  {t('products.new.title', locale === 'zh' ? '新增产品' : 'Add Product')}
                </Link>
              </div>
            </div>
          )}

          {/* Pagination */}
          {!isLoading && !error && totalPages > 1 && (
            <div className="mt-6 flex justify-center">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                showFirstLast={true}
                showPageNumbers={true}
                maxVisiblePages={5}
              />
            </div>
          )}

          {/* Products count info */}
          {!isLoading && !error && totalProducts > 0 && (
            <div className="mt-4 text-center text-sm text-gray-500">
              {t(
                'common.showingRange',
                locale === 'zh'
                  ? '显示第 {from} - {to} 条，共 {total} 个产品'
                  : 'Showing {from} to {to} of {total} products',
                {
                  from: ((currentPage - 1) * pageSize) + 1,
                  to: Math.min(currentPage * pageSize, totalProducts),
                  total: totalProducts,
                }
              )}
            </div>
          )}
        </div>
      </div>
      <MediaPickerModal
        open={showCategoryImagePicker}
        onClose={() => setShowCategoryImagePicker(false)}
        onSelect={handleCategoryImageSelected}
        multiple={false}
        title={t('products.bulk.categoryImagePick', locale === 'zh' ? '选择要批量应用到当前品牌/分类的图片' : 'Select the image to apply to current brand/category')}
        initialFolder={selectedCategory ? '' : categoryImageBrand}
      />
    </AdminLayout>
  );
}

export default function AdminProductsPage() {
  function AdminProductsPageFallback() {
    const { locale, t } = useAdminI18n();
    return (
      <div className="flex items-center justify-center py-10">
        {t('common.loading', locale === 'zh' ? '加载中...' : 'Loading...')}
      </div>
    );
  }

  return (
	<Suspense fallback={<AdminProductsPageFallback />}>
      <AdminProductsContent />
    </Suspense>
  );
}
