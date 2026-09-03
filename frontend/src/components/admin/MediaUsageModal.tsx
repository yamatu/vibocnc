'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowTopRightOnSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';

import { MediaService } from '@/services';
import type { MediaAsset } from '@/services/media.service';

interface MediaUsageModalProps {
  asset: MediaAsset;
  locale: 'zh' | 'en';
  onClose: () => void;
}

export default function MediaUsageModal({ asset, locale, onClose }: MediaUsageModalProps) {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, isLoading, error } = useQuery({
    queryKey: ['media', asset.id, 'products', page],
    queryFn: () => MediaService.getProductsUsingMedia(asset.id, page, pageSize),
    retry: 1,
  });

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 py-8">
        <button type="button" aria-label="Close" className="fixed inset-0 bg-slate-950/70" onClick={onClose} />
        <div className="relative w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-slate-900">{locale === 'zh' ? '使用此图片的产品' : 'Products using this image'}</h3>
              <p className="mt-0.5 truncate text-xs text-slate-500" title={asset.original_name}>{asset.original_name}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><XMarkIcon className="h-5 w-5" /></button>
          </div>

          <div className="max-h-[65vh] overflow-auto p-5">
            {isLoading && <div className="py-12 text-center text-sm text-slate-500">{locale === 'zh' ? '正在查找产品...' : 'Finding products...'}</div>}
            {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error instanceof Error ? error.message : (locale === 'zh' ? '查询失败' : 'Lookup failed')}</div>}
            {!isLoading && !error && data?.total === 0 && <div className="py-12 text-center text-sm text-slate-500">{locale === 'zh' ? '当前没有产品使用这张图片' : 'No products currently use this image'}</div>}
            {data && data.items.length > 0 && (
              <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
                {data.items.map(product => (
                  <div key={product.product_id} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-slate-900">{product.sku}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${product.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                          {product.is_active ? (locale === 'zh' ? '启用' : 'Active') : (locale === 'zh' ? '未启用' : 'Inactive')}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-slate-600" title={product.name}>{product.name}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{product.brand}</div>
                    </div>
                    <Link href={`/admin/products/${product.product_id}/edit`} className="inline-flex shrink-0 items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                      {locale === 'zh' ? '打开产品' : 'Open product'}
                      <ArrowTopRightOnSquareIcon className="ml-1.5 h-4 w-4" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
            {data && data.total > pageSize && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {locale === 'zh' ? `共 ${data.total.toLocaleString()} 个产品，第 ${data.page} 页` : `${data.total.toLocaleString()} products, page ${data.page}`}
                </p>
                <div className="flex gap-2">
                  <button type="button" disabled={page <= 1 || isLoading} onClick={() => setPage(current => Math.max(1, current - 1))} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40">
                    {locale === 'zh' ? '上一页' : 'Previous'}
                  </button>
                  <button type="button" disabled={page * pageSize >= data.total || isLoading} onClick={() => setPage(current => current + 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40">
                    {locale === 'zh' ? '下一页' : 'Next'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
