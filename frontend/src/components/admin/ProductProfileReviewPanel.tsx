'use client';

import { useAuth } from '@/hooks/useAuth';
import {
  ebayMarketService,
  type ProductProfileDraft,
} from '@/services/ebay-market.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

/**
 * Human review queue for AI product identification.
 *
 * Nothing in this panel is auto-published. Approve sends explicit choices for
 * title/content/category; cited specs are routed into the separate Spec
 * Research queue and still require their own approval.
 */
export default function ProductProfileReviewPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [status, setStatus] = useState('pending');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applyTitle, setApplyTitle] = useState(true);
  const [applyContent, setApplyContent] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [allowNewType, setAllowNewType] = useState(false);
  const [activateProduct, setActivateProduct] = useState(false);
  const [forceStale, setForceStale] = useState(false);

  const draftsQuery = useQuery({
    queryKey: ['ebay-profile-drafts', status],
    queryFn: () => ebayMarketService.listProfileDrafts({ status, limit: 50 }),
  });

  const drafts = useMemo(() => draftsQuery.data?.drafts ?? [], [draftsQuery.data]);
  useEffect(() => {
    if (!drafts.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !drafts.some((draft) => draft.id === selectedId)) {
      setSelectedId(drafts[0].id);
    }
  }, [drafts, selectedId]);

  const selected = drafts.find((draft) => draft.id === selectedId) ?? null;

  const approveMutation = useMutation({
    mutationFn: (draft: ProductProfileDraft) =>
      ebayMarketService.approveProfileDraft(draft.id, {
        apply_title: applyTitle,
        apply_content: applyContent,
        overwrite_existing: overwriteExisting,
        allow_new_product_types: allowNewType,
        activate_product: activateProduct,
        force_stale: forceStale,
      }),
    onSuccess: (result) => {
      toast.success('产品画像已批准并应用');
      if (result?.spec_draft_id) {
        toast.success('引用规格已进入 Spec Research，尚未发布');
      }
      setForceStale(false);
      invalidateProfileQueries(qc);
    },
    onError: (error: unknown) => {
      const message = apiErrorMessage(error, '批准失败');
      toast.error(message);
      if (message.toLowerCase().includes('changed after')) {
        setForceStale(true);
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ draft, reason }: { draft: ProductProfileDraft; reason: string }) =>
      ebayMarketService.rejectProfileDraft(draft.id, reason),
    onSuccess: () => {
      toast.success('画像草稿已拒绝');
      invalidateProfileQueries(qc);
    },
    onError: () => toast.error('拒绝失败'),
  });

  const reject = (draft: ProductProfileDraft) => {
    const reason = window.prompt('拒绝原因（可选）', '') ?? null;
    if (reason === null) {
      return;
    }
    rejectMutation.mutate({ draft, reason });
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-gray-900">AI 产品画像审核</h2>
          <p className="mt-1 text-sm text-gray-600">
            AI 先判断“这是什么”，管理员批准后才写入标题、分类、描述和 SEO。
          </p>
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="pending">待审核</option>
          <option value="approved">已批准</option>
          <option value="rejected">已拒绝</option>
          <option value="superseded">已被新结果替代</option>
          <option value="all">全部</option>
        </select>
      </div>

      {draftsQuery.isLoading ? (
        <p className="mt-4 text-sm text-gray-500">加载中…</p>
      ) : drafts.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          暂无{status === 'pending' ? '待审核' : ''}画像。可在上方输入型号进行 AI 识别。
        </p>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
            {drafts.map((draft) => (
              <button
                key={draft.id}
                onClick={() => setSelectedId(draft.id)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedId === draft.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-gray-900">{draft.proposed_title || draft.model}</span>
                  <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {(draft.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {draft.sku || '未关联产品'} · {formatTime(draft.created_at)}
                </p>
              </button>
            ))}
          </div>

          {selected && (
            <ProfileDraftDetail
              draft={selected}
              isAdmin={isAdmin}
              applyTitle={applyTitle}
              setApplyTitle={setApplyTitle}
              applyContent={applyContent}
              setApplyContent={setApplyContent}
              overwriteExisting={overwriteExisting}
              setOverwriteExisting={setOverwriteExisting}
              allowNewType={allowNewType}
              setAllowNewType={setAllowNewType}
              activateProduct={activateProduct}
              setActivateProduct={setActivateProduct}
              forceStale={forceStale}
              setForceStale={setForceStale}
              approving={approveMutation.isPending}
              rejecting={rejectMutation.isPending}
              onApprove={() => approveMutation.mutate(selected)}
              onReject={() => reject(selected)}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ProfileDraftDetail({
  draft,
  isAdmin,
  applyTitle,
  setApplyTitle,
  applyContent,
  setApplyContent,
  overwriteExisting,
  setOverwriteExisting,
  allowNewType,
  setAllowNewType,
  activateProduct,
  setActivateProduct,
  forceStale,
  setForceStale,
  approving,
  rejecting,
  onApprove,
  onReject,
}: {
  draft: ProductProfileDraft;
  isAdmin: boolean;
  applyTitle: boolean;
  setApplyTitle: (value: boolean) => void;
  applyContent: boolean;
  setApplyContent: (value: boolean) => void;
  overwriteExisting: boolean;
  setOverwriteExisting: (value: boolean) => void;
  allowNewType: boolean;
  setAllowNewType: (value: boolean) => void;
  activateProduct: boolean;
  setActivateProduct: (value: boolean) => void;
  forceStale: boolean;
  setForceStale: (value: boolean) => void;
  approving: boolean;
  rejecting: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const pending = draft.status === 'pending';
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">建议标题</p>
          <h3 className="mt-1 text-lg font-semibold text-gray-900">{draft.proposed_title}</h3>
          <p className="mt-1 text-sm text-gray-600">
            {draft.profile.brand} · {draft.profile.part_type} · 建议分类 {draft.proposed_category_name}
          </p>
        </div>
        <span className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
          置信度 {(draft.confidence * 100).toFixed(0)}%
        </span>
      </div>

      {draft.product ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <CompareField label="当前标题" current={draft.product.name} proposed={draft.proposed_title || ''} />
          <CompareField
            label="短描述"
            current={draft.product.short_description}
            proposed={draft.content.short_description}
          />
          <CompareField
            label="Meta Title"
            current={draft.product.meta_title}
            proposed={draft.content.meta_title}
          />
          <CompareField
            label="Meta Description"
            current={draft.product.meta_description}
            proposed={draft.content.meta_description}
          />
        </div>
      ) : (
        <p className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-800">
          该画像没有唯一匹配到产品，只能查看，不能批准。
        </p>
      )}

      <div className="mt-4">
        <p className="text-xs font-medium uppercase text-gray-500">AI 对产品的理解</p>
        <p className="mt-1 text-sm text-gray-700">{draft.profile.what_it_is || '未提供摘要'}</p>
        {draft.profile.key_functions.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
            {draft.profile.key_functions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
        {draft.reason && <p className="mt-2 text-xs text-gray-500">识别依据：{draft.reason}</p>}
      </div>

      <details className="mt-4 rounded border border-gray-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-800">预览完整描述与 SEO</summary>
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="text-xs font-medium text-gray-500">描述</p>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 font-sans text-xs text-gray-700">
              {draft.content.description}
            </pre>
          </div>
          <div><span className="font-medium">关键词：</span>{draft.content.meta_keywords}</div>
        </div>
      </details>

      {draft.profile.specs.length > 0 && (
        <div className="mt-4 rounded border border-blue-100 bg-blue-50 p-3">
          <p className="text-sm font-medium text-blue-900">引用规格（批准画像后仍不会直接发布）</p>
          <ul className="mt-2 space-y-1 text-sm text-blue-900">
            {draft.profile.specs.map((spec) => (
              <li key={`${spec.label}-${spec.value}`}>
                {spec.label}: {spec.value}{' '}
                {spec.source_url && (
                  <a href={spec.source_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                    来源
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-blue-800">
            批准后仅创建 Spec Research 草稿，需再次逐条审核来源。
          </p>
        </div>
      )}

      {draft.evidence.length > 0 && (
        <details className="mt-4 rounded border border-gray-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-800">
            查看 eBay 证据（{draft.evidence.length}）
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {draft.evidence.map((item) => (
              <li key={item.url || item.title}>
                <a href={item.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pending && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <Check label="应用统一标题" checked={applyTitle} onChange={setApplyTitle} />
            <Check label="填充描述与 SEO" checked={applyContent} onChange={setApplyContent} />
            <Check label="覆盖已有成熟文案" checked={overwriteExisting} onChange={setOverwriteExisting} />
            <Check label="允许创建新的产品类型分类" checked={allowNewType} onChange={setAllowNewType} />
            <Check label="同时激活产品" checked={activateProduct} onChange={setActivateProduct} />
            <Check label="产品已变化，仍强制批准" checked={forceStale} onChange={setForceStale} />
          </div>
          {!isAdmin && (
            <p className="mt-3 text-sm text-amber-700">只有管理员能批准或拒绝画像。</p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={onApprove}
              disabled={!isAdmin || !draft.product_id || approving}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {approving ? '应用中…' : '批准并应用'}
            </button>
            <button
              onClick={onReject}
              disabled={!isAdmin || rejecting}
              className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50"
            >
              拒绝
            </button>
          </div>
        </div>
      )}

      {!pending && (
        <p className="mt-4 text-sm text-gray-500">
          状态：{draft.status}{draft.applied_fields?.length ? ` · 已应用 ${draft.applied_fields.join(', ')}` : ''}
        </p>
      )}
    </div>
  );
}

function CompareField({ label, current, proposed }: { label: string; current: string; proposed: string }) {
  return (
    <div className="min-w-0 rounded border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 line-clamp-2 text-xs text-gray-500">当前：{current || '（空）'}</p>
      <p className="mt-1 line-clamp-3 text-sm text-gray-900">建议：{proposed || '（空）'}</p>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function invalidateProfileQueries(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['ebay-profile-drafts'] });
  void qc.invalidateQueries({ queryKey: ['ebay-market-quotes'] });
  void qc.invalidateQueries({ queryKey: ['ebay-market-price-preview'] });
  void qc.invalidateQueries({ queryKey: ['products'] });
  void qc.invalidateQueries({ queryKey: ['spec-drafts'] });
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null) {
    const maybe = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
    return maybe.response?.data?.message || maybe.response?.data?.error || maybe.message || fallback;
  }
  return fallback;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN');
}
