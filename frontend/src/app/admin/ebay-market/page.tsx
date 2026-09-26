'use client';

import AdminLayout from '@/components/admin/AdminLayout';
import EbayPluginSetup from '@/components/admin/EbayPluginSetup';
import ProductProfileReviewPanel from '@/components/admin/ProductProfileReviewPanel';
import {
  ebayMarketService,
  type EbayMarketQuoteRow,
  type PriceSyncSuggestion,
} from '@/services/ebay-market.service';
import { AIAgentService, type AIAgentSEOJob } from '@/services/ai-agent.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

const PAGE_SIZE = 20;

/** Job statuses that still have work in flight, so the UI keeps polling. */
const ACTIVE_JOB_STATUSES = ['queued', 'running', 'paused'];

const STATUS_LABELS: Record<string, string> = {
  ready: '可应用',
  needs_manual_review: '需人工复核',
  unchanged: '无需调整',
  insufficient_samples: '样本不足',
  no_quote: '暂无调研',
  no_matching_product: '未匹配到产品',
  price_sync_disabled: '改价功能未启用',
};

const STATUS_CLASSES: Record<string, string> = {
  ready: 'bg-emerald-100 text-emerald-800',
  needs_manual_review: 'bg-amber-100 text-amber-800',
  unchanged: 'bg-gray-100 text-gray-700',
  insufficient_samples: 'bg-slate-100 text-slate-600',
  no_quote: 'bg-slate-100 text-slate-600',
  no_matching_product: 'bg-slate-100 text-slate-600',
  price_sync_disabled: 'bg-slate-100 text-slate-600',
};

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  cancelled: '已取消',
  completed: '已完成',
  completed_with_errors: '完成（有失败）',
  failed: '失败',
};

/**
 * eBay market research console.
 *
 * Two jobs in one screen:
 *
 *  1. Show what the crawler collected per model number — the median price and
 *     the real listings behind it. This is also the evidence the AI reads when
 *     it has to work out what an unknown part actually is.
 *  2. Offer price changes. A suggestion is only ever a suggestion: nothing is
 *     written until the reviewer ticks the rows and applies them explicitly,
 *     and the backend recomputes every price at apply time.
 */
