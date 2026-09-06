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
import MediaPickerModal from '@/components/admin/MediaPickerModal';
import { ProductService, CategoryService } from '@/services';
import { AIAgentService, type AIAgentSEOFocus, type AIAgentSEOJob } from '@/services/ai-agent.service';
import type {
  ProductImportResult,
  ProductImportTaskSnapshot,
  ProductOptimizationStatus,
} from '@/services/product.service';
import type { MediaAsset } from '@/services/media.service';
import type { Product } from '@/types';
import { queryKeys } from '@/lib/react-query';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl } from '@/lib/utils';
import { useAdminI18n } from '@/lib/admin-i18n';
import { useAuth } from '@/hooks/useAuth';

type BulkSelectionPayload = {
  ids?: number[];
  skus?: string[];
  search?: string;
  category_id?: string;
  include_descendants?: boolean;
  status?: 'active' | 'inactive' | 'all' | '';
  featured?: 'true' | 'false' | '';
  brand?: string;
  ai_seo_status?: Exclude<AISEOFilter, 'all'>;
  batch_size?: number;
};

type BulkProgress = {
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

type AISEOFilter = 'all' | 'optimized' | 'not_optimized' | 'running' | 'failed';

const AI_SEO_DEFAULT_PROMPT = "逐项审核品牌、完整型号、产品名称、分类、简介、描述和 SEO。保留已经准确的内容；名称采用品牌 + 完整型号 + 经证实的产品类型；简介简洁，描述原创且具体，SEO 标题和描述自然包含型号与类型。严格遵循本次选择的优化范围。分类必须有明确证据，无法确认则待人工审核，绝不强行归类。不编造参数、库存、认证、兼容性或保修承诺。不修改价格、库存、图片或管理员设置。输出网站默认语言英文内容，并说明修改依据。";

const AI_SEO_FOCUS_COPY: Record<AIAgentSEOFocus, { zh: string; en: string; instruction: string }> = {
  all: { zh: '全部字段', en: 'All fields', instruction: 'Optimize all supported product fields, including taxonomy, SEO metadata, and product content.' },
  category: { zh: '只优化分类', en: 'Category only', instruction: 'Focus on product taxonomy: select the best matching existing active leaf category using verified brand, product type, and model evidence. If no category can be verified, leave the product inactive for review. Never create a category. Keep SEO metadata and product content unchanged.' },
  seo: { zh: 'SEO 标题 / 描述 / 关键词', en: 'SEO title / description / keywords', instruction: 'Focus on SEO metadata: meta title, meta description, and meta keywords. Keep taxonomy and product content unchanged.' },
	content: { zh: '只优化内容', en: 'Content only', instruction: 'Focus on product content: the short description and long description. Keep the product name, taxonomy, and SEO metadata unchanged.' },
};

const BULK_UPDATE_BATCH_SIZE = 100;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function AdminProductsContent() {
  const { locale, t } = useAdminI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [aiSEOFilter, setAISEOFilter] = useState<AISEOFilter>('all');
  const [sortBy, setSortBy] = useState<'created_at' | 'updated_at' | 'price' | 'name'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20); // Dynamic page size
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectAllResults, setSelectAllResults] = useState<boolean>(false);
  const [customSelectCount, setCustomSelectCount] = useState('');
  const [selectingCustomCount, setSelectingCustomCount] = useState(false);
  const [showAISEOModal, setShowAISEOModal] = useState(false);
  const [showCategoryOptimizationModal, setShowCategoryOptimizationModal] = useState(false);
  const [categoryOptimizationScope, setCategoryOptimizationScope] = useState<'selected' | 'filtered'>('filtered');
  const [categoryOptimizationLimit, setCategoryOptimizationLimit] = useState('');
  const [categoryUseWebSearch, setCategoryUseWebSearch] = useState(true);
  const [categoryCreateMissing, setCategoryCreateMissing] = useState(true);
  const [categoryActivateResolved, setCategoryActivateResolved] = useState(true);
  const [isStartingCategoryJob, setIsStartingCategoryJob] = useState(false);
  const [aiSEOJobMode, setAISEOJobMode] = useState<'selected' | 'auto_candidates' | 'failed_only'>('selected');
  const [aiSEOIncludeFailed, setAISEOIncludeFailed] = useState(false);
  const [aiSEOFocus, setAISEOFocus] = useState<AIAgentSEOFocus>('all');
  const [aiSEOPrompt, setAISEOPrompt] = useState(AI_SEO_DEFAULT_PROMPT);
  const [activeAISEOJob, setActiveAISEOJob] = useState<AIAgentSEOJob | null>(null);
  const [isPausingAISEOJob, setIsPausingAISEOJob] = useState(false);
  const [isStartingAISEOJob, setIsStartingAISEOJob] = useState(false);
  // Product/quote import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFormat, setImportFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [importBrand, setImportBrand] = useState<string>('');
  const [importOverwrite, setImportOverwrite] = useState<boolean>(false);
  const [importCreateMissing, setImportCreateMissing] = useState<boolean>(true);
  const [importResult, setImportResult] = useState<ProductImportResult | null>(null);
  const [importTask, setImportTask] = useState<ProductImportTaskSnapshot | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const importPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiSEOPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showCategoryImagePicker, setShowCategoryImagePicker] = useState(false);
  const [categoryImageBrand, setCategoryImageBrand] = useState('');
  const [categoryImageMode, setCategoryImageMode] = useState<'fill_empty' | 'replace_all'>('fill_empty');
  const [bulkUpdateProgress, setBulkUpdateProgress] = useState<BulkProgress>({
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
      if (aiSEOPollRef.current) {
        clearInterval(aiSEOPollRef.current);
        aiSEOPollRef.current = null;
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
    aiSeoStatus: AISEOFilter;
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
    const finalAISEOStatus = updates.aiSeoStatus !== undefined ? updates.aiSeoStatus : aiSEOFilter;
    const finalSortBy = updates.sortBy !== undefined ? updates.sortBy : sortBy;
    const finalSortDir = updates.sortDir !== undefined ? updates.sortDir : sortDir;
    const finalPage = updates.page !== undefined ? updates.page : currentPage;
    const finalPageSize = updates.pageSize !== undefined ? updates.pageSize : pageSize;

    if (finalSearch) params.set('search', finalSearch);
    if (finalCategory) params.set('category', finalCategory);
    if (finalBrand) params.set('brand', finalBrand);
    if (finalStatus && finalStatus !== 'all') params.set('status', finalStatus);
    if (finalAISEOStatus !== 'all') params.set('aiSeoStatus', finalAISEOStatus);
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
    if (aiSEOFilter !== 'all') params.set('aiSeoStatus', aiSEOFilter);
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
    const seo = (searchParams.get('aiSeoStatus') as AISEOFilter) || 'all';
    const sb = (searchParams.get('sortBy') as 'created_at' | 'updated_at' | 'price' | 'name') || 'created_at';
    const sd = (searchParams.get('sortDir') as 'asc' | 'desc') || 'desc';
    const p = parseInt(searchParams.get('page') || '1', 10);
    const ps = parseInt(searchParams.get('pageSize') || '20', 10);

    setSearchQuery(s);
    setSelectedCategory(c);
    setSelectedBrand(b);
    setStatusFilter(st);
    setAISEOFilter(['all', 'optimized', 'not_optimized', 'running', 'failed'].includes(seo) ? seo : 'all');
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
      aiSEOStatus: aiSEOFilter,
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
      ai_seo_status: aiSEOFilter === 'all' ? undefined : aiSEOFilter,
      sort_by: sortBy,
      sort_dir: sortDir,
      page: currentPage,
      page_size: pageSize
    }),
  });

  const products = productsData?.data || []; // Use empty array if no data
  const totalPages = productsData?.total_pages || 1;
  const totalProducts = productsData?.total || 0;
  // Products are already filtered and paginated by the admin API.
  const filteredProducts = products;
  const selectedCurrentPageIds = selectedIds.filter((id) => filteredProducts.some((product) => product.id === id));

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

  const { data: optimizationStatus } = useQuery<ProductOptimizationStatus>({
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

  const bulkClearProductImagesMutation = useMutation({
    mutationFn: () => ProductService.bulkClearProductImages({ batch_size: 500, status: 'all' }),
    onSuccess: (data) => {
      toast.success(
        t(
          'products.images.clearedAll',
          locale === 'zh'
            ? `已清空产品图片：更新 ${data?.updated || 0} 个产品，移除 ${data?.removed || 0} 条图片路径`
            : `Product images cleared: ${data?.updated || 0} products updated, ${data?.removed || 0} image paths removed`
        )
      );
      setSelectedIds([]);
      setSelectAllResults(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('products.images.clearFailed', locale === 'zh' ? '清空产品图片失败' : 'Failed to clear product images')));
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
    ai_seo_status: aiSEOFilter === 'all' ? undefined : aiSEOFilter,
    status: (statusFilter === 'all' || statusFilter === 'featured') ? 'all' : (statusFilter as 'active' | 'inactive'),
    featured: (statusFilter === 'featured') ? 'true' : undefined,
  });

  const effectiveBulkBrand = selectedBrand || categoryImageBrand || undefined;

  const buildScopedPayload = (): BulkSelectionPayload => (
    selectAllResults
      ? { ...buildSelectAllPayload(), brand: effectiveBulkBrand }
      : { ids: selectedIds, brand: effectiveBulkBrand }
  );

  // Select the first N products of the current filter scope (ordered like the
  // list), so bulk actions can target an exact count instead of page-or-all.
  const selectFirstNResults = async () => {
    const count = Number(customSelectCount);
    if (!Number.isSafeInteger(count) || count < 1) {
      toast.error(locale === 'zh' ? '请输入要选择的产品数量' : 'Enter how many products to select');
      return;
    }
    setSelectingCustomCount(true);
    try {
      const snapshot = await ProductService.getAdminProductSelectionIds(buildSelectAllPayload());
      const ids = snapshot.ids.slice(0, count);
      if (ids.length === 0) {
        toast.error(locale === 'zh' ? '当前筛选范围内没有产品' : 'No products match the current filters');
        return;
      }
      setSelectAllResults(false);
      setSelectedIds(ids);
      toast.success(locale === 'zh'
        ? `已选择前 ${ids.length.toLocaleString()} 个产品（共 ${snapshot.total.toLocaleString()} 个符合筛选）`
        : `Selected the first ${ids.length.toLocaleString()} products (${snapshot.total.toLocaleString()} match the filters)`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '选择产品失败' : 'Failed to select products'));
    } finally {
      setSelectingCustomCount(false);
    }
  };

  const openCategoryOptimizationModal = () => {
    if (totalProducts <= 0) {
      toast.error(locale === 'zh' ? '当前范围内没有可优化分类的商品' : 'There are no products to classify in the current scope');
      return;
    }
    const hasExplicitSelection = !selectAllResults && selectedCurrentPageIds.length > 0;
    const nextScope = hasExplicitSelection ? 'selected' : 'filtered';
    const available = nextScope === 'selected' ? selectedCurrentPageIds.length : totalProducts;
    setCategoryOptimizationScope(nextScope);
    // Zero queues the full filtered scope; processing is batched on the server.
    setCategoryOptimizationLimit("0");
    setShowCategoryOptimizationModal(true);
  };

  const startCategoryOptimizationJob = async () => {
    const explicitSelection = categoryOptimizationScope === 'selected';
    const available = explicitSelection ? selectedCurrentPageIds.length : totalProducts;
    const parsedLimit = Number(categoryOptimizationLimit);
    const maximum = available;
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 0 || parsedLimit > maximum) {
      toast.error(locale === 'zh'
        ? `请输入 0（全部）或 1 到 ${maximum.toLocaleString()} 之间的商品数量`
        : `Use 0 for all, or a product count between 1 and ${maximum.toLocaleString()}`);
      return;
    }
    if (explicitSelection && selectedCurrentPageIds.length === 0) {
      toast.error(locale === 'zh' ? '请先勾选需要优化分类的商品' : 'Select products to classify first');
      return;
    }

    setIsStartingCategoryJob(true);
    try {
      const categoryID = Number(selectedCategory);
      const job = await AIAgentService.startCategoryOptimizationJob({
        product_ids: explicitSelection ? (parsedLimit === 0 ? selectedCurrentPageIds : selectedCurrentPageIds.slice(0, parsedLimit)) : undefined,
        limit: parsedLimit,
        category_id: !explicitSelection && Number.isSafeInteger(categoryID) && categoryID > 0 ? categoryID : undefined,
        include_descendants: !explicitSelection && Boolean(selectedCategory),
        brand: !explicitSelection ? selectedBrand || undefined : undefined,
        search: !explicitSelection ? searchQuery || undefined : undefined,
        status: !explicitSelection && (statusFilter === 'active' || statusFilter === 'inactive') ? statusFilter : 'all',
        featured: !explicitSelection && statusFilter === 'featured' ? 'true' : undefined,
        include_inactive: !explicitSelection ? statusFilter !== 'active' : true,
        ai_seo_status: !explicitSelection && aiSEOFilter !== 'all' ? aiSEOFilter : undefined,
        use_web_search: categoryUseWebSearch,
        create_missing_categories: categoryCreateMissing,
        activate_resolved: categoryActivateResolved,
      });
      setShowCategoryOptimizationModal(false);
      setSelectedIds([]);
      setSelectAllResults(false);
      toast.success(locale === 'zh'
        ? `自动分类后台任务已创建，共 ${job.total.toLocaleString()} 个商品`
        : `Background category optimization job started for ${job.total.toLocaleString()} products`);
      router.push(`/admin/ai-seo?job=${encodeURIComponent(job.id)}`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '创建自动分类任务失败' : 'Unable to start category optimization job'));
    } finally {
      setIsStartingCategoryJob(false);
    }
  };

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
            ? `导入完成：新增 ${task.created || 0}，更新 ${task.updated || 0}，失败 ${task.failed || 0}`
            : `Import completed: ${task.created || 0} created, ${task.updated || 0} updated, ${task.failed || 0} failed`
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
      if (!importFile) throw new Error(locale === 'zh' ? '请选择导入文件' : 'Please select an import file');
      if (importFormat === 'csv') {
        return ProductService.importProductQuotesCsv(importFile, (pct) => setUploadProgress(pct));
      }
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

  const handleAISEOFilterChange = (value: AISEOFilter) => {
    setAISEOFilter(value);
    setCurrentPage(1);
    setSelectedIds([]);
    setSelectAllResults(false);
    updateURL({ aiSeoStatus: value, page: 1 });
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
    setAISEOFilter('all');
    setSortBy('created_at');
    setSortDir('desc');
    setCurrentPage(1);
    updateURL({ search: '', category: '', brand: '', status: 'all', aiSeoStatus: 'all', sortBy: 'created_at', sortDir: 'desc', page: 1 });
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

  const stopAISEOPolling = () => {
    if (aiSEOPollRef.current) {
      clearInterval(aiSEOPollRef.current);
      aiSEOPollRef.current = null;
    }
  };

  const isAISEOJobFinished = (status: AIAgentSEOJob['status']) => (
    status === 'completed' || status === 'completed_with_errors' || status === 'failed' || status === 'paused' || status === 'cancelled'
  );

  const refreshAISEOJob = async (jobID: string) => {
    try {
      const job = await AIAgentService.getSEOJob(jobID);
      setActiveAISEOJob(job);
      if (isAISEOJobFinished(job.status)) {
        stopAISEOPolling();
        queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
        if (job.status === 'completed') {
          toast.success(locale === 'zh' ? `AI SEO 优化完成：成功 ${job.succeeded} 个商品` : `AI SEO job completed: ${job.succeeded} products optimized`);
        } else if (job.status === 'completed_with_errors') {
          toast.error(locale === 'zh' ? `AI SEO 已完成，但有 ${job.failed} 个商品失败` : `AI SEO job completed with ${job.failed} failed products`);
        } else if (job.status === 'paused') {
          toast.success(locale === 'zh' ? 'AI SEO 任务已暂停；未处理商品会保留在队列中，可在 AI SEO 优化记录继续。' : 'AI SEO job paused. Unprocessed products remain queued and can be resumed in AI SEO Records.');
        } else if (job.status === 'cancelled') {
          toast.success(locale === 'zh' ? 'AI SEO 任务已结束；未处理商品已释放，可在以后重新优化。' : 'AI SEO job ended. Unprocessed products were released for future optimization.');
        } else {
          toast.error(job.error || (locale === 'zh' ? 'AI SEO 任务失败' : 'AI SEO job failed'));
        }
        return true;
      }
    } catch (error: unknown) {
      stopAISEOPolling();
      toast.error(getErrorMessage(error, locale === 'zh' ? '无法读取 AI SEO 任务进度' : 'Unable to read AI SEO job progress'));
      return true;
    }
    return false;
  };

  const startAISEOPolling = async (jobID: string) => {
    stopAISEOPolling();
    const isFinished = await refreshAISEOJob(jobID);
    if (isFinished) return;
    aiSEOPollRef.current = setInterval(() => {
      void refreshAISEOJob(jobID);
    }, 2500);
  };

  const pauseActiveAISEOJob = async () => {
    if (!activeAISEOJob || !['queued', 'running'].includes(activeAISEOJob.status)) return;
    setIsPausingAISEOJob(true);
    try {
      const job = await AIAgentService.pauseSEOJob(activeAISEOJob.id);
      setActiveAISEOJob(job);
      stopAISEOPolling();
      toast.success(locale === 'zh' ? 'AI SEO 任务已暂停。已发出的请求可能会完成当前商品。' : 'AI SEO job paused. Requests already sent may finish their current product.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '暂停 AI SEO 任务失败' : 'Unable to pause AI SEO job'));
    } finally {
      setIsPausingAISEOJob(false);
    }
  };

  const startAISEO = async () => {
    const isSelectAllScope = aiSEOJobMode === 'selected' && selectAllResults;
    if (aiSEOJobMode === 'selected' && !isSelectAllScope && selectedCurrentPageIds.length === 0) {
      toast.error(locale === 'zh' ? '请先勾选当前页需要 AI SEO 优化的商品' : 'Select products on this page for AI SEO first');
      return;
    }
    const prompt = aiSEOPrompt.trim();
    if (prompt.length < 2) {
      toast.error(locale === 'zh' ? '请输入至少 2 个字符的 SEO 优化提示词' : 'Enter an SEO instruction with at least 2 characters');
      return;
    }
    setIsStartingAISEOJob(true);
    try {
      const categoryID = Number(selectedCategory);
      const promptWithFocus = aiSEOFocus === 'all'
        ? prompt
        : `${AI_SEO_FOCUS_COPY[aiSEOFocus].instruction}\n\nAdministrator instruction:\n${prompt}`;
      const useCandidateScope = aiSEOJobMode !== 'selected' || isSelectAllScope;
      const job = useCandidateScope
        ? await AIAgentService.startSEOCandidateJob({
            prompt: promptWithFocus,
            limit: 0,
            category_id: Number.isSafeInteger(categoryID) && categoryID > 0 ? categoryID : undefined,
            include_descendants: Boolean(selectedCategory),
            brand: selectedBrand || undefined,
            search: searchQuery || undefined,
            include_failed: isSelectAllScope || (aiSEOJobMode === 'auto_candidates' && aiSEOIncludeFailed),
            failed_only: aiSEOJobMode === 'failed_only',
            include_optimized: isSelectAllScope,
            ai_seo_status: aiSEOFilter === 'all' ? undefined : aiSEOFilter,
            focus: [aiSEOFocus],
          })
        : await AIAgentService.startSEOJob(selectedCurrentPageIds, promptWithFocus, aiSEOFocus);
      setActiveAISEOJob(job);
      setShowAISEOModal(false);
      if (aiSEOJobMode === 'selected') setSelectedIds([]);
      if (isSelectAllScope) setSelectAllResults(false);
      setAISEOPrompt(AI_SEO_DEFAULT_PROMPT);
      toast.success(locale === 'zh'
        ? `${isSelectAllScope ? 'AI SEO 全部筛选结果任务' : aiSEOJobMode === 'failed_only' ? 'AI SEO 失败重试任务' : aiSEOJobMode === 'auto_candidates' ? 'AI SEO 自动候选任务' : 'AI SEO 任务'}已启动：${job.total} 个商品`
        : `${isSelectAllScope ? 'AI SEO filtered-results job' : aiSEOJobMode === 'failed_only' ? 'AI SEO failed-item retry job' : aiSEOJobMode === 'auto_candidates' ? 'AI SEO candidate job' : 'AI SEO job'} started for ${job.total} products`);
      void startAISEOPolling(job.id);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '创建 AI SEO 任务失败' : 'Unable to start AI SEO job'));
    } finally {
      setIsStartingAISEOJob(false);
    }
  };

  const isAISEOSelectAllMode = aiSEOJobMode === 'selected' && selectAllResults;
  const isAISEOCandidateMode = aiSEOJobMode !== 'selected' || isAISEOSelectAllMode;
  const isAISEOFailedOnly = aiSEOJobMode === 'failed_only';

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('nav.products', 'Products')}</h1>
            <p className="mt-1 text-sm text-gray-500">
				{t('products.page.subtitle', locale === 'zh' ? '管理工业自动化产品库存' : 'Manage your industrial automation product inventory')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/ai-seo"
              className="inline-flex items-center px-4 py-2 border border-violet-200 rounded-md shadow-sm text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100"
            >
              <SparklesIcon className="h-4 w-4 mr-2" />
              {locale === 'zh' ? 'AI SEO 优化记录' : 'AI SEO Records'}
            </Link>
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    locale === 'zh'
                      ? '确认清空所有产品的图片路径吗？这会把产品图片字段改为空图状态，但不会删除媒体库文件。此操作不可撤销。'
                      : 'Clear image paths from every product? This makes all products appear image-empty, but does not delete media library files. This cannot be undone.'
                  )
                )
                  return;
                bulkClearProductImagesMutation.mutate();
              }}
              disabled={bulkClearProductImagesMutation.isPending}
              className="inline-flex items-center px-4 py-2 border border-red-200 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              {bulkClearProductImagesMutation.isPending
                ? (locale === 'zh' ? '清空中...' : 'Clearing...')
                : (locale === 'zh' ? '清空全部产品图片' : 'Clear All Images')}
            </button>
            <button
              onClick={() => {
                setShowImportModal(true);
                setImportResult(null);
                setImportFile(null);
                setImportFormat('xlsx');
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
                  <div className="text-lg font-semibold text-gray-900">{locale === 'zh' ? '批量导入产品 / 报价' : 'Bulk Product / Quote Import'}</div>
                  <div className="text-xs text-gray-500">{importFormat === 'csv' ? (locale === 'zh' ? '报价 CSV：品牌 / 型号 / 价格 / 交期' : 'Quote CSV: Brand / Model / Price / Lead time') : (locale === 'zh' ? '商品 XLSX：型号 / 价格 / 数量 / 重量kg / 分类' : 'Product XLSX: Model / Price / Quantity / WeightKg / Category')}</div>
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
                <div className="inline-flex w-full rounded-md border border-gray-200 bg-gray-50 p-1 sm:w-auto">
                  <button
                    type="button"
                    onClick={() => { setImportFormat('xlsx'); setImportFile(null); setImportResult(null); setImportTask(null); stopImportPolling(); }}
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium sm:flex-none ${importFormat === 'xlsx' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600'}`}
                  >
                    {locale === 'zh' ? '商品 XLSX' : 'Product XLSX'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImportFormat('csv'); setImportFile(null); setImportResult(null); setImportTask(null); stopImportPolling(); }}
                    className={`flex-1 rounded px-3 py-2 text-sm font-medium sm:flex-none ${importFormat === 'csv' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600'}`}
                  >
                    {locale === 'zh' ? '报价 CSV' : 'Quote CSV'}
                  </button>
                </div>

                {importFormat === 'csv' && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {locale === 'zh' ? '上传已有报价.csv 或未报价型号.csv。已有 SKU 不会重复创建；空价格会创建为“联系询价”产品，且不会清空网站上已有价格。' : 'Upload your quoted or unquoted CSV. Existing SKUs are updated without duplicates; blank prices create quote-only products and never erase an existing site price.'}
                  </div>
                )}

                {importFormat === 'xlsx' && <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
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
					<p className="mt-1 text-xs text-gray-500">{t('products.import.brandHint', locale === 'zh' ? '建议选择品牌；留空时只会接受型号本身能确认品牌和类型的产品，其余产品保持未启用。' : 'Choose a brand when possible. Blank uses model evidence only; products without verified brand and type stay inactive.')}</p>
                  </div>
                  <button
                    onClick={downloadTemplate}
                    className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
					{t('products.import.downloadTemplate', locale === 'zh' ? '下载模板' : 'Download Template')}
                  </button>
                </div>}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{importFormat === 'csv' ? (locale === 'zh' ? '上传 .csv 文件' : 'Upload .csv') : t('products.import.uploadXlsx', locale === 'zh' ? '上传 .xlsx 文件' : 'Upload .xlsx')}</label>
                  <input
                    type="file"
                    accept={importFormat === 'csv' ? '.csv,text/csv' : '.xlsx'}
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
                  <p className="mt-1 text-xs text-gray-500">{importFormat === 'csv' ? (locale === 'zh' ? '支持中文或英文列名，系统会识别 BOM、带逗号的美元价格和重复型号。品牌、型号和类型无法确认时，产品会保持未启用。' : 'Chinese or English headers are supported, including BOM, comma-formatted prices and duplicate models. Products stay inactive when brand, model, type, or category cannot be verified.') : t('products.import.hint', locale === 'zh' ? '系统会按 SKU/型号/料号匹配；按品牌和型号类型匹配现有启用分类。分类不存在或无法确认时不会创建新分类，产品保持未启用。' : 'We match by SKU/model/part number, then assign an existing active category from the verified brand and product type. Unknown categories are never created and the product stays inactive.')}</p>
                </div>

                {importFormat === 'xlsx' && <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
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
                </div>}

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
                ? '后台新建/编辑产品后会按已核实品牌和型号匹配现有分类，并自动补 SEO 字段与 FAQ；无法确认时保持未启用'
                : 'New and edited products match an existing category from verified brand/model evidence, then auto-fill SEO fields and FAQs; unresolved products stay inactive'}
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
                  {totalProducts > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-gray-500">{locale === 'zh' ? '选择前' : 'Select first'}</span>
                      <input
                        type="number"
                        min={1}
                        max={totalProducts}
                        value={customSelectCount}
                        onChange={(e) => setCustomSelectCount(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void selectFirstNResults(); }}
                        placeholder={String(Math.min(totalProducts, 500))}
                        className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        aria-label={locale === 'zh' ? '自定义选择数量' : 'Custom selection count'}
                      />
                      <span className="text-gray-500">{locale === 'zh' ? '条' : ''}</span>
                      <button
                        onClick={() => void selectFirstNResults()}
                        disabled={selectingCustomCount || !customSelectCount}
                        className="inline-flex items-center px-2.5 py-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title={locale === 'zh' ? '按当前筛选和排序选择前 N 个产品' : 'Select the first N products of the current filter and sort'}
                      >
                        {selectingCustomCount ? (locale === 'zh' ? '选择中…' : 'Selecting…') : (locale === 'zh' ? '选择' : 'Select')}
                      </button>
                    </span>
                  )}
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

              {isAdmin && <button
                type="button"
                onClick={openCategoryOptimizationModal}
                className="inline-flex items-center rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isStartingCategoryJob || totalProducts === 0}
                title={locale === 'zh'
                  ? '打开配置窗口，自定义商品数量并创建后台自动分类任务；进度可在 AI SEO 优化记录中查看。'
                  : 'Configure the product count and start a background category job. Progress appears in AI SEO Records.'}
              >
                <SparklesIcon className="mr-2 h-4 w-4" />
                {selectedCurrentPageIds.length > 0 && !selectAllResults
                    ? (locale === 'zh' ? `自动优化分类（已选 ${selectedCurrentPageIds.length}）` : `Auto-classify (${selectedCurrentPageIds.length} selected)`)
                    : (locale === 'zh' ? `自动优化分类（可选数量）` : 'Auto-classify (choose count)')}
              </button>}

              <button
                onClick={() => {
                  if (!selectAllResults && selectedCurrentPageIds.length === 0) {
                    toast.error(locale === 'zh' ? '请先勾选当前页需要优化的商品' : 'Select products on the current page first');
                    return;
                  }
                  setAISEOJobMode('selected');
                  setShowAISEOModal(true);
                }}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isStartingAISEOJob || (!selectAllResults && (selectedCurrentPageIds.length === 0))}
                title={locale === 'zh' ? `优化当前勾选或全部筛选结果，不限总量，后台分批执行` : `Optimize checked products or all filtered results, with background batching`}
              >
                <SparklesIcon className="h-4 w-4 mr-2" />
                {selectAllResults
                  ? (locale === 'zh' ? `AI SEO 优化（全部筛选 ${totalProducts}）` : `AI SEO (all ${totalProducts} filtered)`)
                  : (locale === 'zh' ? `AI SEO 优化（当前页已选 ${selectedCurrentPageIds.length}）` : `AI SEO (${selectedCurrentPageIds.length} selected)`)}
              </button>

              <button
                onClick={() => { setAISEOJobMode('auto_candidates'); setShowAISEOModal(true); }}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-fuchsia-700 hover:bg-fuchsia-800 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isStartingAISEOJob}
                title={locale === 'zh' ? '自动选择全部匹配的启用、未 AI 优化且内容较薄弱的产品；可按当前分类、品牌和搜索范围限定。' : 'Automatically select all matching active, not-yet-AI-optimized products with thinner content, optionally scoped by the current category, brand, and search.'}
              >
                <SparklesIcon className="h-4 w-4 mr-2" />
                {locale === 'zh' ? 'AI 自动候选优化（不限总量）' : 'AI Auto Candidates (all matching)'}
              </button>

              <button
                onClick={() => { setAISEOJobMode('failed_only'); setAISEOIncludeFailed(false); setShowAISEOModal(true); }}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-rose-700 hover:bg-rose-800 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isStartingAISEOJob}
                title={locale === 'zh' ? '只选择此前 AI SEO 优化失败的启用商品，不限总量；可按当前分类、品牌和搜索范围限定。' : 'Retry only active products whose previous AI SEO optimization failed, all matching, scoped by the current category, brand, and search.'}
              >
                <SparklesIcon className="h-4 w-4 mr-2" />
                {locale === 'zh' ? 'AI 自动重试失败（不限总量）' : 'AI Retry Failed (all matching)'}
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
            {selectAllResults && (
              <p className="mt-3 text-sm text-amber-700">
                {locale === 'zh'
                  ? `已选择全部筛选结果。AI SEO 将按当前搜索、分类、品牌和状态筛选通过候选接口处理，全部匹配商品；已优化商品也会按提示词重新处理。`
                  : `All filtered results are selected. AI SEO will use the candidate endpoint with the current search, category, brand, and status scope, all matching; optimized products are included for rewrites.`}
              </p>
            )}
            {activeAISEOJob && (
              <div className={`mt-4 rounded-lg border p-4 ${
                activeAISEOJob.status === 'failed' || activeAISEOJob.status === 'cancelled'
                  ? 'border-rose-200 bg-rose-50'
                  : activeAISEOJob.status === 'completed' || activeAISEOJob.status === 'completed_with_errors'
                    ? 'border-emerald-200 bg-emerald-50'
                    : activeAISEOJob.status === 'paused'
                      ? 'border-orange-200 bg-orange-50'
                    : 'border-violet-200 bg-violet-50'
              }`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{locale === 'zh' ? 'AI SEO 任务进度' : 'AI SEO job progress'}</div>
                    <div className="mt-1 text-xs text-gray-600">{locale === 'zh' ? `任务 ${activeAISEOJob.id.slice(0, 8)}…` : `Job ${activeAISEOJob.id.slice(0, 8)}…`} · {activeAISEOJob.status}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {(activeAISEOJob.status === 'queued' || activeAISEOJob.status === 'running') && <button type="button" onClick={() => void pauseActiveAISEOJob()} disabled={isPausingAISEOJob} className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-sm font-semibold text-orange-800 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50">{isPausingAISEOJob ? (locale === 'zh' ? '暂停中…' : 'Pausing…') : (locale === 'zh' ? '暂停任务' : 'Pause job')}</button>}
                    <Link href="/admin/ai-seo" className="text-sm font-medium text-violet-700 hover:text-violet-900">{activeAISEOJob.status === 'paused' ? (locale === 'zh' ? '前往继续任务' : 'Resume in records') : (locale === 'zh' ? '查看全部记录' : 'View all records')}</Link>
                  </div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/80">
                  <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${activeAISEOJob.total > 0 ? Math.min(100, Math.round((activeAISEOJob.processed / activeAISEOJob.total) * 100)) : 0}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-gray-700">
                  <span>{locale === 'zh' ? '已处理' : 'Processed'}: {activeAISEOJob.processed}/{activeAISEOJob.total}</span>
                  <span>{locale === 'zh' ? '成功' : 'Succeeded'}: {activeAISEOJob.succeeded}</span>
                  <span>{locale === 'zh' ? '失败' : 'Failed'}: {activeAISEOJob.failed}</span>
                </div>
                {activeAISEOJob.error && <p className="mt-2 text-sm text-rose-700">{activeAISEOJob.error}</p>}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">{locale === 'zh' ? '分类图片品牌' : 'Category Image Brand'}</span>
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
                    ? `当前已按品牌 ${selectedBrand.toUpperCase()} 筛选；这里可为分类图片操作选择另一品牌`
                    : `Brand filter ${selectedBrand.toUpperCase()} is active; choose another brand here only for category image actions`}
                </div>
              )}
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
                  {t('products.bulk.categoryScopedHint', locale === 'zh' ? '未选分类时会作用于当前筛选结果；这里选择的品牌仅用于分类图片批量处理' : 'Without a category filter, this applies to the current filtered results; the selected brand is used only for category image actions')}
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

            <div>
              <label htmlFor="ai-seo-status" className="block text-sm font-medium text-gray-700 mb-1">
                {locale === 'zh' ? 'AI SEO 状态' : 'AI SEO Status'}
              </label>
              <select
                id="ai-seo-status"
                value={aiSEOFilter}
                onChange={(e) => handleAISEOFilterChange(e.target.value as AISEOFilter)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">{locale === 'zh' ? '全部 AI SEO 状态' : 'All AI SEO statuses'}</option>
                <option value="not_optimized">{locale === 'zh' ? '未 AI 优化' : 'Not AI optimized'}</option>
                <option value="optimized">{locale === 'zh' ? 'AI 已优化' : 'AI optimized'}</option>
                <option value="running">{locale === 'zh' ? 'AI 处理中' : 'AI processing'}</option>
                <option value="failed">{locale === 'zh' ? 'AI 优化失败' : 'AI failed'}</option>
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
                <option value="updated_at:desc">{locale === 'zh' ? '编辑时间：新到旧' : 'Last edited: Newest'}</option>
                <option value="updated_at:asc">{locale === 'zh' ? '编辑时间：旧到新' : 'Last edited: Oldest'}</option>
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
                    AI SEO
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {locale === 'zh' ? '编辑时间' : 'Last Edited'}
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
                            className="h-12 w-12 rounded-lg bg-gray-50 object-contain p-0.5"
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
                    <td className="px-6 py-4 whitespace-nowrap">
                      {product.ai_seo_status === 'optimized' ? (
                        <div>
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">{locale === 'zh' ? 'AI 已优化' : 'AI Optimized'}</span>
                          {product.ai_seo_optimized_at && <div className="mt-1 text-xs text-gray-400">{new Date(product.ai_seo_optimized_at).toLocaleDateString()}</div>}
                        </div>
                      ) : product.ai_seo_status === 'running' ? (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-violet-100 text-violet-800">{locale === 'zh' ? 'AI 处理中' : 'AI Processing'}</span>
                      ) : product.ai_seo_status === 'failed' ? (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-rose-100 text-rose-800">{locale === 'zh' ? 'AI 失败' : 'AI Failed'}</span>
                      ) : (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">{locale === 'zh' ? '未 AI 优化' : 'Not AI optimized'}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div>{new Date(product.updated_at || product.created_at).toLocaleDateString()}</div>
                      <div className="text-xs text-gray-400">{new Date(product.updated_at || product.created_at).toLocaleTimeString()}</div>
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
      {showCategoryOptimizationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="category-optimization-modal-title">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-cyan-700">
                  <SparklesIcon className="h-5 w-5" />
                  <h2 id="category-optimization-modal-title" className="text-lg font-semibold text-gray-900">
                    {locale === 'zh' ? '创建自动分类后台任务' : 'Start background category optimization'}
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {locale === 'zh'
                    ? '任务创建后会立即进入“AI SEO / 分类优化任务记录”。关闭产品页面不会中断处理，可在那里查看每个 SKU、暂停或继续任务。'
                    : 'After creation you will be taken to AI SEO / Category Job Records. Closing the product page will not stop processing, and each SKU can be reviewed, paused, or resumed there.'}
                </p>
              </div>
              <button type="button" onClick={() => setShowCategoryOptimizationModal(false)} disabled={isStartingCategoryJob} className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label={locale === 'zh' ? '关闭' : 'Close'}>
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-5 px-5 py-5">
              <fieldset>
                <legend className="text-sm font-medium text-gray-800">{locale === 'zh' ? '商品范围' : 'Product scope'}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className={`flex items-start gap-2 rounded-lg border px-3 py-3 text-sm ${categoryOptimizationScope === 'selected' ? 'border-cyan-400 bg-cyan-50 text-cyan-950 ring-1 ring-cyan-200' : 'border-gray-200 text-gray-700'} ${selectedCurrentPageIds.length === 0 || selectAllResults ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                    <input
                      type="radio"
                      name="category-optimization-scope"
                      checked={categoryOptimizationScope === 'selected'}
                      disabled={selectedCurrentPageIds.length === 0 || selectAllResults}
                      onChange={() => {
                        setCategoryOptimizationScope('selected');
                        setCategoryOptimizationLimit(String(Math.min(selectedCurrentPageIds.length, 500)));
                      }}
                      className="mt-0.5 border-gray-300 text-cyan-700 focus:ring-cyan-600"
                    />
                    <span><strong className="block font-semibold">{locale === 'zh' ? '当前勾选' : 'Checked products'}</strong>{locale === 'zh' ? `${selectedCurrentPageIds.length.toLocaleString()} 个商品` : `${selectedCurrentPageIds.length.toLocaleString()} products`}</span>
                  </label>
                  <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-3 text-sm ${categoryOptimizationScope === 'filtered' ? 'border-cyan-400 bg-cyan-50 text-cyan-950 ring-1 ring-cyan-200' : 'border-gray-200 text-gray-700'}`}>
                    <input
                      type="radio"
                      name="category-optimization-scope"
                      checked={categoryOptimizationScope === 'filtered'}
                      onChange={() => {
                        setCategoryOptimizationScope('filtered');
                        setCategoryOptimizationLimit(String(Math.min(totalProducts, 500)));
                      }}
                      className="mt-0.5 border-gray-300 text-cyan-700 focus:ring-cyan-600"
                    />
                    <span><strong className="block font-semibold">{locale === 'zh' ? '当前筛选 / 全部商品' : 'Current filters / all products'}</strong>{locale === 'zh' ? `范围内共 ${totalProducts.toLocaleString()} 个商品` : `${totalProducts.toLocaleString()} products in scope`}</span>
                  </label>
                </div>
              </fieldset>

              <label className="block text-sm font-medium text-gray-800">
                {locale === 'zh' ? '本次处理数量' : 'Products to process'}
                <input
                  type="number"
                  min={0}
                  max={(categoryOptimizationScope === 'selected' ? selectedCurrentPageIds.length : totalProducts)}
                  step={1}
                  value={categoryOptimizationLimit}
                  onChange={(event) => setCategoryOptimizationLimit(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
                />
                <span className="mt-1.5 block text-xs font-normal text-gray-500">
                  {locale === 'zh'
                    ? `可自定义 1–${(categoryOptimizationScope === 'selected' ? selectedCurrentPageIds.length : totalProducts).toLocaleString()} 个；0 表示全部，后台分批处理。`
                    : `Choose 1–${(categoryOptimizationScope === 'selected' ? selectedCurrentPageIds.length : totalProducts).toLocaleString()}; 0 means all, processed in background batches.`}
                </span>
              </label>

              <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={categoryUseWebSearch} onChange={(event) => setCategoryUseWebSearch(event.target.checked)} className="mt-0.5 rounded border-gray-300 text-cyan-700 focus:ring-cyan-600" />
                  <span>{locale === 'zh' ? '本地无法确认时联网核实完整型号、品牌和产品类型。' : 'Verify full model, brand, and product type online when local rules are inconclusive.'}</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={categoryCreateMissing} onChange={(event) => setCategoryCreateMissing(event.target.checked)} className="mt-0.5 rounded border-gray-300 text-cyan-700 focus:ring-cyan-600" />
                  <span>{locale === 'zh' ? '品牌已确认且没有合适分类时，在品牌下创建去重后的产品类型分类。' : 'Create a deduplicated product-type category under the verified brand when no suitable category exists.'}</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={categoryActivateResolved} onChange={(event) => setCategoryActivateResolved(event.target.checked)} className="mt-0.5 rounded border-gray-300 text-cyan-700 focus:ring-cyan-600" />
                  <span>{locale === 'zh' ? '分类确认成功后启用商品；无法确认的商品继续保持停用。' : 'Activate products after classification succeeds; unresolved products remain inactive.'}</span>
                </label>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowCategoryOptimizationModal(false)} disabled={isStartingCategoryJob} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{locale === 'zh' ? '取消' : 'Cancel'}</button>
              <button type="button" onClick={() => void startCategoryOptimizationJob()} disabled={isStartingCategoryJob || !categoryOptimizationLimit} className="inline-flex items-center justify-center rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50">
                <SparklesIcon className={`mr-2 h-4 w-4 ${isStartingCategoryJob ? 'animate-spin' : ''}`} />
                {isStartingCategoryJob ? (locale === 'zh' ? '正在创建任务…' : 'Starting job…') : (locale === 'zh' ? '创建任务并进入记录' : 'Start job and view records')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showAISEOModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="ai-seo-modal-title">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-violet-700"><SparklesIcon className="h-5 w-5" /><h2 id="ai-seo-modal-title" className="text-lg font-semibold text-gray-900">{locale === 'zh' ? (isAISEOSelectAllMode ? 'AI SEO 优化全部筛选结果' : isAISEOFailedOnly ? 'AI SEO 自动重试失败商品' : aiSEOJobMode === 'auto_candidates' ? 'AI SEO 自动候选优化' : 'AI SEO 优化已选商品') : (isAISEOSelectAllMode ? 'AI SEO optimize all filtered results' : isAISEOFailedOnly ? 'AI SEO retry failed products' : aiSEOJobMode === 'auto_candidates' ? 'AI SEO automatic candidate optimization' : 'AI SEO optimize selected products')}</h2></div>
                <p className="mt-2 text-sm text-gray-600">{isAISEOCandidateMode
                  ? (locale === 'zh'
                    ? (isAISEOSelectAllMode ? `系统会按当前筛选结果启动任务，处理全部匹配商品；已优化、失败和未优化商品都会纳入，已在其他 AI SEO 任务中排队或处理的商品会被排除。` : isAISEOFailedOnly ? '系统会在当前分类、品牌、搜索词范围内，自动选择全部匹配的此前 AI SEO 优化失败的启用商品进行重试。已在其他 AI SEO 任务中排队或处理的商品会被排除。' : '系统会在当前分类、品牌、搜索词范围内，自动选择全部匹配的启用商品；默认选择从未 AI 优化且内容较薄弱的商品，也可同时纳入失败商品。已在其他 AI SEO 任务中排队或处理的商品会被排除。')
                    : (isAISEOSelectAllMode ? `The current filters will be sent to the candidate endpoint, all matching products. Optimized, failed, and never-optimized products are included; products already queued or running elsewhere are excluded.` : isAISEOFailedOnly ? 'The system will retry all matching active products whose previous AI SEO attempt failed within the current category, brand, and search scope. Products queued or running in another AI SEO job are excluded.' : 'The system will choose all matching active products within the current category, brand, and search scope. By default it selects never-optimized products with thinner content, and it can also include failed attempts. Products queued or running in another AI SEO job are excluded.'))
                  : (locale === 'zh' ? `本次只处理当前页手动勾选的 ${selectedCurrentPageIds.length} 个商品。每个商品由 AI 单独处理。` : `This job will process only the ${selectedCurrentPageIds.length} products explicitly checked on this page. AI handles each product separately.`)}</p>
              </div>
              <button type="button" onClick={() => setShowAISEOModal(false)} disabled={isStartingAISEOJob} className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label={locale === 'zh' ? '关闭' : 'Close'}><XMarkIcon className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                {locale === 'zh' ? `本次范围：${AI_SEO_FOCUS_COPY[aiSEOFocus].zh}。${AI_SEO_FOCUS_COPY[aiSEOFocus].instruction} 不会修改价格、库存或图片。任务完成后会刷新站点缓存；若后台已启用 IndexNow，也会批量通知搜索引擎更新 URL。` : `Scope: ${AI_SEO_FOCUS_COPY[aiSEOFocus].en}. ${AI_SEO_FOCUS_COPY[aiSEOFocus].instruction} Prices, inventory, and images are not changed. Completion refreshes site caches and submits changed URLs in one batch when IndexNow is enabled.`}
              </div>
              <fieldset>
                <legend className="text-sm font-medium text-gray-800">{locale === 'zh' ? '本次优化范围' : 'Optimization scope'}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(Object.keys(AI_SEO_FOCUS_COPY) as AIAgentSEOFocus[]).map((focus) => (
                    <label key={focus} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition ${aiSEOFocus === focus ? 'border-violet-400 bg-violet-50 text-violet-900 ring-1 ring-violet-200' : 'border-gray-200 bg-white text-gray-700 hover:border-violet-200'}`}>
                      <input type="radio" name="ai-seo-focus" value={focus} checked={aiSEOFocus === focus} onChange={() => { setAISEOFocus(focus); setAISEOPrompt(AI_SEO_FOCUS_COPY[focus].instruction + "\n\n" + AI_SEO_DEFAULT_PROMPT); }} className="mt-0.5 border-gray-300 text-violet-600 focus:ring-violet-500" />
                      <span>{locale === 'zh' ? AI_SEO_FOCUS_COPY[focus].zh : AI_SEO_FOCUS_COPY[focus].en}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {aiSEOJobMode === 'auto_candidates' && (
                <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  <input type="checkbox" checked={aiSEOIncludeFailed} onChange={(event) => setAISEOIncludeFailed(event.target.checked)} className="mt-0.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
                  <span>{locale === 'zh' ? '同时纳入此前 AI 优化失败的商品（默认只选择从未 AI 优化的商品）。' : 'Also include products that failed a previous AI SEO attempt (by default only never-AI-optimized products are selected).'}</span>
                </label>
              )}
              <label className="block text-sm font-medium text-gray-800">
                {locale === 'zh' ? '本次优化提示词' : 'Optimization instruction'}
                <textarea
                  value={aiSEOPrompt}
                  onChange={(event) => setAISEOPrompt(event.target.value)}
                  maxLength={2000}
                  rows={6}
                  autoFocus
                  placeholder={locale === 'zh' ? '例如：面向英文工业自动化采购用户优化 SEO；按已确认品牌、型号和产品类型选择现有分类；无法确认时保持产品未启用并返回人工审核，避免夸大宣传。' : 'Example: Optimize SEO for English industrial automation buyers. Use only an existing category that matches the verified brand, model, and product type. Keep unresolved products inactive for review and avoid unsupported claims.'}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <p className="text-xs text-gray-500">{aiSEOPrompt.length}/2000 · {locale === 'zh' ? '任务创建后可在“AI SEO 优化记录”中查看每个 SKU 的成功、处理中或失败状态，也可暂停后继续。' : 'After creation, AI SEO Records shows the status for every SKU, and lets you pause and resume the job.'}</p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowAISEOModal(false)} disabled={isStartingAISEOJob} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{locale === 'zh' ? '取消' : 'Cancel'}</button>
              <button type="button" onClick={() => void startAISEO()} disabled={isStartingAISEOJob || aiSEOPrompt.trim().length < 2} className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"><SparklesIcon className="mr-2 h-4 w-4" />{isStartingAISEOJob ? (locale === 'zh' ? '正在创建任务…' : 'Starting job…') : isAISEOSelectAllMode ? (locale === 'zh' ? `优化全部筛选结果（全量）` : `Optimize all filtered results (all matches)`) : isAISEOFailedOnly ? (locale === 'zh' ? '自动重试失败商品' : 'Retry failed products') : aiSEOJobMode === 'auto_candidates' ? (locale === 'zh' ? '自动选择并优化全部匹配商品' : 'Select and optimize all matching candidates') : (locale === 'zh' ? `开始优化 ${selectedCurrentPageIds.length} 个商品` : `Optimize ${selectedCurrentPageIds.length} products`)}</button>
            </div>
          </div>
        </div>
      )}
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
