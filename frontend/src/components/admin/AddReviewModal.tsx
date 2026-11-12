'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { StarIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { REVIEW_SOURCES, ReviewService, type AdminReviewCreate } from '@/services/review.service';
import { ProductService } from '@/services/product.service';
import type { ProductReviewStatus } from '@/types';

type Translate = (zh: string, en: string) => string;

const SOURCE_LABELS: Record<string, [string, string]> = {
  email: ['邮件', 'Email'],
  ebay: ['eBay', 'eBay'],
  whatsapp: ['WhatsApp', 'WhatsApp'],
  phone: ['电话', 'Phone'],
  offline: ['线下订单', 'Offline order'],
  other: ['其他渠道', 'Other'],
};

export function reviewSourceLabel(source: string, L: Translate) {
  const pair = SOURCE_LABELS[source];
  return pair ? L(pair[0], pair[1]) : source;
}

export default function AddReviewModal({ L, onClose, onSaved }: { L: Translate; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Required<AdminReviewCreate>>({
    sku: '',
    customer_name: '',
    rating: 5,
    review_title: '',
    review_content: '',
    source: 'email',
    order_number: '',
    status: 'approved',
    review_date: '',
  });
  const [productName, setProductName] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState('');
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const hasOrder = form.order_number.trim() !== '';

  const lookup = async () => {
    const sku = form.sku.trim();
    setProductName(null);
    setLookupError('');
    if (!sku) return;
    try {
      const product = await ProductService.getProductBySku(sku);
      if (product?.sku) {
        setForm((f) => ({ ...f, sku: product.sku }));
        setProductName(product.name);
        return;
      }
    } catch {
      // handled below
    }
    setLookupError(L('未找到该 SKU 的商品', 'No product with this SKU'));
  };

  const save = useMutation({
    mutationFn: () => ReviewService.adminCreate({ ...form, source: hasOrder ? '' : form.source }),
    onSuccess: () => {
      toast.success(L('评价已录入', 'Feedback added'));
      onSaved();
    },
  });

  const input = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm';
  const today = new Date().toISOString().slice(0, 10);
  const canSave = form.sku.trim() && form.customer_name.trim() && form.review_content.trim().length >= 10;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{L('录入客户评价', 'Add customer feedback')}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label={L('关闭', 'Close')}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <p className="rounded-md bg-blue-50 p-3 text-xs leading-5 text-blue-900">
            {L(
              '用于录入客户通过邮件、eBay、WhatsApp 等渠道给出的真实反馈。填写订单号并匹配到包含该商品的订单时会显示“已购买”；否则会在评价旁标注来源，且不计入 Google 结构化评分。',
              'Record genuine feedback a customer gave by email, eBay, WhatsApp, etc. With a matching order number it shows "Verified buyer"; otherwise the source is shown next to the review and it is excluded from Google rich results.',
            )}
          </p>
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">{L('商品 SKU', 'Product SKU')}</span>
            <div className="flex gap-2">
              <input
                value={form.sku}
                onChange={(e) => { set('sku', e.target.value); setProductName(null); }}
                onBlur={lookup}
                className={input}
                placeholder="A06B-6089-H105"
              />
              <button type="button" onClick={lookup} className="shrink-0 rounded-md border border-gray-300 px-3 text-sm hover:bg-gray-50">{L('查找', 'Find')}</button>
            </div>
            {productName ? <p className="mt-1 text-xs text-green-700">✓ {productName}</p> : null}
            {lookupError ? <p className="mt-1 text-xs text-red-600">{lookupError}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('客户显示名称', 'Customer display name')}</span>
              <input value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} maxLength={100} className={input} placeholder="John D." />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('评价日期', 'Feedback date')}</span>
              <input type="date" max={today} value={form.review_date} onChange={(e) => set('review_date', e.target.value)} className={input} />
            </label>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">{L('评分', 'Rating')}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" onClick={() => set('rating', s)} aria-label={`${s}`}>
                  {s <= form.rating
                    ? <StarIconSolid className="pointer-events-none h-7 w-7 text-amber-500" />
                    : <StarIcon className="pointer-events-none h-7 w-7 text-gray-300" />}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('标题（可选）', 'Title (optional)')}</span>
            <input value={form.review_title} onChange={(e) => set('review_title', e.target.value)} maxLength={200} className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('评价内容（客户原话）', 'Review text (customer’s words)')}</span>
            <textarea rows={4} value={form.review_content} onChange={(e) => set('review_content', e.target.value)} maxLength={3000} className={input} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('关联订单号（可选）', 'Order number (optional)')}</span>
              <input value={form.order_number} onChange={(e) => set('order_number', e.target.value)} className={input} placeholder="ORD-..." />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('反馈来源', 'Feedback source')}</span>
              <select
                value={form.source}
                disabled={hasOrder}
                onChange={(e) => set('source', e.target.value as typeof form.source)}
                className={`${input} disabled:bg-gray-100`}
              >
                {REVIEW_SOURCES.map((src) => <option key={src} value={src}>{reviewSourceLabel(src, L)}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('状态', 'Status')}</span>
            <select value={form.status} onChange={(e) => set('status', e.target.value as ProductReviewStatus)} className={input}>
              <option value="approved">{L('直接通过（公开展示）', 'Approved (public)')}</option>
              <option value="pending">{L('待审核', 'Pending')}</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">{L('取消', 'Cancel')}</button>
          <button
            type="button"
            disabled={save.isPending || !canSave}
            onClick={() => save.mutate()}
            className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-600 disabled:opacity-60"
          >
            {save.isPending ? L('保存中...', 'Saving...') : L('保存', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
