'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  StopIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import AdminLayout from '@/components/admin/AdminLayout';
import {
  AIAgentService,
  type AIAgentSEOItemStatus,
  type AIAgentSEOJob,
  type AIAgentSEOJobItemsPage,
} from '@/services/ai-agent.service';
import { AIListingService } from '@/services/ai-listing.service';
import { getErrorMessage } from '@/lib/errors';
import { useAdminI18n } from '@/lib/admin-i18n';
import { useAuth } from '@/hooks/useAuth';

const JOB_ITEM_PAGE_SIZE = 100;
const ACTIVE_STATUSES: AIAgentSEOJob['status'][] = ['queued', 'running', 'paused'];

type JobTab = 'all' | 'active' | 'finished';

const STATUS_META: Record<AIAgentSEOJob['status'], { zh: string; en: string; style: string }> = {
  queued: { zh: '排队中', en: 'Queued', style: 'bg-slate-100 text-slate-700' },
  running: { zh: '运行中', en: 'Running', style: 'bg-violet-100 text-violet-800' },
  paused: { zh: '已暂停', en: 'Paused', style: 'bg-orange-100 text-orange-800' },
  cancelled: { zh: '已结束', en: 'Ended', style: 'bg-slate-200 text-slate-700' },
  completed: { zh: '已完成', en: 'Completed', style: 'bg-emerald-100 text-emerald-800' },
  completed_with_errors: { zh: '完成（有失败）', en: 'Completed with errors', style: 'bg-amber-100 text-amber-800' },
  failed: { zh: '任务失败', en: 'Failed', style: 'bg-rose-100 text-rose-800' },
};

const JOB_TYPE_META: Record<AIAgentSEOJob['selection_mode'], { zh: string; en: string; style: string }> = {
  listing_optimization: { zh: 'AI 智能优化', en: 'AI listing', style: 'bg-violet-100 text-violet-900' },
  category_optimization: { zh: '自动分类', en: 'Auto category', style: 'bg-cyan-100 text-cyan-900' },
  auto_failed: { zh: '失败重试', en: 'Failed retry', style: 'bg-rose-100 text-rose-800' },
  auto_candidates: { zh: '自动候选', en: 'Auto candidates', style: 'bg-fuchsia-100 text-fuchsia-800' },
  selected: { zh: 'SEO 优化', en: 'SEO', style: 'bg-slate-100 text-slate-700' },
  spec_research: { zh: '参数检索', en: 'Spec research', style: 'bg-indigo-100 text-indigo-800' },
  product_identification: { zh: '产品识别', en: 'Identification', style: 'bg-teal-100 text-teal-800' },
};

const ITEM_STATUS_META: Record<AIAgentSEOItemStatus, { zh: string; en: string; style: string }> = {
  running: { zh: '处理中', en: 'Running', style: 'bg-violet-100 text-violet-800' },
  queued: { zh: '待处理', en: 'Queued', style: 'bg-gray-100 text-gray-700' },
  optimized: { zh: '已优化', en: 'Optimized', style: 'bg-emerald-100 text-emerald-800' },
  skipped: { zh: '合格跳过', en: 'Skipped', style: 'bg-sky-100 text-sky-800' },
  unresolved: { zh: '待核实', en: 'Unresolved', style: 'bg-amber-100 text-amber-800' },
  failed: { zh: '失败', en: 'Failed', style: 'bg-rose-100 text-rose-800' },
  cancelled: { zh: '已结束', en: 'Ended', style: 'bg-slate-200 text-slate-700' },
};

const ITEM_FILTERS: Array<AIAgentSEOItemStatus | ''> = ['', 'running', 'queued', 'optimized', 'skipped', 'unresolved', 'failed', 'cancelled'];

function isActive(job: AIAgentSEOJob) {
  return ACTIVE_STATUSES.includes(job.status);
}

