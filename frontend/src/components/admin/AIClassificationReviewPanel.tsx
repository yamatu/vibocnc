'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  AIAgentService,
  AIClassificationReviewEvidence,
  AIClassificationReviewItem,
  AIClassificationReviewPayload,
  AIClassificationReviewStatus,
} from '@/services/ai-agent.service';
import { useAdminI18n } from '@/lib/admin-i18n';

const PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ value: AIClassificationReviewStatus | ''; label: string; labelZh: string }> = [
  { value: '', label: 'All', labelZh: '全部' },
  { value: 'needs_review', label: 'Needs review', labelZh: '待确认' },
  { value: 'conflict', label: 'Conflict', labelZh: '冲突' },
  { value: 'unresolved', label: 'Unresolved', labelZh: '无法判定' },
];

const STATUS_STYLES: Record<string, string> = {
  needs_review: 'bg-amber-100 text-amber-700',
  conflict: 'bg-rose-100 text-rose-700',
  unresolved: 'bg-gray-100 text-gray-600',
};

/**
 * The payload is either the structured review object written by the current
 * classifier or the raw evidence array written by the older pipeline. Both have
 * to stay readable or previously queued work becomes undecidable.
 */
function normalizeReview(item: AIClassificationReviewItem): {
  candidate: AIClassificationReviewPayload;
  evidence: AIClassificationReviewEvidence[];
} {
  const review = item.review;
  if (!review) return { candidate: {}, evidence: [] };
  if (Array.isArray(review)) return { candidate: {}, evidence: review };
  const evidence = Array.isArray(review.evidence) ? review.evidence : [];
  return { candidate: review, evidence };
}

function formatConfidence(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return '';
  return `${Math.round(value * 100)}%`;
}

