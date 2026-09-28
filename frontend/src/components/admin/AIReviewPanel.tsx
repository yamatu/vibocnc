'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  StopIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { EbayImportDraftService } from '@/services';
import type { EbayDraftReviewJobItem, EbayDraftReviewJobSnapshot } from '@/services';
import { getErrorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/react-query';

/** Runs that are still making progress and therefore worth polling. */
const ACTIVE_JOB_STATUSES = ['queued', 'running', 'paused'];

/**
 * Page sizes for the proposal list. They match the drafts list so the two
 * selectors stay in step, and the server caps at 200 regardless.
 */
const READY_PAGE_SIZES = [50, 100, 200];

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '处理中',
  paused: '已暂停',
  completed: '已完成',
  completed_with_errors: '完成（部分失败）',
  failed: '失败',
  cancelled: '已取消',
};

/** Log line styling. A rejection is a normal outcome, a failure is not. */
const LEVEL_CLASSES: Record<string, string> = {
  info: 'text-slate-600',
  success: 'text-emerald-700',
  warn: 'text-amber-700',
  error: 'text-red-700',
};

const LEVEL_ICONS: Record<string, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  warn: XCircleIcon,
  error: XCircleIcon,
};

interface AIReviewPanelProps {
  /** Draft ids the admin has selected, used to scope a review pass. */
  selectedIds: number[];
  /** Active list filters, so "review everything matching" is possible. */
  filters: {
    search?: string;
    status?: string;
    match_status?: string;
    brand?: string;
    source_site?: string;
    /**
     * Carried so a review pass started from a filtered view targets the same
     * rows the admin is looking at (notably `unreviewed`).
     */
    ai_review_status?: string;
  };
  /** Called after proposals are approved, so the list can refresh. */
  onApproved?: () => void;
  /** Called whenever a pass finishes, so the list can refresh its proposal column. */
  onReviewFinished?: () => void;
}

/**
 * The automated review panel.
 *
 * One component owns the whole loop: start a pass over the selected drafts (or
 * everything matching the filter), watch it as a log, then approve the rows that
 * passed. Keeping it together means the "what did the AI decide" question is
 * answered in the same place as "publish it".
 */
