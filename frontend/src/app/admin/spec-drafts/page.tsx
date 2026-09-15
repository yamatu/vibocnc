'use client';

import AdminLayout from '@/components/admin/AdminLayout';
import { useAdminI18n } from '@/lib/admin-i18n';
import { ProductSpecService } from '@/services';
import type { ProductSpecDraft, ProductSpecDraftDetail, SpecResearchCandidate, SpecResearchItemPayload } from '@/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

const ACTIVE_JOB_STATUSES = ['queued', 'running', 'paused'];

/**
 * Review queue for parameters researched from a model number (型号).
 *
 * The pipeline reads public manufacturer/distributor pages and proposes values.
 * Nothing is published from this queue automatically: the reviewer opens the
 * cited page, confirms the value, and only then is it written into the product's
 * technical specifications. Values without a citation are refused by the API.
 *
 * Catalogue products are researched through the AI job queue (progress,
 * pause/resume, restart recovery) rather than a synchronous request; only a bare
 * model number with no product row is researched inline.
 */
export default function AdminSpecDraftsPage() {
  const qc = useQueryClient();
  const { t, locale } = useAdminI18n();

  const [statusFilter, setStatusFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [includeAI, setIncludeAI] = useState(true);
  const [manualBrand, setManualBrand] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [manualSku, setManualSku] = useState('');

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLimit, setJobLimit] = useState(50);
  const [jobOnlyMissing, setJobOnlyMissing] = useState(true);
  const [jobUseAI, setJobUseAI] = useState(true);

  const [draftRows, setDraftRows] = useState<SpecResearchCandidate[]>([]);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [overwrite, setOverwrite] = useState(false);

  const draftsQuery = useQuery({
    queryKey: ['spec-drafts', statusFilter, search, page],
    queryFn: () => ProductSpecService.listDrafts({ status: statusFilter, search, page, page_size: 20 }),
  });

  // Keep the selection valid when the list refreshes.
  useEffect(() => {
    const rows = draftsQuery.data?.data ?? [];
    if (rows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId === null || !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0].id);
    }
  }, [draftsQuery.data, selectedId]);

  const detailQuery = useQuery({
    queryKey: ['spec-draft', selectedId],
    queryFn: () => ProductSpecService.getDraft(selectedId as number),
    enabled: selectedId !== null,
  });

  useEffect(() => {
    const detail: ProductSpecDraftDetail | undefined = detailQuery.data;
    if (!detail) return;
    setDraftRows(detail.candidates ?? []);
    setChecked(Object.fromEntries((detail.candidates ?? []).map((_, index) => [index, true])));
    setOverwrite(false);
  }, [detailQuery.data]);

  const researchMutation = useMutation({
    mutationFn: (payload: { brand?: string; model?: string; sku?: string }) =>
      ProductSpecService.research({ ...payload, use_ai: includeAI }),
    onSuccess: (draft) => {
      toast.success(
        t('specResearch.draftCreated', {
          en: `Draft created for ${draft.model || draft.sku || 'model'} — review before applying`,
          zh: `已为 ${draft.model || draft.sku || '该型号'} 生成待审核草稿，请审核后再应用`,
        }),
      );
      setStatusFilter('pending');
      setSelectedId(draft.id);
      qc.invalidateQueries({ queryKey: ['spec-drafts'] });
    },
    onError: (err: Error) => toast.error(err?.message || t('specResearch.failed', { en: 'Research failed', zh: '检索失败' })),
  });

  // ---- Job-driven research for catalogue products -------------------------

  const jobQuery = useQuery({
    queryKey: ['spec-research-job', jobId],
    queryFn: () => ProductSpecService.getResearchJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_JOB_STATUSES.includes(status) ? 2500 : false;
    },
  });

  const jobItemsQuery = useQuery({
    queryKey: ['spec-research-job-items', jobId],
    queryFn: () => ProductSpecService.listResearchJobItems(jobId as string, 200),
    enabled: jobId !== null,
  });

  const job = jobQuery.data;
  const jobActive = job ? ACTIVE_JOB_STATUSES.includes(job.status) : false;

  // Pull the review queue in as soon as a run produces drafts.
  useEffect(() => {
    if (!job || jobActive) return;
    qc.invalidateQueries({ queryKey: ['spec-drafts'] });
  }, [job?.status, jobActive, qc, job]);

  const startJobMutation = useMutation({
    mutationFn: () =>
      ProductSpecService.startResearchJob({
        limit: jobLimit,
        only_missing: jobOnlyMissing,
        use_ai: jobUseAI,
      }),
    onSuccess: (created) => {
      setJobId(created.id);
      toast.success(
        t('specResearch.jobStarted', {
          en: `Research queued for up to ${created.total} product(s)`,
          zh: `已加入队列，最多 ${created.total} 个产品`,
        }),
      );
    },
    onError: (err: Error) =>
      toast.error(err?.message || t('specResearch.jobFailed', { en: 'Could not start the task', zh: '任务启动失败' })),
  });

  const jobControlMutation = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'end') => {
      if (!jobId) throw new Error('No task selected');
      if (action === 'pause') return ProductSpecService.pauseResearchJob(jobId);
      if (action === 'resume') return ProductSpecService.resumeResearchJob(jobId);
      return ProductSpecService.endResearchJob(jobId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spec-research-job', jobId] });
    },
    onError: (err: Error) => toast.error(err?.message || t('specResearch.jobControlFailed', { en: 'Action failed', zh: '操作失败' })),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      ProductSpecService.approveDraft(id, {
        candidates: ProductSpecService.sanitizeCandidates(draftRows.filter((_, index) => checked[index] !== false)),
        overwrite,
      }),
    onSuccess: (result) => {
      toast.success(
        t('specResearch.applied', {
          en: `Applied ${result.added} parameter(s); ${result.skipped} kept unchanged`,
          zh: `已写入 ${result.added} 项参数，${result.skipped} 项保持原值`,
        }),
      );
      qc.invalidateQueries({ queryKey: ['spec-drafts'] });
      qc.invalidateQueries({ queryKey: ['spec-draft', selectedId] });
    },
    onError: (err: Error) => toast.error(err?.message || t('specResearch.applyFailed', { en: 'Could not apply draft', zh: '写入失败' })),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) =>
      ProductSpecService.rejectDraft(id, t('specResearch.rejectReason', { en: 'Rejected during review', zh: '审核不通过' })),
    onSuccess: () => {
      toast.success(t('specResearch.rejected', { en: 'Draft rejected', zh: '已拒绝该草稿' }));
      qc.invalidateQueries({ queryKey: ['spec-drafts'] });
      qc.invalidateQueries({ queryKey: ['spec-draft', selectedId] });
    },
    onError: (err: Error) => toast.error(err?.message || t('specResearch.rejectFailed', { en: 'Could not reject draft', zh: '拒绝失败' })),
  });

  const detail = detailQuery.data;
  const selectedDraft: ProductSpecDraft | undefined = detail?.draft;
  const selectedCount = useMemo(
    () => draftRows.filter((_, index) => checked[index] !== false).length,
    [draftRows, checked],
  );

  const confidenceLabel = (confidence?: string) => {
    if (confidence === 'high') return t('specResearch.confidence.high', { en: 'high', zh: '高' });
    if (confidence === 'medium') return t('specResearch.confidence.medium', { en: 'medium', zh: '中' });
    if (confidence === 'low') return t('specResearch.confidence.low', { en: 'low', zh: '低' });
    return t('specResearch.confidence.unknown', { en: 'unknown', zh: '未知' });
  };

  const confidenceBadge = (confidence?: string) => {
    const tone =
      confidence === 'high'
        ? 'bg-emerald-100 text-emerald-800'
        : confidence === 'medium'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-700';
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
        {t('specResearch.confidenceBadge', { en: '{level} confidence', zh: '置信度：{level}' }, { level: confidenceLabel(confidence) })}
      </span>
    );
  };

  const statusLabel = (status: string) => {
    if (status === 'pending') return t('specResearch.status.pending', { en: 'pending review', zh: '待审核' });
    if (status === 'approved') return t('specResearch.status.approved', { en: 'approved', zh: '已通过' });
    if (status === 'rejected') return t('specResearch.status.rejected', { en: 'rejected', zh: '已拒绝' });
    if (status === 'superseded') return t('specResearch.status.superseded', { en: 'superseded', zh: '已被更新' });
    return status;
  };

  const jobProgress = useMemo(() => {
    if (!job || job.total === 0) return 0;
    return Math.min(100, Math.round((job.processed / job.total) * 100));
  }, [job]);

  const itemPayload = (item: { evidence_json?: string }): SpecResearchItemPayload | null =>
    ProductSpecService.parseItemPayload(item);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">{t('specResearch.title', { en: 'Specification Research', zh: '型号参数检索' })}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            {t('specResearch.intro', {
              en: 'Enter a model number (型号) and the system searches public manufacturer and distributor pages for its parameters. Every value keeps the page it came from, and a value that cannot be found verbatim in the cited page is discarded. Nothing reaches a product page until you approve it here.',
              zh: '输入型号（或批量选择产品）后，系统会检索公开的厂家/经销商页面，提取该型号的参数。每一项参数都保留来源页面，无法在来源页原文中找到的数值会被丢弃；未经你在此审核通过，任何参数都不会写入产品页。',
            })}
          </p>
        </div>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">{t('specResearch.modelTitle', { en: 'Research a model number', zh: '按型号检索（无产品记录）' })}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">
              {t('specResearch.brand', { en: 'Brand (optional)', zh: '品牌（可选）' })}
              <input
                value={manualBrand}
                onChange={(event) => setManualBrand(event.target.value)}
                placeholder={locale === 'zh' ? '例如 Mitsubishi' : 'e.g. Mitsubishi'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('specResearch.model', { en: 'Model (型号)', zh: '型号（必填）' })}
              <input
                value={manualModel}
                onChange={(event) => setManualModel(event.target.value)}
                placeholder="e.g. MR-J4-40A"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('specResearch.sku', { en: 'SKU (optional)', zh: 'SKU（可选）' })}
              <input
                value={manualSku}
                onChange={(event) => setManualSku(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                disabled={researchMutation.isPending || manualModel.trim() === ''}
                onClick={() =>
                  researchMutation.mutate({
                    brand: manualBrand.trim(),
                    model: manualModel.trim(),
                    sku: manualSku.trim(),
                  })
                }
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {researchMutation.isPending
                  ? t('specResearch.searching', { en: 'Searching…', zh: '检索中…' })
                  : t('specResearch.research', { en: 'Research', zh: '开始检索' })}
              </button>
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={includeAI} onChange={(event) => setIncludeAI(event.target.checked)} />
            {t('specResearch.useAI', {
              en: 'Use AI to read the pages (every AI value is still verified against the page text)',
              zh: '使用 AI 阅读页面（AI 提取的数值仍会与页面原文逐字校验）',
            })}
          </label>
        </section>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{t('specResearch.catalogueTitle', { en: 'Research catalogue products', zh: '批量检索产品（进入队列）' })}</h2>
              <p className="mt-1 text-xs text-slate-600">
                {t('specResearch.catalogueHint', {
                  en: 'Runs on the AI task queue: safe to leave the page, pausable, and it resumes automatically after a restart. Only products with a model number are researched.',
                  zh: '任务在 AI 队列中运行：可离开页面、可暂停，服务重启后会自动继续。只处理填写了型号的产品。',
                })}
              </p>
            </div>
            <button
              type="button"
              disabled={startJobMutation.isPending}
              onClick={() => startJobMutation.mutate()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {startJobMutation.isPending
                ? t('specResearch.jobStarting', { en: 'Starting…', zh: '正在创建…' })
                : t('specResearch.jobStart', { en: 'Start task', zh: '创建任务' })}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="text-xs font-medium text-slate-600">
              {t('specResearch.jobLimit', { en: 'Max products', zh: '最多处理产品数' })}
              <input
                type="number"
                min={1}
                max={500}
                value={jobLimit}
                onChange={(event) => setJobLimit(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
                className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
              <input type="checkbox" checked={jobOnlyMissing} onChange={(event) => setJobOnlyMissing(event.target.checked)} />
              {t('specResearch.jobOnlyMissing', { en: 'Only products without specifications', zh: '仅处理尚无参数表的产品' })}
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
              <input type="checkbox" checked={jobUseAI} onChange={(event) => setJobUseAI(event.target.checked)} />
              {t('specResearch.jobUseAI', { en: 'Use AI extraction', zh: '启用 AI 提取' })}
            </label>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {t('specResearch.manualHintPrefix', { en: 'To research specific products, select them in', zh: '如需只检索特定产品，请在' })}{' '}
            <Link href="/admin/products" className="text-blue-600 underline">
              {t('specResearch.products', { en: 'Products', zh: '产品列表' })}
            </Link>{' '}
            {t('specResearch.manualHintSuffix', { en: 'and use “Research specs”.', zh: '中勾选后点击“检索参数”。' })}
          </p>

          {job && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                <span className="font-mono text-[11px] text-slate-500">{job.id}</span>
                <span className="font-semibold text-slate-700">{job.status}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${jobProgress}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
                <span>
                  {t('specResearch.jobProcessed', { en: 'Processed', zh: '已处理' })}: {job.processed}/{job.total}
                </span>
                <span className="text-emerald-700">
                  {t('specResearch.jobWithDrafts', { en: 'With drafts', zh: '有草稿' })}: {job.succeeded}
                </span>
                <span className="text-amber-700">
                  {t('specResearch.jobUnresolved', { en: 'No verifiable value', zh: '未找到可核实参数' })}: {job.unresolved ?? 0}
                </span>
                <span className="text-rose-700">
                  {t('specResearch.jobFailed', { en: 'Failed', zh: '失败' })}: {job.failed}
                </span>
              </div>
              {job.error && <p className="mt-2 text-xs text-rose-600">{job.error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!jobActive || job.status === 'paused' || jobControlMutation.isPending}
                  onClick={() => jobControlMutation.mutate('pause')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  {t('specResearch.pause', { en: 'Pause', zh: '暂停' })}
                </button>
                <button
                  type="button"
                  disabled={job.status !== 'paused' || jobControlMutation.isPending}
                  onClick={() => jobControlMutation.mutate('resume')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  {t('specResearch.resume', { en: 'Resume', zh: '继续' })}
                </button>
                <button
                  type="button"
                  disabled={!jobActive || jobControlMutation.isPending}
                  onClick={() => jobControlMutation.mutate('end')}
                  className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  {t('specResearch.end', { en: 'Stop', zh: '终止' })}
                </button>
              </div>

              {(jobItemsQuery.data?.items ?? []).length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                    {t('specResearch.itemDetail', { en: 'Product results', zh: '产品处理结果' })} (
                    {jobItemsQuery.data?.items.length ?? 0})
                  </summary>
                  <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs text-slate-600">
                    {(jobItemsQuery.data?.items ?? []).map((item) => {
                      const payload = itemPayload(item);
                      return (
                        <li key={item.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-500">{item.sku}</span>
                          <span
                            className={
                              item.status === 'optimized'
                                ? 'text-emerald-700'
                                : item.status === 'unresolved'
                                  ? 'text-amber-700'
                                  : item.status === 'failed'
                                    ? 'text-rose-700'
                                    : 'text-slate-500'
                            }
                          >
                            {item.status}
                          </span>
                          {payload?.draft_id ? (
                            <button
                              type="button"
                              onClick={() => {
                                setStatusFilter('pending');
                                setSelectedId(payload.draft_id);
                              }}
                              className="text-blue-600 underline"
                            >
                              {t('specResearch.openDraft', { en: 'open draft', zh: '打开草稿' })} #{payload.draft_id}
                            </button>
                          ) : null}
                          {item.error && <span className="text-slate-500">{item.error}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-2 border-b border-slate-100 p-4">
              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    setPage(1);
                  }}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="pending">{t('specResearch.filter.pending', { en: 'Pending review', zh: '待审核' })}</option>
                  <option value="approved">{t('specResearch.filter.approved', { en: 'Approved', zh: '已通过' })}</option>
                  <option value="rejected">{t('specResearch.filter.rejected', { en: 'Rejected', zh: '已拒绝' })}</option>
                  <option value="superseded">{t('specResearch.filter.superseded', { en: 'Superseded', zh: '已被更新' })}</option>
                  <option value="all">{t('specResearch.filter.all', { en: 'All', zh: '全部' })}</option>
                </select>
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t('specResearch.searchPlaceholder', { en: 'Search SKU / model', zh: '搜索 SKU / 型号' })}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <p className="text-xs text-slate-500">
                {draftsQuery.data
                  ? t('specResearch.draftCount', { en: '{count} draft(s)', zh: '{count} 条草稿' }, { count: draftsQuery.data.total })
                  : t('specResearch.loading', { en: 'Loading…', zh: '加载中…' })}
              </p>
            </div>

            <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {(draftsQuery.data?.data ?? []).map((draft) => (
                <li key={draft.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(draft.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${
                      selectedId === draft.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{draft.model || draft.sku}</span>
                      {confidenceBadge(draft.confidence)}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {draft.brand ? `${draft.brand} · ` : ''}
                      {draft.sku || t('specResearch.noSku', { en: 'no SKU', zh: '无 SKU' })}
                      {draft.product_id
                        ? ` · #${draft.product_id}`
                        : ` · ${t('specResearch.notLinked', { en: 'not linked to a product', zh: '未关联产品' })}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{statusLabel(draft.status)}</div>
                  </button>
                </li>
              ))}
              {(draftsQuery.data?.data ?? []).length === 0 && !draftsQuery.isLoading && (
                <li className="px-4 py-6 text-center text-sm text-slate-500">
                  {t('specResearch.empty', { en: 'No drafts in this view.', zh: '当前视图没有草稿。' })}
                </li>
              )}
            </ul>

            {draftsQuery.data && draftsQuery.data.total_pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
                >
                  {t('specResearch.prev', { en: 'Prev', zh: '上一页' })}
                </button>
                <span>
                  {t('specResearch.page', { en: 'Page {page} / {total}', zh: '第 {page} / {total} 页' }, { page: draftsQuery.data.page, total: draftsQuery.data.total_pages })}
                </span>
                <button
                  type="button"
                  disabled={page >= draftsQuery.data.total_pages}
                  onClick={() => setPage((current) => current + 1)}
                  className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
                >
                  {t('specResearch.next', { en: 'Next', zh: '下一页' })}
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {!selectedDraft && (
              <p className="text-sm text-slate-500">
                {t('specResearch.selectDraft', { en: 'Select a draft to review its parameters.', zh: '选择一条草稿以审核其参数。' })}
              </p>
            )}

            {selectedDraft && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{selectedDraft.model}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {confidenceBadge(selectedDraft.confidence)}
                      <span>{t('specResearch.statusLabel', { en: 'status', zh: '状态' })}: {statusLabel(selectedDraft.status)}</span>
                      {selectedDraft.product_id ? (
                        <Link href={`/admin/products?search=${encodeURIComponent(selectedDraft.sku || '')}`} className="text-blue-600 underline">
                          #{selectedDraft.product_id}
                        </Link>
                      ) : selectedDraft.sku ? (
                        <span>{t('specResearch.linkBySku', { en: 'will be linked by SKU {sku} on apply', zh: '审核通过后将按 SKU {sku} 关联' }, { sku: selectedDraft.sku })}</span>
                      ) : (
                        <span>{t('specResearch.notLinkedHint', { en: 'not linked to a product — research it from the product to apply the parameters', zh: '未关联产品 —— 请从产品页发起检索才能写入参数' })}</span>
                      )}
                    </div>
                  </div>
                  {selectedDraft.status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate(selectedDraft.id)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {t('specResearch.reject', { en: 'Reject', zh: '拒绝' })}
                      </button>
                      <button
                        type="button"
                        disabled={approveMutation.isPending || selectedCount === 0 || (!selectedDraft.product_id && !selectedDraft.sku)}
                        onClick={() => approveMutation.mutate(selectedDraft.id)}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {approveMutation.isPending
                          ? t('specResearch.applying', { en: 'Applying…', zh: '写入中…' })
                          : t('specResearch.apply', { en: 'Apply {count} parameter(s)', zh: '写入 {count} 项参数' }, { count: selectedCount })}
                      </button>
                    </div>
                  )}
                </div>

                {selectedDraft.notes && <p className="mt-3 text-sm text-slate-600">{selectedDraft.notes}</p>}

                <label className="mt-4 flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                  {t('specResearch.overwrite', {
                    en: 'Overwrite parameters that are already published (default keeps the existing value)',
                    zh: '覆盖已发布的同名参数（默认保留原值，只填空缺）',
                  })}
                </label>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-2">{t('specResearch.col.use', { en: 'Use', zh: '采用' })}</th>
                        <th className="px-2 py-2">{t('specResearch.col.parameter', { en: 'Parameter', zh: '参数项' })}</th>
                        <th className="px-2 py-2">{t('specResearch.col.value', { en: 'Value', zh: '数值' })}</th>
                        <th className="px-2 py-2">{t('specResearch.col.source', { en: 'Source', zh: '来源' })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftRows.map((candidate, index) => (
                        <tr key={`${candidate.label}-${index}`} className="border-b border-slate-100 align-top">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={checked[index] !== false}
                              onChange={(event) =>
                                setChecked((prev) => ({ ...prev, [index]: event.target.checked }))
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              value={candidate.label}
                              onChange={(event) =>
                                setDraftRows((prev) =>
                                  prev.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, label: event.target.value } : row,
                                  ),
                                )
                              }
                              className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                            {candidate.origin === 'ai' ? (
                              <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                AI
                              </span>
                            ) : (
                              <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {t('specResearch.extracted', { en: 'extracted', zh: '原文提取' })}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <input
                              value={candidate.value}
                              onChange={(event) =>
                                setDraftRows((prev) =>
                                  prev.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, value: event.target.value } : row,
                                  ),
                                )
                              }
                              className="w-full min-w-[10rem] rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                            {candidate.alternatives && candidate.alternatives.length > 0 && (
                              <p className="mt-1 max-w-xs text-[11px] text-amber-700">
                                {t('specResearch.alternatives', { en: 'Other sources say', zh: '其他来源为' })}:{' '}
                                {candidate.alternatives.join(' / ')}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500">
                            {candidate.conflict && (
                              <span className="mb-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                {t('specResearch.conflict', { en: 'sources disagree', zh: '来源冲突' })}
                              </span>
                            )}
                            {candidate.source_url ? (
                              <a
                                href={candidate.source_url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="text-blue-600 underline"
                              >
                                {candidate.source_title || candidate.source_url}
                              </a>
                            ) : (
                              <span className="text-rose-600">{t('specResearch.noCitation', { en: 'no citation', zh: '无引用来源' })}</span>
                            )}
                            {candidate.evidence && (
                              <p className="mt-1 max-w-md text-[11px] italic text-slate-400">“{candidate.evidence}”</p>
                            )}
                          </td>
                        </tr>
                      ))}
                      {draftRows.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-2 py-6 text-center text-sm text-slate-500">
                            {t('specResearch.noCandidates', {
                              en: 'No verifiable parameter was found for this model. Enter the specifications manually on the product instead of publishing a guess.',
                              zh: '该型号未找到可核实的参数。请在产品页手工填写，不要发布猜测的数值。',
                            })}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {detail && detail.evidence.length > 0 && (
                  <details className="mt-5 rounded-lg bg-slate-50 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                      {t('specResearch.evidencePages', { en: 'Evidence pages', zh: '证据页面' })} ({detail.evidence.length})
                    </summary>
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {detail.evidence.map((item) => (
                        <li key={item.url}>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-blue-600 underline"
                          >
                            {item.title || item.url}
                          </a>{' '}
                          <span className="text-slate-400">({item.evidence_level || item.source_type})</span>
                          <p className="text-slate-500">{item.snippet}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
