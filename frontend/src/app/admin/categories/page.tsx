'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  PencilSquareIcon,
  SparklesIcon,
  TrashIcon,
  TagIcon,
  ArrowsUpDownIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import CategoryHierarchyEditor from '@/components/admin/CategoryHierarchyEditor';
import CategoryAIToolsPanel from '@/components/admin/CategoryAIToolsPanel';
import { CategoryService, ProductService } from '@/services';
import { AIAgentService } from '@/services/ai-agent.service';
import { queryKeys } from '@/lib/react-query';
import { useAdminI18n } from '@/lib/admin-i18n';
import { useAuth } from '@/hooks/useAuth';
import type { CategoryDeletionImpact } from '@/services/category.service';
import type { Category, CategoryCreateRequest } from '@/types';
import { getErrorMessage } from '@/lib/errors';

// Categories data now comes from API only

export default function AdminCategoriesPage() {
  const { locale, t } = useAdminI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deletionCategory, setDeletionCategory] = useState<Category | null>(null);
  const [deletionTargetId, setDeletionTargetId] = useState('');
  const [seoJobCategoryId, setSeoJobCategoryId] = useState<number | null>(null);
  const [titleJobCategoryId, setTitleJobCategoryId] = useState<number | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    parent_id: '',
    sort_order: 0,
    is_active: true
  });

  const queryClient = useQueryClient();

  // Fetch categories from API
  const { data: categories = [], isLoading, error } = useQuery({
    queryKey: queryKeys.categories.lists(),
    queryFn: () => CategoryService.getAdminCategories(),
    retry: 1, // Only retry once
  });

  // Use real API data, no fallback to mock data
  const categoriesData = categories;

  // Create category mutation
  const createCategoryMutation = useMutation({
    mutationFn: (data: CategoryCreateRequest) => CategoryService.createCategory(data),
    onSuccess: () => {
      toast.success(t('categories.toast.created', 'Category created successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree() });
      closeDrawer();
      setFormData({ name: '', description: '', parent_id: '', sort_order: 0, is_active: true });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('categories.toast.createFailed', 'Failed to create category')));
    },
  });

  // Update category mutation
  const updateCategoryMutation = useMutation({
    mutationFn: (payload: { id: number; data: Partial<CategoryCreateRequest> }) => CategoryService.updateCategory(payload.id, payload.data),
    onSuccess: () => {
      toast.success(t('categories.toast.updated', 'Category updated successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree() });
      closeDrawer();
      setFormData({ name: '', description: '', parent_id: '', sort_order: 0, is_active: true });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('categories.toast.updateFailed', 'Failed to update category')));
    },
  });

  // Delete category mutation
  const deleteCategoryMutation = useMutation({
    mutationFn: (payload: { id: number; replacementId?: number | null }) =>
      CategoryService.reassignAndDeleteCategory(payload.id, payload.replacementId),
    onSuccess: () => {
      toast.success(t('categories.toast.deleted', 'Category deleted successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree() });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
      setDeletionCategory(null);
      setDeletionTargetId('');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, t('categories.toast.deleteFailed', 'Failed to delete category')));
    },
  });

  const deletionImpactQuery = useQuery<CategoryDeletionImpact>({
    queryKey: ['categories', 'deletion-impact', deletionCategory?.id],
    queryFn: () => CategoryService.getDeletionImpact(Number(deletionCategory?.id)),
    enabled: Boolean(deletionCategory?.id),
    retry: 1,
  });
  // Populate form when editing
  useEffect(() => {
    if (editingCategory) {
      setFormData({
        name: editingCategory.name || '',
        description: editingCategory.description || '',
        parent_id: editingCategory.parent_id ? String(editingCategory.parent_id) : '',
        sort_order: editingCategory.sort_order ?? 0,
        is_active: Boolean(editingCategory.is_active),
      });
    }
  }, [editingCategory]);

  const openCreate = () => {
    setEditingCategory(null);
    setFormData({ name: '', description: '', parent_id: '', sort_order: 0, is_active: true });
    setDrawerOpen(true);
  };

  const openEdit = (category: Category) => {
    setEditingCategory(category);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingCategory(null);
  };

  const categoryById = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of categoriesData) m.set(Number(c.id), c);
    return m;
  }, [categoriesData]);

  const sortedCategories = useMemo(() => {
    const list = Array.isArray(categoriesData) ? [...categoriesData] : [];
    list.sort((a: Category, b: Category) => {
      const ao = Number(a.sort_order ?? 0);
      const bo = Number(b.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), locale === 'zh' ? 'zh' : 'en');
    });
    return list;
  }, [categoriesData, locale]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return sortedCategories.filter((category: Category) => {
      const matchesSearch =
        !q ||
        category.name?.toLowerCase().includes(q) ||
        category.description?.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && category.is_active) ||
        (statusFilter === 'inactive' && !category.is_active);
      return matchesSearch && matchesStatus;
    });
  }, [sortedCategories, searchQuery, statusFilter]);

  const parentOptions = useMemo(() => {
    const list = Array.isArray(categoriesData) ? [...categoriesData] : [];
    // Build tree for select labels
    const byParent = new Map<number | null, Category[]>();
    for (const c of list) {
      const pid = c.parent_id ?? null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(c);
    }

    const sort = (a: Category, b: Category) => {
      const ao = Number(a.sort_order ?? 0);
      const bo = Number(b.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), locale === 'zh' ? 'zh' : 'en');
    };

    for (const arr of byParent.values()) arr.sort(sort);

    const out: Array<{ value: string; label: string }> = [{ value: '', label: locale === 'zh' ? '（顶级分类）' : '(Root category)' }];
    const editingId = editingCategory?.id ? Number(editingCategory.id) : 0;

    const walk = (pid: number | null, depth: number) => {
      const arr = byParent.get(pid) || [];
      for (const c of arr) {
        if (editingId && Number(c.id) === editingId) continue;
        const prefix = depth > 0 ? `${'—'.repeat(depth)} ` : '';
        out.push({ value: String(c.id), label: `${prefix}${c.name}` });
        walk(Number(c.id), depth + 1);
      }
    };

    walk(null, 0);
    return out;
  }, [categoriesData, locale, editingCategory]);

  const normalizeSortMutation = useMutation({
    mutationFn: async () => {
      for (let i = 0; i < sortedCategories.length; i++) {
        const c = sortedCategories[i];
        const desired = i + 1;
        if (Number(c.sort_order ?? 0) === desired) continue;
        await CategoryService.updateCategory(c.id, { sort_order: desired });
      }
    },
    onSuccess: () => {
      toast.success(locale === 'zh' ? '已重置排序' : 'Sort order normalized');
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree() });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to normalize sort order');
    },
  });

  const handleDelete = (category: Category) => {
    setDeletionCategory(category);
    setDeletionTargetId('');
  };

  // Per-category AI SEO run: focuses on titles/meta and re-optimizes already
  // optimized products so a category can be polished after reclassification.
  const startCategorySEOJob = async (category: Category) => {
    const message = locale === 'zh'
      ? `对「${category.name}」分类（含子分类）启动 AI SEO 优化任务？将优化产品标题和 SEO 元信息，已优化过的产品也会重新处理。`
      : `Start an AI SEO job for "${category.name}" (including subcategories)? Product titles and SEO metadata are optimized; already-optimized products are re-processed.`;
    if (!window.confirm(message)) return;
    setSeoJobCategoryId(Number(category.id));
    try {
      const job = await AIAgentService.startSEOCandidateJob({
        prompt: `Optimize the SEO title, meta description, meta keywords, and corrected product name for each product in the "${category.name}" category. Use the verified brand, model, and category; keep titles precise and non-repetitive.`,
        limit: 30000,
        category_id: Number(category.id),
        include_descendants: true,
        include_optimized: true,
        ai_seo_status: 'all',
        focus: ['seo'],
      });
      toast.success(locale === 'zh'
        ? `已为「${category.name}」启动 SEO 任务（${job.total} 个产品），可到 AI SEO 页面查看进度`
        : `SEO job started for "${category.name}" (${job.total} products) — track it on the AI SEO page`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '启动 SEO 任务失败' : 'Failed to start the SEO job'));
    } finally {
      setSeoJobCategoryId(null);
    }
  };

  // Per-category title standardization: renames verified products in this
  // subtree to "Brand Model Type" in paged batches.
  const standardizeCategoryTitles = async (category: Category) => {
    const message = locale === 'zh'
      ? `将「${category.name}」分类（含子分类）下可核验产品的标题统一为「品牌 型号 类型」？URL 不受影响。`
      : `Rename verifiable products under "${category.name}" (including subcategories) to "Brand Model Type"? URLs are unchanged.`;
    if (!window.confirm(message)) return;
    setTitleJobCategoryId(Number(category.id));
    try {
      let afterId = 0;
      let updated = 0;
      let processed = 0;
      for (let batch = 0; batch < 200; batch++) {
        const result = await ProductService.standardizeTitles({
          category_id: Number(category.id),
          include_descendants: true,
          include_inactive: true,
          limit: 500,
          after_id: afterId,
          apply: true,
        });
        updated += result.updated;
        processed += result.processed;
        if (!result.has_more || !result.next_after_id || result.next_after_id <= afterId) break;
        afterId = result.next_after_id;
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
      toast.success(locale === 'zh'
        ? `「${category.name}」标题规范化完成：检查 ${processed} 个产品，重命名 ${updated} 个`
        : `Titles standardized for "${category.name}": ${processed} checked, ${updated} renamed`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '标题规范化失败' : 'Title standardization failed'));
    } finally {
      setTitleJobCategoryId(null);
    }
  };

  useEffect(() => {
    const impact = deletionImpactQuery.data;
    if (!impact || deletionTargetId) return;
    if (impact.parent?.id) {
      setDeletionTargetId(String(impact.parent.id));
    } else if (impact.product_count > 0 && impact.replacement_categories[0]?.id) {
      setDeletionTargetId(String(impact.replacement_categories[0].id));
    }
  }, [deletionImpactQuery.data, deletionTargetId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error(t('categories.toast.nameRequired', 'Category name is required'));
      return;
    }


    if (editingCategory) {
      // Update existing category
      updateCategoryMutation.mutate({
        id: editingCategory.id,
        data: {
          name: formData.name,
          description: formData.description,
          parent_id: formData.parent_id ? Number(formData.parent_id) : null,
          sort_order: Number(formData.sort_order) || 0,
          is_active: formData.is_active,
        },
      });
    } else {
      // Create new category
      createCategoryMutation.mutate({
        name: formData.name,
        description: formData.description,
        parent_id: formData.parent_id ? Number(formData.parent_id) : null,
        sort_order: Number(formData.sort_order) || 0,
        is_active: formData.is_active,
        image_url: '',
      });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: newValue }));
  };

  // Show loading state
  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </AdminLayout>
    );
  }

  // Show error state
  if (error) {
    return (
      <AdminLayout>
        <div className="text-center py-20">
          <div className="text-red-600 mb-4">
            {t(
              'categories.error.load',
              locale === 'zh' ? '分类加载失败：{message}' : 'Error loading categories: {message}',
              { message: error instanceof Error ? error.message : t('common.unknownError', locale === 'zh' ? '未知错误' : 'Unknown error') }
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold"
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('categories.title', 'Categories')}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {t('categories.subtitle', 'Manage product categories and organization')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const msg = locale === 'zh' ? '确定要把分类排序重置为 1..N 吗？' : 'Normalize sort order to 1..N?';
                if (!window.confirm(msg)) return;
                normalizeSortMutation.mutate();
              }}
              disabled={normalizeSortMutation.isPending || sortedCategories.length === 0}
              className="inline-flex items-center px-4 py-2 border border-gray-200 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              <ArrowsUpDownIcon className="h-4 w-4 mr-2" />
              {t('categories.sort.normalize', 'Normalize Sort')}
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              {t('categories.add', 'Add Category')}
            </button>
          </div>
        </div>

        {/* AI taxonomy tools */}
        <CategoryAIToolsPanel />

        {/* Filters */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Search */}
            <div className="sm:col-span-2">
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                {t('categories.search', 'Search Categories')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  id="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('categories.searchPh', locale === 'zh' ? '按名称/描述搜索...' : 'Search by name or description...')}
                />
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
                {t('categories.status', 'Status')}
              </label>
              <select
                id="status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">{t('categories.all', 'All')}</option>
                <option value="active">{t('categories.active', 'Active')}</option>
                <option value="inactive">{t('categories.inactive', 'Inactive')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Hierarchy (drag & drop) */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('categories.hierarchy', 'Category Hierarchy')}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {t('categories.hierarchy.hint', 'Drag a category onto another to make it a child. Drop onto the top area to make it a root category.')}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <CategoryHierarchyEditor
              categories={categoriesData as any}
              onUpdated={() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.categories.lists() });
                queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree() });
              }}
            />
          </div>
        </div>

        {/* Categories List */}
        {filteredCategories.length > 0 ? (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      {t('categories.field.name', 'Category Name')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      {t('common.url', locale === 'zh' ? '链接' : 'URL')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      {t('categories.field.parent', 'Parent Category')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      {t('categories.status', 'Status')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      {t('categories.field.sortOrder', 'Sort Order')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      {t('common.actions', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredCategories.map((category) => {
                    const pid = (category as any).parent_id ? Number((category as any).parent_id) : null;
                    const parent = pid ? categoryById.get(pid) : null;
                    return (
                      <tr key={category.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">{category.name}</div>
                          {category.description ? (
                            <div className="text-xs text-gray-500 line-clamp-1">{category.description}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-mono text-gray-700">/{(category as any).path || category.slug}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-700">{parent?.name || '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                              category.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {category.is_active ? t('categories.active', 'Active') : t('categories.inactive', 'Hidden')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-700">{Number((category as any).sort_order ?? 0)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => startCategorySEOJob(category)}
                              disabled={seoJobCategoryId !== null || titleJobCategoryId !== null}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-violet-200 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                              title={locale === 'zh' ? '对此分类（含子分类）启动 AI SEO 标题优化任务' : 'Start an AI SEO title job for this category and its subcategories'}
                            >
                              <SparklesIcon className="h-4 w-4" />
                              {seoJobCategoryId === Number(category.id) ? (locale === 'zh' ? '启动中…' : 'Starting…') : 'SEO'}
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => standardizeCategoryTitles(category)}
                                disabled={seoJobCategoryId !== null || titleJobCategoryId !== null}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-blue-200 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                title={locale === 'zh' ? '将此分类（含子分类）下的产品标题统一为「品牌 型号 类型」' : 'Rename products under this category to "Brand Model Type"'}
                              >
                                <PencilSquareIcon className="h-4 w-4" />
                                {titleJobCategoryId === Number(category.id) ? (locale === 'zh' ? '处理中…' : 'Working…') : (locale === 'zh' ? '标题' : 'Titles')}
                              </button>
                            )}
                            <button
                              onClick={() => openEdit(category)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-white"
                            >
                              <PencilIcon className="h-4 w-4" />
                              {t('categories.edit', 'Edit')}
                            </button>
                            <button
                              onClick={() => handleDelete(category)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-sm text-red-600 hover:bg-white"
                            >
                              <TrashIcon className="h-4 w-4" />
                              {t('common.delete', 'Delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {filteredCategories.length === 0 && (
          <div className="text-center py-12">
            <TagIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">{t('categories.empty.title', 'No categories found')}</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchQuery || statusFilter !== 'all'
                ? t('categories.empty.filtered', 'Try adjusting your search or filter criteria.')
                : t('categories.empty.fresh', 'Get started by creating your first category.')
              }
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <div className="mt-6">
                <button
                  onClick={openCreate}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  <PlusIcon className="h-4 w-4 mr-2" />
                  {t('categories.add', locale === 'zh' ? '新增分类' : 'Add Category')}
                </button>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Create/Edit Drawer (no navigation) */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-gray-600/50" onClick={closeDrawer} />
          <div className="absolute inset-y-0 right-0 w-full max-w-xl bg-white shadow-xl overflow-y-auto">
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-200">
              <div>
                <div className="text-lg font-semibold text-gray-900">
                  {editingCategory ? t('categories.drawer.editTitle', 'Edit Category') : t('categories.drawer.createTitle', 'Create Category')}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {t('categories.drawer.hint', 'Edit in this panel; list will refresh after saving.')}
                </div>
              </div>
              <button onClick={closeDrawer} className="p-2 rounded-md hover:bg-gray-50 text-gray-500" title={locale === 'zh' ? '关闭' : 'Close'}>
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              <form id="category-form" onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('categories.field.name', 'Category Name')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder={locale === 'zh' ? '例如：Servo Drives' : 'e.g., Servo Drives'}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('categories.field.parent', 'Parent Category')}
                  </label>
                  <select
                    name="parent_id"
                    value={String((formData as any).parent_id || '')}
                    onChange={handleInputChange}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    {parentOptions.map((opt) => (
                      <option key={opt.value || 'root'} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {t('categories.field.parentHint', 'Set a parent to create nested URLs like /parent/child.')}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('categories.field.description', 'Description')}
                  </label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    rows={4}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder={locale === 'zh' ? '分类描述…' : 'Category description...'}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('categories.field.sortOrder', 'Sort Order')}
                    </label>
                    <input
                      type="number"
                      name="sort_order"
                      value={formData.sort_order}
                      onChange={handleInputChange}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      min={0}
                      max={9999}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t('categories.field.sortHint', 'Smaller numbers appear first.')}
                    </p>
                  </div>

                  <div className="flex items-center mt-6">
                    <input
                      type="checkbox"
                      name="is_active"
                      checked={formData.is_active}
                      onChange={handleInputChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label className="ml-2 block text-sm text-gray-900">
                      {t('categories.field.isActive', 'Active')}
                    </label>
                  </div>
                </div>
              </form>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDrawer}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="submit"
                form="category-form"
                disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {(createCategoryMutation.isPending || updateCategoryMutation.isPending)
                  ? (editingCategory ? t('common.saving', 'Saving...') : t('common.creating', 'Creating...'))
                  : (editingCategory ? t('common.save', 'Save') : t('common.create', 'Create'))}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deletionCategory ? (
        <div className="fixed inset-0 z-[60] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="category-delete-title">
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <div className="fixed inset-0 bg-gray-900/60" onClick={() => !deleteCategoryMutation.isPending && setDeletionCategory(null)} />
            <div className="relative w-full max-w-2xl rounded-lg bg-white shadow-xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                <div>
                  <h2 id="category-delete-title" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                    <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
                    {locale === 'zh' ? '删除分类前检查' : 'Review before deleting'}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">{locale === 'zh' ? `分类：${deletionCategory.name}` : `Category: ${deletionCategory.name}`}</p>
                </div>
                <button onClick={() => setDeletionCategory(null)} disabled={deleteCategoryMutation.isPending} className="rounded-md p-2 text-gray-500 hover:bg-gray-50" title={locale === 'zh' ? '关闭' : 'Close'}><XMarkIcon className="h-5 w-5" /></button>
              </div>

              <div className="space-y-5 px-6 py-5">
                {deletionImpactQuery.isLoading ? (
                  <div className="py-10 text-center text-sm text-gray-500">{locale === 'zh' ? '正在读取关联内容…' : 'Loading linked content…'}</div>
                ) : deletionImpactQuery.error ? (
                  <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{deletionImpactQuery.error instanceof Error ? deletionImpactQuery.error.message : 'Failed to load deletion impact'}</div>
                ) : deletionImpactQuery.data ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-md border border-gray-200 p-3"><div className="text-xs text-gray-500">{locale === 'zh' ? '直接产品' : 'Direct products'}</div><div className="mt-1 text-xl font-semibold text-gray-900">{deletionImpactQuery.data.product_count}</div></div>
                      <div className="rounded-md border border-gray-200 p-3"><div className="text-xs text-gray-500">{locale === 'zh' ? '直接子分类' : 'Child categories'}</div><div className="mt-1 text-xl font-semibold text-gray-900">{deletionImpactQuery.data.direct_children.length}</div></div>
                      <div className="rounded-md border border-gray-200 p-3"><div className="text-xs text-gray-500">{locale === 'zh' ? '所有后代分类' : 'All descendants'}</div><div className="mt-1 text-xl font-semibold text-gray-900">{deletionImpactQuery.data.descendant_count}</div></div>
                    </div>

                    {deletionImpactQuery.data.direct_products.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{locale === 'zh' ? '关联产品预览（最多显示 100 个）' : 'Linked products (up to 100 shown)'}</h3>
                        <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-gray-200 divide-y divide-gray-100">
                          {deletionImpactQuery.data.direct_products.map((product) => (
                            <a key={product.id} href={`/admin/products/${product.id}/edit`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-gray-50">
                              <span className="min-w-0 truncate text-gray-800">{product.name || product.model || product.sku}</span>
                              <span className="shrink-0 font-mono text-xs text-gray-500">{product.sku}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {deletionImpactQuery.data.direct_children.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{locale === 'zh' ? '子分类' : 'Child categories'}</h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {deletionImpactQuery.data.direct_children.map((child) => (
                            <button key={child.id} type="button" onClick={() => { setDeletionCategory(null); openEdit(categoryById.get(child.id) || {
                            ...child,
                            description: '',
                            image_url: '',
                            sort_order: 0,
                            is_active: true,
                            created_at: '',
                            updated_at: '',
                          } as Category); }} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">{child.name}</button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {deletionImpactQuery.data.product_count > 0 || deletionImpactQuery.data.direct_children.length > 0 ? (
                      <div>
                        <label className="block text-sm font-semibold text-gray-900" htmlFor="replacement-category">{locale === 'zh' ? '重分配到分类' : 'Reassign linked content to'}</label>
                        <select id="replacement-category" value={deletionTargetId} onChange={(event) => setDeletionTargetId(event.target.value)} className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                          <option value="">{locale === 'zh' ? '请选择目标分类' : 'Select a target category'}</option>
                          {deletionImpactQuery.data.replacement_categories.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{locale === 'zh' ? '产品和直接子分类会在同一个事务中移动，之后删除当前分类。' : 'Products and direct children are moved in one transaction before deletion.'}</p>
                      </div>
                    ) : (
                      <p className="rounded-md bg-green-50 p-3 text-sm text-green-700">{locale === 'zh' ? '没有发现产品或子分类关联，可以直接删除。' : 'No products or child categories are linked. This category can be deleted directly.'}</p>
                    )}
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button type="button" onClick={() => setDeletionCategory(null)} disabled={deleteCategoryMutation.isPending} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{t('common.cancel', 'Cancel')}</button>
                <button
                  type="button"
                  onClick={() => deletionImpactQuery.data && deleteCategoryMutation.mutate({ id: Number(deletionCategory.id), replacementId: deletionTargetId ? Number(deletionTargetId) : null })}
                  disabled={deleteCategoryMutation.isPending || deletionImpactQuery.isLoading || !deletionImpactQuery.data || ((deletionImpactQuery.data.product_count > 0 || deletionImpactQuery.data.direct_children.length > 0) && !deletionTargetId)}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteCategoryMutation.isPending ? (locale === 'zh' ? '处理中…' : 'Processing…') : (locale === 'zh' ? '确认重分配并删除' : 'Reassign and delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AdminLayout>
  );
}
