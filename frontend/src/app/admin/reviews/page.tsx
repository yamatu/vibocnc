'use client';

import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  CheckIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PencilSquareIcon,
  StarIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import AdminLayout from '@/components/admin/AdminLayout';
import AddReviewModal, { reviewSourceLabel } from '@/components/admin/AddReviewModal';
import { useAdminI18n } from '@/lib/admin-i18n';
import { ReviewService, type AdminReviewUpdate } from '@/services/review.service';
import type { ProductReview, ProductReviewStatus } from '@/types';
import { toProductPathId } from '@/lib/utils';

type StatusTab = ProductReviewStatus | '';

const STATUS_STYLE: Record<ProductReviewStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((s) =>
        s <= rating
          ? <StarIconSolid key={s} className="h-4 w-4 text-amber-500" />
          : <StarIcon key={s} className="h-4 w-4 text-gray-300" />,
      )}
    </span>
  );
}

export default function AdminReviewsPage() {
  const { locale } = useAdminI18n();
  const L = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const qc = useQueryClient();

  const [status, setStatus] = useState<StatusTab>('pending');
  const [rating, setRating] = useState<number | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<ProductReview | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => setSelected([]), [status, rating, search, page]);

  const filters = { page, page_size: 20, status, rating, search };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'reviews', filters],
    queryFn: () => ReviewService.adminList(filters),
    placeholderData: keepPreviousData,
  });
  const reviews = useMemo(() => data?.data ?? [], [data]);
  const counts = data?.status_counts;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'reviews'] });

  const statusMutation = useMutation({
    mutationFn: ({ ids, next }: { ids: number[]; next: ProductReviewStatus }) => ReviewService.adminBulkStatus(ids, next),
    onSuccess: (_d, vars) => {
      toast.success(vars.next === 'approved' ? L('已通过审核', 'Approved') : vars.next === 'rejected' ? L('已拒绝', 'Rejected') : L('已更新', 'Updated'));
      setSelected([]);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ReviewService.adminDelete(id),
    onSuccess: () => {
      toast.success(L('已删除', 'Deleted'));
      invalidate();
    },
  });

  const tabs: Array<{ key: StatusTab; label: string; count?: number }> = [
    { key: 'pending', label: L('待审核', 'Pending'), count: counts?.pending },
    { key: 'approved', label: L('已通过', 'Approved'), count: counts?.approved },
    { key: 'rejected', label: L('已拒绝', 'Rejected'), count: counts?.rejected },
    { key: '', label: L('全部', 'All') },
  ];
  const statusLabel = (s?: ProductReviewStatus) =>
    s === 'approved' ? L('已通过', 'Approved') : s === 'rejected' ? L('已拒绝', 'Rejected') : L('待审核', 'Pending');

  const allSelected = reviews.length > 0 && selected.length === reviews.length;
  const toggleAll = () => setSelected(allSelected ? [] : reviews.map((r) => r.id));
  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{L('商品评价', 'Product Reviews')}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {L(
              '只有购买过商品的客户才能评价，所有评价需审核通过后才会在商品页展示。可以编辑内容、评分和显示名称。',
              'Only customers who bought a product can review it. Every review must be approved before it appears on the product page. You can edit text, rating and display name.',
            )}
          </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-600"
          >
            <PlusIcon className="h-4 w-4" />{L('录入客户评价', 'Add customer feedback')}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key || 'all'}
              type="button"
              onClick={() => { setStatus(tab.key); setPage(1); }}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
                status === tab.key ? 'border-yellow-500 bg-yellow-500 text-black' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && <span className="ml-1.5 text-xs opacity-75">({tab.count})</span>}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={L('搜索 SKU、商品名、客户、邮箱或评价内容', 'Search SKU, product, customer, email or text')}
              className="block w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-yellow-500 focus:ring-yellow-500"
            />
          </div>
          <select
            value={rating}
            onChange={(e) => { setRating(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-yellow-500 focus:ring-yellow-500"
          >
            <option value="">{L('全部评分', 'All ratings')}</option>
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} ★</option>)}
          </select>
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm">
            <span className="font-medium text-gray-800">{L(`已选择 ${selected.length} 条`, `${selected.length} selected`)}</span>
            <button
              type="button"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ ids: selected, next: 'approved' })}
              className="rounded-md bg-green-600 px-3 py-1.5 font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              {L('批量通过', 'Approve')}
            </button>
            <button
              type="button"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ ids: selected, next: 'rejected' })}
              className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {L('批量拒绝', 'Reject')}
            </button>
            <button
              type="button"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ ids: selected, next: 'pending' })}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {L('设为待审核', 'Mark pending')}
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-lg bg-white shadow">
          {isLoading ? (
            <div className="p-6 text-sm text-gray-500">{L('加载中...', 'Loading...')}</div>
          ) : reviews.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">{L('暂无评价', 'No reviews')}</div>
          ) : (
            <div className={`overflow-x-auto ${isFetching ? 'opacity-70' : ''}`}>
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-gray-300" /></th>
                    <th className="px-4 py-3">{L('商品', 'Product')}</th>
                    <th className="px-4 py-3">{L('客户', 'Customer')}</th>
                    <th className="px-4 py-3">{L('评价', 'Review')}</th>
                    <th className="px-4 py-3">{L('状态', 'Status')}</th>
                    <th className="px-4 py-3">{L('时间', 'Date')}</th>
                    <th className="px-4 py-3 text-right">{L('操作', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reviews.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleOne(r.id)} className="rounded border-gray-300" /></td>
                      <td className="max-w-[200px] px-4 py-3">
                        {r.product ? (
                          <a href={`/products/${toProductPathId(r.product.sku)}#reviews`} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">
                            {r.product.sku}
                          </a>
                        ) : <span className="text-gray-400">#{r.product_id}</span>}
                        {r.product?.name && <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{r.product.name}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{r.customer_name}</div>
                        {r.customer_email && <div className="text-xs text-gray-500">{r.customer_email}</div>}
                        {r.is_verified && <div className="mt-1 text-xs font-medium text-green-700">{L('已购买', 'Verified buyer')}</div>}
                        {r.source && <div className="mt-1 text-xs text-gray-500">{L('录入来源', 'Source')}: {reviewSourceLabel(r.source, L)}</div>}
                        {r.order_id ? <div className="text-xs text-gray-400">{L('订单', 'Order')} #{r.order_id}</div> : null}
                      </td>
                      <td className="max-w-md px-4 py-3">
                        <Stars rating={r.rating} />
                        {r.review_title && <div className="mt-1 font-semibold text-gray-900">{r.review_title}</div>}
                        <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-gray-700">{r.review_content}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status || 'pending']}`}>
                          {statusLabel(r.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{new Date(r.created_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {r.status !== 'approved' && (
                            <button type="button" title={L('通过', 'Approve')} onClick={() => statusMutation.mutate({ ids: [r.id], next: 'approved' })} className="rounded p-1.5 text-green-700 hover:bg-green-50">
                              <CheckIcon className="h-5 w-5" />
                            </button>
                          )}
                          {r.status !== 'rejected' && (
                            <button type="button" title={L('拒绝', 'Reject')} onClick={() => statusMutation.mutate({ ids: [r.id], next: 'rejected' })} className="rounded p-1.5 text-red-600 hover:bg-red-50">
                              <XMarkIcon className="h-5 w-5" />
                            </button>
                          )}
                          <button type="button" title={L('编辑', 'Edit')} onClick={() => setEditing(r)} className="rounded p-1.5 text-gray-700 hover:bg-gray-100">
                            <PencilSquareIcon className="h-5 w-5" />
                          </button>
                          <button
                            type="button"
                            title={L('删除', 'Delete')}
                            onClick={() => {
                              if (window.confirm(L('确定删除这条评价吗？', 'Delete this review?'))) deleteMutation.mutate(r.id);
                            }}
                            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-red-600"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total_pages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm">
              <span className="text-gray-600">{L(`共 ${data.total} 条`, `${data.total} total`)} · {page}/{data.total_pages}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-50">
                  {L('上一页', 'Previous')}
                </button>
                <button type="button" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-50">
                  {L('下一页', 'Next')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {adding && (
        <AddReviewModal L={L} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); invalidate(); }} />
      )}

      {editing && (
        <EditReviewModal
          review={editing}
          L={L}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </AdminLayout>
  );
}

function EditReviewModal({
  review,
  L,
  onClose,
  onSaved,
}: {
  review: ProductReview;
  L: (zh: string, en: string) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Required<AdminReviewUpdate>>({
    customer_name: review.customer_name,
    rating: review.rating,
    review_title: review.review_title || '',
    review_content: review.review_content || '',
    status: review.status || 'pending',
    is_verified: review.is_verified,
  });
  const save = useMutation({
    mutationFn: () => ReviewService.adminUpdate(review.id, form),
    onSuccess: () => {
      toast.success(L('已保存', 'Saved'));
      onSaved();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-lg">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {L('编辑评价', 'Edit review')} {review.product?.sku ? `· ${review.product.sku}` : ''}
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('显示名称', 'Display name')}</span>
              <input value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} maxLength={100} className="block w-full rounded-md border border-gray-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('状态', 'Status')}</span>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ProductReviewStatus }))} className="block w-full rounded-md border border-gray-300 px-3 py-2">
                <option value="pending">{L('待审核', 'Pending')}</option>
                <option value="approved">{L('已通过（公开展示）', 'Approved (public)')}</option>
                <option value="rejected">{L('已拒绝', 'Rejected')}</option>
              </select>
            </label>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">{L('评分', 'Rating')}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" onClick={() => setForm((f) => ({ ...f, rating: s }))} aria-label={`${s}`}>
                  {s <= form.rating ? <StarIconSolid className="pointer-events-none h-7 w-7 text-amber-500" /> : <StarIcon className="pointer-events-none h-7 w-7 text-gray-300" />}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('标题', 'Title')}</span>
            <input value={form.review_title} onChange={(e) => setForm((f) => ({ ...f, review_title: e.target.value }))} maxLength={200} className="block w-full rounded-md border border-gray-300 px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('评价内容', 'Review text')}</span>
            <textarea value={form.review_content} onChange={(e) => setForm((f) => ({ ...f, review_content: e.target.value }))} rows={6} maxLength={3000} className="block w-full rounded-md border border-gray-300 px-3 py-2" />
          </label>
          <label className={`inline-flex flex-wrap items-center gap-2 text-sm ${review.order_id ? 'text-gray-700' : 'text-gray-400'}`}>
            <input type="checkbox" disabled={!review.order_id} checked={form.is_verified} onChange={(e) => setForm((f) => ({ ...f, is_verified: e.target.checked }))} className="rounded border-gray-300" />
            {L('显示“已购买”标记', 'Show "Verified buyer" badge')}
            {!review.order_id ? <span className="text-xs">{L('（需关联订单）', '(requires a linked order)')}</span> : null}
          </label>
          {review.customer_email && (
            <p className="text-xs text-gray-500">{L('提交人', 'Submitted by')}: {review.customer_email}{review.order_id ? ` · ${L('订单', 'Order')} #${review.order_id}` : ''}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">{L('取消', 'Cancel')}</button>
          <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-600 disabled:opacity-60">
            {save.isPending ? L('保存中...', 'Saving...') : L('保存', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