export default function AIReviewPanel({
  selectedIds,
  filters,
  onApproved,
  onReviewFinished,
}: AIReviewPanelProps) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [reviewAllFiltered, setReviewAllFiltered] = useState(false);
  // Off by default. Publishing creates indexed product pages, so it is a
  // deliberate choice rather than something the review button does implicitly.
  const [includeImages, setIncludeImages] = useState(false);
  const [categoryMode, setCategoryMode] = useState<'source' | 'mixed'>('source');
  const autoPublish = false; // This screen only optimizes; publishing is always manual.
  const [selectedForApproval, setSelectedForApproval] = useState<number[]>([]);
  // The proposal list is paged independently of the log. A run over tens of
  // thousands of drafts produces far more ready rows than one page can hold, and
  // rendering them all made the list unusable (and the response enormous).
  const [readyPage, setReadyPage] = useState(1);
  const [readyPageSize, setReadyPageSize] = useState(100);
  const logRef = useRef<HTMLDivElement | null>(null);
  const announcedCompletion = useRef<string | null>(null);

  // Reconnect to a run already in flight. A reload during a long pass must not
  // hide the job.
  const latestQuery = useQuery({
    queryKey: ['ebay-ai-review', 'latest'],
    queryFn: () => EbayImportDraftService.getLatestAIReviewJob(),
    staleTime: 0,
  });

  useEffect(() => {
    if (!jobId && latestQuery.data?.job && ACTIVE_JOB_STATUSES.includes(latestQuery.data.job.status)) {
      setJobId(latestQuery.data.job.id);
    }
  }, [jobId, latestQuery.data]);

  const jobQuery = useQuery({
    queryKey: ['ebay-ai-review', jobId],
    queryFn: () => EbayImportDraftService.getAIReviewJob(jobId as string),
    enabled: Boolean(jobId),
    // Poll while the pass is live and stop once it settles, so an idle page is
    // not making a request every three seconds forever.
    refetchInterval: (query) => {
      const status = (query.state.data as EbayDraftReviewJobSnapshot | undefined)?.job?.status;
      return status && ACTIVE_JOB_STATUSES.includes(status) ? 3000 : false;
    },
  });

  const job = jobQuery.data?.job;
  const items = useMemo(() => jobQuery.data?.items ?? [], [jobQuery.data]);

  // The proposal list is its own query so paging never refetches the log and a
  // 10k-row job does not have to be shipped to the browser to see 100 rows.
  const readyQuery = useQuery({
    queryKey: ['ebay-ai-review', jobId, 'ready', readyPage, readyPageSize],
    queryFn: () =>
      EbayImportDraftService.getAIReviewJobItems(jobId as string, {
        status: 'ready',
        page: readyPage,
        pageSize: readyPageSize,
      }),
    enabled: Boolean(jobId),
    staleTime: 0,
  });

  // A new pass replaces the proposals, so paging must restart rather than land on
  // a page that no longer exists.
  useEffect(() => {
    setReadyPage(1);
    setSelectedForApproval([]);
  }, [jobId]);

  const readyItems = readyQuery.data?.items ?? [];
  const readyTotal = readyQuery.data?.total ?? job?.ready ?? 0;
  const readyPageCount = Math.max(1, Math.ceil(readyTotal / readyPageSize));

  // Surface the completion once, then refresh the draft list so the new
  // proposals appear in the table.
  useEffect(() => {
    if (!job || ACTIVE_JOB_STATUSES.includes(job.status)) return;
    if (announcedCompletion.current === job.id) return;
    announcedCompletion.current = job.id;
    if (job.status === 'completed_with_errors') {
      toast.error(`AI 审核完成但有 ${job.failed} 条失败，参见日志 / finished with ${job.failed} failures`);
    } else if (job.status === 'completed') {
      // An auto-publishing run publishes rather than queueing, so reporting a
      // pending count would describe work that no longer exists.
      toast.success(
        job.auto_publish
          ? `AI 审核完成：已上架 ${job.imported ?? 0} 条 / published ${job.imported ?? 0}`
          : `AI 审核完成：${job.ready} 条待批准 / ${job.ready} proposals ready`
      );
    }
    onReviewFinished?.();
  }, [job, onReviewFinished]);

  useEffect(() => {
    if (!job?.processed) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.all() });
  }, [job?.id, job?.processed, queryClient]);

  // Keep the newest log line in view, the way a terminal behaves.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [items.length, job?.processed]);

  const startMutation = useMutation({
    mutationFn: () =>
      EbayImportDraftService.startAIReview(
        reviewAllFiltered || selectedIds.length === 0
          ? {
              all_filtered: true,
              search: filters.search,
              status: filters.status,
              match_status: filters.match_status,
              brand: filters.brand,
              ai_review_status: filters.ai_review_status,
              source_site: filters.source_site,
              category_mode: categoryMode,
              auto_publish: autoPublish,
            }
          : { ids: selectedIds, auto_publish: autoPublish, category_mode: categoryMode, source_site: filters.source_site }
      ),
    onSuccess: (created) => {
      setSelectedForApproval([]);
      announcedCompletion.current = null;
      setJobId(created.id);
      queryClient.invalidateQueries({ queryKey: ['ebay-ai-review'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.all() });
      toast.success(
        autoPublish
          ? `已开始 AI 审核并自动上架 ${created.total} 条草稿 / reviewing and publishing ${created.total} drafts`
          : `已开始 AI 审核 ${created.total} 条草稿 / reviewing ${created.total} drafts`
      );
    },
    // `error.message` on a rejected request is axios' own "Request failed with
    // status code 409", which hides the server's explanation. getErrorMessage
    // reads the response body, where the reason a selection was refused lives.
    onError: (error) => toast.error(getErrorMessage(error, 'AI 审核启动失败 / failed to start AI review')),
  });

  const controlMutation = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'cancel') => {
      if (!jobId) throw new Error('没有正在运行的审核任务');
      if (action === 'pause') return EbayImportDraftService.pauseAIReviewJob(jobId);
      if (action === 'resume') return EbayImportDraftService.resumeAIReviewJob(jobId);
      return EbayImportDraftService.cancelAIReviewJob(jobId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay-ai-review', jobId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.all() });
    },
    onError: (error) => toast.error(getErrorMessage(error, '操作失败 / action failed')),
  });

  const approveMutation = useMutation({
    mutationFn: () => EbayImportDraftService.approveAIReview(selectedForApproval, undefined, includeImages),
    onSuccess: () => {
      toast.success('已开始上架，完成后产品会出现在商品列表 / publishing started');
      setSelectedForApproval([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.all() });
      queryClient.invalidateQueries({ queryKey: ['ebay-ai-review'] });
      onApproved?.();
    },
    onError: (error) => toast.error(getErrorMessage(error, '上架失败 / approval failed')),
  });

  const approveAllNewMutation = useMutation({
    mutationFn: () => EbayImportDraftService.approveAIReview([], undefined, false, {
      allReadyNewUnique: true,
      sourceSite: filters.source_site,
      categoryMode,
    }),
    onSuccess: () => {
      toast.success('AI 已优化新品正在一键上架（不含来源图片） / optimized new products are publishing');
      queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.all() });
      onApproved?.();
    },
    onError: (error) => toast.error(getErrorMessage(error, 'AI 新品一键上架失败 / publish failed')),
  });

  const rejectMutation = useMutation({
    mutationFn: () => EbayImportDraftService.rejectAIReview(selectedForApproval, '管理员拒绝 / rejected by admin'),
    onSuccess: (result) => {
      toast.success(`已拒绝 ${result.rejected} 条提案 / rejected ${result.rejected}`);
      setSelectedForApproval([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.all() });
      queryClient.invalidateQueries({ queryKey: ['ebay-ai-review'] });
    },
    onError: (error) => toast.error(getErrorMessage(error, '拒绝失败 / rejection failed')),
  });

  /** Draft ids on the current page that produced a usable proposal. */
  const readyDraftIds = useMemo(
    () => readyItems.filter((item) => item.status === 'ready').map((item) => item.draft_id),
    [readyItems]
  );

  const toggleApproval = (draftId: number) => {
    setSelectedForApproval((current) =>
      current.includes(draftId) ? current.filter((id) => id !== draftId) : [...current, draftId]
    );
  };

  const isActive = Boolean(job && ACTIVE_JOB_STATUSES.includes(job.status));
  const progressPct = job && job.total > 0 ? Math.min(100, (job.processed / job.total) * 100) : 0;

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <SparklesIcon className="h-5 w-5 text-indigo-600" />
            AI 自动审核
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-600">
            AI 会识别每个草稿的产品身份、自动匹配或新建「品牌 &gt; 部件类型」分类、生成标题、
            描述与 SEO。默认生成<strong>待批准</strong>方案，由你勾选后上架；
            勾选下方「直接上架」则可一次跑完识别与发布。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            分类来源
            <select value={categoryMode} onChange={(event) => setCategoryMode(event.target.value as 'source' | 'mixed')} className="rounded border border-gray-300 bg-white px-2 py-1.5">
              <option value="source">按 eBay / B-Automation 来源分类</option>
              <option value="mixed">混合品牌 + 部件类型分类</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('确定把所有 AI 已优化且判定为新品的草稿一键上架吗？默认不带来源图片。')) approveAllNewMutation.mutate();
            }}
            disabled={approveAllNewMutation.isPending || isActive}
            className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            <CheckCircleIcon className="h-4 w-4" />
            {approveAllNewMutation.isPending ? '上架中...' : 'AI 新品一键上架（无图）'}
          </button>
          <button
            type="button"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending || isActive}
            className="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <SparklesIcon className="h-4 w-4" />
            {selectedIds.length > 0 && !reviewAllFiltered
              ? `审核选中的 ${selectedIds.length} 条`
              : reviewAllFiltered
                ? '审核全部筛选结果'
                : '审核全部待处理'}
            {autoPublish ? '并上架' : ''}
          </button>
          {isActive && (
            <>
              {job?.status === 'paused' ? (
                <button
                  type="button"
                  onClick={() => controlMutation.mutate('resume')}
                  disabled={controlMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <PlayIcon className="h-4 w-4" /> 继续
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => controlMutation.mutate('pause')}
                  disabled={controlMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <PauseIcon className="h-4 w-4" /> 暂停
                </button>
              )}
              <button
                type="button"
                onClick={() => controlMutation.mutate('cancel')}
                disabled={controlMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <StopIcon className="h-4 w-4" /> 停止
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scoping: the admin must be able to tell whether this reviews their
          selection or the whole filtered backlog before clicking. */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-700">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={reviewAllFiltered}
            onChange={(event) => setReviewAllFiltered(event.target.checked)}
            className="h-3.5 w-3.5"
          />
          审核当前筛选条件下的<strong>全部</strong>草稿（忽略选择）
        </label>
        <span className="text-gray-500">
          未勾选时只审核你选中的 {selectedIds.length} 条；没有选择则审核全部待处理草稿。
        </span>
      </div>

      <div className="mt-2 text-xs text-emerald-700">
        自动优化标题、描述和 SEO；匹配已有分类，没有合适分类时自动创建。完成后仅保存草稿，最后由你手动上架。
      </div>

      {job && (
        <div className="mt-4 rounded border border-gray-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  job.status === 'failed' || job.status === 'completed_with_errors'
                    ? 'bg-red-100 text-red-800'
                    : job.status === 'paused'
                      ? 'bg-amber-100 text-amber-800'
                      : isActive
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {JOB_STATUS_LABELS[job.status] || job.status}
              </span>
              <span className="text-xs text-gray-500">任务 {job.id.slice(0, 8)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {job.auto_publish ? (
                <span className="text-emerald-700">已上架 {job.imported ?? 0}</span>
              ) : (
                <span className="text-emerald-700">待批准 {job.ready}</span>
              )}
              {(job.import_failed ?? 0) > 0 && (
                <span className="text-red-700">上架失败 {job.import_failed}</span>
              )}
              <span className="text-amber-700">跳过 {job.rejected}</span>
              {job.failed > 0 && <span className="text-red-700">失败 {job.failed}</span>}
              <span className="text-gray-500">
                {job.processed}/{job.total}
              </span>
              <button
                type="button"
                onClick={() => jobQuery.refetch()}
                className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800"
              >
                <ArrowPathIcon className={`h-3.5 w-3.5 ${jobQuery.isFetching ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
          </div>

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-gray-100">
            <div
              className={`h-full transition-[width] duration-300 ${
                job.status === 'failed' || job.status === 'completed_with_errors'
                  ? 'bg-red-500'
                  : job.status === 'paused'
                    ? 'bg-amber-500'
                    : 'bg-indigo-600'
              }`}
              style={{ width: `${Math.max(2, progressPct)}%` }}
            />
          </div>
          {job.stage && <p className="mt-1.5 text-xs text-gray-500">{job.stage}</p>}
          {job.message && <p className="mt-0.5 text-xs text-gray-600">{job.message}</p>}

          {/* The log. A failed run must be diagnosable without server access, so
              per-item reasons are rendered inline rather than counted. */}
          <div
            ref={logRef}
            className="mt-3 max-h-64 overflow-y-auto rounded bg-slate-900 p-2 font-mono text-xs leading-relaxed"
          >
            {items.length === 0 && <p className="text-slate-400">等待任务输出…</p>}
            {items.map((item) => (
              <LogLine key={item.id} item={item} />
            ))}
          </div>

          {(readyTotal > 0 || readyDraftIds.length > 0) && (
            <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-emerald-900">
                  共 {readyTotal} 条草稿已生成待批准方案
                  {selectedForApproval.length > 0 && `，已选 ${selectedForApproval.length} 条`}
                  {readyPageCount > 1 && `（第 ${readyPage} / ${readyPageCount} 页）`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedForApproval((current) =>
                        Array.from(new Set([...current, ...readyDraftIds]))
                      )
                    }
                    className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs hover:bg-emerald-50"
                  >
                    本页全选
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedForApproval([])}
                    className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    清空选择
                  </button>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} disabled={approveMutation.isPending} />上架时使用来源图片（可关闭避开水印）</label>
                  <button
                    type="button"
                    onClick={() => approveMutation.mutate()}
                    disabled={selectedForApproval.length === 0 || approveMutation.isPending}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    上架选中的 {selectedForApproval.length} 条
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectMutation.mutate()}
                    disabled={selectedForApproval.length === 0 || rejectMutation.isPending}
                    className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    拒绝
                  </button>
                </div>
              </div>

              {/* Approving publishes products, so the consequence is spelled out
                  before the click rather than after. */}
              <ul className="mt-2 grid gap-1 text-xs text-emerald-900 sm:grid-cols-2">
                {readyItems.map((item) => (
                  <li key={item.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedForApproval.includes(item.draft_id)}
                      onChange={() => toggleApproval(item.draft_id)}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{item.model || `#${item.draft_id}`}</span>
                      <span className="block truncate text-emerald-800">{item.title}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {readyItems.length === 0 && (
                <p className="mt-2 text-xs text-emerald-800">
                  {readyQuery.isLoading ? '正在加载待批准列表…' : '本页没有待批准草稿'}
                </p>
              )}

              {/* Paging controls live with the list they page, and a page size
                  choice keeps a large queue workable instead of rendering every
                  proposal at once. */}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-emerald-900">
                <button
                  type="button"
                  onClick={() => setReadyPage((page) => Math.max(1, page - 1))}
                  disabled={readyPage <= 1}
                  className="rounded border border-emerald-300 bg-white px-2 py-1 hover:bg-emerald-50 disabled:opacity-40"
                >
                  上一页
                </button>
                <span>
                  {readyPage} / {readyPageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setReadyPage((page) => Math.min(readyPageCount, page + 1))}
                  disabled={readyPage >= readyPageCount}
                  className="rounded border border-emerald-300 bg-white px-2 py-1 hover:bg-emerald-50 disabled:opacity-40"
                >
                  下一页
                </button>
                <label className="ml-2 flex items-center gap-1">
                  每页
                  <select
                    value={readyPageSize}
                    onChange={(event) => {
                      setReadyPageSize(Number(event.target.value));
                      setReadyPage(1);
                    }}
                    className="rounded border border-emerald-300 bg-white px-1.5 py-1"
                  >
                    {READY_PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  条
                </label>
                {readyQuery.isError && (
                  <span className="text-red-700">
                    {getErrorMessage(readyQuery.error, '待批准列表加载失败')}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-emerald-800">
                上架会创建或更新商品页面，并沿用草稿中的 eBay 采集价格。
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function LogLine({ item }: { item: EbayDraftReviewJobItem }) {
  const Icon = LEVEL_ICONS[item.level];
  const time = new Date(item.updated_at || item.created_at);
  const timeLabel = Number.isNaN(time.getTime())
    ? '--:--:--'
    : time.toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <p className={`flex items-start gap-2 ${LEVEL_CLASSES[item.level] || LEVEL_CLASSES.info}`}>
      <span className="shrink-0 text-slate-500">{timeLabel}</span>
      {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 break-words">
        {item.model && <span className="text-slate-300">[{item.model}] </span>}
        {item.message}
        {item.error && <span className="text-red-400"> — {item.error}</span>}
      </span>
    </p>
  );
}
