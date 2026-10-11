'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  RocketLaunchIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  AIAgentService,
  AIOptimizedInactiveProduct,
  AIOptimizedInactivePage,
} from '@/services/ai-agent.service';
import { useAdminI18n } from '@/lib/admin-i18n';

const PAGE_SIZE = 20;

/**
 * Products the pipeline already rewrote but that are still hidden. Optimising
 * a product deliberately leaves it inactive until the content has been
 * reviewed, which used to mean enabling them one by one in the product list.
 */
export default function AIOptimizedPendingPanel({
  onPublished,
}: {
  onPublished?: (published: number) => void;
}) {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const [page, setPage] = useState<AIOptimizedInactivePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    setError('');
    try {
      const result = await AIAgentService.listOptimizedInactive({ limit: PAGE_SIZE, offset });
      setPage(result);
      setSelectedIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? '加载失败' : 'Loading failed');
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    void load(0);
  }, [load]);

  const items = useMemo(() => page?.items || [], [page]);

  const toggle = (id: number) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  };

  /**
   * Publish the selection, or everything still hidden when nothing is picked.
   * The backend caps each call, so an unlimited run is a loop that reports
   * progress instead of one request that could time out.
   */
  const publish = async (explicitIds?: number[]) => {
    const useIds = explicitIds && explicitIds.length > 0 ? explicitIds : undefined;
    if (!useIds && (page?.total || 0) === 0) return;
    const label = useIds ? useIds.length : page?.total || 0;
    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(
          zh
            ? `将上架 ${label.toLocaleString()} 个 AI 已优化但未启用的产品，前台立即可见。继续？`
            : `Publish ${label.toLocaleString()} optimised products? They become visible on the storefront immediately.`
        );
    if (!confirmed) return;

    setPublishing(true);
    let published = 0;
    try {
      if (useIds) {
        const result = await AIAgentService.publishOptimizedProducts({ product_ids: useIds });
        published = result.published;
      } else {
        // Bound the loop so a stuck row cannot spin forever.
        for (let round = 0; round < 200; round += 1) {
          const result = await AIAgentService.publishOptimizedProducts({});
          published += result.published;
          if (result.published === 0 || result.remaining === 0) break;
        }
      }
      toast.success(
        zh ? `已上架 ${published.toLocaleString()} 个产品` : `Published ${published.toLocaleString()} products`
      );
      onPublished?.(published);
      await load(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : zh ? '上架失败' : 'Publishing failed');
    } finally {
      setPublishing(false);
    }
  };

  const summary = loading
    ? zh ? '加载中…' : 'Loading…'
    : (page?.total || 0) === 0
      ? zh ? '没有已优化但未启用的产品' : 'Nothing waiting to be published'
      : zh ? `共 ${page?.total.toLocaleString()} 个已优化但未启用` : `${page?.total.toLocaleString()} optimised but hidden`;

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <SparklesIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-gray-950">{zh ? 'AI 已优化 · 待上架' : 'Optimised · ready to publish'}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load(0)}
            disabled={loading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 disabled:opacity-40"
            aria-label={zh ? '刷新' : 'Refresh'}
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {collapsed ? (zh ? '展开' : 'Expand') : zh ? '收起' : 'Collapse'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-emerald-50/60 px-5 py-3">
            <span className="text-xs text-gray-600">
              {zh
                ? '这些内容已经由 AI 写好，上架后立即在前台展示。可单选，也可一次上架全部。'
                : 'The AI has already written this content. Publishing makes it live. Pick rows, or publish everything at once.'}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={publishing || selectedIds.length === 0}
                onClick={() => void publish(selectedIds)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <RocketLaunchIcon className="h-3.5 w-3.5" />}
                {zh ? `上架选中（${selectedIds.length}）` : `Publish selected (${selectedIds.length})`}
              </button>
              <button
                type="button"
                disabled={publishing || (page?.total || 0) === 0}
                onClick={() => void publish()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <RocketLaunchIcon className="h-3.5 w-3.5" />}
                {zh ? `一键上架全部（${(page?.total || 0).toLocaleString()}）` : `Publish all (${(page?.total || 0).toLocaleString()})`}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading && !page ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">{zh ? '正在加载…' : 'Loading…'}</div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <CheckCircleIcon className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium text-gray-700">
                {zh ? '全部已上架' : 'Everything is published'}
              </p>
              <p className="text-xs text-gray-500">
                {zh ? 'AI 优化完成后仍未启用的产品会出现在这里。' : 'Products the AI finished but that are still hidden appear here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={items.length > 0 && selectedIds.length === items.length}
                        onChange={(event) => setSelectedIds(event.target.checked ? items.map((item) => item.id) : [])}
                        aria-label={zh ? '选择本页全部' : 'Select all on this page'}
                        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </th>
                    <th className="px-4 py-3">{zh ? '产品' : 'Product'}</th>
                    <th className="px-4 py-3">{zh ? '品牌 / 型号' : 'Brand / model'}</th>
                    <th className="px-4 py-3">{zh ? '最后更新' : 'Updated'}</th>
                    <th className="px-4 py-3">{zh ? '操作' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {items.map((item: AIOptimizedInactiveProduct) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggle(item.id)}
                          aria-label={zh ? '选择该产品' : 'Select this product'}
                          className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="max-w-md px-4 py-3">
                        <Link href={`/admin/products/${item.id}/edit`} className="font-medium text-gray-900 hover:text-emerald-700">
                          {item.name || item.sku}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-gray-500">{item.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <div>{item.brand || '—'}</div>
                        <div className="font-mono text-xs text-gray-500">{item.model || '—'}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {item.updated_at ? new Date(item.updated_at).toLocaleString() : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          type="button"
                          disabled={publishing}
                          onClick={() => void publish([item.id])}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {zh ? '上架' : 'Publish'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {page && page.total > page.limit && (
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                type="button"
                onClick={() => void load(Math.max(0, page.offset - page.limit))}
                disabled={loading || page.offset === 0}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {zh ? '上一页' : 'Previous'}
              </button>
              <button
                type="button"
                onClick={() => void load(page.offset + page.limit)}
                disabled={loading || page.offset + page.limit >= page.total}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {zh ? '下一页' : 'Next'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
