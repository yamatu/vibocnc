'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { AIListingService, type AIListingJobOptions } from '@/services/ai-listing.service';
import { AIAgentService, type AIAgentSEOJob } from '@/services/ai-agent.service';
import { getErrorMessage } from '@/lib/errors';

export interface AIListingJobFilters {
  category_id?: number;
  include_descendants?: boolean;
  brand?: string;
  search?: string;
  status?: 'active' | 'inactive' | 'all';
  featured?: 'true' | 'false';
  ai_seo_status?: 'optimized' | 'not_optimized' | 'running' | 'failed';
}

interface AIListingJobModalProps {
  open: boolean;
  locale: string;
  isAdmin: boolean;
  selectedIds: number[];
  selectAllResults: boolean;
  totalProducts: number;
  filters: AIListingJobFilters;
  onClose: () => void;
  onStarted: (job: AIAgentSEOJob) => void;
}

type Scope = 'selected' | 'filtered' | 'failed';
type Mode = 'full' | 'category';

export default function AIListingJobModal({ open, locale, isAdmin, selectedIds, selectAllResults, totalProducts, filters, onClose, onStarted }: AIListingJobModalProps) {
  const zh = locale === 'zh';
  const hasSelection = !selectAllResults && selectedIds.length > 0;
  const [scope, setScope] = useState<Scope>('filtered');
  const [mode, setMode] = useState<Mode>('full');
  const [skipGood, setSkipGood] = useState(true);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [createCategories, setCreateCategories] = useState(true);
  const [activateResolved, setActivateResolved] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (open) setScope(hasSelection ? 'selected' : 'filtered');
  }, [open, hasSelection]);

  if (!open) return null;

  const start = async () => {
    setStarting(true);
    try {
      const explicit = scope === 'selected';
      let job: AIAgentSEOJob;
      if (mode === 'category') {
        job = await AIAgentService.startCategoryOptimizationJob({
          product_ids: explicit ? selectedIds : undefined,
          limit: 0,
          ...(explicit ? {} : filters),
          status: explicit ? 'all' : filters.status || 'all',
          include_inactive: true,
          ai_seo_status: !explicit ? (scope === 'failed' ? 'failed' : filters.ai_seo_status) : undefined,
          use_web_search: useWebSearch,
          create_missing_categories: createCategories,
          activate_resolved: activateResolved,
          use_llm_fallback: true,
        });
      } else {
        const options: AIListingJobOptions = {
          product_ids: explicit ? selectedIds : undefined,
          ...(explicit ? {} : filters),
          failed_only: scope === 'failed',
          force: !skipGood,
          use_web_search: useWebSearch,
          create_categories: createCategories,
          activate_resolved: activateResolved,
          instruction: instruction.trim() || undefined,
        };
        job = await AIListingService.startJob(options);
      }
      toast.success(zh ? `AI 任务已创建：${job.total.toLocaleString()} 个产品，后台处理中` : `AI job started for ${job.total.toLocaleString()} products`);
      onStarted(job);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, zh ? '创建 AI 任务失败' : 'Unable to start the AI job'));
    } finally {
      setStarting(false);
    }
  };

  const scopeOption = (value: Scope, title: string, detail: string, disabled = false) => (
    <label className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${scope === value ? 'border-violet-400 bg-violet-50 text-violet-950 ring-1 ring-violet-200' : 'border-gray-200 text-gray-700'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input type="radio" name="ai-listing-scope" checked={scope === value} disabled={disabled} onChange={() => setScope(value)} className="mt-0.5 border-gray-300 text-violet-600" />
      <span><strong className="block font-semibold">{title}</strong><span className="text-xs">{detail}</span></span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><SparklesIcon className="h-5 w-5 text-violet-600" />{zh ? 'AI 智能优化' : 'AI smart optimization'}</h2>
            <p className="mt-1 text-sm text-gray-600">
              {zh
                ? '逐个质检产品：资料完整且 SEO 合格的直接跳过；旧字段产品（缺型号/零件号/品牌）、分类缺失、描述单薄或 SEO 不合格的，按固定格式联网检索并重写全部内容。价格和库存不会改动。'
                : 'Each product is checked first: healthy listings are skipped; legacy, uncategorized, thin or poorly optimized ones are researched and rewritten in the fixed format. Price and stock are never changed.'}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={starting} className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label={zh ? '关闭' : 'Close'}><XMarkIcon className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 px-5 py-5">
          <fieldset>
            <legend className="text-sm font-medium text-gray-800">{zh ? '处理范围' : 'Scope'}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {scopeOption('selected', zh ? '已勾选' : 'Checked', zh ? `${selectedIds.length.toLocaleString()} 个产品` : `${selectedIds.length.toLocaleString()} products`, !hasSelection)}
              {scopeOption('filtered', zh ? '当前筛选全部' : 'All filtered', zh ? `${totalProducts.toLocaleString()} 个产品` : `${totalProducts.toLocaleString()} products`)}
              {scopeOption('failed', zh ? '仅重试失败' : 'Retry failed', zh ? '当前筛选内上次失败的' : 'Failed within filters')}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium text-gray-800">{zh ? '优化内容' : 'What to optimize'}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${mode === 'full' ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-200' : 'border-gray-200'}`}>
                <input type="radio" name="ai-listing-mode" checked={mode === 'full'} onChange={() => setMode('full')} className="mt-0.5 border-gray-300 text-violet-600" />
                <span><strong className="block font-semibold">{zh ? '全字段优化（推荐）' : 'Full listing (recommended)'}</strong><span className="text-xs text-gray-600">{zh ? '名称、型号、零件号、品牌、描述、SEO、分类、空白的重量/质保/交期' : 'Name, identity, description, SEO, category and blank commerce fields'}</span></span>
              </label>
              <label className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${mode === 'category' ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-200' : 'border-gray-200'} ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                <input type="radio" name="ai-listing-mode" checked={mode === 'category'} disabled={!isAdmin} onChange={() => setMode('category')} className="mt-0.5 border-gray-300 text-violet-600" />
                <span><strong className="block font-semibold">{zh ? '仅重新分类' : 'Category only'}</strong><span className="text-xs text-gray-600">{zh ? '只按品牌 > 类型校正分类，不改文字（需管理员）' : 'Only fix categories (admin)'}</span></span>
              </label>
            </div>
          </fieldset>
          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
            {mode === 'full' && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={skipGood} onChange={(event) => setSkipGood(event.target.checked)} className="mt-0.5 rounded border-gray-300 text-violet-600" />
                <span>{zh ? '跳过资料完整且 SEO 合格的产品（取消勾选 = 强制全部重写，也会处理已关闭自动 SEO 的产品）' : 'Skip listings that already pass the check (uncheck to force a rewrite)'}</span>
              </label>
            )}
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={useWebSearch} onChange={(event) => setUseWebSearch(event.target.checked)} className="mt-0.5 rounded border-gray-300 text-violet-600" />
              <span>{zh ? '按型号/零件号联网检索资料' : 'Research the part number online'}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={createCategories} onChange={(event) => setCreateCategories(event.target.checked)} className="mt-0.5 rounded border-gray-300 text-violet-600" />
              <span>{zh ? 'AI 读取全部分类判断；没有合适分类时自动创建（品牌 > 品牌类目 > 产品类型）' : 'Create missing Brand > product line > type categories'}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={activateResolved} onChange={(event) => setActivateResolved(event.target.checked)} className="mt-0.5 rounded border-gray-300 text-violet-600" />
              <span>{zh ? '优化并归类成功后，自动上架当前停用的产品' : 'Publish inactive products once optimized'}</span>
            </label>
          </div>
          {mode === 'full' && (
            <label className="block text-sm font-medium text-gray-800">
              {zh ? '补充说明（可选）' : 'Extra instruction (optional)'}
              <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={1000} rows={3} placeholder={zh ? '例如：这批都是翻新件；描述里强调适用 IRC5 控制柜' : 'e.g. these are refurbished units'} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
            </label>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={starting} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{zh ? '取消' : 'Cancel'}</button>
          <button type="button" onClick={() => void start()} disabled={starting || (scope === 'selected' && !hasSelection)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            <SparklesIcon className={`h-4 w-4 ${starting ? 'animate-spin' : ''}`} />
            {starting ? (zh ? '正在创建…' : 'Starting…') : (zh ? '开始优化' : 'Start')}
          </button>
        </div>
      </div>
    </div>
  );
}
