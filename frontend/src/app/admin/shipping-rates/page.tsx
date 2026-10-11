'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckIcon,
  DocumentArrowUpIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  TruckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import AdminLayout from '@/components/admin/AdminLayout';
import { queryKeys } from '@/lib/react-query';
import { cn } from '@/lib/utils';
import { useAdminI18n } from '@/lib/admin-i18n';
import {
  ShippingRateService,
  type ShippingFreeSetting,
  type ShippingRate,
  type ShippingRateImportResult,
  type WorldCountry,
} from '@/services/shipping-rate.service';

type Tab = 'rates' | 'import' | 'free' | 'whitelist';
type Mode = 'country' | 'carrier';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'AUD', 'CAD'];

type ApiErrorShape = { response?: { data?: { message?: string; error?: string; data?: { errors?: string[] } } } };

function errorMessage(error: unknown, fallback: string): string {
  const data = (error as ApiErrorShape)?.response?.data;
  if (data?.message) return data.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

// The API interceptor already toasts server responses; only surface client/network failures here.
function notifyError(error: unknown, fallback: string) {
  if ((error as ApiErrorShape)?.response) return;
  toast.error(errorMessage(error, fallback));
}

function importErrors(error: unknown, fallback: string): string[] {
  const data = (error as ApiErrorShape)?.response?.data;
  if (data?.data?.errors?.length) return data.data.errors;
  return [errorMessage(error, fallback)];
}

function matchesCountry(c: WorldCountry, q: string): boolean {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  return c.code.toLowerCase().includes(s) || c.name.toLowerCase().includes(s) || c.name_zh.includes(q.trim());
}

function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function AdminShippingRatesPage() {
  const { locale } = useAdminI18n();
  const L = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const queryClient = useQueryClient();
  const adminKey = queryKeys.shippingRates.admin();

  const [tab, setTab] = useState<Tab>('rates');
  const [mode, setMode] = useState<Mode>('country');
  const [carrier, setCarrier] = useState('FEDEX');
  const [serviceCode, setServiceCode] = useState('IP');
  const [carrierCurrency, setCarrierCurrency] = useState('USD');

  const { data: world = [] } = useQuery({
    queryKey: [...adminKey, 'world-countries'],
    queryFn: () => ShippingRateService.worldCountries(),
    staleTime: Infinity,
  });
  const worldByCode = useMemo(() => new Map(world.map((c) => [c.code, c])), [world]);

  const { data: rates = [], isLoading: ratesLoading } = useQuery({
    queryKey: [...adminKey, 'rates', { mode, carrier, serviceCode }],
    queryFn: () =>
      ShippingRateService.adminList(undefined, {
        type: mode,
        carrier: mode === 'carrier' ? carrier : undefined,
        service: mode === 'carrier' ? serviceCode : undefined,
      }),
    retry: 1,
  });

  const { data: freeSettings = [] } = useQuery({
    queryKey: [...adminKey, 'free-shipping'],
    queryFn: () => ShippingRateService.getFreeShippingCountries(),
    retry: 1,
  });
  const freeCodes = useMemo(
    () => new Set(freeSettings.filter((s: ShippingFreeSetting) => s.free_shipping_enabled).map((s) => s.country_code)),
    [freeSettings],
  );

  const { data: allowed = [] } = useQuery({
    queryKey: [...adminKey, 'allowed-countries'],
    queryFn: () => ShippingRateService.listAllowedCountries(),
    retry: 1,
  });
  const allowedCodes = useMemo(() => new Set(allowed.map((a) => a.country_code)), [allowed]);
  const pricedCodes = useMemo(() => new Set(rates.map((r) => r.country_code)), [rates]);

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'rates', label: L('运费价格', 'Rates'), count: rates.length },
    { id: 'import', label: L('导入 / 模板', 'Import / Template') },
    { id: 'free', label: L('免运费国家', 'Free Shipping'), count: freeCodes.size },
    { id: 'whitelist', label: L('售卖国家', 'Selling Countries'), count: allowedCodes.size || undefined },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <TruckIcon className="h-7 w-7 text-blue-700" />
              {L('运费设置', 'Shipping Settings')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              {L(
                '按国家设置每公斤运费，支持全球国家。不足 21kg 按整公斤向上取整计费，21kg 及以上按实际重量。',
                'Set a per-kg shipping rate for any country worldwide. Below 21kg the weight is rounded up to a whole kg.',
              )}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:min-w-[420px]">
            <StatCard label={L('已配置运费', 'Countries priced')} value={rates.length} tone="blue" />
            <StatCard label={L('免运费国家', 'Free shipping')} value={freeCodes.size} tone="green" />
            <StatCard
              label={L('售卖范围', 'Selling scope')}
              value={allowedCodes.size > 0 ? allowedCodes.size : L('全部', 'All')}
              tone="slate"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                  tab === item.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                )}
              >
                {item.label}
                {typeof item.count === 'number' && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      tab === item.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600',
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {(tab === 'rates' || tab === 'import') && (
          <ModeBar
            L={L}
            mode={mode}
            setMode={setMode}
            carrier={carrier}
            setCarrier={setCarrier}
            serviceCode={serviceCode}
            setServiceCode={setServiceCode}
            currency={carrierCurrency}
            setCurrency={setCarrierCurrency}
          />
        )}

        {tab === 'rates' && (
          <RatesTab
            L={L}
            mode={mode}
            carrier={carrier}
            serviceCode={serviceCode}
            rates={rates}
            loading={ratesLoading}
            world={world}
            worldByCode={worldByCode}
            freeCodes={freeCodes}
            onInvalidate={() => queryClient.invalidateQueries({ queryKey: adminKey })}
            onGoImport={() => setTab('import')}
          />
        )}

        {tab === 'import' && (
          <ImportTab
            L={L}
            mode={mode}
            carrier={carrier}
            serviceCode={serviceCode}
            currency={carrierCurrency}
            onImported={() => queryClient.invalidateQueries({ queryKey: adminKey })}
            onShowRates={() => setTab('rates')}
          />
        )}

        {tab === 'free' && (
          <FreeShippingTab
            L={L}
            world={world}
            worldByCode={worldByCode}
            serverCodes={freeCodes}
            pricedCodes={pricedCodes}
            onSaved={() => queryClient.invalidateQueries({ queryKey: adminKey })}
          />
        )}

        {tab === 'whitelist' && (
          <WhitelistTab
            L={L}
            world={world}
            worldByCode={worldByCode}
            serverCodes={allowedCodes}
            pricedCodes={pricedCodes}
            onSaved={() => queryClient.invalidateQueries({ queryKey: adminKey })}
          />
        )}
      </div>
    </AdminLayout>
  );
}

