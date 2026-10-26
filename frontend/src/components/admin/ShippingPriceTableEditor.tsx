'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';

import { queryKeys } from '@/lib/react-query';
import { cn } from '@/lib/utils';
import {
  ShippingRateService,
  type ShippingPriceTable,
  type ShippingSurchargeRule,
} from '@/services/shipping-rate.service';

type Translate = (zh: string, en: string) => string;
type FixedRow = { weight: string; fee: string };
type BandRow = { min: string; max: string; rate: string };

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const money = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

function toRows(table: ShippingPriceTable) {
  return {
    fixed: table.fixed.map((f) => ({ weight: String(f.weight_kg), fee: f.fee.toFixed(2) })),
    bands: table.per_kg.map((b) => ({ min: String(b.min_kg), max: b.max_kg > 0 ? String(b.max_kg) : '', rate: String(b.rate_per_kg) })),
  };
}

// Mirrors services.CalculateShippingQuote so the preview matches checkout.
function previewQuote(fixed: FixedRow[], bands: BandRow[], surcharges: ShippingSurchargeRule[], weightKg: number) {
  if (!(weightKg > 0)) return null;
  const fixedRows = fixed
    .map((r) => ({ w: num(r.weight), fee: num(r.fee) }))
    .filter((r) => r.w > 0 && r.w < 21 && r.fee > 0)
    .sort((a, b) => a.w - b.w);
  const bandRows = bands
    .map((b) => ({ min: num(b.min) || 0, max: num(b.max) || 0, rate: num(b.rate) }))
    .filter((b) => b.rate > 0)
    .sort((a, b) => a.min - b.min);

  let billing = weightKg;
  if (weightKg < 21) {
    const step = fixedRows.find((r) => r.w >= Math.round(weightKg * 1000) / 1000);
    billing = step ? step.w : Math.max(1, Math.ceil(weightKg));
  }
  let base = NaN;
  let rule = '';
  const exact = billing < 21 ? fixedRows.find((r) => r.w === billing) : undefined;
  if (exact) {
    base = exact.fee;
    rule = `${billing}kg`;
  } else if (bandRows.length > 0) {
    const hits = bandRows.filter((b) => billing >= b.min && (b.max <= 0 || billing <= b.max)).sort((a, b) => b.min - a.min);
    const band = hits[0] || (billing < bandRows[0].min ? undefined : bandRows[bandRows.length - 1]);
    if (band) {
      base = Math.round(billing * band.rate * 100) / 100;
      rule = `${billing}kg × ${band.rate}/kg`;
    }
  }
  if (!Number.isFinite(base)) return { billing, base, extra: 0, total: NaN, rule: '' };
  const sur = [...surcharges].filter((s) => s.quote_amount >= base).sort((a, b) => a.quote_amount - b.quote_amount)[0];
  const extra = sur ? sur.additional_fee : 0;
  return { billing, base, extra, total: Math.round((base + extra) * 100) / 100, rule };
}

