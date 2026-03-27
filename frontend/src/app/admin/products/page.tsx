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
  XMarkIcon
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import Pagination from '@/components/common/Pagination';
import { ProductService, CategoryService } from '@/services';
import type { ProductImportTaskSnapshot } from '@/services/product.service';
import { queryKeys } from '@/lib/react-query';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl } from '@/lib/utils';
import { useAdminI18n } from '@/lib/admin-i18n';

function AdminProductsContent() {
  const { locale, t } = useAdminI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20); // Dynamic page size
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectAllResults, setSelectAllResults] = useState<boolean>(false);

  // XLSX import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBrand, setImportBrand] = useState<string>('fanuc');
  const [importOverwrite, setImportOverwrite] = useState<boolean>(false);
  const [importCreateMissing, setImportCreateMissing] = useState<boolean>(true);
  const [importResult, setImportResult] = useState<any>(null);
  const [importTask, setImportTask] = useState<ProductImportTaskSnapshot | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const importPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const handleEditClick = (productId: number) => {
    saveScrollPosition();
    // The actual navigation will be handled by the Link component
  };

  // Function to update URL with current state
  const updateURL = (updates: Partial<{
    search: string;
    category: string;
    status: string;
    page: number;
    pageSize: number;
  }>) => {
    const params = new URLSearchParams();

    const finalSearch = updates.search !== undefined ? updates.search : searchQuery;
    const finalCategory = updates.category !== undefined ? updates.category : selectedCategory;
    const finalStatus = updates.status !== undefined ? updates.status : statusFilter;
    const finalPage = updates.page !== undefined ? updates.page : currentPage;
    const finalPageSize = updates.pageSize !== undefined ? updates.pageSize : pageSize;

    if (finalSearch) params.set('search', finalSearch);
    if (finalCategory) params.set('category', finalCategory);
    if (finalStatus && finalStatus !== 'all') params.set('status', finalStatus);
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
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
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
    const st = (searchParams.get('status') as 'all' | 'active' | 'inactive' | 'featured') || 'all';
    const p = parseInt(searchParams.get('page') || '1', 10);
    const ps = parseInt(searchParams.get('pageSize') || '20', 10);

    setSearchQuery(s);
    setSelectedCategory(c);
    setStatusFilter(st);
    setCurrentPage(Number.isFinite(p) && p > 0 ? p : 1);
    setPageSize([20, 50, 100, 200, 500].includes(ps) ? ps : 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Fetch products from API with pagination
  const { data: productsData, isLoading, error } = useQuery({
    queryKey: queryKeys.products.list({
      search: searchQuery,
      category: selectedCategory,
      status: statusFilter,
      page: currentPage,
      pageSize
    }),
    queryFn: () => ProductService.getAdminProducts({
      search: searchQuery,
      category_id: selectedCategory || undefined,
      is_active: statusFilter === 'active' ? 'true' : statusFilter === 'inactive' ? 'false' : undefined,
      is_featured: statusFilter === 'featured' ? 'true' : undefined,
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
    onError: (error: any) => {
      toast.error(error.message || t('products.toast.bulkFailed', 'Bulk update failed'));
    },
  });

  const bulkApplyDefaultImageMutation = useMutation({
    mutationFn: (payload: any) => ProductService.bulkApplyDefaultImage(payload),
    onSuccess: (data: any) => {
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
    onError: (error: any) => {
      toast.error(error.message || t('products.defaultImage.applyFailed', locale === 'zh' ? '应用默认图片失败' : 'Failed to apply default images'));
    },
  });

  const bulkRemoveDefaultImageMutation = useMutation({
    mutationFn: (payload: any) => ProductService.bulkRemoveDefaultImage(payload),
    onSuccess: (data: any) => {
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
    onError: (error: any) => {
      toast.error(error.message || t('products.defaultImage.removeFailed', locale === 'zh' ? '移除默认图片失败' : 'Failed to remove default images'));
    },
  });

  const buildSelectAllPayload = () => ({
    batch_size: 500,
    search: searchQuery || undefined,
    category_id: selectedCategory || undefined,
    status: (statusFilter === 'all' || statusFilter === 'featured') ? 'all' : (statusFilter as 'active' | 'inactive'),
    featured: (statusFilter === 'featured') ? 'true' : undefined,
  });

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

  // (Removed) Auto Import from Site feature

  // Delete product mutation
  const deleteProductMutation = useMutation({
    mutationFn: (productId: number) => ProductService.deleteProduct(productId),
    onSuccess: () => {
      toast.success(t('products.toast.deleted', 'Product deleted successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
    onError: (error: any) => {
      toast.error(error.message || t('products.toast.deleteFailed', 'Failed to delete product'));
    },
  });

  const handleDelete = (product: any) => {
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
      } catch (error: any) {
        stopImportPolling();
        toast.error(error.message || t('products.import.failed', locale === 'zh' ? '导入失败' : 'Import failed'));
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
    onError: (error: any) => {
      stopImportPolling();
      toast.error(error.message || t('products.import.failed', locale === 'zh' ? '导入失败' : 'Import failed'));
    },
  });

  const downloadTemplate = async () => {
    try {
      const blob = await ProductService.downloadImportTemplate(importBrand);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `product-import-template-${importBrand}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t('products.import.templateDownloaded', locale === 'zh' ? '模板已下载' : 'Template downloaded'));
    } catch (e: any) {
      toast.error(e.message || t('products.import.templateDownloadFailed', locale === 'zh' ? '下载模板失败' : 'Failed to download template'));
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

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
    updateURL({ status: value, page: 1 });
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
    setStatusFilter('all');
    setCurrentPage(1);
    updateURL({ search: '', category: '', status: 'all', page: 1 });
  };

  const toggleSelectAllOnPage = (checked: boolean, current: any[]) => {
    setSelectAllResults(false);
    if (checked) setSelectedIds(current.map((p: any) => p.id));
    else setSelectedIds([]);
  };

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => checked ? Array.from(new Set([...prev, id])) : prev.filter(x => x !== id));
  };

  const bulkSetActive = (value: boolean) => {
    if (!selectAllResults && selectedIds.length === 0) { toast.error(t('products.toast.selectOne', 'Select at least one product')); return; }
    if (selectAllResults) {
      bulkUpdateMutation.mutate({
        is_active: value,
        batch_size: 500,
        search: searchQuery || undefined,
        category_id: selectedCategory || undefined,
        status: (statusFilter === 'all' || statusFilter === 'featured') ? 'all' : (statusFilter as 'active' | 'inactive'),
        featured: (statusFilter === 'featured') ? 'true' : undefined,
      });
    } else {
      bulkUpdateMutation.mutate({ ids: selectedIds, is_active: value });
    }
  };

  const bulkSetFeatured = (value: boolean) => {
    if (!selectAllResults && selectedIds.length === 0) { toast.error(t('products.toast.selectOne', 'Select at least one product')); return; }
    if (selectAllResults) {
      bulkUpdateMutation.mutate({
        is_featured: value,
        batch_size: 500,
        search: searchQuery || undefined,
        category_id: selectedCategory || undefined,
        status: (statusFilter === 'all' || statusFilter === 'featured') ? 'all' : (statusFilter as 'active' | 'inactive'),
        featured: (statusFilter === 'featured') ? 'true' : undefined,
      });
    } else {
      bulkUpdateMutation.mutate({ ids: selectedIds, is_featured: value });
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
				{t('products.page.subtitle', locale === 'zh' ? '管理 FANUC 产品库存' : 'Manage your FANUC product inventory')}
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
                      <option value="fanuc">FANUC</option>
                    </select>
					<p className="mt-1 text-xs text-gray-500">{t('products.import.brandHint', locale === 'zh' ? '后续可以再增加更多品牌。' : 'More brands can be added later.')}</p>
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
                            {importResult.items.slice(0, 200).map((it: any, i: number) => (
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
                disabled={bulkUpdateMutation.isPending || (!selectAllResults && selectedIds.length === 0)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
				{t('products.bulk.setActive', locale === 'zh' ? '设为启用' : 'Set Active')}
              </button>

              <button
                onClick={() => bulkSetActive(false)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={bulkUpdateMutation.isPending || (!selectAllResults && selectedIds.length === 0)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
				{t('products.bulk.setInactive', locale === 'zh' ? '设为停用' : 'Set Inactive')}
              </button>

              <button
                onClick={() => bulkSetFeatured(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={bulkUpdateMutation.isPending || (!selectAllResults && selectedIds.length === 0)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
				{t('products.bulk.markFeatured', locale === 'zh' ? '设为推荐' : 'Mark Featured')}
              </button>

              <button
                onClick={() => bulkSetFeatured(false)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-600 hover:bg-slate-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={bulkUpdateMutation.isPending || (!selectAllResults && selectedIds.length === 0)}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                </svg>
				{t('products.bulk.unmarkFeatured', locale === 'zh' ? '取消推荐' : 'Unmark Featured')}
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
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                          onClick={() => handleEditClick(product.id)}
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