type Translate = (zh: string, en: string) => string;

function StatCard({ label, value, tone }: { label: string; value: number | string; tone: 'blue' | 'green' | 'slate' }) {
  const tones = {
    blue: 'border-blue-100 bg-blue-50 text-blue-800',
    green: 'border-green-100 bg-green-50 text-green-800',
    slate: 'border-gray-200 bg-white text-gray-800',
  };
  return (
    <div className={cn('rounded-lg border px-4 py-3', tones[tone])}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function ModeBar(props: {
  L: Translate;
  mode: Mode;
  setMode: (m: Mode) => void;
  carrier: string;
  setCarrier: (v: string) => void;
  serviceCode: string;
  setServiceCode: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
}) {
  const { L, mode, setMode } = props;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:flex-row sm:items-center">
      <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-1">
        {(['country', 'carrier'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              mode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            {m === 'country' ? L('按国家（每公斤）', 'By country (per kg)') : L('按承运商分区（高级）', 'Carrier zones (advanced)')}
          </button>
        ))}
      </div>
      {mode === 'carrier' && (
        <div className="flex flex-wrap items-center gap-2">
          <LabeledInput label={L('承运商', 'Carrier')} value={props.carrier} onChange={props.setCarrier} width="w-28" />
          <LabeledInput label={L('服务', 'Service')} value={props.serviceCode} onChange={props.setServiceCode} width="w-20" />
          <LabeledInput label={L('币种', 'Currency')} value={props.currency} onChange={props.setCurrency} width="w-20" />
        </div>
      )}
    </div>
  );
}

function LabeledInput({ label, value, onChange, width }: { label: string; value: string; onChange: (v: string) => void; width: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className={cn('rounded-md border border-gray-300 px-2 py-1.5 text-sm uppercase', width)}
      />
    </label>
  );
}

// ---------------- Rates tab ----------------

function RatesTab(props: {
  L: Translate;
  mode: Mode;
  carrier: string;
  serviceCode: string;
  rates: ShippingRate[];
  loading: boolean;
  world: WorldCountry[];
  worldByCode: Map<string, WorldCountry>;
  freeCodes: Set<string>;
  onInvalidate: () => void;
  onGoImport: () => void;
}) {
  const { L, mode, rates, worldByCode, freeCodes } = props;
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editRate, setEditRate] = useState('');
  const [editCurrency, setEditCurrency] = useState('USD');
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rates;
    return rates.filter((r) => {
      const zh = worldByCode.get(r.country_code)?.name_zh || '';
      return r.country_code.toLowerCase().includes(s) || r.country_name.toLowerCase().includes(s) || zh.includes(q.trim());
    });
  }, [rates, q, worldByCode]);

  const allChecked = filtered.length > 0 && filtered.every((r) => selected.includes(r.country_code));

  const saveRate = useMutation({
    mutationFn: (p: { code: string; rate: number; currency: string }) => ShippingRateService.upsertCountryRate(p.code, p.rate, p.currency),
    onSuccess: (_, p) => {
      toast.success(L(`${p.code} 运费已保存`, `${p.code} rate saved`));
      setEditing(null);
      setAdding(false);
      props.onInvalidate();
    },
    onError: (e: unknown) => notifyError(e, L('保存失败', 'Save failed')),
  });

  const bulkDelete = useMutation({
    mutationFn: (payload: { all?: boolean; country_codes?: string[] }) =>
      ShippingRateService.bulkDelete(payload, {
        type: mode,
        carrier: mode === 'carrier' ? props.carrier : undefined,
        service: mode === 'carrier' ? props.serviceCode : undefined,
      }),
    onSuccess: (res) => {
      toast.success(L(`已删除 ${res.deleted} 个国家`, `Deleted ${res.deleted}`));
      setSelected([]);
      props.onInvalidate();
    },
    onError: (e: unknown) => notifyError(e, L('删除失败', 'Delete failed')),
  });

  const startEdit = (r: ShippingRate) => {
    setEditing(r.country_code);
    setEditRate(r.rate_per_kg ? String(r.rate_per_kg) : '');
    setEditCurrency(r.currency || 'USD');
  };

  const submitEdit = (r: ShippingRate) => {
    const rate = Number(editRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error(L('请输入大于 0 的每公斤运费', 'Enter a rate greater than 0'));
      return;
    }
    if (r.pricing_mode === 'brackets' && !window.confirm(L(
      `${r.country_code} 当前使用分段/固定价格规则，保存后将替换为统一每公斤运费，确定吗？`,
      `${r.country_code} uses bracket rules. Replace them with a flat per-kg rate?`,
    ))) return;
    saveRate.mutate({ code: r.country_code, rate, currency: editCurrency });
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative md:w-80">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L('搜索国家：US / Germany / 德国', 'Search: US / Germany')}
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(L(`确定删除这些国家的运费吗：${selected.join(', ')}？`, `Delete rates for ${selected.join(', ')}?`))) return;
                bulkDelete.mutate({ country_codes: selected });
              }}
              disabled={bulkDelete.isPending}
              className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              <TrashIcon className="mr-1.5 h-4 w-4" />
              {L(`删除已选 (${selected.length})`, `Delete selected (${selected.length})`)}
            </button>
          )}
          {mode === 'country' && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {L('添加国家运费', 'Add country rate')}
            </button>
          )}
          <button
            type="button"
            onClick={props.onGoImport}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ArrowUpTrayIcon className="mr-1.5 h-4 w-4" />
            {L('批量导入', 'Bulk import')}
          </button>
        </div>
      </div>

      {adding && mode === 'country' && (
        <AddRateForm
          L={L}
          world={props.world}
          existing={new Set(rates.map((r) => r.country_code))}
          pending={saveRate.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(code, rate, currency) => saveRate.mutate({ code, rate, currency })}
        />
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? [] : filtered.map((r) => r.country_code))}
                    aria-label={L('全选', 'Select all')}
                  />
                </th>
                {mode === 'carrier' && <th className="px-4 py-3">{L('承运商/服务', 'Carrier')}</th>}
                <th className="px-4 py-3">{L('国家', 'Country')}</th>
                <th className="px-4 py-3">{L('计费方式', 'Pricing')}</th>
                <th className="px-4 py-3 text-right">{L('每公斤运费', 'Rate / kg')}</th>
                <th className="px-4 py-3">{L('币种', 'Currency')}</th>
                <th className="px-4 py-3">{L('状态', 'Status')}</th>
                {mode === 'country' && <th className="px-4 py-3 text-right">{L('操作', 'Actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {props.loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-500">{L('加载中...', 'Loading...')}</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <GlobeAltIcon className="mx-auto h-10 w-10 text-gray-300" />
                    <p className="mt-2 text-gray-500">
                      {q ? L('没有匹配的国家', 'No matching countries') : L('还没有配置运费，点击「批量导入」或「添加国家运费」开始。', 'No rates yet. Import a sheet or add a country.')}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const isEditing = editing === r.country_code;
                  const zh = worldByCode.get(r.country_code)?.name_zh;
                  return (
                    <tr key={`${r.carrier || ''}:${r.service_code || ''}:${r.country_code}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selected.includes(r.country_code)}
                          onChange={() =>
                            setSelected((prev) => (prev.includes(r.country_code) ? prev.filter((x) => x !== r.country_code) : [...prev, r.country_code]))
                          }
                        />
                      </td>
                      {mode === 'carrier' && (
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.carrier} / {r.service_code}</td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-7 w-9 items-center justify-center rounded bg-gray-100 font-mono text-xs font-semibold text-gray-700">
                            {r.country_code}
                          </span>
                          <div>
                            <div className="font-medium text-gray-900">{r.country_name}</div>
                            {zh && <div className="text-xs text-gray-500">{zh}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {r.pricing_mode === 'per_kg' ? (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{L('每公斤', 'Per kg')}</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700" title={L(`${r.weight_brackets} 条重量规则，${r.quote_surcharges} 条附加费规则`, `${r.weight_brackets} brackets, ${r.quote_surcharges} surcharges`)}>
                            {L(`分段 · ${r.weight_brackets} 条`, `Brackets · ${r.weight_brackets}`)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <input
                            autoFocus
                            type="number"
                            min="0"
                            step="0.01"
                            value={editRate}
                            onChange={(e) => setEditRate(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitEdit(r);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            className="w-28 rounded-md border border-blue-400 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                          />
                        ) : r.pricing_mode === 'per_kg' && typeof r.rate_per_kg === 'number' ? (
                          <span className="font-semibold tabular-nums text-gray-900">{r.rate_per_kg.toFixed(2)}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
                            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <span className="text-gray-700">{r.currency || 'USD'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {freeCodes.has(r.country_code) ? (
                          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{L('免运费', 'Free')}</span>
                        ) : (
                          <span className="text-xs text-gray-400">{L('正常计费', 'Charged')}</span>
                        )}
                      </td>
                      {mode === 'country' && (
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {isEditing ? (
                              <>
                                <IconButton title={L('保存', 'Save')} onClick={() => submitEdit(r)} disabled={saveRate.isPending} tone="blue">
                                  <CheckIcon className="h-4 w-4" />
                                </IconButton>
                                <IconButton title={L('取消', 'Cancel')} onClick={() => setEditing(null)}>
                                  <XMarkIcon className="h-4 w-4" />
                                </IconButton>
                              </>
                            ) : (
                              <>
                                <IconButton title={L('修改运费', 'Edit rate')} onClick={() => startEdit(r)}>
                                  <PencilSquareIcon className="h-4 w-4" />
                                </IconButton>
                                <IconButton
                                  title={L('删除', 'Delete')}
                                  tone="red"
                                  disabled={bulkDelete.isPending}
                                  onClick={() => {
                                    if (!window.confirm(L(`确定删除 ${r.country_name} 的运费吗？`, `Delete ${r.country_name}?`))) return;
                                    bulkDelete.mutate({ country_codes: [r.country_code] });
                                  }}
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </IconButton>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {rates.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
            <span>{L(`共 ${rates.length} 个国家，显示 ${filtered.length} 个`, `${filtered.length} of ${rates.length} countries`)}</span>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(L('确定删除全部运费配置吗？此操作不可撤销。', 'Delete ALL rates? This cannot be undone.'))) return;
                bulkDelete.mutate({ all: true });
              }}
              disabled={bulkDelete.isPending}
              className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              {L('清空全部运费', 'Delete all rates')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  children, title, onClick, disabled, tone = 'gray',
}: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; tone?: 'gray' | 'blue' | 'red' }) {
  const tones = {
    gray: 'text-gray-500 hover:bg-gray-100 hover:text-gray-800',
    blue: 'text-blue-600 hover:bg-blue-50',
    red: 'text-red-500 hover:bg-red-50 hover:text-red-700',
  };
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled} className={cn('rounded-md p-1.5 transition-colors disabled:opacity-50', tones[tone])}>
      {children}
    </button>
  );
}

function AddRateForm(props: {
  L: Translate;
  world: WorldCountry[];
  existing: Set<string>;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (code: string, rate: number, currency: string) => void;
}) {
  const { L } = props;
  const [code, setCode] = useState('');
  const [rate, setRate] = useState('');
  const [currency, setCurrency] = useState('USD');

  const submit = () => {
    const r = Number(rate);
    if (!code) return toast.error(L('请选择国家', 'Choose a country'));
    if (!Number.isFinite(r) || r <= 0) return toast.error(L('请输入大于 0 的每公斤运费', 'Enter a rate greater than 0'));
    props.onSubmit(code, r, currency);
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] md:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">{L('国家', 'Country')}</label>
          <CountrySelect L={L} world={props.world} value={code} onChange={setCode} hint={(c) => (props.existing.has(c) ? L('已配置，将覆盖', 'exists, will overwrite') : '')} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">{L('每公斤运费', 'Rate per kg')}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="8.50"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">{L('币种', 'Currency')}</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={submit} disabled={props.pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {L('保存', 'Save')}
          </button>
          <button type="button" onClick={props.onCancel} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            {L('取消', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CountrySelect(props: {
  L: Translate;
  world: WorldCountry[];
  value: string;
  onChange: (code: string) => void;
  hint?: (code: string) => string;
}) {
  const { L, world, value } = props;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = world.find((c) => c.code === value);
  const options = useMemo(() => world.filter((c) => matchesCountry(c, q)).slice(0, 60), [world, q]);

  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <input
        value={open ? q : selected ? `${selected.code} · ${selected.name} · ${selected.name_zh}` : q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setQ(''); setOpen(true); }}
        placeholder={L('输入代码、英文或中文搜索', 'Type code or name')}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">{L('没有匹配的国家', 'No match')}</li>
          ) : options.map((c) => {
            const hint = props.hint?.(c.code);
            return (
              <li key={c.code}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { props.onChange(c.code); setOpen(false); }}
                  className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50', c.code === value && 'bg-blue-50')}
                >
                  <span className="w-8 font-mono text-xs font-semibold text-gray-600">{c.code}</span>
                  <span className="flex-1 text-gray-900">{c.name}</span>
                  <span className="text-xs text-gray-500">{c.name_zh}</span>
                  {hint && <span className="text-xs text-amber-600">{hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------- Import tab ----------------

function ImportTab(props: {
  L: Translate;
  mode: Mode;
  carrier: string;
  serviceCode: string;
  currency: string;
  onImported: () => void;
  onShowRates: () => void;
}) {
  const { L, mode } = props;
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ShippingRateImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      toast.error(L('只支持 .xlsx 文件', 'Only .xlsx files are supported'));
      return;
    }
    setFile(f);
    setResult(null);
    setErrors([]);
  };

  const download = async (type: 'country' | 'country-advanced' | 'carrier-zone') => {
    try {
      const blob = await ShippingRateService.downloadTemplate({
        type,
        carrier: type === 'carrier-zone' ? props.carrier : undefined,
        service: type === 'carrier-zone' ? props.serviceCode : undefined,
        currency: type === 'carrier-zone' ? props.currency : undefined,
      });
      const name = type === 'carrier-zone'
        ? `shipping-${props.carrier.toLowerCase()}-${props.serviceCode.toLowerCase()}-zone-template.xlsx`
        : type === 'country-advanced' ? 'shipping-template-advanced.xlsx' : 'shipping-rate-per-kg.xlsx';
      triggerDownload(blob, name);
      toast.success(L('模板已下载', 'Template downloaded'));
    } catch (e) {
      toast.error(errorMessage(e, L('下载模板失败', 'Download failed')));
    }
  };

  const importMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error(L('请先选择文件', 'Choose a file first'));
      return ShippingRateService.importXlsx(file, {
        replace,
        type: mode === 'carrier' ? 'carrier-zone' : 'country',
        carrier: mode === 'carrier' ? props.carrier : undefined,
        service: mode === 'carrier' ? props.serviceCode : undefined,
        currency: mode === 'carrier' ? props.currency : undefined,
      });
    },
    onSuccess: (res) => {
      setResult(res);
      setErrors(res.errors || []);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      toast.success(L(`导入成功：${res.countries} 个国家`, `Imported ${res.countries} countries`));
      props.onImported();
    },
    onError: (e: unknown) => {
      setResult(null);
      setErrors(importErrors(e, L('导入失败', 'Import failed')));
      notifyError(e, L('导入失败', 'Import failed'));
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Step 1 & 2 */}
      <div className="space-y-4 lg:col-span-1">
        <StepCard step={1} title={L('下载模板', 'Download template')}>
          {mode === 'country' ? (
            <>
              <p className="text-sm text-gray-600">
                {L('模板已列出全球 200+ 个国家，并自动带出当前已设置的运费，改完直接上传即可。', 'Lists 200+ countries with your current rates pre-filled.')}
              </p>
              <button type="button" onClick={() => download('country')} className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
                <ArrowDownTrayIcon className="mr-2 h-4 w-4" />
                {L('下载每公斤运费模板', 'Download per-kg template')}
              </button>
              <button type="button" onClick={() => download('country-advanced')} className="mt-2 w-full text-center text-xs text-gray-500 hover:text-blue-700">
                {L('需要按重量分段定价？下载高级分段模板', 'Need weight brackets? Download the advanced template')}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">{L('承运商分区模板：CountryZones 填写国家对应分区，再按分区填写价格。', 'Carrier zone template: map countries to zones, then fill zone prices.')}</p>
              <button type="button" onClick={() => download('carrier-zone')} className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
                <ArrowDownTrayIcon className="mr-2 h-4 w-4" />
                {L(`下载 ${props.carrier} 分区模板`, `Download ${props.carrier} template`)}
              </button>
            </>
          )}
        </StepCard>

        <StepCard step={2} title={L('填写价格', 'Fill in rates')}>
          <ul className="space-y-2 text-sm text-gray-600">
            {mode === 'country' ? (
              <>
                <li>• {L('只填橙色列「每公斤运费」，例如 8.5', 'Fill only the orange "Rate per kg" column')}</li>
                <li>• {L('不发货的国家留空即可，不会被导入', 'Leave blank to skip a country')}</li>
                <li>• {L('国家可写 US / United States / 美国，都能识别', 'Countries may be ISO2, English or Chinese names')}</li>
                <li>• {L('也可以直接上传自己的表格：有「国家」和「每公斤运费/单价」两列即可', 'Your own sheet works too: one country column + one rate column')}</li>
              </>
            ) : (
              <li>• {L('上传需包含 CountryZones 工作表；也支持 FedEx eBay 报价表。', 'Must include CountryZones; FedEx eBay sheets are also supported.')}</li>
            )}
          </ul>
        </StepCard>
      </div>

      {/* Step 3 */}
      <div className="space-y-4 lg:col-span-2">
        <StepCard step={3} title={L('上传导入', 'Upload')}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragOver ? 'border-blue-500 bg-blue-50' : file ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50',
            )}
          >
            <DocumentArrowUpIcon className={cn('h-10 w-10', file ? 'text-green-600' : 'text-gray-400')} />
            {file ? (
              <>
                <p className="mt-2 font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB · {L('点击更换文件', 'click to change')}</p>
              </>
            ) : (
              <>
                <p className="mt-2 font-medium text-gray-700">{L('拖拽 .xlsx 文件到这里，或点击选择', 'Drop an .xlsx file here or click to browse')}</p>
                <p className="text-xs text-gray-500">{L('自动识别表头位置和列顺序', 'Header row and column order are detected automatically')}</p>
              </>
            )}
            <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                {L('覆盖表格中出现国家的旧规则', 'Replace existing rules for countries in the file')}
                <span className="block text-xs text-gray-500">{L('表格里没有的国家保持不变', 'Countries not in the file are left untouched')}</span>
              </span>
            </label>
            <button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={!file || importMutation.isPending}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUpTrayIcon className="mr-2 h-4 w-4" />
              {importMutation.isPending ? L('导入中...', 'Importing...') : L('开始导入', 'Import')}
            </button>
          </div>
        </StepCard>

        {result && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-green-800">
                <CheckIcon className="h-5 w-5" /> {L('导入完成', 'Import completed')}
              </h3>
              <button type="button" onClick={props.onShowRates} className="text-sm font-medium text-green-700 hover:underline">
                {L('查看运费列表 →', 'View rates →')}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <ResultStat label={L('国家', 'Countries')} value={result.countries} />
              <ResultStat label={L('新增', 'Created')} value={result.created} />
              <ResultStat label={L('更新', 'Updated')} value={result.updated} />
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="font-semibold text-red-800">{L(`发现 ${errors.length} 个问题`, `${errors.length} issue(s) found`)}</h3>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm text-red-700">
              {errors.map((err, i) => <li key={i}>• {err}</li>)}
            </ul>
            <p className="mt-2 text-xs text-red-600">{L('修正表格后重新上传即可，没有任何数据被写入。', 'Fix the sheet and upload again. Nothing was saved.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StepCard({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{step}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-white px-3 py-2">
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

// ---------------- Country multi picker (free shipping + whitelist) ----------------

function CountryMultiPicker(props: {
  L: Translate;
  world: WorldCountry[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  pricedCodes: Set<string>;
  accent: 'green' | 'blue';
}) {
  const { L, world, selected, onChange, pricedCodes, accent } = props;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'selected' | 'priced'>('all');

  const visible = useMemo(
    () => world.filter((c) => matchesCountry(c, q) && (filter === 'all' || (filter === 'selected' ? selected.has(c.code) : pricedCodes.has(c.code)))),
    [world, q, filter, selected, pricedCodes],
  );

  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };

  const accentChecked = accent === 'green' ? 'border-green-300 bg-green-50' : 'border-blue-300 bg-blue-50';

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L('搜索国家：代码 / 英文 / 中文', 'Search by code or name')}
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-1 text-sm">
          {([
            ['all', L(`全部 ${world.length}`, `All ${world.length}`)],
            ['selected', L(`已选 ${selected.size}`, `Selected ${selected.size}`)],
            ['priced', L(`已配运费 ${pricedCodes.size}`, `Priced ${pricedCodes.size}`)],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} className={cn('rounded px-3 py-1', filter === id ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={() => onChange(new Set([...selected, ...visible.map((c) => c.code)]))} className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50">
          {L('全选当前列表', 'Select visible')}
        </button>
        <button type="button" onClick={() => { const next = new Set(selected); visible.forEach((c) => next.delete(c.code)); onChange(next); }} className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50">
          {L('取消当前列表', 'Unselect visible')}
        </button>
      </div>

      <div className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.length === 0 ? (
          <p className="col-span-full py-6 text-center text-sm text-gray-500">{L('没有匹配的国家', 'No matching countries')}</p>
        ) : visible.map((c) => {
          const checked = selected.has(c.code);
          return (
            <label key={c.code} className={cn('flex cursor-pointer items-center gap-3 rounded-md border bg-white px-3 py-2 text-sm transition-colors', checked ? accentChecked : 'border-gray-200 hover:border-gray-300')}>
              <input type="checkbox" checked={checked} onChange={() => toggle(c.code)} className="h-4 w-4" />
              <span className="w-7 font-mono text-xs font-semibold text-gray-600">{c.code}</span>
              <span className="min-w-0 flex-1 truncate text-gray-900">{c.name}</span>
              <span className="shrink-0 text-xs text-gray-500">{c.name_zh}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SelectedChips({ L, codes, worldByCode, onRemove, tone }: {
  L: Translate;
  codes: string[];
  worldByCode: Map<string, WorldCountry>;
  onRemove: (code: string) => void;
  tone: 'green' | 'blue';
}) {
  if (codes.length === 0) return <p className="text-sm text-gray-500">{L('尚未选择任何国家', 'No countries selected')}</p>;
  const cls = tone === 'green' ? 'border-green-200 bg-green-50 text-green-800' : 'border-blue-200 bg-blue-50 text-blue-800';
  return (
    <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
      {codes.map((code) => (
        <span key={code} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', cls)}>
          <span className="font-mono font-semibold">{code}</span>
          <span>{worldByCode.get(code)?.name || code}</span>
          <button type="button" onClick={() => onRemove(code)} className="opacity-60 hover:opacity-100" aria-label={L('移除', 'Remove')}>
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

function SaveBar({ L, dirty, pending, onSave, onReset, count }: { L: Translate; dirty: boolean; pending: boolean; onSave: () => void; onReset: () => void; count: number }) {
  return (
    <div className={cn('sticky bottom-4 z-10 flex items-center justify-between rounded-lg border px-4 py-3 shadow-sm transition-colors', dirty ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white')}>
      <span className="text-sm text-gray-700">
        {dirty ? L(`有未保存的修改（已选 ${count} 个国家）`, `Unsaved changes (${count} selected)`) : L(`已保存 · ${count} 个国家`, `Saved · ${count} countries`)}
      </span>
      <div className="flex gap-2">
        <button type="button" onClick={onReset} disabled={!dirty || pending} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {L('撤销', 'Discard')}
        </button>
        <button type="button" onClick={onSave} disabled={!dirty || pending} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? L('保存中...', 'Saving...') : L('保存设置', 'Save')}
        </button>
      </div>
    </div>
  );
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

function FreeShippingTab(props: {
  L: Translate;
  world: WorldCountry[];
  worldByCode: Map<string, WorldCountry>;
  serverCodes: Set<string>;
  pricedCodes: Set<string>;
  onSaved: () => void;
}) {
  const { L, worldByCode, serverCodes } = props;
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const current = draft ?? serverCodes;
  const dirty = draft !== null && !sameSet(draft, serverCodes);

  const save = useMutation({
    mutationFn: () =>
      ShippingRateService.setFreeShippingCountries(
        [...current].map((code) => ({ country_code: code, country_name: worldByCode.get(code)?.name || code, free_shipping_enabled: true })),
      ),
    onSuccess: () => {
      toast.success(L(`免运费国家已保存（${current.size} 个）`, `Free shipping saved (${current.size})`));
      setDraft(null);
      props.onSaved();
    },
    onError: (e: unknown) => notifyError(e, L('保存失败', 'Save failed')),
  });

  const sortedCodes = [...current].sort((a, b) => (worldByCode.get(a)?.name || a).localeCompare(worldByCode.get(b)?.name || b));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <h3 className="font-semibold text-green-900">{L('选择需要免运费的国家', 'Choose free-shipping countries')}</h3>
        <p className="mt-1 text-sm text-green-800">
          {L(
            '被选中的国家，前台产品页和结算时运费都显示为 0。即使该国家没有配置运费价格，选中后客户也可以选择并享受免运费。',
            'Selected countries get $0 shipping on the product page and at checkout, even without a configured rate.',
          )}
        </p>
        <div className="mt-3">
          <SelectedChips L={L} codes={sortedCodes} worldByCode={worldByCode} tone="green" onRemove={(code) => { const n = new Set(current); n.delete(code); setDraft(n); }} />
        </div>
      </div>

      <CountryMultiPicker L={L} world={props.world} selected={current} onChange={setDraft} pricedCodes={props.pricedCodes} accent="green" />

      <SaveBar L={L} dirty={dirty} pending={save.isPending} count={current.size} onSave={() => save.mutate()} onReset={() => setDraft(null)} />
    </div>
  );
}

function WhitelistTab(props: {
  L: Translate;
  world: WorldCountry[];
  worldByCode: Map<string, WorldCountry>;
  serverCodes: Set<string>;
  pricedCodes: Set<string>;
  onSaved: () => void;
}) {
  const { L, worldByCode, serverCodes } = props;
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const current = draft ?? serverCodes;
  const dirty = draft !== null && !sameSet(draft, serverCodes);

  const save = useMutation({
    mutationFn: () =>
      ShippingRateService.bulkSetAllowedCountries(
        [...current].map((code, i) => ({ country_code: code, country_name: worldByCode.get(code)?.name || code, sort_order: i })),
      ),
    onSuccess: () => {
      toast.success(current.size > 0 ? L(`售卖国家已保存（${current.size} 个）`, `Saved (${current.size})`) : L('已恢复为全部国家可售', 'All countries are now sellable'));
      setDraft(null);
      props.onSaved();
    },
    onError: (e: unknown) => notifyError(e, L('保存失败', 'Save failed')),
  });

  const sortedCodes = [...current].sort((a, b) => (worldByCode.get(a)?.name || a).localeCompare(worldByCode.get(b)?.name || b));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-blue-900">{L('限制可售国家（可选）', 'Restrict selling countries (optional)')}</h3>
            <p className="mt-1 text-sm text-blue-800">
              {current.size === 0
                ? L('当前未限制：前台显示所有已配置运费或免运费的国家。', 'No restriction: every priced or free-shipping country is shown.')
                : L(`已限制：前台只显示这 ${current.size} 个国家。全部移除即恢复不限制。`, `Restricted to ${current.size} countries. Remove all to lift the restriction.`)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDraft(new Set(props.pricedCodes))}
            className="shrink-0 rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            {L('设为所有已配运费国家', 'Use all priced countries')}
          </button>
        </div>
        <div className="mt-3">
          <SelectedChips L={L} codes={sortedCodes} worldByCode={worldByCode} tone="blue" onRemove={(code) => { const n = new Set(current); n.delete(code); setDraft(n); }} />
        </div>
      </div>

      <CountryMultiPicker L={L} world={props.world} selected={current} onChange={setDraft} pricedCodes={props.pricedCodes} accent="blue" />

      <SaveBar L={L} dirty={dirty} pending={save.isPending} count={current.size} onSave={() => save.mutate()} onReset={() => setDraft(null)} />
    </div>
  );
}
