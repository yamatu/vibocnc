'use client';

import { Fragment, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, ClipboardDocumentListIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  AIListingService,
  type ListingImportApplyResult,
  type ListingImportFieldKey,
  type ListingImportItem,
} from '@/services/ai-listing.service';
import { getErrorMessage } from '@/lib/errors';

const FIELD_LABELS: Record<ListingImportFieldKey, [string, string]> = {
  name: ['产品名称', 'Name'],
  brand: ['品牌', 'Brand'],
  model: ['型号', 'Model'],
  part_number: ['零件号', 'Part number'],
  price: ['价格', 'Price'],
  stock_quantity: ['库存', 'Stock'],
  warranty_period: ['质保期', 'Warranty'],
  lead_time: ['交货期', 'Lead time'],
  weight: ['重量(kg)', 'Weight (kg)'],
  short_description: ['简介', 'Short description'],
  description: ['描述', 'Description'],
  meta_title: ['SEO 标题', 'SEO title'],
  meta_description: ['SEO 描述', 'SEO description'],
  meta_keywords: ['SEO 关键词', 'SEO keywords'],
};

const CATEGORY_BATCH = 10;
const APPLY_BATCH = 20;

interface ListingImportModalProps {
  open: boolean;
  locale: string;
  onClose: () => void;
  onImported: () => void;
}

function recomputeItem(item: ListingImportItem): ListingImportItem {
  if (item.action === 'invalid') return item;
  if (item.product_id === 0) return { ...item, action: 'create' };
  const changed = item.apply_category || item.fields.some((field) => field.apply);
  return { ...item, action: changed ? 'update' : 'unchanged' };
}

function preview(value: string, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || '—';
}