export default function AIClassificationReviewPanel() {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const [items, setItems] = useState<AIClassificationReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<AIClassificationReviewStatus | ''>('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [openEvidenceId, setOpenEvidenceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [allowNewTypes, setAllowNewTypes] = useState(false);
  const [activateProduct, setActivateProduct] = useState(true);

  const load = useCallback(
    async (offset: number) => {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = await AIAgentService.listClassificationReview({
          limit: PAGE_SIZE,
          offset,
          status,
          search: appliedSearch,
        });
        setTotal(page.total);
        setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]));
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : zh ? '加载失败' : 'Failed to load');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [appliedSearch, status, zh]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const approve = async (item: AIClassificationReviewItem) => {
    setBusyId(item.item_id);
    try {
      const result = await AIAgentService.approveClassificationReview(item.item_id, {
        allow_new_product_types: allowNewTypes,
        activate_product: activateProduct,
      });
      toast.success(
        zh
          ? `已采纳并归类到 ${result.category_path || '现有分类'}`
          : `Approved and filed under ${result.category_path || 'an existing category'}`
      );
      setItems((current) => current.filter((entry) => entry.item_id !== item.item_id));
      setTotal((current) => Math.max(0, current - 1));
      setExpandedId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : zh ? '采纳失败' : 'Approval failed');
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (item: AIClassificationReviewItem) => {
    setBusyId(item.item_id);
    try {
      await AIAgentService.dismissClassificationReview(item.item_id);
      toast.success(zh ? '已丢弃该候选' : 'Candidate dismissed');
      setItems((current) => current.filter((entry) => entry.item_id !== item.item_id));
      setTotal((current) => Math.max(0, current - 1));
      setExpandedId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : zh ? '丢弃失败' : 'Dismiss failed');
    } finally {
      setBusyId(null);
    }
  };

  const summary = useMemo(() => {
    if (loading) return zh ? '加载中…' : 'Loading…';
    if (total === 0) return zh ? '没有待复核的分类' : 'Nothing to review';
    return zh ? `共 ${total} 条待复核` : `${total} pending`;
  }, [loading, total, zh]);

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <ClipboardDocumentCheckIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-gray-950">{zh ? '分类复核队列' : 'Classification review'}</h2>
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
            title={zh ? '刷新' : 'Refresh'}
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            aria-expanded={!collapsed}
          >
            {collapsed ? (zh ? '展开' : 'Expand') : zh ? '收起' : 'Collapse'}
            <ChevronDownIcon className={`h-3.5 w-3.5 transition ${collapsed ? '-rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-5 py-3 sm:flex-row sm:items-center">
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedSearch(search.trim());
              }}
            >
              <div className="relative flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={zh ? '搜索型号、名称或品牌' : 'Search model, name, or brand'}
                  className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                />
              </div>
              <button type="submit" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {zh ? '搜索' : 'Search'}
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value || 'all'}
                  type="button"
                  onClick={() => setStatus(filter.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    status === filter.value ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {zh ? filter.labelZh : filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-b border-gray-200 bg-white px-5 py-3">
            <p className="mb-2 text-xs text-gray-500">
              {zh
                ? '采纳会把该候选写入产品分类，并记录为已验证规则，之后相同型号会直接沿用。'
                : 'Approving writes the category and records a verified rule, so the same model is classified the same way next time.'}
            </p>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={allowNewTypes}
                  onChange={(event) => setAllowNewTypes(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                />
                {zh ? '允许新建分类类型（不推荐）' : 'Allow new product types (not recommended)'}
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={activateProduct}
                  onChange={(event) => setActivateProduct(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                />
                {zh ? '同时上架产品' : 'Publish the product as well'}
              </label>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">{zh ? '正在加载…' : 'Loading…'}</div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <CheckCircleIcon className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium text-gray-700">{zh ? '没有待复核的分类' : 'Nothing to review'}</p>
              <p className="text-xs text-gray-500">
                {zh ? 'AI 无法确认的分类会出现在这里，而不是被自动发布。' : 'Classifications the AI could not verify land here instead of being published.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((item) => {
                const { candidate, evidence } = normalizeReview(item);
                const confidence = formatConfidence(candidate.confidence);
                const expanded = expandedId === item.item_id;
                const busy = busyId === item.item_id;
                return (
                  <li key={item.item_id} className={`px-5 py-4 ${expanded ? 'bg-violet-50/40' : 'bg-white'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLES[item.classification_status] || 'bg-gray-100 text-gray-600'}`}>
                            {item.classification_status}
                          </span>
                          <strong className="truncate text-sm text-gray-950">{item.product_name || item.sku || `#${item.product_id}`}</strong>
                          {item.sku && <span className="font-mono text-xs text-gray-500">{item.sku}</span>}
                          {!item.is_active && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{zh ? '未上架' : 'Inactive'}</span>
                          )}
                        </div>
                        <p className="mt-1.5 text-xs text-gray-600">
                          <span className="font-medium text-gray-700">{zh ? '型号' : 'Model'}:</span> {item.model || '—'}
                          {item.brand && (
                            <>
                              {' · '}
                              <span className="font-medium text-gray-700">{zh ? '品牌' : 'Brand'}:</span> {item.brand}
                            </>
                          )}
                          {' · '}
                          <span className="font-medium text-gray-700">{zh ? '当前分类' : 'Category'}:</span> {item.category_path || '—'}
                        </p>
                        <p className="mt-1.5 text-xs text-gray-600">
                          <span className="font-medium text-gray-700">{zh ? '候选类型' : 'Candidate'}:</span>{' '}
                          {candidate.part_type || '—'}
                          {candidate.brand && candidate.brand !== item.brand ? ` (${candidate.brand})` : ''}
                          {confidence && <span className="ml-1 text-gray-500">{confidence}</span>}
                          {candidate.source && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{candidate.source}</span>}
                        </p>
                        {(candidate.reason || item.error) && (
                          <p className="mt-1 text-xs leading-5 text-amber-700">{candidate.reason || item.error}</p>
                        )}
                        {candidate.search_error && (
                          <p className="mt-1 text-xs leading-5 text-gray-500">
                            {zh ? '联网校验失败：' : 'Web verification failed: '}
                            {candidate.search_error}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {evidence.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpenEvidenceId(openEvidenceId === item.item_id ? null : item.item_id)}
                            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            aria-expanded={openEvidenceId === item.item_id}
                          >
                            {zh ? `证据 ${evidence.length}` : `Evidence ${evidence.length}`}
                          </button>
                        )}
                        {!expanded ? (
                          <button
                            type="button"
                            onClick={() => setExpandedId(item.item_id)}
                            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                          >
                            {zh ? '采纳…' : 'Approve…'}
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void approve(item)}
                              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                            >
                              {busy ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <CheckCircleIcon className="h-3.5 w-3.5" />}
                              {zh ? '确认采纳' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setExpandedId(null)}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {zh ? '取消' : 'Cancel'}
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void dismiss(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                        >
                          <NoSymbolIcon className="h-3.5 w-3.5" />
                          {zh ? '丢弃' : 'Dismiss'}
                        </button>
                      </div>
                    </div>

                    {openEvidenceId === item.item_id && evidence.length > 0 && (
                      <ul className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                        {evidence.map((entry, index) => (
                          <li key={`${item.item_id}-${index}`} className="text-xs">
                            {entry.url ? (
                              <a href={entry.url} target="_blank" rel="noreferrer" className="font-medium text-violet-700 hover:underline">
                                {entry.title || entry.url}
                              </a>
                            ) : (
                              <span className="font-medium text-gray-800">{entry.title || '—'}</span>
                            )}
                            {entry.snippet && <p className="mt-0.5 leading-5 text-gray-500">{entry.snippet}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && items.length > 0 && items.length < total && (
            <div className="border-t border-gray-200 px-5 py-3 text-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void load(items.length)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
                {zh ? '加载更多' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
