'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import AdminLayout from '@/components/admin/AdminLayout';
import TurnstileWidget, { type TurnstileWidgetHandle } from '@/components/common/TurnstileWidget';
import { useAdminI18n } from '@/lib/admin-i18n';
import { TurnstileService, type UpdateTurnstileSettingRequest } from '@/services/turnstile.service';

export default function AdminTurnstilePage() {
  const { locale } = useAdminI18n();
  const L = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['turnstile', 'settings'],
    queryFn: () => TurnstileService.getSettings(),
  });

  const [enabled, setEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [testToken, setTestToken] = useState('');
  const widgetRef = useRef<TurnstileWidgetHandle>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setSiteKey(data.site_key || '');
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: UpdateTurnstileSettingRequest) => TurnstileService.updateSettings(payload),
    onSuccess: async () => {
      toast.success(L('已保存', 'Saved'));
      setSecretKey('');
      await qc.invalidateQueries({ queryKey: ['turnstile'] });
    },
  });

  const test = useMutation({
    mutationFn: () => TurnstileService.test(testToken),
    onSuccess: (msg) => toast.success(msg || L('验证通过', 'Verification passed')),
    onSettled: () => widgetRef.current?.reset(),
  });

  const submit = () => {
    const payload: UpdateTurnstileSettingRequest = { enabled, site_key: siteKey.trim() };
    if (secretKey.trim()) payload.secret_key = secretKey.trim();
    save.mutate(payload);
  };

  const savedSiteKey = data?.site_key || '';

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{L('人机验证（Cloudflare Turnstile）', 'Human Verification (Cloudflare Turnstile)')}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {L(
              '启用后，客户在商品页提交评价时需要通过 Cloudflare Turnstile 人机验证。填写密钥后即可使用，无需修改 .env。',
              'When enabled, customers must pass a Cloudflare Turnstile check before submitting a product review. No .env change is required.',
            )}
          </p>
        </div>

        {isLoading ? (
          <div className="rounded-lg bg-white p-6 shadow">{L('加载中...', 'Loading...')}</div>
        ) : isError || !data ? (
          <div className="rounded-lg bg-white p-6 shadow">
            <p className="text-sm text-red-600">{L('加载失败', 'Failed to load')}</p>
            <button type="button" onClick={() => refetch()} className="mt-3 rounded-md border border-gray-200 px-3 py-2 text-sm">{L('重试', 'Retry')}</button>
          </div>
        ) : (
          <>
            <div className="space-y-5 rounded-lg bg-white p-6 shadow">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{L('启用人机验证', 'Enable verification')}</div>
                  <div className="text-xs text-gray-500">
                    {data.active
                      ? <span className="text-green-700">{L('当前状态：已生效', 'Status: active')}</span>
                      : <span>{L('当前状态：未生效（需启用并填写两个密钥）', 'Status: inactive (enable and set both keys)')}</span>}
                  </div>
                </div>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500" />
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Site Key</span>
                <input
                  value={siteKey}
                  onChange={(e) => setSiteKey(e.target.value)}
                  placeholder="0x4AAAAAAA..."
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Secret Key</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={data.has_secret_key ? L('已配置，输入新值可替换', 'Configured — enter a new value to replace') : L('输入 Secret Key', 'Enter Secret Key')}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                />
                <span className="mt-1 block text-xs text-gray-500">
                  {L('Secret Key 在服务器端加密保存，不会回传到浏览器。', 'The secret key is encrypted on the server and never returned to the browser.')}
                </span>
              </label>

              <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-gray-700">
                <div className="mb-1 font-semibold text-gray-900">{L('获取密钥', 'Getting keys')}</div>
                {L(
                  '登录 Cloudflare 控制台 → Turnstile → 添加站点（Add widget），域名填写你的网站域名（本地测试可添加 localhost），模式选择 Managed，创建后复制 Site Key 和 Secret Key 填到这里。',
                  'In the Cloudflare dashboard open Turnstile → Add widget, add your site domain (add localhost for local testing), choose Managed mode, then copy the Site Key and Secret Key here.',
                )}
              </div>

              <div className="flex justify-end gap-2">
                {data.has_secret_key && (
                  <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() => {
                      if (window.confirm(L('确定清除 Secret Key 并关闭验证？', 'Clear the secret key and disable verification?'))) {
                        save.mutate({ enabled: false, clear_secret: true });
                      }
                    }}
                    className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    {L('清除密钥', 'Clear secret')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={submit}
                  className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-600 disabled:opacity-60"
                >
                  {save.isPending ? L('保存中...', 'Saving...') : L('保存', 'Save')}
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-lg bg-white p-6 shadow">
              <div className="text-sm font-semibold text-gray-900">{L('测试密钥', 'Test the keys')}</div>
              {savedSiteKey && data.has_secret_key ? (
                <>
                  <p className="text-xs text-gray-500">
                    {L('完成下方验证后点击“测试”，服务器会用已保存的 Secret Key 校验。可在启用前先测试。', 'Complete the widget, then click Test. The server verifies it with the saved secret. You can test before enabling.')}
                  </p>
                  <TurnstileWidget ref={widgetRef} siteKey={savedSiteKey} language={locale} onToken={setTestToken} onError={(m) => toast.error(m)} />
                  <button
                    type="button"
                    disabled={!testToken || test.isPending}
                    onClick={() => test.mutate()}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {test.isPending ? L('测试中...', 'Testing...') : L('测试', 'Test')}
                  </button>
                </>
              ) : (
                <p className="text-xs text-gray-500">{L('请先保存 Site Key 和 Secret Key。', 'Save the Site Key and Secret Key first.')}</p>
              )}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
