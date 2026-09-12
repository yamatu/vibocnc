'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

import AdminLayout from '@/components/admin/AdminLayout';
import { queryKeys } from '@/lib/react-query';
import { ShippingRateService, ShippingFreeSetting, ShippingMutationResult, ShippingRate, ShippingAllowedCountry, ShippingRateImportResult } from '@/services/shipping-rate.service';
import { useAdminI18n } from '@/lib/admin-i18n';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function AdminShippingRatesPage() {
  const { locale, t } = useAdminI18n();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'country' | 'carrier'>('country');
  const [carrier, setCarrier] = useState('FEDEX');
  const [serviceCode, setServiceCode] = useState('IP');
  const [currency, setCurrency] = useState('USD');
  const [q, setQ] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [replaceMode, setReplaceMode] = useState(true);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [allowedText, setAllowedText] = useState('');
  const [freeShippingCode, setFreeShippingCode] = useState('');
  const [freeShippingName, setFreeShippingName] = useState('');

  const { data: freeShippingCountries = [], isLoading: freeShippingLoading } = useQuery({
    queryKey: [...queryKeys.shippingRates.admin(), 'free-shipping'],
    queryFn: () => ShippingRateService.getFreeShippingCountries(),
    retry: 1,
  });

  const freeShippingMutation = useMutation({
    mutationFn: (countries: Array<{ country_code: string; country_name?: string; free_shipping_enabled: boolean }>) =>
      ShippingRateService.setFreeShippingCountries(countries),
    onSuccess: (res: ShippingMutationResult) => {
      toast.success(locale === 'zh' ? `免运费设置已更新（${res?.count || 0} 个国家）` : `Free shipping settings updated (${res?.count || 0})`);
      queryClient.invalidateQueries({ queryKey: [...queryKeys.shippingRates.admin(), 'free-shipping'] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, locale === 'zh' ? '更新免运费设置失败' : 'Failed to update free shipping settings')),
  });

  const { data: allowedCountries = [], isLoading: allowedLoading } = useQuery({
    queryKey: [...queryKeys.shippingRates.admin(), 'allowed-countries'],
    queryFn: () => ShippingRateService.listAllowedCountries(),
    retry: 1,
  });

  const { data: templates = [], isLoading } = useQuery({
    queryKey: [...queryKeys.shippingRates.admin(), { q, mode, carrier, serviceCode }],
    queryFn: () =>
      ShippingRateService.adminList(q.trim() || undefined, {
        type: mode === 'carrier' ? 'carrier' : 'country',
        carrier: mode === 'carrier' ? carrier : undefined,
        service: mode === 'carrier' ? serviceCode : undefined,
      }),
    retry: 1,
  });

  const rows = useMemo(() => templates || [], [templates]);
  const codeToName = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const r of rows as ShippingRate[]) {
      if (r?.country_code && r?.country_name) m[String(r.country_code).toUpperCase()] = String(r.country_name);
    }
    for (const a of allowedCountries as ShippingAllowedCountry[]) {
      if (a?.country_code && a?.country_name) m[String(a.country_code).toUpperCase()] = String(a.country_name);
    }
    return m;
  }, [rows, allowedCountries]);

  const parseAllowedInput = (txt: string) => {
    const parts = String(txt || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: Array<{ country_code: string; country_name: string; sort_order: number }> = [];
    for (const p of parts) {
      const m = p.match(/\b([A-Za-z]{2})\b/);
      if (!m) continue;
      const code = m[1].toUpperCase();
      if (seen.has(code)) continue;
      seen.add(code);
      const name = p
        .replace(m[0], '')
        .replace(/[-–—:|]+/g, ' ')
        .trim();
      out.push({
        country_code: code,
        country_name: name || codeToName[code] || code,
        sort_order: out.length,
      });
    }
    return out;
  };

  const whitelistMutation = useMutation({
    mutationFn: (countries: Array<{ country_code: string; country_name?: string; sort_order?: number }>) =>
      ShippingRateService.bulkSetAllowedCountries(countries),
    onSuccess: (res: ShippingMutationResult) => {
      toast.success(t('shipping.whitelist.updated', locale === 'zh' ? `白名单已更新（${res?.count || 0} 个国家）` : `Whitelist updated (${res?.count || 0})`));
      queryClient.invalidateQueries({ queryKey: [...queryKeys.shippingRates.admin(), 'allowed-countries'] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t('shipping.whitelist.updateFailed', locale === 'zh' ? '更新白名单失败' : 'Failed to update whitelist'))),
  });

  const removeAllowedMutation = useMutation({
    mutationFn: (code: string) => ShippingRateService.removeAllowedCountry(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...queryKeys.shippingRates.admin(), 'allowed-countries'] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t('shipping.whitelist.removeFailed', locale === 'zh' ? '移除失败' : 'Remove failed'))),
  });

  const downloadTemplate = async () => {
    try {
      const blob = await ShippingRateService.downloadTemplate({
        type: mode === 'carrier' ? 'carrier-zone' : 'country',
        carrier: mode === 'carrier' ? carrier : undefined,
        service: mode === 'carrier' ? serviceCode : undefined,
        currency: mode === 'carrier' ? currency : undefined,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mode === 'carrier'
        ? `shipping-${(carrier || 'carrier').toLowerCase()}-${(serviceCode || 'service').toLowerCase()}-zone-template.xlsx`
        : 'shipping-template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t('shipping.toast.templateDownloaded', '模板已下载'));
    } catch (e: unknown) {
      toast.error(errorMessage(e, t('shipping.downloadTemplate', '下载 XLSX 模板') + '失败'));
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!importFile) throw new Error(t('shipping.import.noFile', locale === 'zh' ? '请选择 .xlsx 文件' : 'Please select an .xlsx file'));
      return ShippingRateService.importXlsx(importFile, {
        replace: replaceMode,
        type: mode === 'carrier' ? 'carrier-zone' : 'country',
        carrier: mode === 'carrier' ? carrier : undefined,
        service: mode === 'carrier' ? serviceCode : undefined,
        currency: mode === 'carrier' ? currency : undefined,
      });
    },
    onSuccess: (res: ShippingRateImportResult) => {
      toast.success(t('shipping.toast.imported', '已导入国家：{countries}（新增 {created}，更新 {updated}）', {
        countries: res.countries || 0,
        created: res.created || 0,
        updated: res.updated || 0,
      }));
      setImportFile(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.shippingRates.admin() });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t('shipping.import', '导入') + '失败')),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (payload: { all?: boolean; country_codes?: string[] }) =>
      ShippingRateService.bulkDelete(payload, {
        type: mode === 'carrier' ? 'carrier' : 'country',
        carrier: mode === 'carrier' ? carrier : undefined,
        service: mode === 'carrier' ? serviceCode : undefined,
      }),
    onSuccess: (res: ShippingMutationResult) => {
      toast.success(t('shipping.toast.deleted', '已删除 {deleted} 个国家模板', { deleted: res.deleted || 0 }));
      setSelectedCodes([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.shippingRates.admin() });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, t('common.delete', '删除') + '失败')),
  });

  const toggleSelected = (code: string) => {
    setSelectedCodes((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('shipping.title', '运费模板')}</h1>
            <p className="mt-1 text-sm text-gray-500">{t('shipping.subtitle', '支持多国家运费配置：<21kg 按整数公斤直接取值；>=21kg 按区间每公斤价格计算。')}</p>
            {mode === 'carrier' && (
              <p className="mt-1 text-xs text-gray-500">
                {t(
                  'shipping.carrier.hint',
                  locale === 'zh'
                    ? '承运商模式：上传文件需包含 CountryZones（ISO2->Zone）。费率可用模板的 Under21Kg_Zones/Over21Kg_Zones，或直接用你的 FedEx eBay 表（系统会从“加过利润的所有运费（含旺季附加费）”读取）。'
                    : 'Carrier mode: upload must include CountryZones (ISO2->Zone). Rates can be from Under21Kg_Zones/Over21Kg_Zones, or your FedEx eBay sheet (parsed from the combined sheet).'
                )}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <span className="text-gray-500">{t('shipping.mode', locale === 'zh' ? '类型' : 'Mode')}</span>
              <select
                value={mode}
                onChange={(e) => {
                  const v = e.target.value as 'country' | 'carrier';
                  setMode(v);
                  setSelectedCodes([]);
                  setImportFile(null);
                }}
                className="px-2 py-1 border border-gray-300 rounded-md bg-white"
              >
                <option value="country">{t('shipping.mode.country', locale === 'zh' ? '按国家（默认）' : 'By country')}</option>
                <option value="carrier">{t('shipping.mode.carrier', locale === 'zh' ? '按承运商（FedEx/DHL）' : 'By carrier')}</option>
              </select>
            </label>

            {mode === 'carrier' && (
              <>
                <input
                  value={carrier}
                  onChange={(e) => {
                    setCarrier(e.target.value);
                    setSelectedCodes([]);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder={t('shipping.carrierPh', locale === 'zh' ? '承运商 (FEDEX/DHL)' : 'Carrier (FEDEX/DHL)')}
                />
                <input
                  value={serviceCode}
                  onChange={(e) => {
                    setServiceCode(e.target.value);
                    setSelectedCodes([]);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder={t('shipping.servicePh', locale === 'zh' ? '服务代码 (IP/IE...)' : 'Service (IP/IE...)')}
                />
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm w-24"
                  placeholder={t('shipping.currency', '币种')}
                />
              </>
            )}

            <button
              onClick={downloadTemplate}
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-200 bg-white hover:bg-gray-50"
            >
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
              {mode === 'carrier'
                ? t('shipping.downloadCarrierZoneTemplate', locale === 'zh' ? '下载承运商模板' : 'Download Carrier Template')
                : t('shipping.downloadTemplate', '下载 XLSX 模板')}
            </button>

            <label className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer">
              <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
              <span>{t('shipping.chooseXlsx', '选择 XLSX')}</span>
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={replaceMode} onChange={(e) => setReplaceMode(e.target.checked)} className="h-4 w-4" />
              {t('shipping.replaceRules', '覆盖旧规则（同国家）')}
            </label>

            <button
              onClick={() => importMutation.mutate()}
              disabled={!importFile || importMutation.isPending}
              className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t('shipping.import', '导入')}
            </button>

            <button
              onClick={() => {
                if (!window.confirm(t('shipping.confirmDeleteAll', '确定删除全部运费模板吗？此操作不可撤销。'))) return;
                bulkDeleteMutation.mutate({ all: true });
              }}
              className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700"
              disabled={bulkDeleteMutation.isPending}
              title={
                mode === 'carrier'
                  ? t('shipping.deleteAllCarrier.title', locale === 'zh' ? '删除该承运商/服务下全部国家模板' : 'Delete all for this carrier/service')
                  : t('shipping.deleteAll.title', locale === 'zh' ? '批量删除全部国家模板' : 'Bulk delete all countries')
              }
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              {t('shipping.deleteAll', '删除全部')}
            </button>
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-6 space-y-4">
          <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{t('shipping.whitelist.title', locale === 'zh' ? '售卖国家白名单' : 'Selling Countries Whitelist')}</div>
                <div className="mt-1 text-xs text-gray-600">
                  {allowedLoading
                    ? t('common.loading', '加载中...')
                    : allowedCountries.length > 0
                      ? (locale === 'zh'
                        ? `已启用白名单：前台只显示这 ${allowedCountries.length} 个国家。清空白名单=恢复显示全部。`
                        : `Whitelist enabled: only these ${allowedCountries.length} countries are shown on the storefront. Clear it to show all.`)
                      : (locale === 'zh'
                        ? '白名单为空：前台会显示所有已配置的国家。你可以在这里设置只卖到哪些国家。'
                        : 'Whitelist is empty: storefront shows all configured countries. Set it to restrict selling countries.')}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    const list = parseAllowedInput(allowedText);
                    whitelistMutation.mutate(list);
                  }}
                  disabled={whitelistMutation.isPending}
                  className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  title={t('shipping.whitelist.applyHint', locale === 'zh' ? '把下面输入的国家设置为白名单' : 'Apply whitelist from input')}
                >
                  {t('shipping.whitelist.apply', locale === 'zh' ? '应用白名单' : 'Apply Whitelist')}
                </button>
                <button
                  onClick={() => {
                    if (selectedCodes.length === 0) {
                      toast.error(t('shipping.whitelist.selectFirst', locale === 'zh' ? '请先在下方列表勾选国家' : 'Select countries from the list first'));
                      return;
                    }
                    const list = selectedCodes.map((cc, i) => ({
                      country_code: String(cc).toUpperCase(),
                      country_name: codeToName[String(cc).toUpperCase()] || String(cc).toUpperCase(),
                      sort_order: i,
                    }));
                    whitelistMutation.mutate(list);
                  }}
                  disabled={whitelistMutation.isPending}
                  className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('shipping.whitelist.fromSelected', locale === 'zh' ? '用已选国家设置' : 'Use Selected')}
                </button>
                <button
                  onClick={() => {
                    if (!window.confirm(t('shipping.whitelist.clearConfirm', locale === 'zh' ? '确定清空白名单吗？清空后前台会显示全部国家。' : 'Clear whitelist? Storefront will show all countries.'))) return;
                    whitelistMutation.mutate([]);
                  }}
                  disabled={whitelistMutation.isPending}
                  className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-gray-900 text-white hover:bg-black disabled:opacity-50"
                >
                  {t('shipping.whitelist.clear', locale === 'zh' ? '清空白名单' : 'Clear')}
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{t('shipping.whitelist.input', locale === 'zh' ? '输入国家（逗号或换行分隔）' : 'Input countries (comma/newline separated)')}</label>
                <textarea
                  value={allowedText}
                  onChange={(e) => setAllowedText(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder={locale === 'zh'
                    ? '例如：\nCA Canada\nAU Australia\nDE Germany\nJP Japan\n\n或：CA,AU,DE,JP'
                    : 'Example:\nCA Canada\nAU Australia\nDE Germany\nJP Japan\n\nOr: CA,AU,DE,JP'}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-700 mb-1">{t('shipping.whitelist.current', locale === 'zh' ? '当前白名单' : 'Current whitelist')}</div>
                <div className="rounded-md border border-gray-200 bg-white p-2 h-[110px] overflow-auto">
                  {allowedLoading ? (
                    <div className="text-sm text-gray-500">{t('common.loading', '加载中...')}</div>
                  ) : allowedCountries.length === 0 ? (
                    <div className="text-sm text-gray-500">{t('shipping.whitelist.empty', locale === 'zh' ? '（空）' : '(empty)')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allowedCountries.map((c) => (
                        <span key={c.country_code} className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-gray-200 text-sm">
                          <span className="font-mono text-gray-900">{c.country_code}</span>
                          <span className="text-gray-700">{c.country_name}</span>
                          <button
                            onClick={() => removeAllowedMutation.mutate(c.country_code)}
                            className="text-gray-400 hover:text-gray-700"
                            title={t('common.remove', locale === 'zh' ? '移除' : 'Remove')}
                            disabled={removeAllowedMutation.isPending}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Free Shipping Section */}
          <div className="rounded-md border border-green-200 bg-green-50 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{locale === 'zh' ? '免运费设置' : 'Free Shipping Settings'}</div>
                <div className="mt-1 text-xs text-gray-600">
                  {freeShippingLoading
                    ? (locale === 'zh' ? '加载中...' : 'Loading...')
                    : freeShippingCountries.filter((c: ShippingFreeSetting) => c.free_shipping_enabled).length > 0
                      ? (locale === 'zh'
                        ? `已启用免运费：${freeShippingCountries.filter((c: ShippingFreeSetting) => c.free_shipping_enabled).map((c: ShippingFreeSetting) => c.country_code).join(', ')}。`
                        : `Free shipping enabled for: ${freeShippingCountries.filter((c: ShippingFreeSetting) => c.free_shipping_enabled).map((c: ShippingFreeSetting) => c.country_code).join(', ')}.`)
                      : (locale === 'zh'
                        ? '未启用免运费。勾选国家后可为其开启免运费。'
                        : 'No free shipping enabled. Toggle countries below to enable free shipping.')}
                </div>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {/* Current free shipping countries */}
              <div className="flex flex-wrap gap-2">
                {freeShippingCountries.map((c: ShippingFreeSetting) => (
                  <label key={c.country_code} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-sm cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={c.free_shipping_enabled}
                      onChange={() => {
                        const updated = freeShippingCountries.map((x: ShippingFreeSetting) =>
                          x.country_code === c.country_code
                            ? { country_code: x.country_code, country_name: x.country_name, free_shipping_enabled: !x.free_shipping_enabled }
                            : { country_code: x.country_code, country_name: x.country_name, free_shipping_enabled: x.free_shipping_enabled }
                        );
                        freeShippingMutation.mutate(updated);
                      }}
                      className="h-4 w-4 text-green-600"
                      disabled={freeShippingMutation.isPending}
                    />
                    <span className="font-mono text-gray-900">{c.country_code}</span>
                    <span className="text-gray-700">{c.country_name}</span>
                  </label>
                ))}
              </div>

              {/* Add new country */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={freeShippingCode}
                  onChange={(e) => setFreeShippingCode(e.target.value.toUpperCase())}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm w-24"
                  placeholder={locale === 'zh' ? '国家代码' : 'Code (US)'}
                  maxLength={2}
                />
                <input
                  value={freeShippingName}
                  onChange={(e) => setFreeShippingName(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder={locale === 'zh' ? '国家名称' : 'Country name'}
                />
                <button
                  onClick={() => {
                    const code = freeShippingCode.trim().toUpperCase();
                    if (!code || code.length !== 2) {
                      toast.error(locale === 'zh' ? '请输入有效的 2 位国家代码' : 'Please enter a valid 2-letter country code');
                      return;
                    }
                    const existing = freeShippingCountries.map((x: ShippingFreeSetting) => ({
                      country_code: x.country_code,
                      country_name: x.country_name,
                      free_shipping_enabled: x.free_shipping_enabled,
                    }));
                    if (existing.some((x: { country_code: string }) => x.country_code === code)) {
                      toast.error(locale === 'zh' ? '该国家已在列表中' : 'Country already exists');
                      return;
                    }
                    existing.push({
                      country_code: code,
                      country_name: freeShippingName.trim() || codeToName[code] || code,
                      free_shipping_enabled: true,
                    });
                    freeShippingMutation.mutate(existing);
                    setFreeShippingCode('');
                    setFreeShippingName('');
                  }}
                  disabled={freeShippingMutation.isPending}
                  className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {locale === 'zh' ? '添加免运费国家' : 'Add Free Shipping Country'}
                </button>
                <button
                  onClick={() => {
                    const code = 'US';
                    const existing = freeShippingCountries.map((x: ShippingFreeSetting) => ({
                      country_code: x.country_code,
                      country_name: x.country_name,
                      free_shipping_enabled: x.free_shipping_enabled,
                    }));
                    if (existing.some((x: { country_code: string }) => x.country_code === code)) {
                      // Toggle US free shipping on
                      const updated = existing.map((x: { country_code: string; country_name: string; free_shipping_enabled: boolean }) =>
                        x.country_code === code ? { ...x, free_shipping_enabled: true } : x
                      );
                      freeShippingMutation.mutate(updated);
                    } else {
                      existing.push({ country_code: 'US', country_name: 'United States', free_shipping_enabled: true });
                      freeShippingMutation.mutate(existing);
                    }
                  }}
                  disabled={freeShippingMutation.isPending || freeShippingCountries.some((c: ShippingFreeSetting) => c.country_code === 'US' && c.free_shipping_enabled)}
                  className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-green-300 bg-white text-green-700 hover:bg-green-50 disabled:opacity-50"
                >
                  {locale === 'zh' ? '快速启用 US 免运费' : 'Enable US Free Shipping'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('shipping.search', '搜索')}</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder={t('shipping.searchPh', locale === 'zh' ? 'US / CN ...' : 'US / CN ...')}
              />
            </div>
            <button
              onClick={() => {
                if (selectedCodes.length === 0) { toast.error(t('shipping.toast.selectOne', '请至少选择一个国家')); return; }
                if (!window.confirm(t('shipping.confirmDeleteSelected', '确定删除这些国家的模板吗：{codes}？', { codes: selectedCodes.join(', ') }))) return;
                bulkDeleteMutation.mutate({ country_codes: selectedCodes });
              }}
              className="inline-flex items-center px-4 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              disabled={bulkDeleteMutation.isPending || selectedCodes.length === 0}
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              {t('shipping.deleteSelected', '删除已选')}
            </button>
          </div>

          <div className="overflow-auto rounded border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('shipping.select', '选择')}</th>
                  {mode === 'carrier' && (
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      {t('shipping.carrier', locale === 'zh' ? '承运商/服务' : 'Carrier/Service')}
                    </th>
                  )}
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('shipping.country', '国家')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('shipping.currency', '币种')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('shipping.weightBrackets', '重量规则数')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('shipping.quoteSurcharges', '附加费规则数')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={mode === 'carrier' ? 6 : 5} className="px-3 py-10 text-center text-gray-500">{t('shipping.loading', '加载中...')}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={mode === 'carrier' ? 6 : 5} className="px-3 py-10 text-center text-gray-500">{t('shipping.empty', '暂无模板')}</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={(mode === 'carrier' ? `${r.carrier || carrier}:${r.service_code || serviceCode}:` : '') + r.country_code} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedCodes.includes(r.country_code)}
                          onChange={() => toggleSelected(r.country_code)}
                          className="h-4 w-4"
                        />
                      </td>
                      {mode === 'carrier' && (
                        <td className="px-3 py-2 text-gray-900">
                          <div className="font-mono">{r.carrier || carrier || '-'}</div>
                          <div className="text-gray-700">{r.service_code || serviceCode || '-'}</div>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div className="font-mono text-gray-900">{r.country_code}</div>
                        <div className="text-gray-700">{r.country_name}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-900">{r.currency || 'USD'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.weight_brackets}</td>
                      <td className="px-3 py-2 text-gray-900">{r.quote_surcharges}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
