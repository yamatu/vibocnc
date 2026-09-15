'use client';

import AdminLayout from '@/components/admin/AdminLayout';
import { ProductSpecService } from '@/services';
import type { ProductSpecDraft, ProductSpecDraftDetail, SpecResearchCandidate } from '@/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

/**
 * Review queue for parameters researched from a model number (型号).
 *
 * The pipeline reads public manufacturer/distributor pages and proposes values.
 * Nothing is published from this queue automatically: the reviewer opens the
 * cited page, confirms the value, and only then is it written into the product's
 * technical specifications. Values without a citation are refused by the API.
 */
export default function AdminSpecDraftsPage() {
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [includeAI, setIncludeAI] = useState(true);
  const [manualBrand, setManualBrand] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [manualSku, setManualSku] = useState('');

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
      toast.success(`Draft created for ${draft.model || draft.sku || 'model'} — review before applying`);
      setStatusFilter('pending');
      setSelectedId(draft.id);
      qc.invalidateQueries({ queryKey: ['spec-drafts'] });
    },
    onError: (err: Error) => toast.error(err?.message || 'Research failed'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      ProductSpecService.approveDraft(id, {
        candidates: ProductSpecService.sanitizeCandidates(draftRows.filter((_, index) => checked[index] !== false)),
        overwrite,
      }),
    onSuccess: (result) => {
      toast.success(`Applied ${result.added} parameter(s); ${result.skipped} kept unchanged`);
      qc.invalidateQueries({ queryKey: ['spec-drafts'] });
      qc.invalidateQueries({ queryKey: ['spec-draft', selectedId] });
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not apply draft'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => ProductSpecService.rejectDraft(id, 'Rejected during review'),
    onSuccess: () => {
      toast.success('Draft rejected');
      qc.invalidateQueries({ queryKey: ['spec-drafts'] });
      qc.invalidateQueries({ queryKey: ['spec-draft', selectedId] });
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not reject draft'),
  });

  const detail = detailQuery.data;
  const selectedDraft: ProductSpecDraft | undefined = detail?.draft;
  const selectedCount = useMemo(
    () => draftRows.filter((_, index) => checked[index] !== false).length,
    [draftRows, checked],
  );

  const confidenceBadge = (confidence?: string) => {
    const tone =
      confidence === 'high'
        ? 'bg-emerald-100 text-emerald-800'
        : confidence === 'medium'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-700';
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{confidence || 'unknown'} confidence</span>
    );
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Specification Research</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Enter a model number (型号) and the system searches public manufacturer and distributor pages for its
            parameters. Every value keeps the page it came from, and a value that cannot be found verbatim in the cited
            page is discarded. Nothing reaches a product page until you approve it here.
          </p>
        </div>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Research a model number</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">
              Brand (optional)
              <input
                value={manualBrand}
                onChange={(event) => setManualBrand(event.target.value)}
                placeholder="e.g. Mitsubishi"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Model (型号)
              <input
                value={manualModel}
                onChange={(event) => setManualModel(event.target.value)}
                placeholder="e.g. MR-J4-40A"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              SKU (optional)
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
                {researchMutation.isPending ? 'Searching…' : 'Research'}
              </button>
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={includeAI} onChange={(event) => setIncludeAI(event.target.checked)} />
            Use AI to read the pages (every AI value is still verified against the page text)
          </label>
          <p className="mt-2 text-xs text-slate-500">
            To research many products at once, select them in{' '}
            <Link href="/admin/products" className="text-blue-600 underline">
              Products
            </Link>{' '}
            and use “Research specs”.
          </p>
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
                  <option value="pending">Pending review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="all">All</option>
                </select>
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search SKU / model"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <p className="text-xs text-slate-500">
                {draftsQuery.data ? `${draftsQuery.data.total} draft(s)` : 'Loading…'}
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
                      {draft.sku || 'no SKU'}
                      {draft.product_id ? ` · product #${draft.product_id}` : ' · not linked to a product'}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{draft.status}</div>
                  </button>
                </li>
              ))}
              {(draftsQuery.data?.data ?? []).length === 0 && !draftsQuery.isLoading && (
                <li className="px-4 py-6 text-center text-sm text-slate-500">No drafts in this view.</li>
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
                  Prev
                </button>
                <span>
                  Page {draftsQuery.data.page} / {draftsQuery.data.total_pages}
                </span>
                <button
                  type="button"
                  disabled={page >= draftsQuery.data.total_pages}
                  onClick={() => setPage((current) => current + 1)}
                  className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {!selectedDraft && <p className="text-sm text-slate-500">Select a draft to review its parameters.</p>}

            {selectedDraft && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{selectedDraft.model}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {confidenceBadge(selectedDraft.confidence)}
                      <span>status: {selectedDraft.status}</span>
                      {selectedDraft.product_id ? (
                        <Link href={`/admin/products?search=${encodeURIComponent(selectedDraft.sku || '')}`} className="text-blue-600 underline">
                          product #{selectedDraft.product_id}
                        </Link>
                      ) : selectedDraft.sku ? (
                        <span>will be linked by SKU {selectedDraft.sku} on apply</span>
                      ) : (
                        <span>not linked to a product — research it from the product to apply the parameters</span>
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
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={approveMutation.isPending || selectedCount === 0 || (!selectedDraft.product_id && !selectedDraft.sku)}
                        onClick={() => approveMutation.mutate(selectedDraft.id)}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {approveMutation.isPending ? 'Applying…' : `Apply ${selectedCount} parameter(s)`}
                      </button>
                    </div>
                  )}
                </div>

                {selectedDraft.notes && <p className="mt-3 text-sm text-slate-600">{selectedDraft.notes}</p>}

                <label className="mt-4 flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                  Overwrite parameters that are already published (default keeps the existing value)
                </label>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-2">Use</th>
                        <th className="px-2 py-2">Parameter</th>
                        <th className="px-2 py-2">Value</th>
                        <th className="px-2 py-2">Source</th>
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
                            {candidate.origin === 'ai' && (
                              <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                AI
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
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500">
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
                              <span className="text-rose-600">no citation</span>
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
                            No verifiable parameter was found for this model. Enter the specifications manually on the
                            product instead of publishing a guess.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {detail && detail.evidence.length > 0 && (
                  <details className="mt-5 rounded-lg bg-slate-50 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                      Evidence pages ({detail.evidence.length})
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