export default function AdminEbayMarketPage() {
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'scraped_desc' | 'delta_desc' | 'delta_asc'>('scraped_desc');
  const [page, setPage] = useState(1);
  const [selectedQuoteId, setSelectedQuoteId] = useState<number | null>(null);

  const [identifyModel, setIdentifyModel] = useState('');
  const [identifyBrand, setIdentifyBrand] = useState('');
  const [identificationJobId, setIdentificationJobId] = useState<string | null>(null);

  const [picked, setPicked] = useState<Record<number, boolean>>({});

  const summaryQuery = useQuery({
    queryKey: ['ebay-market-summary'],
    queryFn: () => ebayMarketService.getSummary(),
  });

  const quotesQuery = useQuery({
    queryKey: ['ebay-market-quotes', search, sort, page],
    queryFn: () =>
      ebayMarketService.listQuotes({
        search: search || undefined,
        sort,
        page,
        limit: PAGE_SIZE,
      }),
  });

  const detailQuery = useQuery({
    queryKey: ['ebay-market-quote', selectedQuoteId],
    queryFn: () => ebayMarketService.getQuote(selectedQuoteId as number),
    enabled: selectedQuoteId !== null,
  });

  const previewQuery = useQuery({
    queryKey: ['ebay-market-price-preview'],
    queryFn: () => ebayMarketService.previewPriceSync({ limit: 500 }),
  });

  const applyMutation = useMutation({
    mutationFn: ({ productIds, forceProductIds }: { productIds: number[]; forceProductIds: number[] }) =>
      ebayMarketService.applyPriceSync({
        product_ids: productIds,
        force_product_ids: forceProductIds,
        reason: forceProductIds.length > 0
          ? 'eBay 市场价同步（已人工确认大幅变动）'
          : 'eBay 市场价同步',
      }),
    onSuccess: (result) => {
      toast.success(`已更新 ${result.updated} 个产品价格，跳过 ${result.skipped} 个`);
      if (result.errors?.length) {
        toast.error(`部分产品未更新：${result.errors.slice(0, 3).join('；')}`);
      }
      setPicked({});
      void qc.invalidateQueries({ queryKey: ['ebay-market-price-preview'] });
      void qc.invalidateQueries({ queryKey: ['ebay-market-quotes'] });
    },
    onError: () => toast.error('应用价格失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ebayMarketService.deleteQuote(id),
    onSuccess: () => {
      toast.success('已删除该条调研记录');
      setSelectedQuoteId(null);
      void qc.invalidateQueries({ queryKey: ['ebay-market-quotes'] });
      void qc.invalidateQueries({ queryKey: ['ebay-market-summary'] });
    },
  });

  const identificationJobQuery = useQuery({
    queryKey: ['ebay-identify-job', identificationJobId],
    queryFn: () => AIAgentService.getSEOJob(identificationJobId as string),
    enabled: identificationJobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_JOB_STATUSES.includes(status) ? 3000 : false;
    },
  });
  const identificationJob: AIAgentSEOJob | undefined = identificationJobQuery.data;

  const startIdentificationJobMutation = useMutation({
    mutationFn: () => ebayMarketService.startIdentificationJob({ limit: 100 }),
    onSuccess: (result) => {
      setIdentificationJobId(result.job.id);
      toast.success(`已加入 ${result.selected} 个产品，跳过 ${result.skipped} 个`);
      void qc.invalidateQueries({ queryKey: ['ebay-profile-drafts'] });
    },
    onError: (err: Error) => toast.error(err?.message || '创建识别任务失败'),
  });

  const toggleIdentificationJob = useMutation({
    mutationFn: (job: AIAgentSEOJob) =>
      ACTIVE_JOB_STATUSES.includes(job.status) && job.status !== 'paused'
        ? AIAgentService.pauseSEOJob(job.id)
        : AIAgentService.resumeSEOJob(job.id),
    onSuccess: (job) => {
      toast.success(job.status === 'paused' ? '任务已暂停' : '任务已继续');
      void qc.invalidateQueries({ queryKey: ['ebay-identify-job', job.id] });
    },
    onError: () => toast.error('任务状态切换失败'),
  });

  // A finished run has written new drafts; pull the review queue in so the
  // operator does not have to refresh the page.
  useEffect(() => {
    if (!identificationJob) return;
    if (ACTIVE_JOB_STATUSES.includes(identificationJob.status)) return;
    void qc.invalidateQueries({ queryKey: ['ebay-profile-drafts'] });
    void qc.invalidateQueries({ queryKey: ['ebay-market-quotes'] });
  }, [identificationJob, qc]);

  const identifyMutation = useMutation({
    mutationFn: (payload: { product_id?: number; model: string; brand?: string }) =>
      ebayMarketService.identifyProduct({ ...payload, save_draft: true }),
    onSuccess: (result) => {
      if (result?.draft_saved) {
        toast.success('识别完成，已进入产品画像审核队列');
        void qc.invalidateQueries({ queryKey: ['ebay-profile-drafts'] });
      } else if (result?.draft_error) {
        toast.error(`识别完成，但不能进入审核：${result.draft_error}`);
      }
    },
    onError: () => toast.error('AI 识别失败，请检查 AI 配置'),
  });

  const summary = summaryQuery.data;
  const quotes = quotesQuery.data?.quotes ?? [];
  const total = quotesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const suggestions = previewQuery.data?.suggestions ?? [];
  const actionable = useMemo(
    () => suggestions.filter(
      (item) => (item.status === 'ready' || item.status === 'needs_manual_review') && item.matched_count > 0
    ),
    [suggestions]
  );
  const pickedIds = useMemo(
    () => Object.keys(picked).filter((key) => picked[Number(key)]).map(Number),
    [picked]
  );
  const forcedPickedIds = useMemo(
    () => actionable
      .filter((item) => item.status === 'needs_manual_review' && picked[item.product_id])
      .map((item) => item.product_id),
    [actionable, picked]
  );

  const applyPickedPrices = () => {
    if (pickedIds.length === 0) return;
    if (forcedPickedIds.length > 0) {
      const accepted = window.confirm(
        `${forcedPickedIds.length} 个产品的建议变动超过安全阈值。` +
        '确认你已逐项核对 eBay 证据，并仍要应用这些大幅价格变动？'
      );
      if (!accepted) return;
    }
    applyMutation.mutate({ productIds: pickedIds, forceProductIds: forcedPickedIds });
  };

  return (
    <AdminLayout>
      <div className="space-y-6 p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-900">eBay 市场调研</h1>
          <p className="text-sm text-gray-600">
            爬虫按型号采集 eBay 真实成交列表，这里汇总中位价并作为 AI 识别产品的证据。
            价格只会生成建议，必须勾选后手动应用。
          </p>
        </header>

        <EbayPluginSetup />

        {summary && (
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <SummaryCard label="调研型号数" value={summary.total_quotes} />
            <SummaryCard label="含有效价格" value={summary.quotes_with_price} />
            <SummaryCard label="产品总数" value={summary.total_products} />
            <SummaryCard
              label="最近采集"
              value={summary.last_scraped_at ? formatTime(summary.last_scraped_at) : '—'}
            />
          </section>
        )}

        {summary && !summary.policy.enabled && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            价格同步当前<strong>未启用</strong>。请在「商业政策」中开启后，这里的建议才能被应用。
          </div>
        )}

        {/* -------------------------------------------------- AI identification */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-medium text-gray-900">AI 识别产品</h2>
          <p className="mt-1 text-sm text-gray-600">
            输入型号，AI 会读取该型号的 eBay 列表与商品属性，判断这是什么品牌、什么类型的产品。
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-700">型号</span>
              <input
                value={identifyModel}
                onChange={(event) => setIdentifyModel(event.target.value)}
                placeholder="A06B-6077-H106"
                className="w-64 rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-700">品牌（可选）</span>
              <input
                value={identifyBrand}
                onChange={(event) => setIdentifyBrand(event.target.value)}
                placeholder="FANUC"
                className="w-40 rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <button
              onClick={() => identifyMutation.mutate({
                model: identifyModel.trim(),
                brand: identifyBrand.trim() || undefined,
              })}
              disabled={!identifyModel.trim() || identifyMutation.isPending}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {identifyMutation.isPending ? '识别中…' : '开始识别'}
            </button>
          </div>

          {identifyMutation.data && (
            <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">
                  {identifyMutation.data.profile.brand || '未识别品牌'}{' '}
                  {identifyMutation.data.profile.model}{' '}
                  {identifyMutation.data.profile.part_type || '未识别类型'}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    identifyMutation.data.profile.confidence >= 0.5
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  置信度 {(identifyMutation.data.profile.confidence * 100).toFixed(0)}%
                </span>
                {!identifyMutation.data.has_quote && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    无本地调研记录
                  </span>
                )}
              </div>
              {identifyMutation.data.profile.what_it_is && (
                <p className="mt-2 text-gray-700">{identifyMutation.data.profile.what_it_is}</p>
              )}
              {identifyMutation.data.proposed_title && (
                <p className="mt-2 text-sm text-gray-800">
                  <span className="font-medium">建议标题：</span>
                  {identifyMutation.data.proposed_title}
                </p>
              )}
              {identifyMutation.data.draft_saved && (
                <p className="mt-2 rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                  已保存到下方“AI 产品画像审核”，尚未修改产品。
                </p>
              )}
              {identifyMutation.data.draft_error && (
                <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                  未生成审核草稿：{identifyMutation.data.draft_error}
                </p>
              )}
              {identifyMutation.data.profile.reason && (
                <p className="mt-1 text-xs text-gray-500">
                  依据：{identifyMutation.data.profile.reason}
                </p>
              )}
              {identifyMutation.data.profile.specs.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-gray-700">
                  {identifyMutation.data.profile.specs.map((spec) => (
                    <li key={`${spec.label}-${spec.value}`}>
                      <span className="font-medium">{spec.label}：</span>
                      {spec.value}
                      {spec.source_url && (
                        <a
                          href={spec.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 text-xs text-blue-600 underline"
                        >
                          来源
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-5 border-t border-gray-200 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-gray-900">批量识别未知产品</h3>
                <p className="mt-1 text-sm text-gray-600">
                  为已有精确型号 eBay 证据、且尚无待审画像的产品排队识别。
                  每项只会生成待审草稿，不会修改产品。
                </p>
              </div>
              <button
                onClick={() => startIdentificationJobMutation.mutate()}
                disabled={startIdentificationJobMutation.isPending}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {startIdentificationJobMutation.isPending ? '创建中…' : '开始批量识别'}
              </button>
            </div>

            {identificationJobId && (
              <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4 text-sm">
                {identificationJobQuery.isLoading ? (
                  <p className="text-gray-500">加载任务状态…</p>
                ) : identificationJob ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium text-gray-900">
                        任务 {identificationJob.id.slice(0, 8)}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          ACTIVE_JOB_STATUSES.includes(identificationJob.status)
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {JOB_STATUS_LABELS[identificationJob.status] ?? identificationJob.status}
                      </span>
                      {ACTIVE_JOB_STATUSES.includes(identificationJob.status) && (
                        <button
                          onClick={() => toggleIdentificationJob.mutate(identificationJob)}
                          disabled={toggleIdentificationJob.isPending}
                          className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 disabled:opacity-50"
                        >
                          {identificationJob.status === 'paused' ? '继续' : '暂停'}
                        </button>
                      )}
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{
                          width: `${
                            identificationJob.total > 0
                              ? Math.min(100, (identificationJob.processed / identificationJob.total) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-600">
                      已处理 {identificationJob.processed}/{identificationJob.total} ·
                      成功 {identificationJob.succeeded} · 失败 {identificationJob.failed} ·
                      待人工 {identificationJob.unresolved ?? 0}
                    </p>
                    {identificationJob.error && (
                      <p className="mt-1 text-xs text-amber-700">{identificationJob.error}</p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-500">任务状态不可用。</p>
                )}
              </div>
            )}
          </div>
        </section>

        <ProductProfileReviewPanel />

        {/* ------------------------------------------------------- price sync */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-gray-900">价格建议</h2>
              <p className="mt-1 text-sm text-gray-600">
                基于中位价 × 系数 {summary?.policy.factor ?? 1}，至少需要{' '}
                {summary?.policy.min_samples ?? 3} 个样本。单次变动超过{' '}
                {summary?.policy.max_delta_pct ?? 50}% 需人工复核。
              </p>
            </div>
            <button
              onClick={applyPickedPrices}
              disabled={pickedIds.length === 0 || applyMutation.isPending}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {applyMutation.isPending ? '应用中…' : `应用选中价格（${pickedIds.length}）`}
            </button>
          </div>

          {previewQuery.isLoading ? (
            <p className="mt-4 text-sm text-gray-500">加载中…</p>
          ) : actionable.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              暂无可用建议。请先运行爬虫采集市场价，或检查是否已在商业政策中开启价格同步。
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={pickedIds.length === actionable.length && actionable.length > 0}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setPicked(
                              Object.fromEntries(actionable.map((item) => [item.product_id, true]))
                            );
                          } else {
                            setPicked({});
                          }
                        }}
                      />
                    </th>
                    <th className="px-3 py-2">产品</th>
                    <th className="px-3 py-2">型号</th>
                    <th className="px-3 py-2 text-right">当前价</th>
                    <th className="px-3 py-2 text-right">中位价</th>
                    <th className="px-3 py-2 text-right">建议价</th>
                    <th className="px-3 py-2 text-right">变动</th>
                    <th className="px-3 py-2 text-right">样本</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {actionable.map((item) => (
                    <SuggestionRow
                      key={item.product_id}
                      item={item}
                      checked={Boolean(picked[item.product_id])}
                      onToggle={() =>
                        setPicked((prev) => ({ ...prev, [item.product_id]: !prev[item.product_id] }))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------ quote table */}
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="搜索型号或品牌"
              className="w-64 rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="scraped_desc">最近采集</option>
              <option value="delta_desc">价差从大到小</option>
              <option value="delta_asc">价差从小到大</option>
            </select>
          </div>

          {quotesQuery.isLoading ? (
            <p className="mt-4 text-sm text-gray-500">加载中…</p>
          ) : quotes.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              还没有调研数据。运行爬虫后通过 push_to_storefront.py 上传即可。
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">型号</th>
                    <th className="px-3 py-2">品牌</th>
                    <th className="px-3 py-2 text-right">中位价</th>
                    <th className="px-3 py-2 text-right">样本</th>
                    <th className="px-3 py-2">匹配产品</th>
                    <th className="px-3 py-2">采集时间</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {quotes.map((quote) => (
                    <QuoteRow
                      key={quote.id}
                      quote={quote}
                      onSelect={() => setSelectedQuoteId(quote.id)}
                      onIdentify={() => {
                        setIdentifyModel(quote.model);
                        setIdentifyBrand(quote.brand || '');
                        identifyMutation.mutate({
                          product_id: quote.matched_product_id || undefined,
                          model: quote.model,
                          brand: quote.brand || undefined,
                        });
                      }}
                      identifying={identifyMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-gray-600">
                第 {page} / {totalPages} 页，共 {total} 条
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                  className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                  className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </section>

        {selectedQuoteId !== null && detailQuery.data && (
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">
                {detailQuery.data.quote.brand} {detailQuery.data.quote.model} 的原始列表
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedQuoteId(null)}
                  className="rounded border border-gray-300 px-3 py-1 text-sm"
                >
                  关闭
                </button>
                <button
                  onClick={() => deleteMutation.mutate(selectedQuoteId)}
                  className="rounded border border-red-300 px-3 py-1 text-sm text-red-700"
                >
                  删除
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              这些列表同时是 AI 识别该型号时的证据来源。
            </p>
            <ul className="mt-3 divide-y divide-gray-100 text-sm">
              {detailQuery.data.evidence.map((item) => (
                <li key={item.url || item.title} className="py-2">
                  <div className="flex items-start justify-between gap-3">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {item.title}
                    </a>
                    <span className="whitespace-nowrap font-medium">
                      {item.price_value ? `US $${item.price_value.toFixed(2)}` : '—'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {[item.condition, item.category_path].filter(Boolean).join(' · ')}
                  </div>
                </li>
              ))}
              {detailQuery.data.evidence.length === 0 && (
                <li className="py-2 text-gray-500">该记录没有保留原始列表。</li>
              )}
            </ul>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function SuggestionRow({
  item,
  checked,
  onToggle,
}: {
  item: PriceSyncSuggestion;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <tr>
      <td className="px-3 py-2">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td className="px-3 py-2">
        <span className="text-gray-900">{item.name}</span>
        <span className="ml-2 text-xs text-gray-500">{item.sku}</span>
        {item.status === 'needs_manual_review' && (
          <div className="mt-1">
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              大幅变动，选中后需再次确认
            </span>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-gray-600">{item.model}</td>
      <td className="px-3 py-2 text-right">${item.current_price.toFixed(2)}</td>
      <td className="px-3 py-2 text-right text-gray-600">${item.median_price.toFixed(2)}</td>
      <td className="px-3 py-2 text-right font-medium">${item.suggested_price.toFixed(2)}</td>
      <td
        className={`px-3 py-2 text-right ${
          item.delta_percent >= 0 ? 'text-emerald-700' : 'text-red-700'
        }`}
      >
        {item.delta_percent >= 0 ? '+' : ''}
        {item.delta_percent.toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-right text-gray-600">{item.matched_count}</td>
    </tr>
  );
}

function QuoteRow({
  quote,
  onSelect,
  onIdentify,
  identifying,
}: {
  quote: EbayMarketQuoteRow;
  onSelect: () => void;
  onIdentify: () => void;
  identifying: boolean;
}) {
  const status = quote.suggestion_status || 'no_quote';
  return (
    <tr className="cursor-pointer hover:bg-gray-50" onClick={onSelect}>
      <td className="px-3 py-2 font-medium text-gray-900">{quote.model}</td>
      <td className="px-3 py-2 text-gray-600">{quote.brand || '—'}</td>
      <td className="px-3 py-2 text-right">
        {quote.median_price > 0 ? `$${quote.median_price.toFixed(2)}` : '—'}
      </td>
      <td className="px-3 py-2 text-right text-gray-600">{quote.matched_count}</td>
      <td className="px-3 py-2">
        {quote.matched_product_sku ? (
          <span className="text-gray-700">{quote.matched_product_sku}</span>
        ) : (
          <span className="text-gray-400">未匹配</span>
        )}
        <span
          className={`ml-2 rounded px-2 py-0.5 text-xs ${
            STATUS_CLASSES[status] || 'bg-slate-100 text-slate-600'
          }`}
        >
          {STATUS_LABELS[status] || status}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">{formatTime(quote.scraped_at)}</td>
      <td className="px-3 py-2 text-right text-xs">
        <div className="flex justify-end gap-2">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onIdentify();
            }}
            disabled={identifying}
            className="text-emerald-700 hover:underline disabled:opacity-50"
          >
            AI 识别
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className="text-blue-600 hover:underline"
          >
            查看列表
          </button>
        </div>
      </td>
    </tr>
  );
}

function formatTime(value: string) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