export default function ShippingPriceTableEditor(props: {
  L: Translate;
  countryCode: string;
  countryName: string;
  countryNameZh?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { L, countryCode } = props;
  const { data, isLoading, error } = useQuery({
    // Under the page's admin key so its invalidation after a save refreshes this table too.
    queryKey: [...queryKeys.shippingRates.admin(), 'table', countryCode],
    queryFn: () => ShippingRateService.getCountryTable(countryCode),
  });

  const [fixed, setFixed] = useState<FixedRow[]>([]);
  const [bands, setBands] = useState<BandRow[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [percent, setPercent] = useState('');
  const [previewKg, setPreviewKg] = useState('1');
  const [applyTo, setApplyTo] = useState<string[]>([]);

  const original = useMemo(() => (data ? toRows(data.table) : { fixed: [], bands: [] }), [data]);
  useEffect(() => {
    if (!data) return;
    setFixed(original.fixed);
    setBands(original.bands);
    setCurrency(data.table.currency || 'USD');
    setApplyTo([]);
  }, [data, original]);

  const dirty = JSON.stringify({ fixed, bands }) !== JSON.stringify(original) || (data && currency !== data.table.currency);
  const surcharges = useMemo(() => data?.table.surcharges || [], [data]);
  const preview = useMemo(() => previewQuote(fixed, bands, surcharges, Number(previewKg)), [fixed, bands, surcharges, previewKg]);
  const sameTable = data?.same_table || [];

  const save = useMutation({
    mutationFn: () => {
      const table: ShippingPriceTable = {
        currency,
        fixed: fixed.map((r) => ({ weight_kg: num(r.weight), fee: num(r.fee) })),
        per_kg: bands.map((b) => ({ min_kg: num(b.min) || 0, max_kg: num(b.max) || 0, rate_per_kg: num(b.rate) })),
        surcharges,
      };
      const bad = table.fixed.find((f) => !(f.weight_kg > 0 && f.weight_kg < 21 && f.fee > 0)) || table.per_kg.find((b) => !(b.rate_per_kg > 0));
      if (bad) throw new Error(L('有空白或无效的重量/价格，请检查后再保存', 'Some weights or prices are empty or invalid'));
      return ShippingRateService.saveCountryTable(countryCode, table, { applyTo });
    },
    onSuccess: (res) => {
      toast.success(L(`已保存 ${res.countries.length} 个国家的价格表`, `Saved price table for ${res.countries.length} countries`));
      props.onSaved();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : L('保存失败', 'Save failed')),
  });

  const applyPercent = () => {
    const p = Number(percent);
    if (!Number.isFinite(p) || p === 0) {
      toast.error(L('请输入调整百分比，例如 10 或 -5', 'Enter a percentage such as 10 or -5'));
      return;
    }
    const k = 1 + p / 100;
    setFixed((rows) => rows.map((r) => (Number.isFinite(num(r.fee)) ? { ...r, fee: (num(r.fee) * k).toFixed(2) } : r)));
    setBands((rows) => rows.map((b) => (Number.isFinite(num(b.rate)) ? { ...b, rate: (num(b.rate) * k).toFixed(2) } : b)));
    setPercent('');
  };

  const addFixedRow = () => {
    const last = fixed.length ? num(fixed[fixed.length - 1].weight) : 0;
    const next = Number.isFinite(last) && last + 0.5 < 21 ? String(last + 0.5) : '';
    setFixed((rows) => [...rows, { weight: next, fee: '' }]);
  };

  if (isLoading) return <div className="p-6 text-sm text-gray-500">{L('加载价格表...', 'Loading price table...')}</div>;
  if (error || !data) {
    return <div className="p-6 text-sm text-red-600">{error instanceof Error ? error.message : L('加载失败', 'Failed to load')}</div>;
  }

  const origFee = new Map(original.fixed.map((r) => [r.weight, r.fee]));

  return (
    <div className="space-y-5 border-t border-blue-100 bg-blue-50/40 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {L('价格表', 'Price table')} · {props.countryName} {props.countryNameZh && <span className="text-gray-500">{props.countryNameZh}</span>}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            {L(
              '21kg 以下按价格表重量档向上取整（例如 1.2kg 按 1.5kg 档）；21kg 及以上按“超重每公斤单价 × 实际重量”。',
              'Below 21kg the weight rounds up to the next step (1.2kg bills as 1.5kg); 21kg and above uses rate per kg × actual weight.',
            )}
            {data.free_shipping && <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700">{L('该国已设为免运费，结账不收运费', 'Free shipping is on for this country')}</span>}
          </p>
        </div>
        <button type="button" onClick={props.onClose} className="rounded-md p-1.5 text-gray-500 hover:bg-white" aria-label={L('关闭', 'Close')}>
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Tools */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <label className="inline-flex items-center gap-2 text-gray-600">
          {L('币种', 'Currency')}
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1">
            {['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'AUD', 'CAD'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <span className="h-5 w-px bg-gray-200" />
        <label className="inline-flex items-center gap-2 text-gray-600">
          {L('全部价格调整', 'Adjust all prices')}
          <input
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyPercent(); }}
            placeholder="+10"
            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right"
          />
          %
        </label>
        <button type="button" onClick={applyPercent} className="rounded-md border border-gray-300 px-2.5 py-1 text-gray-700 hover:bg-gray-50">
          {L('应用', 'Apply')}
        </button>
        <span className="h-5 w-px bg-gray-200" />
        <label className="inline-flex items-center gap-2 text-gray-600">
          {L('试算重量', 'Test weight')}
          <input value={previewKg} onChange={(e) => setPreviewKg(e.target.value)} className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right" />
          kg
        </label>
        <span className="rounded-md bg-gray-900 px-2.5 py-1 font-semibold tabular-nums text-white">
          {preview && Number.isFinite(preview.total)
            ? `${currency} ${money(preview.total)}`
            : L('无匹配价格', 'No matching price')}
        </span>
        {preview && Number.isFinite(preview.total) && (
          <span className="text-xs text-gray-500">
            {L(`计费重量 ${preview.billing}kg`, `billed ${preview.billing}kg`)} · {preview.rule}
            {preview.extra > 0 && ` + ${money(preview.extra)}`}
          </span>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        {/* Fixed fees */}
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <div className="text-sm font-semibold text-gray-800">
              {L('21kg 以下固定价格', 'Fixed fees below 21kg')}
              <span className="ml-2 font-normal text-gray-500">{L(`${fixed.length} 档`, `${fixed.length} steps`)}</span>
            </div>
            <button type="button" onClick={addFixedRow} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
              <PlusIcon className="h-4 w-4" /> {L('添加重量档', 'Add step')}
            </button>
          </div>
          {fixed.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">{L('没有固定价格档，21kg 以下也按每公斤单价计算。', 'No fixed steps; below 21kg uses the per-kg rate.')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {fixed.map((r, i) => {
                const changed = origFee.get(r.weight) !== r.fee;
                const perKg = num(r.fee) / num(r.weight);
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      value={r.weight}
                      onChange={(e) => setFixed((rows) => rows.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
                      className="w-14 rounded border border-gray-200 px-1.5 py-1 text-right text-xs tabular-nums text-gray-600"
                      aria-label={L('重量 kg', 'Weight kg')}
                    />
                    <span className="text-xs text-gray-400">kg</span>
                    <input
                      value={r.fee}
                      onChange={(e) => setFixed((rows) => rows.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))}
                      className={cn(
                        'w-24 rounded border px-1.5 py-1 text-right text-sm font-medium tabular-nums',
                        changed ? 'border-amber-400 bg-amber-50' : 'border-gray-300',
                      )}
                      aria-label={L('价格', 'Fee')}
                    />
                    <span className="w-14 text-[11px] tabular-nums text-gray-400" title={L('折合每公斤', 'Per kg equivalent')}>
                      {Number.isFinite(perKg) ? `${perKg.toFixed(1)}/kg` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFixed((rows) => rows.filter((_, j) => j !== i))}
                      className="rounded p-0.5 text-gray-300 hover:text-red-500"
                      aria-label={L('删除', 'Remove')}
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-5">
          {/* Per-kg bands */}
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
              <div className="text-sm font-semibold text-gray-800">{L('每公斤单价（重货）', 'Per-kg rates')}</div>
              <button
                type="button"
                onClick={() => setBands((rows) => [...rows, { min: rows.length ? '' : '21', max: '', rate: '' }])}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <PlusIcon className="h-4 w-4" /> {L('添加', 'Add')}
              </button>
            </div>
            <div className="space-y-2 p-3">
              {bands.length === 0 && (
                <p className="text-center text-xs text-amber-700">{L('未设置：超过最大重量档的包裹将无法报价。', 'Not set: parcels above the last step cannot be quoted.')}</p>
              )}
              {bands.map((b, i) => (
                <div key={i} className="flex items-center gap-1.5 text-sm">
                  <input value={b.min} onChange={(e) => setBands((rows) => rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} className="w-14 rounded border border-gray-300 px-1.5 py-1 text-right text-xs" aria-label="min kg" />
                  <span className="text-gray-400">–</span>
                  <input value={b.max} placeholder="∞" onChange={(e) => setBands((rows) => rows.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} className="w-14 rounded border border-gray-300 px-1.5 py-1 text-right text-xs" aria-label="max kg" />
                  <span className="text-xs text-gray-400">kg</span>
                  <input value={b.rate} onChange={(e) => setBands((rows) => rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} className="w-20 rounded border border-gray-300 px-1.5 py-1 text-right font-medium" aria-label={L('每公斤', 'per kg')} />
                  <span className="text-xs text-gray-400">/kg</span>
                  <button type="button" onClick={() => setBands((rows) => rows.filter((_, j) => j !== i))} className="ml-auto rounded p-1 text-gray-300 hover:text-red-500" aria-label={L('删除', 'Remove')}>
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {surcharges.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
              <div className="mb-1 font-semibold text-gray-800">{L('附加费规则（保存时保留）', 'Surcharges (kept on save)')}</div>
              {surcharges.map((s, i) => (
                <div key={i}>{L(`运费 ≤ ${money(s.quote_amount)} 加收 ${money(s.additional_fee)}`, `Fee ≤ ${money(s.quote_amount)}: +${money(s.additional_fee)}`)}</div>
              ))}
            </div>
          )}

          {/* Apply to same group */}
          {sameTable.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-800">
                  {L(`同价格组 ${sameTable.length} 个国家`, `${sameTable.length} countries share this table`)}
                </div>
                <button
                  type="button"
                  onClick={() => setApplyTo(applyTo.length === sameTable.length ? [] : sameTable.map((c) => c.country_code))}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {applyTo.length === sameTable.length ? L('全不选', 'None') : L('全选', 'All')}
                </button>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{L('勾选的国家保存时会使用同一张价格表（例如同一 DHL 分区）。', 'Checked countries receive the same table on save (e.g. the same DHL zone).')}</p>
              <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {sameTable.map((c) => {
                  const on = applyTo.includes(c.country_code);
                  return (
                    <button
                      key={c.country_code}
                      type="button"
                      title={c.country_name}
                      onClick={() => setApplyTo((prev) => (on ? prev.filter((x) => x !== c.country_code) : [...prev, c.country_code]))}
                      className={cn(
                        'rounded border px-1.5 py-0.5 font-mono text-xs',
                        on ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300',
                      )}
                    >
                      {c.country_code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-amber-700">{L('有未保存的修改', 'Unsaved changes')}</span>}
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => { setFixed(original.fixed); setBands(original.bands); setCurrency(data.table.currency); }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {L('撤销修改', 'Reset')}
        </button>
        <button
          type="button"
          disabled={save.isPending || (!dirty && applyTo.length === 0)}
          onClick={() => save.mutate()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {save.isPending
            ? L('保存中...', 'Saving...')
            : applyTo.length > 0
              ? L(`保存并应用到 ${applyTo.length + 1} 个国家`, `Save to ${applyTo.length + 1} countries`)
              : L('保存价格表', 'Save price table')}
        </button>
      </div>
    </div>
  );
}