function visibleJobPrompt(job: AIAgentSEOJob, zh: boolean) {
  if (job.selection_mode === 'listing_optimization') {
    return job.prompt.split('[[VIBOCNC_LISTING_JOB_OPTIONS=')[0].trim();
  }
  if (job.selection_mode === 'category_optimization') {
    try {
      const encoded = job.prompt.split('[[VIBOCNC_CATEGORY_JOB_OPTIONS=')[1]?.split(']]')[0];
      const opts = encoded ? JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) : {};
      return opts.repair_content
        ? (zh ? '分类返工：核验证据 → AI 分类 → 名称/描述/SEO 审核 → 保存' : 'Category rework: evidence → classify → audit copy → save')
        : (zh ? '自动分类：核验证据 → AI 判断 → 匹配分类 → 保存' : 'Auto category: evidence → AI → match category → save');
    } catch {
      return zh ? '分类任务' : 'Category task';
    }
  }
  return job.prompt.split('[[VIBOCNC_')[0].trim();
}

function formatDuration(seconds: number, zh: boolean) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return zh ? `${days} 天 ${hours % 24} 小时` : `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return zh ? `${hours} 小时 ${minutes} 分` : `${hours}h ${minutes}m`;
  return zh ? `${Math.max(1, minutes)} 分钟` : `${Math.max(1, minutes)}m`;
}

function estimateRemaining(job: AIAgentSEOJob) {
  if (job.status !== 'running' || !job.started_at || job.processed <= 0) return null;
  const elapsed = (Date.now() - new Date(job.started_at).getTime()) / 1000;
  if (elapsed <= 0) return null;
  return ((job.total - job.processed) / job.processed) * elapsed;
}

function percent(value: number, total: number) {
  return total > 0 ? Math.min(100, (value / total) * 100) : 0;
}

export default function AIJobCenterPage() {
  const { locale } = useAdminI18n();
  const { user } = useAuth();
  const zh = locale === 'zh';
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<JobTab>('all');
  const [expandedID, setExpandedID] = useState<string | null>(null);
  const [itemsPage, setItemsPage] = useState<AIAgentSEOJobItemsPage | null>(null);
  const [itemFilter, setItemFilter] = useState<AIAgentSEOItemStatus | ''>('');
  const [itemQuery, setItemQuery] = useState('');
  const [itemOffset, setItemOffset] = useState(0);
  const [loadingItems, setLoadingItems] = useState(false);
  const [changingJobID, setChangingJobID] = useState<string | null>(null);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const requestedJobRef = useRef(false);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['admin', 'ai-seo', 'stats'],
    queryFn: () => AIAgentService.getSEOStats(),
    refetchInterval: 10000,
  });
  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ['admin', 'ai-seo', 'jobs'],
    queryFn: () => AIAgentService.listSEOJobs(),
    refetchInterval: (query) => ((query.state.data || []).some(isActive) ? 4000 : 15000),
  });
  const { data: aiStatus } = useQuery({
    queryKey: ['admin', 'ai-agent', 'status'],
    queryFn: () => AIAgentService.status(),
    refetchInterval: 30000,
  });

  const visibleJobs = useMemo(() => jobs.filter((job) => tab === 'all' || (tab === 'active' ? isActive(job) : !isActive(job))), [jobs, tab]);
  const activeCount = jobs.filter(isActive).length;
  const expandedJob = jobs.find((job) => job.id === expandedID) || null;

  const loadItems = useCallback(async (jobID: string, offset: number, filter: AIAgentSEOItemStatus | '', query: string) => {
    setLoadingItems(true);
    try {
      setItemsPage(await AIAgentService.listSEOJobItems(jobID, JOB_ITEM_PAGE_SIZE, offset, filter, query));
      setItemOffset(offset);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, zh ? '无法加载 SKU 明细' : 'Unable to load SKU details'));
    } finally {
      setLoadingItems(false);
    }
  }, [zh]);

  const openDetails = useCallback((job: AIAgentSEOJob) => {
    if (job.selection_mode === 'category_optimization' && !isAdmin) {
      toast.error(zh ? '只有管理员可以查看自动分类任务的明细' : 'Only administrators can view category job details');
      return;
    }
    if (expandedID === job.id) {
      setExpandedID(null);
      setItemsPage(null);
      return;
    }
    setExpandedID(job.id);
    setItemsPage(null);
    setItemFilter('');
    setItemQuery('');
    void loadItems(job.id, 0, '', '');
  }, [expandedID, isAdmin, loadItems, zh]);

  useEffect(() => {
    if (requestedJobRef.current || jobs.length === 0) return;
    const requested = new URLSearchParams(window.location.search).get('job');
    if (!requested) return;
    requestedJobRef.current = true;
    const job = jobs.find((candidate) => candidate.id === requested);
    if (job) openDetails(job);
  }, [jobs, openDetails]);

  useEffect(() => {
    if (!expandedJob || !isActive(expandedJob)) return;
    const timer = window.setInterval(() => {
      void AIAgentService.listSEOJobItems(expandedJob.id, JOB_ITEM_PAGE_SIZE, itemOffset, itemFilter, itemQuery).then(setItemsPage).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [expandedJob, itemOffset, itemFilter, itemQuery]);

  const refreshAll = () => {
    void refetchStats();
    void refetchJobs();
    if (expandedJob) void loadItems(expandedJob.id, itemOffset, itemFilter, itemQuery);
  };

  const runJobAction = async (job: AIAgentSEOJob, action: 'pause' | 'resume' | 'end') => {
    if (action === 'end' && !window.confirm(zh
      ? `结束任务 ${job.id.slice(0, 8)}？已处理的产品保留结果，剩余 ${(job.total - job.processed).toLocaleString()} 个未处理产品会被释放，之后可以重新处理。`
      : `End job ${job.id.slice(0, 8)}? Processed products keep their results; ${(job.total - job.processed).toLocaleString()} unprocessed products are released.`)) return;
    setChangingJobID(job.id);
    try {
      if (action === 'pause') await AIAgentService.pauseSEOJob(job.id);
      if (action === 'resume') await AIAgentService.resumeSEOJob(job.id);
      if (action === 'end') await AIAgentService.endSEOJob(job.id);
      toast.success(zh
        ? { pause: '任务已暂停，正在处理的产品可能会完成', resume: '任务已继续', end: '任务已结束，剩余产品已释放' }[action]
        : { pause: 'Job paused', resume: 'Job resumed', end: 'Job ended and remaining products released' }[action]);
      refreshAll();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, zh ? '操作失败' : 'Action failed'));
    } finally {
      setChangingJobID(null);
    }
  };

  const retryFailed = async () => {
    if (!window.confirm(zh ? `用 AI 智能优化重新处理全部 ${(stats?.failed ?? 0).toLocaleString()} 个失败产品？` : `Retry all ${(stats?.failed ?? 0).toLocaleString()} failed products with AI optimization?`)) return;
    setRetryingFailed(true);
    try {
      const job = await AIListingService.startJob({ failed_only: true, status: 'all', force: true });
      toast.success(zh ? `已创建重试任务：${job.total.toLocaleString()} 个产品` : `Retry job started for ${job.total.toLocaleString()} products`);
      refreshAll();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, zh ? '创建重试任务失败' : 'Unable to start retry job'));
    } finally {
      setRetryingFailed(false);
    }
  };

  const cards = [
    { label: zh ? '全部产品' : 'All products', value: stats?.total, style: 'border-slate-200 bg-white text-slate-900', href: '/admin/products' },
    { label: zh ? 'AI 已优化' : 'AI optimized', value: stats?.optimized, style: 'border-emerald-200 bg-emerald-50 text-emerald-900', href: '/admin/products?aiSeoStatus=optimized' },
    { label: zh ? '未 AI 优化' : 'Not optimized', value: stats?.not_optimized, style: 'border-gray-200 bg-gray-50 text-gray-900', href: '/admin/products?aiSeoStatus=not_optimized' },
    { label: zh ? '处理中' : 'Processing', value: stats?.running, style: 'border-violet-200 bg-violet-50 text-violet-900', href: '/admin/products?aiSeoStatus=running' },
    { label: zh ? '优化失败' : 'Failed', value: stats?.failed, style: 'border-rose-200 bg-rose-50 text-rose-900', href: '/admin/products?aiSeoStatus=failed' },
  ];
  const optimizedRate = stats && stats.total > 0 ? Math.round((stats.optimized / stats.total) * 100) : 0;

  const actionButton = (job: AIAgentSEOJob, action: 'pause' | 'resume' | 'end') => {
    const meta = {
      pause: { icon: PauseIcon, label: zh ? '暂停' : 'Pause', style: 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100' },
      resume: { icon: PlayIcon, label: zh ? '继续' : 'Resume', style: 'border-violet-600 bg-violet-600 text-white hover:bg-violet-700' },
      end: { icon: StopIcon, label: zh ? '结束' : 'End', style: 'border-rose-300 bg-white text-rose-700 hover:bg-rose-50' },
    }[action];
    const Icon = meta.icon;
    return (
      <button key={action} type="button" onClick={() => void runJobAction(job, action)} disabled={changingJobID !== null} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${meta.style}`}>
        {changingJobID === job.id ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
        {meta.label}
      </button>
    );
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-2xl bg-gradient-to-r from-violet-700 to-indigo-700 px-6 py-6 text-white shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <SparklesIcon className="mt-0.5 h-7 w-7 shrink-0" />
              <div>
                <h1 className="text-2xl font-bold">{zh ? 'AI 优化任务中心' : 'AI Job Center'}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-violet-100">
                  {zh
                    ? '所有 AI 智能优化、自动分类和 SEO 后台任务都在这里。任务在后台分批运行，关闭页面不影响；同一产品不会被两个任务同时处理。'
                    : 'Every AI optimization, category and SEO background job is tracked here. Jobs run in the background; one product is never processed by two jobs.'}
                </p>
                <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs">
                  <CpuChipIcon className="h-4 w-4" />
                  <span>{zh ? '当前模型：' : 'Model: '}</span>
                  <span className="font-semibold">{aiStatus ? `${aiStatus.active_profile_name || 'Default'} · ${aiStatus.model}` : '—'}</span>
                  {aiStatus && !aiStatus.configured && <span className="rounded bg-rose-500/80 px-1.5 py-0.5 font-semibold">{zh ? '未配置' : 'Not configured'}</span>}
                  {isAdmin && <Link href="/admin/ai-assistant" className="rounded bg-white px-2 py-0.5 font-semibold text-violet-700 hover:bg-violet-50">{zh ? '切换 / 修改模型' : 'Change model'}</Link>}
                  <span className="text-violet-200">{zh ? '修改后，进行中的任务从下一个产品起使用新模型' : 'Running jobs switch from the next product'}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link href="/admin/products" className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm hover:bg-violet-50">{zh ? '去产品管理优化' : 'Optimize products'}</Link>
              <button type="button" onClick={() => void retryFailed()} disabled={retryingFailed || !stats?.failed} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/40 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">
                {retryingFailed && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
                {zh ? `重试失败产品（${(stats?.failed ?? 0).toLocaleString()}）` : `Retry failed (${(stats?.failed ?? 0).toLocaleString()})`}
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {cards.map((card) => (
            <Link key={card.href} href={card.href} className={`rounded-xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${card.style}`}>
              <div className="text-sm font-medium opacity-80">{card.label}</div>
              <div className="mt-2 text-3xl font-bold tabular-nums">{statsLoading ? '—' : (card.value ?? 0).toLocaleString()}</div>
            </Link>
          ))}
        </section>
        {stats && stats.total > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex justify-between text-xs text-gray-600">
              <span>{zh ? '全站 AI 优化覆盖率' : 'Catalogue AI coverage'}</span>
              <span className="font-semibold text-gray-900">{optimizedRate}%</span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="bg-emerald-500" style={{ width: `${percent(stats.optimized, stats.total)}%` }} />
              <div className="bg-violet-500" style={{ width: `${percent(stats.running, stats.total)}%` }} />
              <div className="bg-rose-500" style={{ width: `${percent(stats.failed, stats.total)}%` }} />
            </div>
          </div>
        )}

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-sm">
              {([
                ['all', zh ? '全部' : 'All', jobs.length],
                ['active', zh ? '进行中' : 'Active', activeCount],
                ['finished', zh ? '已结束' : 'Finished', jobs.length - activeCount],
              ] as Array<[JobTab, string, number]>).map(([value, label, count]) => (
                <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-md px-3 py-1.5 font-medium ${tab === value ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                  {label}<span className="ml-1.5 text-xs text-gray-400">{count}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">{zh ? '显示最近 50 个任务' : 'Latest 50 jobs'}</span>
              <button type="button" onClick={refreshAll} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><ArrowPathIcon className="h-4 w-4" />{zh ? '刷新' : 'Refresh'}</button>
            </div>
          </div>

          {jobsLoading ? (
            <div className="p-12 text-center text-sm text-gray-500">{zh ? '正在加载任务…' : 'Loading jobs…'}</div>
          ) : visibleJobs.length === 0 ? (
            <div className="p-12 text-center text-sm text-gray-500">
              <p>{zh ? '这里还没有任务。' : 'No jobs here yet.'}</p>
              <Link href="/admin/products" className="mt-3 inline-block font-medium text-violet-700 hover:text-violet-900">{zh ? '去产品管理点击「AI 智能优化」' : 'Start one from Products → AI Optimize'}</Link>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {visibleJobs.map((job) => {
                const type = JOB_TYPE_META[job.selection_mode] || JOB_TYPE_META.selected;
                const status = STATUS_META[job.status];
                const remaining = estimateRemaining(job);
                const canControl = job.selection_mode !== 'category_optimization' || isAdmin;
                const expanded = expandedID === job.id;
                const unresolved = job.unresolved || 0;
                return (
                  <li key={job.id} className={expanded ? 'bg-violet-50/30' : ''}>
                    <div className="px-5 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`rounded px-1.5 py-0.5 font-semibold ${type.style}`}>{zh ? type.zh : type.en}</span>
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${status.style}`}>{zh ? status.zh : status.en}</span>
                            <span className="text-gray-500">{new Date(job.created_at).toLocaleString()}</span>
                            <span className="font-mono text-gray-400" title={job.id}>#{job.id.slice(0, 8)}</span>
                            {job.ai_model && <span className="text-gray-500">{job.ai_profile_name ? `${job.ai_profile_name} · ` : ''}{job.ai_model}</span>}
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-sm text-gray-700">{visibleJobPrompt(job, zh) || '—'}</p>
                          {job.error && <p className="mt-1 line-clamp-2 text-xs text-rose-700">{job.error}</p>}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {canControl && (job.status === 'queued' || job.status === 'running') && actionButton(job, 'pause')}
                          {canControl && job.status === 'paused' && actionButton(job, 'resume')}
                          {canControl && isActive(job) && actionButton(job, 'end')}
                          <button type="button" onClick={() => openDetails(job)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                            {expanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
                            {zh ? 'SKU 明细' : 'Details'}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3">
                        <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100">
                          <div className="bg-emerald-500 transition-all" style={{ width: `${percent(job.succeeded, job.total)}%` }} />
                          <div className="bg-amber-400 transition-all" style={{ width: `${percent(unresolved, job.total)}%` }} />
                          <div className="bg-rose-500 transition-all" style={{ width: `${percent(job.failed, job.total)}%` }} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                          <span className="font-semibold text-gray-900 tabular-nums">{job.processed.toLocaleString()} / {job.total.toLocaleString()}（{Math.round(percent(job.processed, job.total))}%）</span>
                          <span className="text-emerald-700">{zh ? '成功' : 'Done'} {job.succeeded.toLocaleString()}</span>
                          {unresolved > 0 && <span className="text-amber-700">{zh ? '待核实' : 'Review'} {unresolved.toLocaleString()}</span>}
                          <span className={job.failed ? 'text-rose-700' : ''}>{zh ? '失败' : 'Failed'} {job.failed.toLocaleString()}</span>
                          {remaining !== null && <span className="text-violet-700">{zh ? '预计剩余' : 'ETA'} {formatDuration(remaining, zh)}</span>}
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t border-violet-100 bg-white px-5 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex flex-wrap gap-1.5">
                            {ITEM_FILTERS.map((filter) => {
                              const count = filter === '' ? job.total : itemsPage?.status_counts?.[filter] || 0;
                              if (filter !== '' && count === 0 && itemFilter !== filter) return null;
                              const meta = filter ? ITEM_STATUS_META[filter] : null;
                              return (
                                <button key={filter || 'all'} type="button" onClick={() => { setItemFilter(filter); void loadItems(job.id, 0, filter, itemQuery); }} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${itemFilter === filter ? 'border-violet-500 bg-violet-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-violet-300'}`}>
                                  {meta ? (zh ? meta.zh : meta.en) : (zh ? '全部' : 'All')} <span className="tabular-nums opacity-75">{count.toLocaleString()}</span>
                                </button>
                              );
                            })}
                          </div>
                          <form onSubmit={(event) => { event.preventDefault(); void loadItems(job.id, 0, itemFilter, itemQuery.trim()); }} className="flex items-center gap-2">
                            <div className="relative">
                              <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                              <input value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} placeholder={zh ? '搜索 SKU' : 'Search SKU'} className="w-48 rounded-lg border border-gray-300 py-1.5 pl-7 pr-2 text-sm focus:border-violet-500 focus:outline-none" />
                            </div>
                            <button type="submit" className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">{zh ? '搜索' : 'Search'}</button>
                          </form>
                        </div>
                        <div className="mt-3 max-h-[28rem] overflow-auto rounded-lg border border-gray-200">
                          <table className="min-w-full text-sm">
                            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                              <tr>
                                <th className="px-4 py-2">SKU</th>
                                <th className="px-4 py-2">{zh ? '结果' : 'Result'}</th>
                                <th className="px-4 py-2">{zh ? '处理说明 / 修改内容 / 失败原因' : 'Note / changes / failure reason'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {loadingItems && !itemsPage ? (
                                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">{zh ? '正在加载…' : 'Loading…'}</td></tr>
                              ) : (itemsPage?.items || []).length === 0 ? (
                                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">{zh ? '没有匹配的 SKU' : 'No matching SKUs'}</td></tr>
                              ) : (itemsPage?.items || []).map((item) => {
                                const meta = ITEM_STATUS_META[item.status] || ITEM_STATUS_META.queued;
                                return (
                                  <tr key={item.id} className="align-top">
                                    <td className="whitespace-nowrap px-4 py-2">
                                      <Link href={`/admin/products/${item.product_id}/edit`} className="font-mono text-violet-700 hover:underline">{item.sku || `#${item.product_id}`}</Link>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${meta.style}`}>{zh ? meta.zh : meta.en}</span></td>
                                    <td className={`px-4 py-2 text-xs leading-5 ${item.status === 'failed' ? 'text-rose-700' : 'text-gray-600'}`}>{item.error || '—'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {itemsPage && itemsPage.total > 0 && (
                          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                            <span>{zh ? `第 ${itemsPage.offset + 1}–${Math.min(itemsPage.offset + itemsPage.items.length, itemsPage.total)} 条，共 ${itemsPage.total.toLocaleString()} 条` : `${itemsPage.offset + 1}–${Math.min(itemsPage.offset + itemsPage.items.length, itemsPage.total)} of ${itemsPage.total.toLocaleString()}`}</span>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => void loadItems(job.id, Math.max(0, itemsPage.offset - itemsPage.limit), itemFilter, itemQuery)} disabled={loadingItems || itemsPage.offset === 0} className="rounded border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{zh ? '上一页' : 'Previous'}</button>
                              <button type="button" onClick={() => void loadItems(job.id, itemsPage.offset + itemsPage.limit, itemFilter, itemQuery)} disabled={loadingItems || itemsPage.offset + itemsPage.limit >= itemsPage.total} className="rounded border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{zh ? '下一页' : 'Next'}</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
