'use client';

import AdminLayout from '@/components/admin/AdminLayout';
import { useAdminI18n } from '@/lib/admin-i18n';
import { PayPalService } from '@/services';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

type FormState = {
  enabled: boolean;
  mode: 'sandbox' | 'live';
  currency: string;
  webhook_id: string;
  client_id_sandbox: string;
  client_id_live: string;
  client_secret_sandbox: string;
  client_secret_live: string;
};

export default function AdminPayPalPage() {
  const { locale, t } = useAdminI18n();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['paypal', 'settings'],
    queryFn: () => PayPalService.getSettings(),
  });

  const [form, setForm] = useState<FormState>({
    enabled: false,
    mode: 'sandbox',
    currency: 'USD',
    webhook_id: '',
    client_id_sandbox: '',
    client_id_live: '',
    client_secret_sandbox: '',
    client_secret_live: '',
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: Boolean((data as any).enabled),
      mode: ((data as any).mode === 'live' ? 'live' : 'sandbox') as any,
      currency: String((data as any).currency || 'USD'),
      webhook_id: String((data as any).webhook_id || ''),
      client_id_sandbox: String((data as any).client_id_sandbox || ''),
      client_id_live: String((data as any).client_id_live || ''),
      client_secret_sandbox: '',
      client_secret_live: '',
    });
  }, [data]);

  const effectiveClientId = useMemo(() => {
    return form.mode === 'live' ? form.client_id_live.trim() : form.client_id_sandbox.trim();
  }, [form.mode, form.client_id_live, form.client_id_sandbox]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Parameters<typeof PayPalService.updateSettings>[0] = {
        enabled: form.enabled,
        mode: form.mode,
        currency: form.currency.trim() || 'USD',
        webhook_id: form.webhook_id.trim(),
        client_id_sandbox: form.client_id_sandbox.trim(),
        client_id_live: form.client_id_live.trim(),
      };
      if (form.client_secret_sandbox.trim()) payload.client_secret_sandbox = form.client_secret_sandbox.trim();
      if (form.client_secret_live.trim()) payload.client_secret_live = form.client_secret_live.trim();
      return PayPalService.updateSettings(payload);
    },
    onSuccess: async () => {
      toast.success(t('paypal.saved', locale === 'zh' ? '已保存' : 'Saved'));
      await qc.invalidateQueries({ queryKey: ['paypal'] });
      await qc.invalidateQueries({ queryKey: ['public', 'paypal'] });
      setForm((p) => ({ ...p, client_secret_sandbox: '', client_secret_live: '' }));
      refetch();
    },
    onError: (e: any) => toast.error(e?.message || t('paypal.saveFailed', locale === 'zh' ? '保存失败' : 'Failed to save')),
  });

  return (
    <AdminLayout>
      <div className="max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {t('paypal.title', locale === 'zh' ? 'PayPal 设置' : 'PayPal Settings')}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {t(
              'paypal.subtitle',
              locale === 'zh'
                ? '配置 PayPal Client ID（Sandbox/Live）。无需修改 .env。'
                : 'Configure PayPal Client ID (Sandbox/Live). No .env is required.'
            )}
          </p>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-lg shadow p-6">{t('common.loading', locale === 'zh' ? '加载中...' : 'Loading...')}</div>
        ) : isError ? (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-red-600">
              {String((error as any)?.message || (locale === 'zh' ? '加载失败' : 'Failed to load'))}
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-4 inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {t('common.retry', locale === 'zh' ? '重试' : 'Retry')}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  {t('paypal.enable', locale === 'zh' ? '启用 PayPal' : 'Enable PayPal')}
                </div>
                <div className="text-xs text-gray-500">
                  {t('paypal.enableHint', locale === 'zh' ? '在结账页显示 PayPal' : 'Show PayPal on checkout')}
                </div>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                  className="h-4 w-4 text-yellow-600 focus:ring-yellow-500 border-gray-300 rounded"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('paypal.mode', locale === 'zh' ? '模式' : 'Mode')}</label>
                <select
                  value={form.mode}
                  onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value === 'live' ? 'live' : 'sandbox' }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                >
                  <option value="sandbox">{t('paypal.mode.sandbox', locale === 'zh' ? 'Sandbox（测试）' : 'Sandbox')}</option>
                  <option value="live">{t('paypal.mode.live', locale === 'zh' ? 'Live（正式）' : 'Live')}</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {t('paypal.modeHint', locale === 'zh' ? 'Sandbox 用于测试；Live 用于真实收款' : 'Sandbox for testing, Live for real payments')}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('paypal.currency', locale === 'zh' ? '币种' : 'Currency')}</label>
                <input
                  value={form.currency}
                  onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value.toUpperCase() }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                  placeholder="USD"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('paypal.sandboxId', locale === 'zh' ? 'Sandbox Client ID' : 'Sandbox Client ID')}
                </label>
                <input
                  value={form.client_id_sandbox}
                  onChange={(e) => setForm((p) => ({ ...p, client_id_sandbox: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                  placeholder="AQ... (Sandbox Client ID)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('paypal.liveId', locale === 'zh' ? 'Live Client ID' : 'Live Client ID')}
                </label>
                <input
                  value={form.client_id_live}
                  onChange={(e) => setForm((p) => ({ ...p, client_id_live: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                  placeholder="AQ... (Live Client ID)"
                />
              </div>
              <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-800">{t('paypal.activeId', locale === 'zh' ? '当前使用的 Client ID' : 'Active Client ID')}</div>
                <div className="mt-1 font-mono break-all">{effectiveClientId || '—'}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('paypal.sandboxSecret', locale === 'zh' ? 'Sandbox Client Secret' : 'Sandbox Client Secret')}
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.client_secret_sandbox}
                  onChange={(e) => setForm((p) => ({ ...p, client_secret_sandbox: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                  placeholder={data?.has_client_secret_sandbox ? '已配置，输入新值可替换' : '输入 Sandbox Secret'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('paypal.liveSecret', locale === 'zh' ? 'Live Client Secret' : 'Live Client Secret')}
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.client_secret_live}
                  onChange={(e) => setForm((p) => ({ ...p, client_secret_live: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                  placeholder={data?.has_client_secret_live ? '已配置，输入新值可替换' : '输入 Live Secret'}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {t('paypal.secretHint', locale === 'zh' ? 'Client Secret 会在服务器端加密保存，仅用于 PayPal 支付和退款，不会回传到浏览器。' : 'Client Secrets are encrypted on the server and are never returned to the browser. They are required for PayPal refunds.')}
            </p>

            <div className="rounded-md border border-blue-200 bg-blue-50 p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">
                  {t('paypal.webhookId', locale === 'zh' ? 'Webhook ID' : 'Webhook ID')}
                </label>
                <input
                  value={form.webhook_id}
                  onChange={(e) => setForm((p) => ({ ...p, webhook_id: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                  placeholder="例如 8PT597110X687430LKGECATA"
                />
              </div>
              <p className="text-xs text-gray-600">
                {t(
                  'paypal.webhookHint',
                  locale === 'zh'
                    ? '在 PayPal 后台创建 Webhook，事件类型勾选「付款捕获已完成 (PAYMENT.CAPTURE.COMPLETED)」，然后将 Webhook ID 填到这里。支付结果会通过服务端捕获与 Webhook 双重校验。'
                    : 'Create a webhook in PayPal with the PAYMENT.CAPTURE.COMPLETED event, then paste its Webhook ID here. Payments are verified both on server-side capture and via this webhook.'
                )}
              </p>
              <div className="text-xs text-gray-600">
                <span className="font-semibold">Webhook URL:</span>{' '}
                <span className="font-mono break-all">
                  {typeof window !== 'undefined' ? `${window.location.origin.replace(/\/$/, '')}/api/v1/paypal/webhook` : '/api/v1/paypal/webhook'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {t('common.refresh', locale === 'zh' ? '刷新' : 'Refresh')}
              </button>
              <button
                type="button"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
                className="inline-flex items-center rounded-md bg-yellow-500 px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-600 disabled:opacity-60"
              >
                {saveMutation.isPending
                  ? t('common.saving', locale === 'zh' ? '保存中...' : 'Saving...')
                  : t('common.save', locale === 'zh' ? '保存' : 'Save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
