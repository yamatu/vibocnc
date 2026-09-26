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

/** Runs that are still making progress and therefore worth polling. */
const ACTIVE_JOB_STATUSES = ['queued', 'running', 'paused'];

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
  const [selectedForApproval, setSelectedForApproval] = useState<number[]>([]);
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

  // Surface the completion once, then refresh the draft list so the new
  // proposals appear in the table.
  useEffect(() => {
    if (!job || ACTIVE_JOB_STATUSES.includes(job.status)) return;
    if (announcedCompletion.current === job.id) return;
    announcedCompletion.current = job.id;
    if (job.status === 'completed_with_errors') {
      toast.error(`AI 审核完成但有 ${job.failed} 条失败，参见日志 / finished with ${job.failed} failures`);
    } else if (job.status === 'completed') {
      toast.success(`AI 审核完成：${job.ready} 条待批准 / ${job.ready} proposals ready`);
    }
    onReviewFinished?.();
  }, [job, onReviewFinished]);

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
            }
          : { ids: selectedIds }
      ),
    onSuccess: (created) => {
      setSelectedForApproval([]);
      announcedCompletion.current = null;
      setJobId(created.id);
      queryClient.invalidateQueries({ queryKey: ['ebay-ai-review'] });
      queryClient.invalidateQueries({ queryKey: ['ebay-import-drafts'] });
      toast.success(`已开始 AI 审核 ${created.total} 条草稿 / reviewing ${created.total} drafts`);
    },
    onError: (error: Error) => toast.error(error.message || 'AI 审核启动失败'),
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
      queryClient.invalidateQueries({ queryKey: ['ebay-import-drafts'] });
    },
    onError: (error: Error) => toast.error(error.message || '操作失败'),
  });

  const approveMutation = useMutation({
    mutationFn: () => EbayImportDraftService.approveAIReview(selectedForApproval),
    onSuccess: () => {
      toast.success('已开始上架，完成后产品会出现在商品列表 / publishing started');
      setSelectedForApproval([]);
      queryClient.invalidateQueries({ queryKey: ['ebay-import-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['ebay-ai-review'] });
      onApproved?.();
    },
    onError: (error: Error) => toast.error(error.message || '上架失败'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => EbayImportDraftService.rejectAIReview(selectedForApproval, '管理员拒绝 / rejected by admin'),
    onSuccess: (result) => {
      toast.success(`已拒绝 ${result.rejected} 条提案 / rejected ${result.rejected}`);
      setSelectedForApproval([]);
      queryClient.invalidateQueries({ queryKey: ['ebay-import-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['ebay-ai-review'] });
    },
    onError: (error: Error) => toast.error(error.message || '拒绝失败'),
  });

  /** Draft ids that produced a usable proposal, in log order. */
  const readyDraftIds = useMemo(
    () => items.filter((item) => item.status === 'ready').map((item) => item.draft_id),
    [items]
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
            描述与 SEO。生成的方案处于<strong>待批准</strong>状态，只有你勾选后才会真正上架。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
              <span className="text-emerald-700">待批准 {job.ready}</span>
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

          {readyDraftIds.length > 0 && (
            <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-emerald-900">
                  {readyDraftIds.length} 条草稿已生成待批准方案
                  {selectedForApproval.length > 0 && `，已选 ${selectedForApproval.length} 条`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedForApproval(readyDraftIds)}
                    className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs hover:bg-emerald-50"
                  >
                    全选待批准
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedForApproval([])}
                    className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    清空选择
                  </button>
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
                {items
                  .filter((item) => item.status === 'ready')
                  .map((item) => (
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