export default function ListingImportModal({ open, locale, onClose, onImported }: ListingImportModalProps) {
  const zh = locale === 'zh';
  const [text, setText] = useState('');
  const [useAICategory, setUseAICategory] = useState(true);
  const [activateNew, setActivateNew] = useState(true);
  const [disableAutoSEO, setDisableAutoSEO] = useState(true);
  const [items, setItems] = useState<ListingImportItem[]>([]);
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<'' | 'parsing' | 'categorizing' | 'applying'>('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Record<number, ListingImportApplyResult>>({});

  const counts = useMemo(() => {
    const summary = { create: 0, update: 0, unchanged: 0, invalid: 0 };
    items.forEach((item) => { summary[item.action] += 1; });
    return summary;
  }, [items]);
  const selectedCount = items.filter((item) => included[item.index]).length;

  if (!open) return null;

  const reset = () => {
    setItems([]);
    setIncluded({});
    setResults({});
    setExpanded(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    setText('');
    onClose();
  };

  const categorize = async (parsed: ListingImportItem[]) => {
    const candidates = parsed.filter((item) => item.action !== 'invalid');
    if (candidates.length === 0) return parsed;
    setBusy('categorizing');
    setProgress({ done: 0, total: candidates.length });
    const byIndex = new Map(parsed.map((item) => [item.index, item]));
    let failedBatches = 0;
    for (let start = 0; start < candidates.length; start += CATEGORY_BATCH) {
      const batch = candidates.slice(start, start + CATEGORY_BATCH);
      try {
        const decisions = await AIListingService.suggestCategories(batch.map((item) => ({
          index: item.index,
          name: item.record.name,
          brand: item.record.brand,
          model: item.record.model,
          part_number: item.record.part_number,
          category_text: item.record.category_text,
          description: item.record.short_description || item.record.description,
        })));
        decisions.forEach((decision) => {
          const item = byIndex.get(decision.index);
          if (!item || decision.category_path.length === 0) return;
          const applyCategory = item.product_id === 0 || item.current_category_id === 0 || decision.category.category_id !== item.current_category_id;
          byIndex.set(decision.index, recomputeItem({ ...item, category_path: decision.category_path, category: decision.category, apply_category: applyCategory }));
        });
      } catch {
        failedBatches += 1;
      }
      setProgress({ done: Math.min(start + batch.length, candidates.length), total: candidates.length });
      setItems(parsed.map((item) => byIndex.get(item.index) || item));
    }
    if (failedBatches > 0) {
      toast.error(zh ? `${failedBatches} 批 AI 分类失败，这些产品使用资料中的分类文字` : `${failedBatches} AI category batches failed; text categories are used`);
    }
    return parsed.map((item) => byIndex.get(item.index) || item);
  };

  const runPreview = async () => {
    if (text.trim().length < 10) {
      toast.error(zh ? '请先粘贴产品资料' : 'Paste product listings first');
      return;
    }
    reset();
    setBusy('parsing');
    try {
      let parsed = await AIListingService.previewImport(text);
      setItems(parsed);
      setIncluded(Object.fromEntries(parsed.map((item) => [item.index, item.action === 'create' || item.action === 'update'])));
      if (useAICategory) {
        parsed = await categorize(parsed);
        setItems(parsed);
        setIncluded(Object.fromEntries(parsed.map((item) => [item.index, item.action === 'create' || item.action === 'update'])));
      }
      toast.success(zh ? `识别到 ${parsed.length} 个产品` : `${parsed.length} products recognised`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, zh ? '解析失败' : 'Parsing failed'));
    } finally {
      setBusy('');
    }
  };

  const updateItem = (index: number, updater: (item: ListingImportItem) => ListingImportItem) => {
    setItems((current) => current.map((item) => (item.index === index ? recomputeItem(updater(item)) : item)));
  };

  const setOverwriteMode = (overwrite: boolean) => {
    setItems((current) => current.map((item) => recomputeItem({
      ...item,
      fields: item.fields.map((field) => ({ ...field, apply: field.status === 'fill' || (overwrite && field.status === 'overwrite') })),
    })));
  };

  const apply = async () => {
    const targets = items.filter((item) => included[item.index] && (item.action === 'create' || item.action === 'update'));
    if (targets.length === 0) {
      toast.error(zh ? '没有需要导入或更新的产品' : 'Nothing to import');
      return;
    }
    setBusy('applying');
    setProgress({ done: 0, total: targets.length });
    const collected: Record<number, ListingImportApplyResult> = {};
    try {
      for (let start = 0; start < targets.length; start += APPLY_BATCH) {
        const batch = targets.slice(start, start + APPLY_BATCH);
        const batchResults = await AIListingService.applyImport(batch.map((item) => ({
          index: item.index,
          record: item.record,
          product_id: item.product_id,
          fields: item.fields.filter((field) => field.apply).map((field) => field.key),
          category_path: item.category_path,
          apply_category: item.apply_category,
        })), { activate_new: activateNew, disable_auto_seo: disableAutoSEO });
        batchResults.forEach((result) => { collected[result.index] = result; });
        setResults({ ...collected });
        setProgress({ done: Math.min(start + batch.length, targets.length), total: targets.length });
      }
      const values = Object.values(collected);
      const created = values.filter((result) => result.status === 'created').length;
      const updated = values.filter((result) => result.status === 'updated').length;
      const failed = values.filter((result) => result.status === 'failed').length;
      toast.success(zh ? `导入完成：新建 ${created}，更新 ${updated}，失败 ${failed}` : `Done: ${created} created, ${updated} updated, ${failed} failed`);
      onImported();
    } catch (error: unknown) {
      setResults({ ...collected });
      toast.error(getErrorMessage(error, zh ? '导入失败' : 'Import failed'));
    } finally {
      setBusy('');
    }
  };

  const actionBadge = (item: ListingImportItem) => {
    const result = results[item.index];
    if (result) {
      const style = result.status === 'failed' ? 'bg-rose-100 text-rose-800' : result.status === 'skipped' ? 'bg-gray-100 text-gray-700' : 'bg-emerald-100 text-emerald-800';
      const label = { created: ['已新建', 'Created'], updated: ['已更新', 'Updated'], skipped: ['已跳过', 'Skipped'], failed: ['失败', 'Failed'] }[result.status];
      return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`} title={result.message}>{zh ? label[0] : label[1]}</span>;
    }
    const map = {
      create: ['新建', 'New', 'bg-blue-100 text-blue-800'],
      update: ['更新', 'Update', 'bg-amber-100 text-amber-800'],
      unchanged: ['无变化', 'Unchanged', 'bg-gray-100 text-gray-600'],
      invalid: ['无效', 'Invalid', 'bg-rose-100 text-rose-800'],
    }[item.action];
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[2]}`}>{zh ? map[0] : map[1]}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <ClipboardDocumentListIcon className="h-5 w-5 text-violet-600" />
              {zh ? '按固定格式粘贴批量导入' : 'Paste fixed-format listings'}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {zh
                ? '支持一次粘贴多个产品（Product Name / SKU / Price / Category / Brand / Model / Part Number / Warranty Period / Delivery Time / Weight / Description / SEO Title / SEO Description / SEO Keywords，中文字段名也可）。SKU 已存在时自动逐字段比对，你可以选择覆盖哪些字段。'
                : 'Paste one or many products in the fixed format. Existing SKUs are compared field by field so you choose what to overwrite.'}
            </p>
          </div>
          <button type="button" onClick={close} disabled={Boolean(busy)} className="rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label={zh ? '关闭' : 'Close'}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={16}
              placeholder={'Basic Information\nProduct Name*: ABB ACU-01B Air Control Unit ... 3HNA024871-001\nSKU*: 3HNA024871-001\nPrice*: $ (Request a quote)\nCategory*: Robotics Spare Parts / Paint Robot Controllers\nBrand: ABB\nModel: ACU-01B\nPart Number: 3HNA024871-001\nWarranty Period: 12 months\nDelivery Time: To be confirmed\nWeight (kg): Approx. 3.66 kg\nDescription:\nThe ABB 3HNA024871-001 ...\nSEO Title: ...\nSEO Description: ...\nSEO Keywords: ...\n\n(多个产品直接接着粘贴即可)'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-gray-700">{zh ? `共 ${items.length} 个：新建 ${counts.create} · 更新 ${counts.update} · 无变化 ${counts.unchanged} · 无效 ${counts.invalid}` : `${items.length} items: ${counts.create} new · ${counts.update} update · ${counts.unchanged} unchanged · ${counts.invalid} invalid`}</span>
                <button type="button" onClick={() => setOverwriteMode(true)} disabled={Boolean(busy)} className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50">{zh ? '已存在 SKU：覆盖不同字段' : 'Existing: overwrite differences'}</button>
                <button type="button" onClick={() => setOverwriteMode(false)} disabled={Boolean(busy)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{zh ? '已存在 SKU：只补空字段' : 'Existing: fill blanks only'}</button>
                <button type="button" onClick={() => { reset(); }} disabled={Boolean(busy)} className="text-xs font-medium text-violet-700 underline disabled:opacity-50">{zh ? '重新粘贴' : 'Paste again'}</button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedCount > 0 && items.filter((item) => item.action === 'create' || item.action === 'update').every((item) => included[item.index])}
                          onChange={(event) => setIncluded(Object.fromEntries(items.map((item) => [item.index, event.target.checked && (item.action === 'create' || item.action === 'update')])))}
                          className="rounded border-gray-300 text-violet-600"
                        />
                      </th>
                      <th className="w-6 px-1 py-2" />
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">{zh ? '操作' : 'Action'}</th>
                      <th className="px-3 py-2">{zh ? '产品名称' : 'Name'}</th>
                      <th className="px-3 py-2">{zh ? '分类（品牌 > 类目 > 类型）' : 'Category'}</th>
                      <th className="px-3 py-2">{zh ? '提示' : 'Notes'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {items.map((item) => {
                      const changedFields = item.fields.filter((field) => field.apply).length;
                      return (
                        <Fragment key={item.index}>
                          <tr className="align-top hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={Boolean(included[item.index])} disabled={item.action === 'invalid' || item.action === 'unchanged' || Boolean(results[item.index])} onChange={(event) => setIncluded((current) => ({ ...current, [item.index]: event.target.checked }))} className="rounded border-gray-300 text-violet-600 disabled:opacity-40" />
                            </td>
                            <td className="px-1 py-2">
                              <button type="button" onClick={() => setExpanded(expanded === item.index ? null : item.index)} className="rounded p-0.5 text-gray-500 hover:bg-gray-200" aria-label={zh ? '字段对比' : 'Field diff'}>
                                {expanded === item.index ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                              </button>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-800">{item.record.sku || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {actionBadge(item)}
                              {item.action === 'update' && !results[item.index] && <div className="mt-1 text-[11px] text-gray-500">{zh ? `${changedFields} 个字段${item.apply_category ? ' + 分类' : ''}` : `${changedFields} fields${item.apply_category ? ' + category' : ''}`}</div>}
                            </td>
                            <td className="max-w-xs px-3 py-2 text-gray-800">
                              <div className="line-clamp-2">{item.record.name || '—'}</div>
                              {item.product_id > 0 && <div className="mt-0.5 text-[11px] text-gray-500">{zh ? '匹配：' : 'Match: '}#{item.product_id} {item.product_sku}{item.match_type === 'part_number' ? (zh ? '（零件号）' : ' (part no.)') : ''}</div>}
                            </td>
                            <td className="max-w-xs px-3 py-2 text-xs text-gray-700">
                              {item.category_path.length > 0 ? (
                                <>
                                  <div>{item.category_path.join(' > ')}</div>
                                  {item.category.missing?.length > 0 && <div className="mt-0.5 text-[11px] text-emerald-700">{zh ? `将新建：${item.category.missing.join(' > ')}` : `Will create: ${item.category.missing.join(' > ')}`}</div>}
                                  {item.product_id > 0 && (
                                    <label className="mt-1 flex items-center gap-1 text-[11px] text-gray-600">
                                      <input type="checkbox" checked={item.apply_category} onChange={(event) => updateItem(item.index, (current) => ({ ...current, apply_category: event.target.checked }))} className="rounded border-gray-300 text-violet-600" />
                                      {zh ? `改分类（当前：${item.current_category_path.join(' > ') || '未分类'}）` : `Change (now: ${item.current_category_path.join(' > ') || 'none'})`}
                                    </label>
                                  )}
                                </>
                              ) : <span className="text-amber-700">{zh ? '无分类' : 'No category'}</span>}
                            </td>
                            <td className="max-w-xs px-3 py-2 text-[11px] text-amber-700">
                              {item.warnings.join('；')}
                              {results[item.index]?.message && <div className="text-gray-600">{results[item.index].message}</div>}
                            </td>
                          </tr>
                          {expanded === item.index && (
                            <tr className="bg-violet-50/40">
                              <td colSpan={7} className="px-5 py-3">
                                {item.fields.length === 0 ? <p className="text-xs text-gray-500">{zh ? '没有可比对的字段' : 'No comparable fields'}</p> : (
                                  <div className="grid gap-2 md:grid-cols-2">
                                    {item.fields.map((field) => (
                                      <label key={field.key} className={`flex items-start gap-2 rounded-md border bg-white px-3 py-2 text-xs ${field.status === 'same' ? 'border-gray-100 opacity-60' : 'border-gray-200'}`}>
                                        <input type="checkbox" checked={field.apply} disabled={field.status === 'same' || item.product_id === 0} onChange={(event) => updateItem(item.index, (current) => ({ ...current, fields: current.fields.map((candidate) => candidate.key === field.key ? { ...candidate, apply: event.target.checked } : candidate) }))} className="mt-0.5 rounded border-gray-300 text-violet-600" />
                                        <span className="min-w-0 flex-1">
                                          <span className="font-semibold text-gray-900">{zh ? FIELD_LABELS[field.key][0] : FIELD_LABELS[field.key][1]}</span>
                                          <span className={`ml-1.5 rounded px-1 text-[10px] ${field.status === 'fill' ? 'bg-blue-100 text-blue-800' : field.status === 'overwrite' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{field.status === 'fill' ? (zh ? '补空' : 'fill') : field.status === 'overwrite' ? (zh ? '不同' : 'differs') : (zh ? '相同' : 'same')}</span>
                                          {item.product_id > 0 && field.status !== 'fill' && <span className="mt-0.5 block text-gray-400 line-through">{preview(field.current)}</span>}
                                          <span className="mt-0.5 block text-gray-800">{preview(field.incoming, 160)}</span>
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {busy && busy !== 'parsing' && (
            <div>
              <div className="flex justify-between text-xs text-gray-600">
                <span>{busy === 'categorizing' ? (zh ? 'AI 正在读取全部分类并匹配…' : 'AI matching categories…') : (zh ? '正在导入…' : 'Importing…')}</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-gray-700">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={useAICategory} disabled={items.length > 0} onChange={(event) => setUseAICategory(event.target.checked)} className="rounded border-gray-300 text-violet-600" />
              {zh ? 'AI 读取全部分类智能归类（品牌 > 品牌类目 > 产品类型）' : 'AI category mapping'}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={activateNew} onChange={(event) => setActivateNew(event.target.checked)} className="rounded border-gray-300 text-violet-600" />
              {zh ? '新建产品直接上架' : 'Publish new products'}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={disableAutoSEO} onChange={(event) => setDisableAutoSEO(event.target.checked)} className="rounded border-gray-300 text-violet-600" />
              {zh ? '导入后关闭自动 SEO 覆盖（保留粘贴的 SEO）' : 'Disable auto SEO override'}
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={close} disabled={Boolean(busy)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{zh ? '关闭' : 'Close'}</button>
            {items.length === 0 ? (
              <button type="button" onClick={() => void runPreview()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                {busy ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : null}
                {zh ? '解析并比对' : 'Parse & compare'}
              </button>
            ) : (
              <button type="button" onClick={() => void apply()} disabled={Boolean(busy) || selectedCount === 0} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                {busy === 'applying' ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : null}
                {zh ? `导入选中的 ${selectedCount} 个产品` : `Import ${selectedCount} products`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
