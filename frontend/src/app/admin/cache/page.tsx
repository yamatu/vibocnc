'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import AdminLayout from '@/components/admin/AdminLayout';
import { CacheService, HotlinkService } from '@/services';
import type { CloudflareCacheSettingResponse } from '@/services/cache.service';
import type { HotlinkProtectionSettingResponse } from '@/services/hotlink.service';
import { useAdminI18n } from '@/lib/admin-i18n';

function splitUrls(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AdminCachePage() {
  const { t } = useAdminI18n();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<CloudflareCacheSettingResponse | null>(null);
  const [, setHotlink] = useState<HotlinkProtectionSettingResponse | null>(null);

  const [email, setEmail] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [apiKey, setApiKey] = useState('');

  const [enabled, setEnabled] = useState(false);
  const [autoOnMutation, setAutoOnMutation] = useState(true);
  const [autoClearRedisOnMutation, setAutoClearRedisOnMutation] = useState(true);
  const [intervalMin, setIntervalMin] = useState<number>(0);
  const [purgeEverythingDefault, setPurgeEverythingDefault] = useState(false);

  const [purgeEverythingNow, setPurgeEverythingNow] = useState(false);
  const [clearRedis, setClearRedis] = useState(true);
  const [clearRedisOnly, setClearRedisOnly] = useState(false);

  const [hotlinkEnabled, setHotlinkEnabled] = useState(false);
  const [hotlinkAllowedHosts, setHotlinkAllowedHosts] = useState('');
  const [hotlinkAllowEmpty, setHotlinkAllowEmpty] = useState(true);
  const [hotlinkAllowSameHost, setHotlinkAllowSameHost] = useState(true);
  const [customUrls, setCustomUrls] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const s = await CacheService.getSettings();
      const h = await HotlinkService.getSettings();
      setSettings(s);
      setHotlink(h);
      setEmail(s.email || '');
      setZoneId(s.zone_id || '');
      setEnabled(!!s.enabled);
      setAutoOnMutation(!!s.auto_purge_on_mutation);
      setAutoClearRedisOnMutation(!!s.auto_clear_redis_on_mutation);
      setIntervalMin(Number(s.auto_purge_interval_minutes || 0));
      setPurgeEverythingDefault(!!s.purge_everything);

      setHotlinkEnabled(!!h.enabled);
      setHotlinkAllowedHosts(h.allowed_hosts || '');
      setHotlinkAllowEmpty(!!h.allow_empty_referer);
      setHotlinkAllowSameHost(!!h.allow_same_host);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg || t('cache.loadFailed', 'Failed to load cache settings'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMutation = useMutation({
    mutationFn: () =>
      CacheService.updateSettings({
        email,
        zone_id: zoneId,
        enabled,
        auto_purge_on_mutation: autoOnMutation,
        auto_clear_redis_on_mutation: autoClearRedisOnMutation,
        auto_purge_interval_minutes: intervalMin,
        purge_everything: purgeEverythingDefault,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      }),
    onSuccess: (s) => {
      toast.success(t('cache.saved', 'Saved'));
      setSettings(s);
      setApiKey('');
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg || t('cache.saveFailed', 'Failed to save'));
    },
  });

  const hotlinkSaveMutation = useMutation({
    mutationFn: () =>
      HotlinkService.updateSettings({
        enabled: hotlinkEnabled,
        allowed_hosts: hotlinkAllowedHosts,
        allow_empty_referer: hotlinkAllowEmpty,
        allow_same_host: hotlinkAllowSameHost,
      }),
    onSuccess: (h) => {
      toast.success(t('hotlink.saved', 'Saved'));
      setHotlink(h);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg || t('hotlink.saveFailed', 'Failed to save'));
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      // Prevent "Cloudflare is disabled" confusion when user toggles UI but hasn't saved.
      // Backend allows test even if feature is disabled, but we still require Save first
      // so the user doesn't test with unsaved form values.
      if (!settings) {
        throw new Error(t('cache.saveBeforeTest', 'Please save settings before testing.'));
      }
      return CacheService.test();
    },
    onSuccess: () => toast.success(t('cache.testOk', 'Cloudflare credentials OK')),
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg || t('cache.testFailed', 'Test failed'));
    },
  });

  const purgeMutation = useMutation({
    mutationFn: () =>
      CacheService.purgeNow({
        purge_everything: clearRedisOnly ? false : purgeEverythingNow,
        clear_redis: clearRedis || clearRedisOnly,
        urls: clearRedisOnly ? [] : splitUrls(customUrls),
      }),
    onSuccess: () => {
      toast.success(t('cache.purged', 'Purge requested'));
      load();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg || t('cache.purgeFailed', 'Purge failed'));
    },
  });

  const busy =
    saveMutation.isPending ||
    hotlinkSaveMutation.isPending ||
    testMutation.isPending ||
    purgeMutation.isPending ||
    loading;

  const hasApiKey = !!settings?.has_api_key;
  const lastPurgeAt = settings?.last_purge_at ? String(settings.last_purge_at) : '';

  const statusPill = useMemo(() => {
    if (!settings) return null;
    if (!enabled) return { text: t('cache.statusDisabled', 'Disabled'), cls: 'bg-gray-100 text-gray-700' };
    if (!hasApiKey || !zoneId || !email) return { text: t('cache.statusIncomplete', 'Incomplete'), cls: 'bg-amber-100 text-amber-800' };
    return { text: t('cache.statusReady', 'Ready'), cls: 'bg-green-100 text-green-800' };
  }, [settings, enabled, hasApiKey, zoneId, email, t]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('cache.title', 'Cache & CDN')}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {t('cache.subtitle', 'Configure Cloudflare purge (Email + Global API Key + Zone ID) and refresh cache manually or automatically.')}
            </p>
          </div>
          {statusPill && (
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${statusPill.cls}`}>{statusPill.text}</div>
          )}
        </div>

        {/* Settings */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t('cache.settings', 'Cloudflare Settings')}</h2>
            <button
              disabled={busy}
              onClick={() => load()}
              className="text-sm text-blue-600 hover:text-blue-500 disabled:opacity-60"
            >
              {t('cache.reload', 'Reload')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <div className="text-sm font-medium text-gray-700">{t('cache.email', 'Email')}</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <div className="text-sm font-medium text-gray-700">{t('cache.zone', 'Zone ID')}</div>
              <input
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </label>

            <label className="block md:col-span-2">
              <div className="text-sm font-medium text-gray-700">
                {t('cache.apiKey', 'Global API Key')}{' '}
                <span className="text-xs text-gray-500">({hasApiKey ? t('cache.apiKeySet', 'already set') : t('cache.apiKeyNotSet', 'not set')})</span>
              </div>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t('cache.apiKeyHint', 'Leave blank to keep existing key')}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                type="password"
                autoComplete="new-password"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              {t('cache.enabled', 'Enable Cloudflare purge')}
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={autoOnMutation} onChange={(e) => setAutoOnMutation(e.target.checked)} />
              {t('cache.autoOnMutation', 'Auto purge on admin changes')}
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={autoClearRedisOnMutation}
                onChange={(e) => setAutoClearRedisOnMutation(e.target.checked)}
              />
              {t('cache.autoClearRedisOnMutation', 'Auto clear Redis on admin changes')}
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={purgeEverythingDefault}
                onChange={(e) => setPurgeEverythingDefault(e.target.checked)}
              />
              {t('cache.purgeEverythingDefault', 'Default: purge everything')}
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <div className="text-sm font-medium text-gray-700">{t('cache.interval', 'Auto purge interval (minutes)')}</div>
              <input
                value={String(intervalMin)}
                onChange={(e) => setIntervalMin(Number(e.target.value || 0))}
                type="number"
                min={0}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
              <div className="mt-1 text-xs text-gray-500">{t('cache.intervalHint', '0 = disabled. Scheduler checks every minute.')}</div>
            </label>

            <div className="text-sm text-gray-700">
              <div className="font-medium">{t('cache.lastPurge', 'Last purge')}</div>
              <div className="mt-1 text-gray-500">{lastPurgeAt || t('cache.never', 'Never')}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={() => saveMutation.mutate()}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
            >
              {t('common.save', 'Save')}
            </button>

            <button
              disabled={busy || !enabled}
              onClick={() => testMutation.mutate()}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-gray-900 bg-gray-100 hover:bg-gray-200 disabled:opacity-60"
            >
              {t('cache.test', 'Test Cloudflare')}
            </button>
          </div>

          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
            {t('cache.siteUrlHint', 'Tip: set backend env SITE_URL so targeted URL purges match your real domain.')}
          </div>
        </div>

        {/* Hotlink protection */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('hotlink.title', 'Hotlink Protection')}</h2>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={hotlinkEnabled} onChange={(e) => setHotlinkEnabled(e.target.checked)} />
            {t('hotlink.enabled', 'Enable hotlink protection for /uploads')}
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={hotlinkAllowSameHost} onChange={(e) => setHotlinkAllowSameHost(e.target.checked)} />
              {t('hotlink.allowSameHost', 'Allow same host')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={hotlinkAllowEmpty} onChange={(e) => setHotlinkAllowEmpty(e.target.checked)} />
              {t('hotlink.allowEmpty', 'Allow empty Referer/Origin')}
            </label>
          </div>

          <label className="block">
            <div className="text-sm font-medium text-gray-700">{t('hotlink.allowedHosts', 'Allowed hosts (comma-separated)')}</div>
            <textarea
              value={hotlinkAllowedHosts}
              onChange={(e) => setHotlinkAllowedHosts(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[96px]"
              placeholder="www.vibocnc.com,vibocnc.com"
              disabled={!hotlinkEnabled}
            />
            <div className="mt-1 text-xs text-gray-500">{t('hotlink.hint', 'Tip: include your main domain and any CDN/custom domains that should embed images.')}</div>
          </label>

          <button
            disabled={busy}
            onClick={() => hotlinkSaveMutation.mutate()}
            className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
          >
            {t('common.save', 'Save')}
          </button>
        </div>

        {/* Manual purge */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('cache.manual', 'Manual Refresh')}</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={clearRedisOnly}
                onChange={(e) => {
                  const v = e.target.checked;
                  setClearRedisOnly(v);
                  if (v) {
                    setClearRedis(true);
                    setPurgeEverythingNow(false);
                    setCustomUrls('');
                  }
                }}
              />
              {t('cache.clearRedisOnly', 'Only clear Redis (no Cloudflare)')}
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={clearRedis}
                onChange={(e) => {
                  const v = e.target.checked;
                  setClearRedis(v);
                  if (!v) setClearRedisOnly(false);
                }}
              />
              {t('cache.clearRedis', 'Clear Redis (origin) cache')}
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={purgeEverythingNow}
                onChange={(e) => {
                  const v = e.target.checked;
                  setPurgeEverythingNow(v);
                  if (v) setClearRedisOnly(false);
                }}
                disabled={clearRedisOnly}
              />
              {t('cache.purgeEverythingNow', 'Purge everything (edge)')}
            </label>
          </div>

          <label className="block">
            <div className="text-sm font-medium text-gray-700">{t('cache.customUrls', 'Custom URLs to purge (one per line)')}</div>
            <textarea
              value={customUrls}
              onChange={(e) => setCustomUrls(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[120px]"
              placeholder={`https://www.example.com/\nhttps://www.example.com/products`}
            />
            <div className="mt-1 text-xs text-gray-500">
              {t('cache.customUrlsHint', 'Leave empty to purge a safe default set: /, /products.')}
            </div>
          </label>

          <button
            disabled={busy}
            onClick={() => purgeMutation.mutate()}
            className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
          >
            {t('cache.purgeNow', 'Purge Now')}
          </button>
        </div>
      </div>
    </AdminLayout>
  );
}
