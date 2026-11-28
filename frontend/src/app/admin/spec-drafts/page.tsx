'use client';

import AdminLayout from '@/components/admin/AdminLayout';
import { useAdminI18n } from '@/lib/admin-i18n';
import { ProductSpecService } from '@/services/product-spec.service';
import type { ProductSpecDraft, SpecResearchCandidate } from '@/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

/**
 * Review queue for researched parameters.
 *
 * A draft is a proposal, never a publication. The screen lists pending drafts,
 * shows each value next to the page it came from, and writes to the product only
 * when the administrator approves. That is the whole safety model of the spec
 * pipeline, and it is why the Datasheets.com import lands here as well.
 */
export default function AdminSpecDraftsPage() {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const qc = useQueryClient();

  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draftState, setDraftState] = useState<Record<string, boolean>>({});
  const [overwrite, setOverwrite] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['spec-drafts', status, search, page],
    queryFn: () => ProductSpecService.listDrafts({ status, search, page, page_size: 20 }),
  });

  const detailQuery = useQuery({
    queryKey: ['spec-drafts', 'detail', openId],
    queryFn: () => ProductSpecService.getDraft(openId as number),
    enabled: !!openId,
  });

  const approveMutation = useMutation({
    mutationFn: (vars: { id: number; candidates: SpecResearchCandidate[]; overwrite: boolean }) =>
      ProductSpecService.approveDraft(vars.id, { candidates: vars.candidates, overwrite: vars.overwrite }),
    onSuccess: (result) => {
      toast.success(
        zh
          ? `已写入 ${result.added} 条参数，跳过 ${result.skipped} 条`
          : `Applied ${result.added} parameter(s), skipped ${result.skipped}`,
      );
      setOpenId(null);
      setDraftState({});
      qc.invalidateQueries({ queryKey: ['spec-drafts'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => toast.error(e?.message || (zh ? '审批失败' : 'Approval failed')),
  });

  const rejectMutation = useMutation({
    mutationFn: (vars: { id: number; reason: string }) => ProductSpecService.rejectDraft(vars.id, vars.reason),
    onSuccess: () => {
      toast.success(zh ? '已驳回' : 'Draft rejected');
      setOpenId(null);
      setRejectReason('');
      qc.invalidateQueries({ queryKey: ['spec-drafts'] });
    },
    onError: (e: any) => toast.error(e?.message || (zh ? '驳回失败' : 'Rejection failed')),
  });

  const drafts: ProductSpecDraft[] = data?.data ?? [];
  const totalPages = data?.total_pages ?? 1;
  const detail = detailQuery.data;
  const candidates = detail?.candidates ?? [];
  const selected = candidates.filter((candidate) =>
    draftState[`${candidate.label}\u0000${candidate.value}`] === undefined
      ? true
      : draftState[`${candidate.label}\u0000${candidate.value}`],
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{zh ? '参数草稿审核' : 'Specification Draft Review'}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {zh
              ? '研究/查询得到的参数先落在这里。每条参数都带着来源页面，只有你点「通过」才会写入产品。'
              : 'Researched parameters land here first. Every value carries its source page; only your approval writes it to the product.'}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <div className="text-sm font-medium text-gray-700 mb-1">{zh ? '状态' : 'Status'}</div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="pending">{zh ? '待审' : 'Pending'}</option>
              <option value="approved">{zh ? '已通过' : 'Approved'}</option>
              <option value="rejected">{zh ? '已驳回' : 'Rejected'}</option>
              <option value="superseded">{zh ? '已被替换' : 'Superseded'}</option>
              <option value="all">{zh ? '全部' : 'All'}</option>
            </select>
          </label>
          <label className="block flex-1 min-w-[220px]">
            <div className="text-sm font-medium text-gray-700 mb-1">{zh ? '搜索' : 'Search'}</div>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={zh ? 'SKU / 型号 / 品牌' : 'SKU / model / brand'}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-lg shadow p-6">{zh ? '加载中…' : 'Loading…'}</div>
        ) : error ? (
          <div className="bg-white rounded-lg shadow p-6 text-sm text-red-600">
            {String((error as any)?.message || (zh ? '加载失败' : 'Failed to load'))}
          </div>
        ) : drafts.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-sm text-gray-500">
            {zh ? '没有符合条件的草稿。' : 'No drafts match the filter.'}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
            {drafts.map((draft) => (
              <div key={draft.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      #{draft.id} · {draft.brand || '—'} · <span className="font-mono">{draft.model}</span>
                      {draft.sku ? <span className="text-gray-500"> · {draft.sku}</span> : null}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(draft.created_at).toLocaleString()} · {draft.confidence || '—'} ·{' '}
                      {draft.product_id > 0 ? `${zh ? '产品' : 'product'} #${draft.product_id}` : zh ? '未绑定产品' : 'no product'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        draft.status === 'pending'
                          ? 'bg-amber-100 text-amber-800'
                          : draft.status === 'approved'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {draft.status}
                    </span>
                    <button
                      onClick={() => {
                        setOpenId(openId === draft.id ? null : draft.id);
                        setDraftState({});
                        setOverwrite(false);
                      }}
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700"
                    >
                      {openId === draft.id ? (zh ? '收起' : 'Close') : zh ? '查看' : 'Open'}
                    </button>
                  </div>
                </div>

                {openId === draft.id && (
                  <div className="mt-3 space-y-3 rounded-md border border-gray-200 p-3">
                    {detailQuery.isLoading ? (
                      <div className="text-sm text-gray-500">{zh ? '加载中…' : 'Loading…'}</div>
                    ) : candidates.length === 0 ? (
                      <div className="text-sm text-gray-500">
                        {zh ? '这个草稿没有参数。' : 'This draft has no parameters.'}
                      </div>
                    ) : (
                      <>
                        <div className="text-xs text-gray-500">
                          {candidates.length} {zh ? '条参数' : 'parameter(s)'}
                          {draft.notes ? <> · {draft.notes}</> : null}
                        </div>
                        <div className="divide-y divide-gray-100">
                          {candidates.map((candidate, index) => {
                            const key = `${candidate.label}\u0000${candidate.value}`;
                            const isChecked = draftState[key] !== false;
                            return (
                              <div key={`${key}-${index}`} className="flex items-start gap-2 py-1.5 text-sm">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => setDraftState((prev) => ({ ...prev, [key]: e.target.checked }))}
                                  className="mt-1"
                                />
                                <span className="min-w-[180px] text-gray-500">{candidate.label}</span>
                                <span className="font-mono text-xs text-gray-900">{candidate.value}</span>
                                <span className="ml-auto text-right text-[11px] text-gray-400">
                                  {candidate.source_url ? (
                                    <a
                                      href={candidate.source_url}
                                      target="_blank"
                                      rel="noopener noreferrer nofollow"
                                      className="underline"
                                      title={candidate.evidence || ''}
                                    >
                                      {candidate.source_type || 'source'}
                                    </a>
                                  ) : (
                                    <span className="text-red-500">{zh ? '无来源' : 'no source'}</span>
                                  )}
                                  {candidate.conflict && (
                                    <span className="ml-1 text-amber-600">
                                      {zh ? `冲突：${(candidate.alternatives || []).join(' / ')}` : `conflict: ${(candidate.alternatives || []).join(' / ')}`}
                                    </span>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2">
                          <button
                            onClick={() =>
                              approveMutation.mutate({ id: draft.id, candidates: selected, overwrite })
                            }
                            disabled={approveMutation.isPending || selected.length === 0}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {approveMutation.isPending
                              ? zh
                                ? '写入中…'
                                : 'Applying…'
                              : zh
                                ? `通过并写入 ${selected.length} 条参数`
                                : `Approve and apply ${selected.length}`}
                          </button>
                          <label className="flex items-center gap-1 text-xs text-gray-600">
                            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                            {zh ? '覆盖已有参数' : 'Overwrite existing values'}
                          </label>
                          <div className="ml-auto flex items-center gap-2">
                            <input
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              placeholder={zh ? '驳回原因（可选）' : 'Reason (optional)'}
                              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                            />
                            <button
                              onClick={() => rejectMutation.mutate({ id: draft.id, reason: rejectReason })}
                              disabled={rejectMutation.isPending}
                              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                            >
                              {zh ? '驳回' : 'Reject'}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
            >
              {zh ? '上一页' : 'Prev'}
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
            >
              {zh ? '下一页' : 'Next'}
            </button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
