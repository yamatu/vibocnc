'use client';

import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { ArrowPathIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { AIListingService, type AIListingGenerateRequest, type AIListingGenerateResult } from '@/services/ai-listing.service';
import { getErrorMessage } from '@/lib/errors';

interface AIListingAssistProps {
  locale: string;
  productId?: number;
  getCurrent: () => AIListingGenerateRequest;
  onApply: (result: AIListingGenerateResult) => void;
}

// Researches the part number online and rewrites the whole form in the fixed
// listing format; the administrator reviews the filled form before saving.
export default function AIListingAssist({ locale, productId, getCurrent, onApply }: AIListingAssistProps) {
  const zh = locale === 'zh';
  const [running, setRunning] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [createCategory, setCreateCategory] = useState(true);
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<AIListingGenerateResult | null>(null);

  const run = async () => {
    const current = getCurrent();
    if (![current.sku, current.model, current.part_number, current.name].some((value) => String(value || '').trim())) {
      toast.error(zh ? '请先填写产品名称、SKU 或型号' : 'Enter a product name, SKU or model first');
      return;
    }
    setRunning(true);
    try {
      const data = await AIListingService.generate({
        ...current,
        product_id: productId,
        instruction: instruction.trim() || undefined,
        use_web_search: useWebSearch,
        create_category: createCategory,
      });
      setResult(data);
      onApply(data);
      toast.success(zh ? 'AI 已按固定格式填好表单，请核对后保存' : 'AI filled the form in the listing format — review and save');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, zh ? 'AI 智能优化失败' : 'AI optimization failed'));
    } finally {
      setRunning(false);
    }
  };

  const category = result?.category;
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-violet-900">
            <SparklesIcon className="h-4 w-4" />
            {zh ? 'AI 智能优化（识别型号 + 联网检索）' : 'AI smart optimize (identify + web research)'}
          </h3>
          <p className="mt-1 text-xs leading-5 text-violet-800">
            {zh
              ? '根据当前名称 / SKU / 型号联网检索资料，按固定格式重写名称、型号、零件号、描述、SEO，并按「品牌 > 品牌类目 > 产品类型」匹配或创建分类。价格与库存不会改动。'
              : 'Researches the part online and rewrites name, model, part number, description and SEO in the fixed format, matching or creating the Brand > product line > product type category. Price and stock are untouched.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
          {running ? (zh ? '检索并生成中…（约 30-90 秒）' : 'Researching… (30-90s)') : (zh ? 'AI 一键优化' : 'Optimize with AI')}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-violet-900">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={useWebSearch} onChange={(event) => setUseWebSearch(event.target.checked)} className="rounded border-violet-300 text-violet-600 focus:ring-violet-500" />
          {zh ? '联网检索型号资料' : 'Web research'}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={createCategory} onChange={(event) => setCreateCategory(event.target.checked)} className="rounded border-violet-300 text-violet-600 focus:ring-violet-500" />
          {zh ? '没有合适分类时自动创建' : 'Create missing category'}
        </label>
        <input
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          maxLength={500}
          placeholder={zh ? '可选补充说明，例如：这是翻新件 / 适用 IRC5P 控制柜' : 'Optional note, e.g. refurbished unit'}
          className="min-w-[220px] flex-1 rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-violet-500 focus:outline-none"
        />
      </div>
      {result && (
        <div className="mt-3 space-y-1.5 rounded-md border border-violet-200 bg-white px-3 py-2 text-xs text-gray-700">
          <div>
            <span className="font-medium text-gray-900">{zh ? '分类：' : 'Category: '}</span>
            {category?.path?.length ? category.path.join(' > ') : (result.category_path || []).join(' > ') || '—'}
            {category?.created && category.missing?.length > 0 && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">{zh ? `已新建：${category.missing.join(' > ')}` : `Created: ${category.missing.join(' > ')}`}</span>}
            {category && !category.category_id && category.missing?.length > 0 && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{zh ? `需新建：${category.missing.join(' > ')}（已关闭自动创建）` : `Missing: ${category.missing.join(' > ')}`}</span>}
            {result.category_message && <span className="ml-1.5 text-amber-700">{result.category_message}</span>}
          </div>
          {result.quality_issues.length > 0 && (
            <div>
              <span className="font-medium text-gray-900">{zh ? '原资料问题：' : 'Issues fixed: '}</span>
              {result.quality_issues.map((issue) => issue.detail).join('；')}
            </div>
          )}
          <div>
            <span className="font-medium text-gray-900">{zh ? '参考来源：' : 'Sources: '}</span>
            {result.evidence.length === 0
              ? (zh ? '未检索到公开资料，内容仅依据现有信息' : 'No public sources found; based on existing data only')
              : result.evidence.filter((item) => /^https?:\/\//i.test(item.url)).slice(0, 5).map((item, index) => (
                <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noopener noreferrer" className="mr-2 text-violet-700 underline hover:text-violet-900">
                  {item.title ? item.title.slice(0, 40) : item.url}
                </a>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
