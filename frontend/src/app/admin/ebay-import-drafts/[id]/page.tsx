'use client';

import { hasReadyDraftReview, draftDisplayTitle } from '@/lib/ebay-draft-preview';
import { draftToEditForm, draftEditPatch } from '@/lib/ebay-draft-form';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import CategoryCombobox from '@/components/admin/CategoryCombobox';
import { CategoryService, EbayImportDraftService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { useAdminI18n } from '@/lib/admin-i18n';
import { getErrorMessage } from '@/lib/errors';

export default function EbayImportDraftDetailPage() {
  const { locale } = useAdminI18n();
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const draftId = Number(params.id);

  const { data: draft, isLoading, error } = useQuery({
    queryKey: queryKeys.ebayImportDrafts.detail(draftId),
    queryFn: () => EbayImportDraftService.get(draftId),
    enabled: !!draftId,
    refetchInterval: (query) => ['queued', 'processing'].includes(query.state.data?.ai_review_status || '') ? 2000 : false,
    refetchOnWindowFocus: false,
  });

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.admin(),
    queryFn: () => CategoryService.getAdminCategories(),
  });
  const { data: ebayCategoryOptions = [] } = useQuery({
    queryKey: ['ebayImportDrafts', 'source-categories', 'ebay'],
    queryFn: () => EbayImportDraftService.getSourceCategories('ebay'),
    staleTime: 5 * 60 * 1000,
  });
  const activeLeafCategories = categories.filter((category) =>
    category.is_active && !categories.some((candidate) => candidate.is_active && candidate.parent_id === category.id)
  );

  const [form, setForm] = useState({
    normalized_title: '',
    normalized_description: '',
    normalized_short_description: '',
    include_images: true,
    normalized_brand: '',
    normalized_model: '',
    normalized_part_number: '',
    normalized_mpn: '',
    normalized_price: '',
    suggested_category_id: '',
    ebay_category: '',
    import_action: '',
    meta_title: '',
    meta_description: '',
    meta_keywords: '',
    review_note: '',
    disable_auto_seo: false,
  });

  useEffect(() => {
    if (!draft) return;
    setForm(draftToEditForm(draft));
  }, [draft]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.detail(draftId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.lists() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
  };

  const categoryRequiredMessage = locale === 'zh' ? '请点击「AI 一键优化」，自动识别并匹配或创建分类，完成后再上架。' : 'Run AI optimization to identify and resolve or create a category before publishing.';
  const reviewRunning = ['queued', 'processing'].includes(draft?.ai_review_status || '');
  const processed = ['imported', 'skipped'].includes(draft?.status || '');
  const saveChanges = async () => {
    if (!draft) throw new Error('Draft not loaded');
    const patch = draftEditPatch(form, draft);
    if (Object.keys(patch).length > 0) return EbayImportDraftService.update(draftId, patch);
    return draft;
  };
  const optimizeMutation = useMutation({
    mutationFn: async () => {
      await saveChanges();
      return EbayImportDraftService.startAIReview({ ids: [draftId], auto_publish: false });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(locale === 'zh' ? 'AI 正在优化标题、分类、描述和 SEO；完成后会自动填入下方字段，不会自动上架。' : 'AI optimization started; nothing will be published automatically.');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, 'AI optimization failed')),
  });
  useEffect(() => {
    if (draft?.ai_review_status === 'ready') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.admin() });
    }
  }, [draft?.ai_review_status, draft?.updated_at, queryClient]);
  const isCategoryMissing = !form.suggested_category_id && !(draft && hasReadyDraftReview(draft) && draft.proposed_category_id);

  const saveMutation = useMutation({
    mutationFn: saveChanges,
    onSuccess: async () => {
      await invalidate();
      toast.success(locale === 'zh' ? '草稿已保存' : 'Draft saved');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '保存失败' : 'Save failed')),
  });

  const recheckMutation = useMutation({
    mutationFn: () => EbayImportDraftService.recheck(draftId),
    onSuccess: async () => {
      await invalidate();
      toast.success(locale === 'zh' ? '已重新检测' : 'Draft rechecked');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '重检失败' : 'Recheck failed')),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const saved = await saveChanges();
      if (!saved.suggested_category_id && !saved.proposed_category_id) throw new Error(categoryRequiredMessage);
      if (saved.ai_review_status !== 'ready' && saved.ai_review_status !== 'approved') {
        throw new Error(locale === 'zh' ? '请先完成 AI 优化，再一键上架。' : 'Finish AI optimization before publishing.');
      }
      return EbayImportDraftService.confirm(draftId, form.import_action || undefined, form.include_images);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(locale === 'zh' ? '已保存并确认导入' : 'Draft saved and confirmed');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '确认失败' : 'Confirm failed')),
  });

  const deleteMutation = useMutation({
    mutationFn: () => EbayImportDraftService.delete(draftId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.lists() });
      toast.success(locale === 'zh' ? '草稿已删除' : 'Draft deleted');
      router.push('/admin/ebay-import-drafts');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '删除失败' : 'Delete failed')),
  });

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  if (error || !draft) {
    return (
      <AdminLayout>
        <div className="p-12 text-center text-red-600">{(error as Error)?.message || 'Not found'}</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {hasReadyDraftReview(draft) && (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="font-semibold text-emerald-900">{locale === 'zh' ? 'AI 优化已完成，等待手动上架' : 'AI optimized, awaiting manual publishing'}</h2>
            <p className="mt-2 font-medium">{draft.proposed_name}</p>
            <p className="mt-1 text-sm">{locale === 'zh' ? '本站分类：' : 'Site category: '}{draft.proposed_category_name}{draft.proposed_category_created ? (locale === 'zh' ? '（自动新建）' : ' (created)') : ''}</p>
            <p className="mt-1 text-xs text-gray-500">eBay: {draft.ebay_category || '—'} · BAS: {draft.bas_category || '—'}</p>
            <p className="mt-2 whitespace-pre-line text-sm">{draft.proposed_short_description}</p>
            <details className="mt-2 text-sm"><summary>{locale === 'zh' ? '查看优化后的描述 / SEO' : 'View optimized description / SEO'}</summary>
              <p className="mt-2 whitespace-pre-line">{draft.proposed_description}</p>
              <p className="mt-2">SEO: {draft.proposed_meta_title}</p><p>{draft.proposed_meta_description}</p>
            </details>
            <p className="mt-2 text-xs text-gray-500">{locale === 'zh' ? '优化结果已填入下方可编辑字段；可直接手动上架。原始采集内容另行保留。' : 'Optimized fields are editable below and ready to publish. Source evidence is kept separately.'}</p>
          </section>
        )}
        {reviewRunning && <p role="status" className="rounded border border-blue-200 bg-blue-50 p-4 text-blue-800">{locale === 'zh' ? 'AI 正在识别商品并优化标题、分类、描述及 SEO，完成后将自动更新。' : 'AI is optimizing this listing. Results will appear automatically.'}</p>}
        {draft.ai_review_error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-700">{draft.ai_review_error}</p>}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/ebay-import-drafts"
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '返回草稿列表' : 'Back to Drafts'}
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{draftDisplayTitle(draft)}</h1>
              <p className="mt-1 text-sm text-gray-500">#{draft.id} · {draft.status} · {draft.source_site || 'ebay'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => optimizeMutation.mutate()} disabled={reviewRunning || optimizeMutation.isPending || processed || saveMutation.isPending || confirmMutation.isPending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {reviewRunning || optimizeMutation.isPending ? (locale === 'zh' ? 'AI 优化中…' : 'Optimizing…') : (locale === 'zh' ? 'AI 一键优化' : 'Optimize with AI')}
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || reviewRunning || optimizeMutation.isPending || processed || confirmMutation.isPending}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {locale === 'zh' ? '保存' : 'Save'}
            </button>
            <button
              onClick={() => recheckMutation.mutate()}
              disabled={recheckMutation.isPending || reviewRunning || optimizeMutation.isPending || processed}
              className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              <ArrowPathIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '重新检测' : 'Recheck'}
            </button>
            <button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending || isCategoryMissing || reviewRunning || optimizeMutation.isPending || saveMutation.isPending || processed || !['ready', 'approved'].includes(draft.ai_review_status || '')}
              className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
            >
              <CheckCircleIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '保存并一键上架' : 'Save and publish'}
            </button>
            <button
              onClick={() => {
                if (!window.confirm(locale === 'zh' ? '确定删除这个草稿吗？' : 'Delete this draft?')) return;
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              <TrashIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '删除' : 'Delete'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-medium text-gray-900">{locale === 'zh' ? '可编辑入库字段' : 'Editable Import Fields'}</h3>
              <fieldset disabled={reviewRunning || optimizeMutation.isPending || processed || confirmMutation.isPending || saveMutation.isPending} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '标题' : 'Title'}</label>
                  <input value={form.normalized_title} onChange={(e) => setForm((prev) => ({ ...prev, normalized_title: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '品牌' : 'Brand'}</label>
                  <input value={form.normalized_brand} onChange={(e) => setForm((prev) => ({ ...prev, normalized_brand: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '型号' : 'Model'}</label>
                  <input value={form.normalized_model} onChange={(e) => setForm((prev) => ({ ...prev, normalized_model: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? 'Part Number' : 'Part Number'}</label>
                  <input value={form.normalized_part_number} onChange={(e) => setForm((prev) => ({ ...prev, normalized_part_number: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">MPN</label>
                  <input value={form.normalized_mpn} onChange={(e) => setForm((prev) => ({ ...prev, normalized_mpn: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '价格' : 'Price'}</label>
                  <input value={form.normalized_price} onChange={(e) => setForm((prev) => ({ ...prev, normalized_price: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '导入动作' : 'Import Action'}</label>
                  <select value={form.import_action} onChange={(e) => setForm((prev) => ({ ...prev, import_action: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                    <option value="">{locale === 'zh' ? '自动' : 'Auto'}</option>
                    <option value="create_new">{locale === 'zh' ? '创建新产品' : 'Create New'}</option>
                    <option value="update_existing">{locale === 'zh' ? '更新现有产品' : 'Update Existing'}</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-sm font-medium text-gray-700">{locale === 'zh' ? '分类' : 'Category'}</label>
                    {isCategoryMissing && (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                        {locale === 'zh' ? '等待 AI 自动归类' : 'Awaiting AI classification'}
                      </span>
                    )}
                  </div>
                  {/* A taxonomy has hundreds of leaves, so a native select cannot
                      be searched and the reviewer scrolls a flat list of paths.
                      The combobox filters by name, slug, path and description. */}
                  <CategoryCombobox
                    categories={activeLeafCategories}
                    value={form.suggested_category_id}
                    onChange={(categoryId) => setForm((prev) => ({ ...prev, suggested_category_id: String(categoryId) }))}
                    placeholder={
                      locale === 'zh'
                        ? '输入关键词搜索分类（名称 / 路径 / 型号关键词）'
                        : 'Type to search categories (name / path / keyword)'
                    }
                  />
                  {isCategoryMissing ? (
                    <p className="mt-2 text-sm text-amber-700">{categoryRequiredMessage}</p>
                  ) : null}
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {locale === 'zh' ? 'eBay 源站分类（独立）' : 'eBay source category (separate)'}
                  </label>
                  <select
                    value={form.ebay_category}
                    onChange={(e) => setForm((prev) => ({ ...prev, ebay_category: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">{locale === 'zh' ? '（未选择）' : '(none)'}</option>
                    {form.ebay_category && !ebayCategoryOptions.some((option) => option.value === form.ebay_category) ? (
                      <option value={form.ebay_category}>{form.ebay_category}</option>
                    ) : null}
                    {ebayCategoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.value} ({option.count})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {locale === 'zh' ? '这里只修改 eBay 的源站分类，不会覆盖本站分类；修改后请重新运行 AI 优化。' : 'This changes only eBay source taxonomy, not the site category; rerun AI after changing it.'}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '商品短描述' : 'Short description'}</label>
                  <textarea rows={3} value={form.normalized_short_description} onChange={(e) => setForm((prev) => ({ ...prev, normalized_short_description: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '商品描述（纯文本）' : 'Product description (plain text)'}</label>
                  <textarea rows={10} value={form.normalized_description} onChange={(e) => setForm((prev) => ({ ...prev, normalized_description: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Meta Title</label>
                  <input value={form.meta_title} onChange={(e) => setForm((prev) => ({ ...prev, meta_title: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Meta Description</label>
                  <textarea value={form.meta_description} onChange={(e) => setForm((prev) => ({ ...prev, meta_description: e.target.value }))} rows={4} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Meta Keywords</label>
                  <textarea value={form.meta_keywords} onChange={(e) => setForm((prev) => ({ ...prev, meta_keywords: e.target.value }))} rows={2} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '审核备注' : 'Review Note'}</label>
                  <textarea value={form.review_note} onChange={(e) => setForm((prev) => ({ ...prev, review_note: e.target.value }))} rows={3} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
                  <input type="checkbox" checked={form.disable_auto_seo} onChange={(e) => setForm((prev) => ({ ...prev, disable_auto_seo: e.target.checked }))} className="h-4 w-4" />
                  {locale === 'zh' ? '禁用自动 SEO 覆盖' : 'Disable auto SEO override'}
                </label>
              </fieldset>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-medium text-gray-900">{locale === 'zh' ? '原始抓取信息' : 'Raw Source Data'}</h3>
              <pre className="max-h-[420px] overflow-auto rounded-md bg-gray-50 p-4 text-xs text-gray-700">{JSON.stringify(draft.raw_payload, null, 2)}</pre>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-medium text-gray-900">{locale === 'zh' ? '图片' : 'Images'}</h3>
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.include_images} disabled={reviewRunning || processed || confirmMutation.isPending || optimizeMutation.isPending} onChange={(e) => setForm((prev) => ({ ...prev, include_images: e.target.checked }))} />
                {locale === 'zh' ? '上架时使用来源图片' : 'Use source images when publishing'}
              </label>
              {!form.include_images && <p className="mb-3 text-sm text-amber-700">{locale === 'zh' ? '不导入抓取图片（含媒体库副本）。新商品无图上架，已有商品保留原有图片；下方仅为来源预览。' : 'Skip scraped pictures, including cached copies. Existing product images are preserved. Preview only below.'}</p>}
              <div className="grid grid-cols-2 gap-3">
                {draft.media_assets.length > 0 ? draft.media_assets.map((asset) => (
                  <div key={asset.id} className="overflow-hidden rounded-lg border border-gray-200">
                    <Image src={asset.url} alt={asset.original_name} width={320} height={128} className="h-32 w-full object-cover" unoptimized />
                    <div className="p-2 text-xs text-gray-500">#{asset.id}</div>
                  </div>
                )) : draft.image_source_urls.map((url, index) => (
                  <div key={`${url}-${index}`} className="overflow-hidden rounded-lg border border-gray-200">
                    <Image src={url} alt={`draft-${index}`} width={320} height={128} className="h-32 w-full object-cover" unoptimized />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-medium text-gray-900">{locale === 'zh' ? '匹配结果' : 'Match Result'}</h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">{locale === 'zh' ? '匹配状态' : 'Match Status'}</dt>
                  <dd className="font-medium text-gray-900">{draft.match_status}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{locale === 'zh' ? '匹配原因' : 'Reason'}</dt>
                  <dd className="text-gray-900">{draft.match_reason || '-'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{locale === 'zh' ? '匹配分数' : 'Score'}</dt>
                  <dd className="text-gray-900">{draft.match_score}</dd>
                </div>
                {draft.matched_product && (
                  <div>
                    <dt className="text-gray-500">{locale === 'zh' ? '命中产品' : 'Matched Product'}</dt>
                    <dd>
                      <Link href={`/admin/products/${draft.matched_product.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                        #{draft.matched_product.id} · {draft.matched_product.sku} · {draft.matched_product.name}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-medium text-gray-900">{locale === 'zh' ? '来源信息' : 'Source Info'}</h3>
              <dl className="space-y-3 text-sm">
                <div><dt className="text-gray-500">URL</dt><dd className="break-all text-gray-900">{draft.source_url || '-'}</dd></div>
                <div><dt className="text-gray-500">eBay Item ID</dt><dd className="text-gray-900">{draft.ebay_item_id || '-'}</dd></div>
                <div><dt className="text-gray-500">Listing ID</dt><dd className="text-gray-900">{draft.listing_id || '-'}</dd></div>
                <div><dt className="text-gray-500">{locale === 'zh' ? '上传时间' : 'Uploaded'}</dt><dd className="text-gray-900">{new Date(draft.created_at).toLocaleString()}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
