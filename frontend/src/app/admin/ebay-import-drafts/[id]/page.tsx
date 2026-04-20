'use client';

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
import { CategoryService, EbayImportDraftService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { useAdminI18n } from '@/lib/admin-i18n';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

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
  });

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.admin(),
    queryFn: () => CategoryService.getAdminCategories(),
  });

  const [form, setForm] = useState({
    normalized_title: '',
    normalized_brand: '',
    normalized_model: '',
    normalized_part_number: '',
    normalized_mpn: '',
    normalized_price: '',
    suggested_category_id: '',
    import_action: '',
    meta_title: '',
    meta_description: '',
    meta_keywords: '',
    review_note: '',
    disable_auto_seo: false,
  });

  useEffect(() => {
    if (!draft) return;
    setForm({
      normalized_title: draft.normalized_title || '',
      normalized_brand: draft.normalized_brand || '',
      normalized_model: draft.normalized_model || '',
      normalized_part_number: draft.normalized_part_number || '',
      normalized_mpn: draft.normalized_mpn || '',
      normalized_price: String(draft.normalized_price ?? ''),
      suggested_category_id: draft.suggested_category_id ? String(draft.suggested_category_id) : '',
      import_action: draft.import_action || '',
      meta_title: draft.meta_title || '',
      meta_description: draft.meta_description || '',
      meta_keywords: draft.meta_keywords || '',
      review_note: draft.review_note || '',
      disable_auto_seo: !!draft.disable_auto_seo,
    });
  }, [draft]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.detail(draftId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.lists() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
  };

  const saveMutation = useMutation({
    mutationFn: async () => EbayImportDraftService.update(draftId, {
      normalized_title: form.normalized_title,
      normalized_brand: form.normalized_brand,
      normalized_model: form.normalized_model,
      normalized_part_number: form.normalized_part_number,
      normalized_mpn: form.normalized_mpn,
      normalized_price: Number(form.normalized_price || 0),
      suggested_category_id: form.suggested_category_id ? Number(form.suggested_category_id) : undefined,
      import_action: form.import_action || undefined,
      meta_title: form.meta_title,
      meta_description: form.meta_description,
      meta_keywords: form.meta_keywords,
      review_note: form.review_note,
      disable_auto_seo: form.disable_auto_seo,
    }),
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
    mutationFn: () => EbayImportDraftService.confirm(draftId, form.import_action || undefined),
    onSuccess: async () => {
      await invalidate();
      toast.success(locale === 'zh' ? '已确认导入' : 'Draft confirmed');
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
              <h1 className="text-2xl font-bold text-gray-900">{draft.normalized_title || draft.title_raw}</h1>
              <p className="mt-1 text-sm text-gray-500">#{draft.id} · {draft.status}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {locale === 'zh' ? '保存' : 'Save'}
            </button>
            <button
              onClick={() => recheckMutation.mutate()}
              disabled={recheckMutation.isPending}
              className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              <ArrowPathIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '重新检测' : 'Recheck'}
            </button>
            <button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
              className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              <CheckCircleIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '确认导入' : 'Confirm Import'}
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '分类' : 'Category'}</label>
                  <select value={form.suggested_category_id} onChange={(e) => setForm((prev) => ({ ...prev, suggested_category_id: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                    <option value="">{locale === 'zh' ? '请选择分类' : 'Select category'}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
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
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-medium text-gray-900">{locale === 'zh' ? '原始抓取信息' : 'Raw Source Data'}</h3>
              <pre className="max-h-[420px] overflow-auto rounded-md bg-gray-50 p-4 text-xs text-gray-700">{JSON.stringify(draft.raw_payload, null, 2)}</pre>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-medium text-gray-900">{locale === 'zh' ? '图片' : 'Images'}</h3>
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
