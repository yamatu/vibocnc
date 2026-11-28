'use client';

import AdminLayout from '@/components/admin/AdminLayout';
import { useAdminI18n } from '@/lib/admin-i18n';
import {
  DatasheetService,
  type DatasheetLookup,
  type DatasheetRecord,
  type DatasheetSearchResult,
} from '@/services/datasheet.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

/**
 * Admin screen for the Datasheets.com product search API.
 *
 * Purpose: let an administrator look one part number up, read what the provider
 * knows, and copy what they trust. The screen never writes to a product by
 * itself: parameters go through a spec draft that must be approved, and the
 * copyable fields (datasheet URL, description) are offered for manual entry.
 *
 * Two labels matter and appear on every result:
 *   - "exact match": the provider's part number equals the one we asked for.
 *     Only exact matches may become product parameters, because the API also
 *     returns fuzzy neighbours (3RV1742-5FD10 for 3RV1742-5LD10).
 *   - the attribution line, which the provider terms require wherever the data
 *     is displayed.
 */
function AdminDatasheetPageInner() {
  const { locale } = useAdminI18n();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const productIdParam = Number(searchParams?.get('product_id') || 0) || 0;

  const zh = locale === 'zh';

  const {
    data: settings,
    isLoading: settingsLoading,
    isError: settingsError,
    error: settingsErr,
    refetch: refetchSettings,
  } = useQuery({
    queryKey: ['datasheet', 'settings'],
    queryFn: () => DatasheetService.getSettings(),
  });

  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [perMinute, setPerMinute] = useState('60');
  const [perHour, setPerHour] = useState('500');
  const [monthly, setMonthly] = useState('5000');
  const [autoStop, setAutoStop] = useState('90');
  const [cacheDays, setCacheDays] = useState('90');
  const [pageLimit, setPageLimit] = useState('10');

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DatasheetSearchResult | null>(null);
  const [selectedRecord, setSelectedRecord] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.setting.enabled);
    setPerMinute(String(settings.setting.per_minute_limit));
    setPerHour(String(settings.setting.per_hour_limit));
    setMonthly(String(settings.setting.monthly_limit));
    setAutoStop(String(settings.setting.auto_stop_percent));
    setCacheDays(String(settings.setting.cache_ttl_days));
    setPageLimit(String(settings.setting.default_page_limit));
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      DatasheetService.updateSettings({
        enabled,
        api_key: apiKey.trim() || undefined,
        per_minute_limit: Number(perMinute) || undefined,
        per_hour_limit: Number(perHour) || undefined,
        monthly_limit: Number(monthly) || undefined,
        auto_stop_percent: Number(autoStop) || undefined,
        cache_ttl_days: Number.isNaN(Number(cacheDays)) ? undefined : Number(cacheDays),
        default_page_limit: Number(pageLimit) || undefined,
      }),
    onSuccess: () => {
      setApiKey('');
      toast.success(zh ? '设置已保存' : 'Settings saved');
      refetchSettings();
    },
    onError: (e: any) => toast.error(e?.message || (zh ? '保存失败' : 'Save failed')),
  });

  const clearKeyMutation = useMutation({
    mutationFn: () => DatasheetService.updateSettings({ clear_api_key: true }),
    onSuccess: () => {
      toast.success(zh ? '已清除密钥' : 'API key cleared');
      refetchSettings();
    },
    onError: (e: any) => toast.error(e?.message || (zh ? '清除失败' : 'Failed to clear the key')),
  });

  const resetUsageMutation = useMutation({
    mutationFn: () => DatasheetService.updateSettings({ reset_usage: true }),
    onSuccess: () => {
      toast.success(zh ? '本月用量已归零' : 'Monthly counter reset');
      refetchSettings();
    },
    onError: (e: any) => toast.error(e?.message || (zh ? '重置失败' : 'Reset failed')),
  });

  const testMutation = useMutation({
    mutationFn: () => DatasheetService.testKey('BAV99'),
    onSuccess: (data) => {
      toast.success(
        zh
          ? `密钥可用（返回 ${data.count} 条，剩余 ${data.quota_remaining}/${data.quota_limit} 次）`
          : `Key works (${data.count} record(s), ${data.quota_remaining}/${data.quota_limit} calls left)`,
      );
      refetchSettings();
    },
    onError: (e: any) => toast.error(e?.message || (zh ? '密钥测试失败' : 'Key test failed')),
  });

  const searchMutation = useMutation({
    mutationFn: (vars: { q: string; page: number; refresh?: boolean }) =>
      DatasheetService.search({
        q: vars.q,
        page: vars.page,
        limit: Number(pageLimit) || 10,
        refresh: vars.refresh,
        product_id: productIdParam || undefined,
      }),
    onSuccess: (data) => {
      setResult(data);
      setSelectedRecord(0);
      setChecked({});
      refetchSettings();
      const lookup = data.lookup;
      if (lookup.notice) {
        toast(lookup.notice, { icon: 'ℹ️' });
      } else if (lookup.cache_hit) {
        toast.success(
          zh
            ? `命中缓存（${lookup.cache_age}），本次未消耗配额`
            : `Served from cache (${lookup.cache_age}), no quota used`,
        );
      } else {
        toast.success(zh ? '查询完成' : 'Lookup complete');
      }
    },
    onError: (e: any) => toast.error(e?.message || (zh ? '查询失败' : 'Lookup failed')),
  });

  const draftMutation = useMutation({
    mutationFn: (vars: { record: DatasheetRecord; specs: { name: string; value: string }[] }) =>
      DatasheetService.createDraft({
        product_id: result?.product?.id || productIdParam || undefined,
        mpn: vars.record.mpn,
        q: result?.lookup.query,
        specs: vars.specs,
      }),
    onSuccess: (draft) => {
      qc.invalidateQueries({ queryKey: ['datasheet', 'cache'] });
      toast.success(
        zh
          ? `已生成待审草稿 #${draft.id}，需在「参数草稿」审核后才会写入产品`
          : `Draft #${draft.id} created. Approve it before it reaches the product.`,
      );
    },
    onError: (e: any) => toast.error(e?.message || (zh ? '生成草稿失败' : 'Failed to create the draft')),
  });

  const lookup: DatasheetLookup | null = result?.lookup ?? null;
  const records = lookup?.records ?? [];
  const record: DatasheetRecord | undefined = records[selectedRecord];
  const checkableSpecs = useMemo(() => record?.specs ?? [], [record]);
  const checkedSpecs = useMemo(
    () => checkableSpecs.filter((spec) => checked[`${spec.name}\u0000${spec.value}`]),
    [checkableSpecs, checked],
  );

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(zh ? `已复制${label}` : `${label} copied`);
    } catch {
      toast.error(zh ? '复制失败，请手动选择文本' : 'Copy failed, select the text manually');
    }
  };

  const quotaPercent = settings?.setting
    ? Math.min(100, Math.round((settings.setting.monthly_used / Math.max(1, settings.setting.monthly_limit)) * 100))
    : 0;

  return (
    <AdminLayout>
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {zh ? 'Datasheets.com 参数查询' : 'Datasheets.com Product Lookup'}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {zh
              ? '按型号查询 Datasheets.com，人工核对后决定是否采纳。查询结果只是参考：参数必须经「参数草稿」审核才会写入产品。'
              : 'Look one part number up on Datasheets.com and review the answer by hand. Results are reference only: parameters reach a product through an approved spec draft.'}
          </p>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {zh ? (
            <>
              账户配额 5,000 次/月，而本目录有 50 万+ SKU，因此这里<b>只做单条按需查询</b>，不做批量回填；重复查询会命中本地缓存，
              不消耗配额。条款要求署名并禁止把数据镜像到其他站点，公开页面请保留回链 Datasheets.com。
            </>
          ) : (
            <>
              The account allows 5,000 calls a month against 500k+ SKUs, so this screen is
              <b> on-demand, one part number at a time</b> and never bulk-fills the catalogue. Repeat
              lookups hit the local cache for free. The provider terms require attribution and forbid
              mirroring their data: keep the link back to Datasheets.com on public pages.
            </>
          )}
        </div>

        {settingsLoading ? (
          <div className="bg-white rounded-lg shadow p-6">{zh ? '加载中…' : 'Loading…'}</div>
        ) : settingsError ? (
          <div className="bg-white rounded-lg shadow p-6 text-sm text-red-600">
            {String((settingsErr as any)?.message || (zh ? '加载设置失败' : 'Failed to load settings'))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-5">
                <div className="text-sm text-gray-500">{zh ? '本月已用' : 'Used this month'}</div>
                <div className="mt-2 text-2xl font-bold text-gray-900">
                  {(settings?.setting.monthly_used ?? 0).toLocaleString()} /{' '}
                  {(settings?.setting.monthly_limit ?? 0).toLocaleString()}
                </div>
                <div className="mt-2 h-2 rounded bg-gray-100">
                  <div
                    className={`h-2 rounded ${
                      quotaPercent >= 90 ? 'bg-red-500' : quotaPercent >= 70 ? 'bg-amber-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${quotaPercent}%` }}
                  />
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-5">
                <div className="text-sm text-gray-500">{zh ? '剩余配额' : 'Calls left'}</div>
                <div className="mt-2 text-2xl font-bold text-blue-700">
                  {(settings?.setting.monthly_remaining ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-5">
                <div className="text-sm text-gray-500">{zh ? '缓存有效期' : 'Cache TTL'}</div>
                <div className="mt-2 text-lg font-bold text-gray-900">
                  {(settings?.setting.cache_ttl_days ?? 0) > 0
                    ? zh
                      ? `${settings?.setting.cache_ttl_days} 天`
                      : `${settings?.setting.cache_ttl_days} days`
                    : zh
                      ? '已关闭'
                      : 'Off'}
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-5">
                <div className="text-sm text-gray-500">{zh ? 'API 密钥' : 'API key'}</div>
                <div className={`mt-2 text-lg font-bold ${settings?.has_api_key ? 'text-green-700' : 'text-red-600'}`}>
                  {settings?.has_api_key ? (zh ? '已配置' : 'Configured') : zh ? '未配置' : 'Missing'}
                </div>
                {settings?.api_key_from_env && (
                  <div className="mt-1 text-xs text-gray-500">{zh ? '来自环境变量' : 'from environment'}</div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">{zh ? '设置' : 'Settings'}</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="block md:col-span-2">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    {zh ? 'API 密钥（留空表示不修改）' : 'API key (leave empty to keep the current one)'}
                  </div>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={settings?.has_api_key ? '••••••••••••' : 'ps_live.…'}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    autoComplete="new-password"
                  />
                  <div className="mt-1 text-xs text-gray-500">
                    {zh
                      ? '密钥加密后存入数据库，不会回传到浏览器。'
                      : 'The key is encrypted at rest and never sent back to the browser.'}
                  </div>
                </label>
                <label className="flex items-center gap-2 mt-6">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  <span className="text-sm text-gray-700">{zh ? '启用查询' : 'Enable lookups'}</span>
                </label>
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">{zh ? '每分钟上限' : 'Per minute'}</div>
                  <input
                    value={perMinute}
                    onChange={(e) => setPerMinute(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">{zh ? '每小时上限' : 'Per hour'}</div>
                  <input
                    value={perHour}
                    onChange={(e) => setPerHour(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">{zh ? '每月上限' : 'Per month'}</div>
                  <input
                    value={monthly}
                    onChange={(e) => setMonthly(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">{zh ? '提前停用阈值 %' : 'Auto-stop at %'}</div>
                  <input
                    value={autoStop}
                    onChange={(e) => setAutoStop(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">{zh ? '缓存有效天数' : 'Cache TTL (days)'}</div>
                  <input
                    value={cacheDays}
                    onChange={(e) => setCacheDays(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    {zh ? '每次返回条数（最多 10）' : 'Records per page (max 10)'}
                  </div>
                  <input
                    value={pageLimit}
                    onChange={(e) => setPageLimit(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saveMutation.isPending ? (zh ? '保存中…' : 'Saving…') : zh ? '保存设置' : 'Save settings'}
                </button>
                <button
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !settings?.has_api_key}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                >
                  {testMutation.isPending
                    ? zh
                      ? '测试中…'
                      : 'Testing…'
                    : zh
                      ? '测试密钥（消耗 1 次）'
                      : 'Test key (costs 1 call)'}
                </button>
                <button
                  onClick={() => resetUsageMutation.mutate()}
                  disabled={resetUsageMutation.isPending}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                >
                  {zh ? '本月用量归零' : 'Reset monthly counter'}
                </button>
                {settings?.has_api_key && !settings?.api_key_from_env && (
                  <button
                    onClick={() => clearKeyMutation.mutate()}
                    className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
                  >
                    {zh ? '清除密钥' : 'Clear API key'}
                  </button>
                )}
                {settings?.setting.last_call_at && (
                  <span className="self-center text-xs text-gray-500">
                    {zh ? '上次调用：' : 'Last call: '}
                    {new Date(settings.setting.last_call_at).toLocaleString()} · {settings.setting.last_call_query} ·{' '}
                    {settings.setting.last_call_message}
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">{zh ? '型号查询' : 'Part-number lookup'}</h2>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block flex-1 min-w-[240px]">
                  <div className="text-sm font-medium text-gray-700 mb-1">{zh ? '型号 / MPN' : 'Model / MPN'}</div>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && query.trim()) {
                        setPage(1);
                        searchMutation.mutate({ q: query.trim(), page: 1 });
                      }
                    }}
                    placeholder={zh ? '例如 F3S-TGR-CL2A-014-450 / 1205859' : 'e.g. F3S-TGR-CL2A-014-450 / 1205859'}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                {result?.product && (
                  <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    {zh ? '产品：' : 'Product: '}
                    {result.product.sku} · {result.product.brand} · {result.product.model}
                  </div>
                )}
                <button
                  onClick={() => {
                    if (!query.trim()) return;
                    setPage(1);
                    searchMutation.mutate({ q: query.trim(), page: 1 });
                  }}
                  disabled={searchMutation.isPending || !settings?.has_api_key}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {searchMutation.isPending ? (zh ? '查询中…' : 'Looking up…') : zh ? '查询' : 'Look up'}
                </button>
                <button
                  onClick={() => {
                    if (!query.trim()) return;
                    setPage(1);
                    searchMutation.mutate({ q: query.trim(), page: 1, refresh: true });
                  }}
                  disabled={searchMutation.isPending || !settings?.has_api_key}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                >
                  {zh ? '强制刷新（消耗 1 次）' : 'Force refresh (costs 1 call)'}
                </button>
              </div>

              {lookup && (
                <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  {zh ? '查询：' : 'Query: '}
                  <span className="font-mono">{lookup.query}</span> · {lookup.count} {zh ? '条结果' : 'result(s)'} ·{' '}
                  {lookup.exact_count} {zh ? '条精确匹配' : 'exact match(es)'} ·{' '}
                  {lookup.cache_hit ? (
                    <span className="text-green-700">
                      {zh ? `缓存（${lookup.cache_age}，未扣配额）` : `cache (${lookup.cache_age}, no quota)`}
                    </span>
                  ) : (
                    <span className="text-blue-700">{zh ? '实时请求（已扣 1 次）' : 'live call (1 used)'}</span>
                  )}
                </div>
              )}

              {records.length === 0 && lookup && (
                <div className="rounded-md border border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  {zh
                    ? 'Datasheets.com 没有这个型号的结果。该库以电子元器件为主（IC、分立器件、连接器、传感器），工业自动化备件（FANUC/西门子模块等）大多查不到。'
                    : 'No result on Datasheets.com. The library is mostly electronic components (ICs, discretes, connectors, sensors); industrial automation spares (FANUC/Siemens modules) are usually absent.'}
                </div>
              )}

              {records.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    {records.map((r, index) => (
                      <button
                        key={`${r.mpn}-${index}`}
                        onClick={() => {
                          setSelectedRecord(index);
                          setChecked({});
                        }}
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                          index === selectedRecord ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs">{r.mpn}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              r.exact_match ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {r.exact_match ? (zh ? '精确匹配' : 'exact') : zh ? '相似型号' : 'similar'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">{r.manufacturer}</div>
                        <div className="text-xs text-gray-400">
                          {(r.specs?.length ?? 0)} {zh ? '条参数' : 'specs'}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="lg:col-span-2 space-y-3">
                    {record && (
                      <>
                        <div className="rounded-md border border-gray-200 p-4 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-gray-900">{record.title || record.mpn}</div>
                              <div className="text-xs text-gray-500">
                                {record.manufacturer} · {record.mpn}
                                {record.lifecycle_status ? ` · ${record.lifecycle_status}` : ''}
                                {record.package_type ? ` · ${record.package_type}` : ''}
                              </div>
                            </div>
                            {record.url && (
                              <a
                                href={record.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="text-xs text-blue-600 underline"
                              >
                                {zh ? '在 Datasheets.com 打开' : 'Open on Datasheets.com'}
                              </a>
                            )}
                          </div>
                          {record.description && <p className="text-sm text-gray-700">{record.description}</p>}
                          <div className="text-xs text-gray-500">
                            {[record.category1, record.category2, record.category3, record.category4]
                              .filter(Boolean)
                              .join(' › ')}
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {record.datasheet_url && (
                              <>
                                <a
                                  href={record.datasheet_url}
                                  target="_blank"
                                  rel="noopener noreferrer nofollow"
                                  className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700"
                                >
                                  {zh ? '打开 PDF 数据手册' : 'Open datasheet PDF'}
                                </a>
                                <button
                                  onClick={() => copy('datasheet_url', record.datasheet_url!)}
                                  className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700"
                                >
                                  {zh ? '复制 datasheet_url' : 'Copy datasheet_url'}
                                </button>
                              </>
                            )}
                            {record.primary_image_url && (
                              <button
                                onClick={() => copy('image_url', record.primary_image_url!)}
                                className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700"
                              >
                                {zh ? '复制图片地址' : 'Copy image URL'}
                              </button>
                            )}
                            {record.description && (
                              <button
                                onClick={() => copy('description', record.description)}
                                className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700"
                              >
                                {zh ? '复制描述' : 'Copy description'}
                              </button>
                            )}
                          </div>
                        </div>

                        {!record.exact_match && (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            {zh
                              ? '这不是精确匹配：Datasheets.com 只是返回了一个相似型号。相似型号的参数不能写进当前产品，否则会用别家型号的规格误导客户。'
                              : 'Not an exact match: this is a neighbouring part number. Its parameters must not be published under the current product, or customers get another part number’s specification.'}
                          </div>
                        )}

                        {checkableSpecs.length > 0 ? (
                          <div className="rounded-md border border-gray-200">
                            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
                              <div className="text-sm font-medium text-gray-900">
                                {zh ? `参数（${checkableSpecs.length}）` : `Parameters (${checkableSpecs.length})`}
                              </div>
                              <div className="flex gap-2 text-xs">
                                <button
                                  onClick={() =>
                                    setChecked(
                                      Object.fromEntries(
                                        checkableSpecs.map((s) => [`${s.name}\u0000${s.value}`, true] as const),
                                      ),
                                    )
                                  }
                                  className="text-blue-600 underline"
                                >
                                  {zh ? '全选' : 'Select all'}
                                </button>
                                <button onClick={() => setChecked({})} className="text-gray-600 underline">
                                  {zh ? '清空' : 'Clear'}
                                </button>
                              </div>
                            </div>
                            <div className="max-h-80 overflow-auto divide-y divide-gray-100">
                              {checkableSpecs.map((spec, i) => {
                                const key = `${spec.name}\u0000${spec.value}`;
                                return (
                                  <label
                                    key={`${key}-${i}`}
                                    className="flex items-start gap-2 px-4 py-1.5 text-sm hover:bg-gray-50"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={!!checked[key]}
                                      onChange={(e) => setChecked((prev) => ({ ...prev, [key]: e.target.checked }))}
                                      className="mt-1"
                                    />
                                    <span className="text-gray-500 min-w-[180px]">{spec.name}</span>
                                    <span className="text-gray-900 font-mono text-xs">{spec.value}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-3">
                              <button
                                onClick={() =>
                                  draftMutation.mutate({
                                    record,
                                    specs: checkedSpecs.map((s) => ({ name: s.name, value: s.value })),
                                  })
                                }
                                disabled={!record.exact_match || checkedSpecs.length === 0 || draftMutation.isPending}
                                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                              >
                                {draftMutation.isPending
                                  ? zh
                                    ? '生成中…'
                                    : 'Creating…'
                                  : zh
                                    ? `用选中的 ${checkedSpecs.length} 条参数生成待审草稿`
                                    : `Create draft from ${checkedSpecs.length} parameter(s)`}
                              </button>
                              <span className="text-xs text-gray-500">
                                {zh
                                  ? '草稿仍需在「参数草稿」里审核通过，才会写入产品。'
                                  : 'The draft still has to be approved before it reaches the product.'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-md border border-gray-200 px-4 py-3 text-sm text-gray-500">
                            {zh
                              ? '这条记录没有参数表（Datasheets.com 对很多工业件只提供标题、描述和手册链接）。可以复制描述或 datasheet_url 到产品里。'
                              : 'This record carries no parameter table (Datasheets.com often only has a title, description and datasheet link for industrial parts). Copy the description or datasheet_url instead.'}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {lookup && lookup.count > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <button
                    onClick={() => {
                      const next = Math.max(1, page - 1);
                      setPage(next);
                      searchMutation.mutate({ q: lookup.query, page: next });
                    }}
                    disabled={page <= 1 || searchMutation.isPending}
                    className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                  >
                    {zh ? '上一页' : 'Prev'}
                  </button>
                  <span>
                    {zh ? `第 ${lookup.page} 页` : `Page ${lookup.page}`}
                  </span>
                  <button
                    onClick={() => {
                      const next = page + 1;
                      setPage(next);
                      searchMutation.mutate({ q: lookup.query, page: next });
                    }}
                    disabled={records.length < (lookup.limit || 10) || searchMutation.isPending}
                    className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                  >
                    {zh ? '下一页' : 'Next'}
                  </button>
                </div>
              )}

              <div className="border-t border-gray-100 pt-3 text-xs text-gray-500">
                {settings?.attribution || 'Data from Datasheets.com'} ·{' '}
                <a href="https://www.datasheets.com" target="_blank" rel="noopener noreferrer" className="underline">
                  datasheets.com
                </a>
                {zh ? '（条款要求展示来源，请勿删除）' : ' (attribution is required by the provider terms)'}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

/**
 * useSearchParams() opts the page out of static prerendering, so Next requires a
 * Suspense boundary around it. The fallback mirrors the page's own loading row.
 */
export default function AdminDatasheetPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-lg shadow p-6">Loading…</div>}>
      <AdminDatasheetPageInner />
    </Suspense>
  );
}
