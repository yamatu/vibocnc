'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/admin/AdminLayout';
import { EmailService } from '@/services';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { buildEmailHtml, defaultModule, type EmailModule, type EmailModuleType } from '@/lib/email-templates';
import { useAdminI18n } from '@/lib/admin-i18n';
import { useAuth } from '@/hooks/useAuth';

type Tab = 'mailbox' | 'settings' | 'send' | 'marketing' | 'webhooks';

export default function AdminEmailPage() {
  const { locale, t } = useAdminI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('mailbox');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => EmailService.getSettings(),
    enabled: isAdmin,
  });

  const [form, setForm] = useState<any>({
    enabled: false,
    provider: 'smtp',
    from_name: 'VIBO CNC',
    from_email: '',
    reply_to: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    smtp_tls_mode: 'starttls',
    resend_api_key: '',
    resend_webhook_secret: '',
    alimail_endpoint: 'https://alimail-cn.aliyuncs.com',
    alimail_client_id: '',
    alimail_client_secret: '',
    alimail_account_email: '',
    verification_enabled: false,
    marketing_enabled: false,
    shipping_notifications_enabled: true,
    order_notifications_enabled: false,
    order_created_notifications_enabled: false,
    order_paid_notifications_enabled: false,
    order_notification_emails: '',
    contact_notifications_enabled: true,
    contact_notification_emails: '',
    code_expiry_minutes: 10,
    code_resend_seconds: 60,
    has_smtp_password: false,
    has_resend_api_key: false,
    has_alimail_client_secret: false,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      ...data,
      smtp_password: '', // never hydrate password
    });
  }, [data]);

  useEffect(() => {
    if (!isAdmin && (tab === 'settings' || tab === 'marketing' || tab === 'webhooks')) {
      setTab('mailbox');
    }
  }, [isAdmin, tab]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        enabled: Boolean(form.enabled),
        provider: form.provider || 'smtp',
        from_name: String(form.from_name || ''),
        from_email: String(form.from_email || ''),
        reply_to: String(form.reply_to || ''),
        smtp_host: String(form.smtp_host || ''),
        smtp_port: Number(form.smtp_port || 587),
        smtp_username: String(form.smtp_username || ''),
        smtp_tls_mode: String(form.smtp_tls_mode || 'starttls'),
        alimail_endpoint: String(form.alimail_endpoint || 'https://alimail-cn.aliyuncs.com'),
        alimail_client_id: String(form.alimail_client_id || ''),
        alimail_account_email: String(form.alimail_account_email || ''),
        verification_enabled: Boolean(form.verification_enabled),
        marketing_enabled: Boolean(form.marketing_enabled),
        code_expiry_minutes: Number(form.code_expiry_minutes || 10),
        code_resend_seconds: Number(form.code_resend_seconds || 60),
        shipping_notifications_enabled: Boolean(form.shipping_notifications_enabled),
        // Legacy field for backward compatibility.
        order_notifications_enabled: Boolean(form.order_created_notifications_enabled || form.order_paid_notifications_enabled),
        order_created_notifications_enabled: Boolean(form.order_created_notifications_enabled),
        order_paid_notifications_enabled: Boolean(form.order_paid_notifications_enabled),
        order_notification_emails: String(form.order_notification_emails || ''),
        contact_notifications_enabled: Boolean(form.contact_notifications_enabled),
        contact_notification_emails: String(form.contact_notification_emails || ''),
      };
      // only send password if user typed something
      if (String(form.smtp_password || '').trim() !== '') {
        payload.smtp_password = String(form.smtp_password);
      }

      // only send Resend credentials if user typed something
      if (String(form.resend_api_key || '').trim() !== '') {
        payload.resend_api_key = String(form.resend_api_key);
      }
      if (String(form.resend_webhook_secret || '').trim() !== '') {
        payload.resend_webhook_secret = String(form.resend_webhook_secret);
      }
      if (String(form.alimail_client_secret || '').trim() !== '') {
        payload.alimail_client_secret = String(form.alimail_client_secret);
      }
      return EmailService.updateSettings(payload);
    },
    onSuccess: async () => {
      toast.success(t('common.saved', locale === 'zh' ? '保存成功' : 'Saved'));
      await qc.invalidateQueries({ queryKey: ['email'] });
      await qc.invalidateQueries({ queryKey: ['public', 'email'] });
      refetch();
      setForm((p: any) => ({ ...p, smtp_password: '', resend_api_key: '', resend_webhook_secret: '', alimail_client_secret: '' }));
    },
    onError: (e: any) => toast.error(e?.message || t('common.saveFailed', locale === 'zh' ? '保存失败' : 'Failed to save')),
  });

  const [testTo, setTestTo] = useState('');
  const testMutation = useMutation({
    mutationFn: async () => EmailService.sendTest(testTo),
    onSuccess: () => toast.success(t('email.test.sent', locale === 'zh' ? '测试邮件已发送' : 'Test email sent')),
    onError: (e: any) => toast.error(e?.message || t('email.test.failed', locale === 'zh' ? '发送测试邮件失败' : 'Failed to send test')),
  });

  const [modules, setModules] = useState<EmailModule[]>(() => {
    const mk1 = { ...defaultModule('new_arrivals'), id: 'm1' } as EmailModule;
    const mk2 = { ...defaultModule('promotion'), id: 'm2' } as EmailModule;
    return [mk1, mk2];
  });

  const [mk, setMk] = useState({ subject: '', html: '', text: '', test_to: '', limit: 0 });
  const [single, setSingle] = useState({ to: '', subject: '', html: '', text: '' });

  useEffect(() => {
    const subject = mk.subject || 'VIBO CNC Updates';
    const built = buildEmailHtml(subject, modules);
    setMk((p) => ({ ...p, html: built.html, text: built.text }));
    setSingle((p) => ({ ...p, html: built.html, text: built.text }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const subject = mk.subject || 'VIBO CNC Updates';
    const built = buildEmailHtml(subject, modules);
    setMk((p) => ({ ...p, html: built.html, text: p.text ? p.text : built.text }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules, mk.subject]);

  const singleSendMutation = useMutation({
    mutationFn: async () => EmailService.send(single),
    onSuccess: () => toast.success(t('email.send.sent', locale === 'zh' ? '邮件已发送' : 'Email sent')),
    onError: (e: any) => toast.error(e?.message || t('email.send.failed', locale === 'zh' ? '发送失败' : 'Failed to send')),
  });

  const webhooksQuery = useQuery({
    queryKey: ['email', 'resend', 'webhooks'],
    queryFn: () => EmailService.resendWebhooksList(),
    enabled: Boolean(isAdmin && (form.provider || 'smtp') === 'resend'),
  });

  const [whCreate, setWhCreate] = useState({ endpoint: '', events: 'email.sent,email.delivered' });
  const createWebhookMutation = useMutation({
    mutationFn: async () => EmailService.resendWebhooksCreate({
      endpoint: whCreate.endpoint,
      events: whCreate.events.split(',').map((s) => s.trim()).filter(Boolean),
    }),
    onSuccess: async () => {
      toast.success(t('email.webhook.created', locale === 'zh' ? 'Webhook 已创建' : 'Webhook created'));
      await webhooksQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || t('email.webhook.createFailed', locale === 'zh' ? '创建 Webhook 失败' : 'Failed to create webhook')),
  });

  const canSendMarketing = useMemo(() => Boolean(form.enabled && form.marketing_enabled), [form.enabled, form.marketing_enabled]);

  const broadcastMutation = useMutation({
    mutationFn: async () => EmailService.broadcast({
      subject: mk.subject,
      html: mk.html,
      text: mk.text || undefined,
      test_to: mk.test_to || undefined,
      limit: mk.limit || undefined,
    }),
    onSuccess: (res) => {
      if (mk.test_to) {
        toast.success(t('email.marketing.testSent', locale === 'zh' ? '营销测试邮件已发送' : 'Test marketing email sent'));
      } else {
        toast.success(
          t(
            'email.marketing.broadcastDone',
            locale === 'zh' ? '群发完成：成功 {sent}，失败 {failed}' : 'Broadcast finished: sent {sent}, failed {failed}',
            { sent: res.sent || 0, failed: res.failed || 0 }
          )
        );
      }
    },
    onError: (e: any) => toast.error(e?.message || t('email.send.failed', locale === 'zh' ? '发送失败' : 'Failed to send')),
  });

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('nav.email', locale === 'zh' ? '邮件' : 'Email')}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {t(
              'email.subtitle',
              locale === 'zh'
                ? '员工可在这里使用邮局收发邮件；管理员可配置 SMTP / Resend / 阿里邮箱 API、订单通知、验证码与营销邮件。'
                : 'Staff can use the mailbox here. Admins can configure SMTP / Resend / AliMail API, order notifications, verification codes, and marketing emails.'
            )}
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setTab('mailbox')}
            className={`px-3 py-2 text-sm rounded-md ${tab === 'mailbox' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            {t('email.tab.mailbox', locale === 'zh' ? '邮局' : 'Mailbox')}
          </button>
          {isAdmin ? (
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`px-3 py-2 text-sm rounded-md ${tab === 'settings' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            {t('email.tab.settings', locale === 'zh' ? '设置' : 'Settings')}
          </button>
          ) : null}
          <button
            type="button"
            onClick={() => setTab('send')}
            className={`px-3 py-2 text-sm rounded-md ${tab === 'send' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            {t('email.tab.send', locale === 'zh' ? '发送' : 'Send')}
          </button>
          {isAdmin ? (
          <button
            type="button"
            onClick={() => setTab('marketing')}
            className={`px-3 py-2 text-sm rounded-md ${tab === 'marketing' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            {t('email.tab.marketing', locale === 'zh' ? '营销' : 'Marketing')}
          </button>
          ) : null}
          {isAdmin ? (
          <button
            type="button"
            onClick={() => setTab('webhooks')}
            className={`px-3 py-2 text-sm rounded-md ${tab === 'webhooks' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            {t('email.tab.webhooks', locale === 'zh' ? 'Webhooks' : 'Webhooks')}
          </button>
          ) : null}
        </div>

        {tab === 'mailbox' ? (
          <MailboxPanel />
        ) : isAdmin && isLoading ? (
          <div className="bg-white rounded-lg shadow p-6">{t('common.loading', locale === 'zh' ? '加载中...' : 'Loading...')}</div>
        ) : tab === 'settings' ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">{t('email.settings.enable', locale === 'zh' ? '启用邮件' : 'Enable Email')}</div>
                <div className="text-xs text-gray-500">
                  {t(
                    'email.settings.enableHint',
                    locale === 'zh' ? '控制全部外发邮件（订单通知 / 验证码 / 营销邮件）' : 'Controls all outbound email (order notifications + verification + marketing)'
                  )}
                </div>
              </div>
              <input
                type="checkbox"
                checked={Boolean(form.enabled)}
                onChange={(e) => setForm((p: any) => ({ ...p, enabled: e.target.checked }))}
                className="h-4 w-4"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.fromName', locale === 'zh' ? '发件人名称' : 'From Name')}</label>
                <input
                  value={form.from_name || ''}
                  onChange={(e) => setForm((p: any) => ({ ...p, from_name: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.fromEmail', locale === 'zh' ? '发件邮箱' : 'From Email')}</label>
                <input
                  value={form.from_email || ''}
                  onChange={(e) => setForm((p: any) => ({ ...p, from_email: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  placeholder="sales@vibocnc.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.replyTo', locale === 'zh' ? '回复邮箱' : 'Reply-To')}</label>
                <input
                  value={form.reply_to || ''}
                  onChange={(e) => setForm((p: any) => ({ ...p, reply_to: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  placeholder="sales@vibocnc.com"
                />
              </div>
            </div>

            <div className="border-t pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.provider', locale === 'zh' ? '服务商' : 'Provider')}</label>
                  <select
                    value={form.provider || 'smtp'}
                    onChange={(e) => setForm((p: any) => ({ ...p, provider: e.target.value }))}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  >
                    <option value="smtp">{t('email.settings.provider.smtp', locale === 'zh' ? 'SMTP（Poste.io / AliMail）' : 'SMTP (Poste.io / AliMail)')}</option>
                    <option value="resend">{t('email.settings.provider.resend', locale === 'zh' ? 'Resend API' : 'Resend API')}</option>
                    <option value="alimail">{t('email.settings.provider.alimail', locale === 'zh' ? '阿里邮箱 API 开放平台' : 'AliMail API Open Platform')}</option>
                  </select>
                </div>
              </div>

              <div className="text-sm font-semibold text-gray-900 mb-3">
                {String(form.provider || 'smtp') === 'resend'
                  ? t('email.settings.resend.title', locale === 'zh' ? 'Resend API' : 'Resend API')
                  : String(form.provider || 'smtp') === 'alimail'
                    ? t('email.settings.alimail.title', locale === 'zh' ? '阿里邮箱 API 开放平台' : 'AliMail API Open Platform')
                    : t('email.settings.smtp.title', locale === 'zh' ? 'SMTP（Poste.io / AliMail / 自定义）' : 'SMTP (Poste.io / AliMail / Custom)')}
              </div>
              {String(form.provider || 'smtp') === 'resend' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.resend.apiKey', locale === 'zh' ? 'Resend API Key' : 'Resend API Key')}</label>
                    <input
                      type="password"
                      value={form.resend_api_key || ''}
                      onChange={(e) => setForm((p: any) => ({ ...p, resend_api_key: e.target.value }))}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2"
                      placeholder={
                        form.has_resend_api_key
                          ? t('common.savedKeepBlank', locale === 'zh' ? '已保存（留空则不修改）' : 'Saved (leave blank to keep)')
                          : 're_xxxxxxxxx'
                      }
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t(
                        'email.settings.encryptionHint',
                        locale === 'zh' ? '如设置 SETTINGS_ENCRYPTION_KEY，则会加密存储。' : 'Stored encrypted if SETTINGS_ENCRYPTION_KEY is set.'
                      )}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('email.settings.resend.webhookSecret', locale === 'zh' ? 'Webhook Secret（可选）' : 'Webhook Secret (optional)')}
                    </label>
                    <input
                      type="password"
                      value={form.resend_webhook_secret || ''}
                      onChange={(e) => setForm((p: any) => ({ ...p, resend_webhook_secret: e.target.value }))}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2"
                      placeholder={t('common.optional', locale === 'zh' ? '（可选）' : '(optional)')}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t('email.settings.resend.webhookHint', locale === 'zh' ? '用于校验回调事件（预留）。' : 'Used to verify inbound events (future).')}
                    </p>
                  </div>
                </div>
              ) : String(form.provider || 'smtp') === 'alimail' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('email.settings.alimail.endpoint', locale === 'zh' ? '调用域名' : 'Endpoint')}
                    </label>
                    <select
                      value={form.alimail_endpoint || 'https://alimail-cn.aliyuncs.com'}
                      onChange={(e) => setForm((p: any) => ({ ...p, alimail_endpoint: e.target.value }))}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2"
                    >
                      <option value="https://alimail-cn.aliyuncs.com">alimail-cn.aliyuncs.com</option>
                      <option value="https://mail-open.xc.aliyun.com">mail-open.xc.aliyun.com</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      {t(
                        'email.settings.alimail.endpointHint',
                        locale === 'zh'
                          ? '标准版使用 alimail-cn.aliyuncs.com；国产化版本使用 mail-open.xc.aliyun.com。'
                          : 'Use alimail-cn.aliyuncs.com for the standard service, or mail-open.xc.aliyun.com for the domestic edition.'
                      )}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('email.settings.alimail.account', locale === 'zh' ? '邮箱账号' : 'Mailbox Account')}
                    </label>
                    <input
                      value={form.alimail_account_email || ''}
                      onChange={(e) => setForm((p: any) => ({ ...p, alimail_account_email: e.target.value }))}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2"
                      placeholder={form.from_email || 'sales@vibocnc.com'}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t(
                        'email.settings.alimail.accountHint',
                        locale === 'zh' ? '用于调用 /v2/users/{邮箱}/messages；留空默认使用发件邮箱。' : 'Used for /v2/users/{email}/messages; leave blank to use From Email.'
                      )}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('email.settings.alimail.appId', locale === 'zh' ? '应用 ID / AppID' : 'Application ID / AppID')}
                    </label>
                    <input
                      value={form.alimail_client_id || ''}
                      onChange={(e) => setForm((p: any) => ({ ...p, alimail_client_id: e.target.value }))}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2"
                      placeholder="AppID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('email.settings.alimail.secret', locale === 'zh' ? 'Secret' : 'Secret')}
                    </label>
                    <input
                      type="password"
                      value={form.alimail_client_secret || ''}
                      onChange={(e) => setForm((p: any) => ({ ...p, alimail_client_secret: e.target.value }))}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2"
                      placeholder={
                        form.has_alimail_client_secret
                          ? t('common.savedKeepBlank', locale === 'zh' ? '已保存（留空则不修改）' : 'Saved (leave blank to keep)')
                          : 'Secret'
                      }
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t(
                        'email.settings.encryptionHint',
                        locale === 'zh' ? '如设置 SETTINGS_ENCRYPTION_KEY，则会加密存储。' : 'Stored encrypted if SETTINGS_ENCRYPTION_KEY is set.'
                      )}
                    </p>
                  </div>
                  <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    {t(
                      'email.settings.alimail.hint',
                      locale === 'zh'
                        ? '请在阿里邮箱 API 开放平台给应用开启 Mail.Send.All 权限。若开启了 IP 限制，请把当前后端服务器出口 IP 加入白名单。'
                        : 'Enable Mail.Send.All for this app in AliMail API Open Platform. If IP restriction is enabled, add the backend server egress IP to the allowlist.'
                    )}
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.smtp.host', locale === 'zh' ? 'SMTP 主机' : 'SMTP Host')}</label>
                  <input
                    value={form.smtp_host || ''}
                    onChange={(e) => setForm((p: any) => ({ ...p, smtp_host: e.target.value }))}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2"
                    placeholder="mail.vibocnc.com"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {t(
                      'email.settings.smtp.hostHint',
                      locale === 'zh'
                        ? '建议仅填写域名（推荐），也可填写域名+端口（例如 mail.vibocnc.com:8443）。如果粘贴 URL，服务端会自动清洗。'
                        : 'You can use hostname only (recommended) or hostname with port (e.g. mail.vibocnc.com:8443). If you paste a URL, it will be sanitized server-side.'
                    )}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.smtp.port', locale === 'zh' ? 'SMTP 端口' : 'SMTP Port')}</label>
                  <input
                    type="number"
                    value={form.smtp_port ?? 587}
                    onChange={(e) => setForm((p: any) => ({ ...p, smtp_port: Number(e.target.value) }))}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.smtp.username', locale === 'zh' ? '用户名' : 'Username')}</label>
                  <input
                    value={form.smtp_username || ''}
                    onChange={(e) => setForm((p: any) => ({ ...p, smtp_username: e.target.value }))}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.smtp.password', locale === 'zh' ? '密码' : 'Password')}</label>
                  <input
                    type="password"
                    value={form.smtp_password || ''}
                    onChange={(e) => setForm((p: any) => ({ ...p, smtp_password: e.target.value }))}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2"
                    placeholder={
                      form.has_smtp_password
                        ? t('common.savedKeepBlank', locale === 'zh' ? '已保存（留空则不修改）' : 'Saved (leave blank to keep)')
                        : t('email.settings.smtp.passwordPh', locale === 'zh' ? '输入 SMTP 密码' : 'Enter SMTP password')
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.smtp.tls', locale === 'zh' ? 'TLS 模式' : 'TLS Mode')}</label>
                  <select
                    value={form.smtp_tls_mode || 'starttls'}
                    onChange={(e) => setForm((p: any) => ({ ...p, smtp_tls_mode: e.target.value }))}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  >
                    <option value="starttls">STARTTLS (587)</option>
                    <option value="ssl">SSL (465)</option>
                    <option value="none">{t('email.settings.smtp.tls.none', locale === 'zh' ? '不加密（25）' : 'None (25)')}</option>
                  </select>
                </div>
              </div>
              )}
            </div>

            <div className="border-t pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t('email.settings.verification', locale === 'zh' ? '邮箱验证码' : 'Email Verification')}</div>
                    <div className="text-xs text-gray-500">{t('email.settings.verificationHint', locale === 'zh' ? '注册（以及重置密码）需要验证码' : 'Require code for registration (and password reset)')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(form.verification_enabled)}
                    onChange={(e) => setForm((p: any) => ({ ...p, verification_enabled: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t('email.settings.marketing', locale === 'zh' ? '营销邮件' : 'Marketing Emails')}</div>
                    <div className="text-xs text-gray-500">{t('email.settings.marketingHint', locale === 'zh' ? '启用群发邮件' : 'Enable bulk email sending')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(form.marketing_enabled)}
                    onChange={(e) => setForm((p: any) => ({ ...p, marketing_enabled: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t('email.settings.shippingNotice', locale === 'zh' ? '发货通知' : 'Shipping Notifications')}</div>
                    <div className="text-xs text-gray-500">{t('email.settings.shippingNoticeHint', locale === 'zh' ? '填写物流单号时发送邮件' : 'Send an email when you add tracking number')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(form.shipping_notifications_enabled)}
                    onChange={(e) => setForm((p: any) => ({ ...p, shipping_notifications_enabled: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </div>

                <div>
                  <div className="text-sm font-semibold text-gray-900">{t('email.settings.orderNotice', locale === 'zh' ? '订单通知' : 'Order Notifications')}</div>
                  <div className="text-xs text-gray-500">{t('email.settings.orderNoticeHint', locale === 'zh' ? '订单创建/支付完成时发送通知' : 'Send notifications when orders are created and/or paid')}</div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t('email.settings.orderNotice.create', locale === 'zh' ? '下单通知' : 'Notify on create')}</div>
                    <div className="text-xs text-gray-500">{t('email.settings.orderNotice.createHint', locale === 'zh' ? '客户提交订单时' : 'When customer submits the order')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(form.order_created_notifications_enabled)}
                    onChange={(e) => setForm((p: any) => ({ ...p, order_created_notifications_enabled: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t('email.settings.orderNotice.paid', locale === 'zh' ? '支付通知' : 'Notify on paid')}</div>
                    <div className="text-xs text-gray-500">{t('email.settings.orderNotice.paidHint', locale === 'zh' ? '支付完成时' : 'When payment is completed')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(form.order_paid_notifications_enabled)}
                    onChange={(e) => setForm((p: any) => ({ ...p, order_paid_notifications_enabled: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.orderNotice.emails', locale === 'zh' ? '订单通知收件人' : 'Order notification emails')}</label>
                <textarea
                  value={form.order_notification_emails || ''}
                  onChange={(e) => setForm((p: any) => ({ ...p, order_notification_emails: e.target.value }))}
                  rows={3}
                  disabled={
                    !Boolean(form.order_created_notifications_enabled) &&
                    !Boolean(form.order_paid_notifications_enabled)
                  }
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                  placeholder="owner@yourdomain.com, sales@yourdomain.com"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t(
                    'email.settings.orderNotice.emailsHint',
                    locale === 'zh' ? '可用逗号/分号/换行分隔；需先开启“启用邮件”。' : 'Separate by comma / semicolon / new line. Requires Enable Email = on.'
                  )}
                </p>
              </div>

              <div className="mt-6 border-t pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t('email.settings.contactNotice', locale === 'zh' ? '联系消息通知' : 'Contact Notifications')}</div>
                    <div className="text-xs text-gray-500">
                      {t(
                        'email.settings.contactNoticeHint',
                        locale === 'zh' ? '客户提交联系表单后，自动邮件通知管理员' : 'Email admins when a customer submits the contact form'
                      )}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(form.contact_notifications_enabled)}
                    onChange={(e) => setForm((p) => ({ ...p, contact_notifications_enabled: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('email.settings.contactNotice.emails', locale === 'zh' ? '联系消息通知收件人' : 'Contact notification emails')}
                  </label>
                  <textarea
                    value={form.contact_notification_emails || ''}
                    onChange={(e) => setForm((p) => ({ ...p, contact_notification_emails: e.target.value }))}
                    rows={3}
                    disabled={!Boolean(form.contact_notifications_enabled)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                    placeholder="owner@yourdomain.com, sales@yourdomain.com"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {t(
                      'email.settings.contactNotice.emailsHint',
                      locale === 'zh'
                        ? '可用逗号/分号/换行分隔；留空时会复用订单通知收件人。'
                        : 'Separate by comma / semicolon / new line. Leave blank to reuse order notification recipients.'
                    )}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.codeExpiry', locale === 'zh' ? '验证码有效期（分钟）' : 'Code expiry (minutes)')}</label>
                  <input
                    type="number"
                    value={form.code_expiry_minutes ?? 10}
                    onChange={(e) => setForm((p: any) => ({ ...p, code_expiry_minutes: Number(e.target.value) }))}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.settings.resendWait', locale === 'zh' ? '重发等待（秒）' : 'Resend wait (seconds)')}</label>
                  <input
                    type="number"
                    value={form.code_resend_seconds ?? 60}
                    onChange={(e) => setForm((p: any) => ({ ...p, code_resend_seconds: Number(e.target.value) }))}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-6">
              <div className="flex items-center gap-2">
                <input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  className="w-72 max-w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="test@example.com"
                />
                <button
                  type="button"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !testTo}
                  className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {testMutation.isPending
                    ? t('common.sending', locale === 'zh' ? '发送中...' : 'Sending...')
                    : t('email.test.send', locale === 'zh' ? '发送测试' : 'Send test')}
                </button>
              </div>

              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {saveMutation.isPending
                  ? t('common.saving', locale === 'zh' ? '保存中...' : 'Saving...')
                  : t('common.save', locale === 'zh' ? '保存' : 'Save')}
              </button>
            </div>
          </div>
        ) : tab === 'send' ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div className="text-sm text-gray-600">
              {t('email.send.subtitle', locale === 'zh' ? '发送单封邮件（可当作后台邮件面板使用）。' : 'Send a single email (use this as your mail panel).')}
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-semibold text-gray-900 mb-3">{t('email.modules.title', locale === 'zh' ? '模块（在此编辑内容）' : 'Modules (edit text here)')}</div>
              <ModuleEditor modules={modules} setModules={setModules} />
              <div className="mt-3 text-xs text-gray-500">
                {t(
                  'email.modules.hint',
                  locale === 'zh'
                    ? '编辑模块会自动重新生成 HTML；你仍可在下方对 HTML 做最终修改。'
                    : 'Editing modules regenerates HTML automatically. You can still edit HTML below after generation.'
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.send.to', locale === 'zh' ? '收件人' : 'To')}</label>
                <input value={single.to} onChange={(e) => setSingle((p) => ({ ...p, to: e.target.value }))} className="block w-full rounded-md border border-gray-300 px-3 py-2" placeholder="customer@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.subject', locale === 'zh' ? '主题' : 'Subject')}</label>
                <input
                  value={single.subject}
                  onChange={(e) => setSingle((p) => ({ ...p, subject: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  placeholder={t('email.subjectPh', locale === 'zh' ? '邮件主题' : 'Your subject')}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">HTML</label>
              <textarea value={single.html} onChange={(e) => setSingle((p) => ({ ...p, html: e.target.value }))} rows={14} className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.textOptional', locale === 'zh' ? '纯文本（可选）' : 'Text (optional)')}</label>
              <textarea value={single.text} onChange={(e) => setSingle((p) => ({ ...p, text: e.target.value }))} rows={6} className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs" />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => singleSendMutation.mutate()}
                disabled={singleSendMutation.isPending}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
              >
                {singleSendMutation.isPending
                  ? t('common.sending', locale === 'zh' ? '发送中...' : 'Sending...')
                  : t('email.send.sendEmail', locale === 'zh' ? '发送邮件' : 'Send email')}
              </button>
            </div>

            <div className="border-t pt-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">{t('common.preview', locale === 'zh' ? '预览' : 'Preview')}</div>
              <iframe
                title="email-preview"
                sandbox=""
                style={{ width: '100%', height: 520, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}
                srcDoc={single.html}
              />
            </div>
          </div>
        ) : tab === 'marketing' ? (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div className="text-sm text-gray-600">
              {canSendMarketing ? (
                <div>
                  {t('email.marketing.placeholders', locale === 'zh' ? '支持占位符：' : 'Placeholders supported:')}{' '}
                  <span className="font-mono">{'{{full_name}}'}</span>, <span className="font-mono">{'{{email}}'}</span>
                </div>
              ) : (
                <div className="text-red-600">
                  {t('email.marketing.enableFirst', locale === 'zh' ? '请先在“设置”中开启：启用邮件 + 营销邮件。' : 'Enable Email + Marketing in Settings first.')}
                </div>
              )}
            </div>

            <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-semibold text-gray-900 mb-3">{t('email.modules.title', locale === 'zh' ? '模块（在此编辑内容）' : 'Modules (edit text here)')}</div>
              <ModuleEditor modules={modules} setModules={setModules} />
              <div className="mt-3 text-xs text-gray-500">
                {t(
                  'email.modules.hint2',
                  locale === 'zh' ? '编辑模块会自动生成 HTML；最终微调请使用下方 HTML 字段。' : 'Editing modules regenerates HTML automatically. Use the HTML field below for final tweaks.'
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.subject', locale === 'zh' ? '主题' : 'Subject')}</label>
              <input
                value={mk.subject}
                onChange={(e) => setMk((p) => ({ ...p, subject: e.target.value }))}
                className="block w-full rounded-md border border-gray-300 px-3 py-2"
                placeholder={t('email.marketing.subjectPh', locale === 'zh' ? '新品 / 促销 / 更新' : 'New arrivals / Promotion / Update')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">HTML</label>
              <textarea
                value={mk.html}
                onChange={(e) => setMk((p) => ({ ...p, html: e.target.value }))}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
                rows={12}
                placeholder="<h1>Hello {{full_name}}</h1>..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.textOptional', locale === 'zh' ? '纯文本（可选）' : 'Text (optional)')}</label>
              <textarea
                value={mk.text}
                onChange={(e) => setMk((p) => ({ ...p, text: e.target.value }))}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
                rows={6}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.marketing.testTo', locale === 'zh' ? '测试收件人（可选）' : 'Test to (optional)')}</label>
                <input
                  value={mk.test_to}
                  onChange={(e) => setMk((p) => ({ ...p, test_to: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2"
                  placeholder="test@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.marketing.limit', locale === 'zh' ? '发送上限（0 = 全部）' : 'Limit (0 = all)')}</label>
                <input
                  type="number"
                  value={mk.limit}
                  onChange={(e) => setMk((p) => ({ ...p, limit: Number(e.target.value) }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </div>
              <div className="flex items-end justify-end">
                <button
                  type="button"
                  disabled={!canSendMarketing || broadcastMutation.isPending}
                  onClick={() => broadcastMutation.mutate()}
                  className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
                >
                  {broadcastMutation.isPending
                    ? t('common.sending', locale === 'zh' ? '发送中...' : 'Sending...')
                    : mk.test_to
                      ? t('email.test.send', locale === 'zh' ? '发送测试' : 'Send test')
                      : t('email.marketing.sendBroadcast', locale === 'zh' ? '开始群发' : 'Send broadcast')}
                </button>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">{t('common.preview', locale === 'zh' ? '预览' : 'Preview')}</div>
              <iframe
                title="email-preview"
                sandbox=""
                style={{ width: '100%', height: 520, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}
                srcDoc={mk.html}
              />
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div className="text-sm text-gray-600">
              {t(
                'email.webhooks.subtitle',
                locale === 'zh' ? 'Resend Webhooks（需要服务商=Resend 且已保存 API Key）。' : 'Resend webhooks (requires Provider=Resend and API key saved).'
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.webhooks.endpoint', locale === 'zh' ? '回调地址' : 'Endpoint')}</label>
                <input value={whCreate.endpoint} onChange={(e) => setWhCreate((p) => ({ ...p, endpoint: e.target.value }))} className="block w-full rounded-md border border-gray-300 px-3 py-2" placeholder="https://yourdomain.com/api/resend/webhook" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email.webhooks.events', locale === 'zh' ? '事件（逗号分隔）' : 'Events (comma)')}</label>
                <input value={whCreate.events} onChange={(e) => setWhCreate((p) => ({ ...p, events: e.target.value }))} className="block w-full rounded-md border border-gray-300 px-3 py-2" placeholder="email.sent,email.delivered" />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => createWebhookMutation.mutate()}
                disabled={createWebhookMutation.isPending}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {createWebhookMutation.isPending
                  ? t('common.creating', locale === 'zh' ? '创建中...' : 'Creating...')
                  : t('email.webhooks.create', locale === 'zh' ? '创建 Webhook' : 'Create webhook')}
              </button>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">{t('email.webhooks.existing', locale === 'zh' ? '已有 Webhooks' : 'Existing webhooks')}</div>
                <button type="button" onClick={() => webhooksQuery.refetch()} className="text-sm text-gray-700 hover:underline">
                  {t('common.refresh', locale === 'zh' ? '刷新' : 'Refresh')}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {(webhooksQuery.data?.data || webhooksQuery.data || []).map((wh: any) => (
                  <div key={wh.id} className="rounded-md border border-gray-200 p-3 text-sm">
                    <div className="font-mono text-xs text-gray-700">{wh.id}</div>
                    <div className="mt-1 text-gray-800">{wh.endpoint}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {t('email.webhooks.eventsLabel', locale === 'zh' ? '事件：' : 'Events:')} {(wh.events || []).join(', ')}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await EmailService.resendWebhooksRemove(wh.id);
                            toast.success(t('common.deleted', locale === 'zh' ? '已删除' : 'Deleted'));
                            webhooksQuery.refetch();
                          } catch (e: any) {
                            toast.error(e?.message || t('common.failed', locale === 'zh' ? '失败' : 'Failed'));
                          }
                        }}
                        className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-gray-50"
                      >
                        {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                      </button>
                    </div>
                  </div>
                ))}
                {Array.isArray(webhooksQuery.data?.data || webhooksQuery.data) && (webhooksQuery.data?.data || webhooksQuery.data).length === 0 ? (
                  <div className="text-sm text-gray-500">{t('email.webhooks.empty', locale === 'zh' ? '暂无 Webhooks' : 'No webhooks')}</div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function MailboxPanel() {
  const { locale, t } = useAdminI18n();
  const [folderId, setFolderId] = useState('2');
  const [cursor, setCursor] = useState('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [compose, setCompose] = useState({ to: '', subject: '', html: '', text: '' });

  const configQuery = useQuery({
    queryKey: ['email', 'mailbox', 'config'],
    queryFn: () => EmailService.mailboxConfig(),
  });

  const messagesQuery = useQuery({
    queryKey: ['email', 'mailbox', 'messages', folderId, cursor],
    queryFn: () => EmailService.mailboxMessages(folderId, { cursor, size: 30 }),
    enabled: Boolean(configQuery.data?.can_read),
  });

  const selectedMessage = useQuery({
    queryKey: ['email', 'mailbox', 'message', selectedId],
    queryFn: () => EmailService.mailboxMessage(selectedId),
    enabled: Boolean(configQuery.data?.can_read && selectedId),
  });

  const attachmentsQuery = useQuery({
    queryKey: ['email', 'mailbox', 'attachments', selectedId],
    queryFn: () => EmailService.mailboxAttachments(selectedId),
    enabled: Boolean(configQuery.data?.can_read && selectedId && hasAttachments(unwrapMessage(selectedMessage.data))),
  });

  const sendMutation = useMutation({
    mutationFn: async () => EmailService.send(compose),
    onSuccess: () => {
      toast.success(t('email.send.sent', locale === 'zh' ? '邮件已发送' : 'Email sent'));
      setCompose({ to: '', subject: '', html: '', text: '' });
      messagesQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || t('email.send.failed', locale === 'zh' ? '发送失败' : 'Failed to send')),
  });

  const folders = configQuery.data?.folders?.length ? configQuery.data.folders : [
    { id: '2', key: 'inbox', name: '收件箱', label: 'Inbox' },
    { id: '1', key: 'sent', name: '发件箱', label: 'Sent' },
    { id: '5', key: 'drafts', name: '草稿箱', label: 'Drafts' },
    { id: '3', key: 'junk', name: '垃圾箱', label: 'Junk' },
    { id: '6', key: 'deleted', name: '已删除', label: 'Deleted' },
  ];
  const messages = normalizeMessages(messagesQuery.data);
  const nextCursor = String((messagesQuery.data as any)?.nextCursor || '');
  const hasMore = Boolean((messagesQuery.data as any)?.hasMore);
  const message = unwrapMessage(selectedMessage.data) || messages.find((m: any) => getMessageId(m) === selectedId);
  const attachments = normalizeAttachments(attachmentsQuery.data);

  const switchFolder = (id: string) => {
    setFolderId(id);
    setCursor('');
    setCursorStack([]);
    setSelectedId('');
  };

  const goNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, cursor]);
    setCursor(nextCursor);
    setSelectedId('');
  };

  const goPrev = () => {
    setCursorStack((prev) => {
      const copy = [...prev];
      const previous = copy.pop() || '';
      setCursor(previous);
      return copy;
    });
    setSelectedId('');
  };

  const downloadAttachment = async (attachment: any) => {
    const attachmentId = String(attachment?.id || '');
    if (!selectedId || !attachmentId) return;
    try {
      const { blob, filename } = await EmailService.downloadAttachment(selectedId, attachmentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = String(attachment?.name || filename || 'attachment');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message || (locale === 'zh' ? '附件下载失败' : 'Failed to download attachment'));
    }
  };

  if (configQuery.isLoading) {
    return <div className="bg-white rounded-lg shadow p-6">{t('common.loading', locale === 'zh' ? '加载中...' : 'Loading...')}</div>;
  }

  if (configQuery.error || !configQuery.data?.enabled || !configQuery.data?.can_read) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-sm font-semibold text-gray-900">{locale === 'zh' ? '邮局未启用' : 'Mailbox is not enabled'}</div>
        <p className="mt-2 text-sm text-gray-600">
          {locale === 'zh'
            ? '请让管理员在邮件设置里启用邮件，并选择“阿里邮箱 API 开放平台”作为服务商。读取邮件需要 Mail.Read.All 或 Mail.ReadWrite.All 权限。'
            : 'Ask an admin to enable Email and select AliMail API Open Platform as the provider. Reading messages requires Mail.Read.All or Mail.ReadWrite.All.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="border-b border-gray-200 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">{locale === 'zh' ? '企业邮局' : 'Company Mailbox'}</div>
          <div className="text-xs text-gray-500">{configQuery.data.account_email || configQuery.data.from_email}</div>
        </div>
        <button
          type="button"
          onClick={() => messagesQuery.refetch()}
          className="self-start sm:self-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          {t('common.refresh', locale === 'zh' ? '刷新' : 'Refresh')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[160px_minmax(260px,360px)_1fr] min-h-[620px]">
        <aside className="border-b lg:border-b-0 lg:border-r border-gray-200 p-3">
          <div className="space-y-1">
            {folders.map((folder: any) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => switchFolder(String(folder.id))}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${String(folder.id) === folderId ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {locale === 'zh' ? folder.name : folder.label}
              </button>
            ))}
          </div>
        </aside>

        <section className="border-b lg:border-b-0 lg:border-r border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
            <div className="text-xs text-gray-500">
              {messagesQuery.isFetching ? (locale === 'zh' ? '刷新中...' : 'Refreshing...') : `${messages.length} ${locale === 'zh' ? '封邮件' : 'messages'}`}
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={goPrev} disabled={cursorStack.length === 0} className="rounded border border-gray-200 px-2 py-1 text-xs disabled:opacity-50">
                {locale === 'zh' ? '上一页' : 'Prev'}
              </button>
              <button type="button" onClick={goNext} disabled={!hasMore || !nextCursor} className="rounded border border-gray-200 px-2 py-1 text-xs disabled:opacity-50">
                {locale === 'zh' ? '下一页' : 'Next'}
              </button>
            </div>
          </div>

          <div className="max-h-[560px] overflow-y-auto">
            {messages.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">{locale === 'zh' ? '暂无邮件' : 'No messages'}</div>
            ) : messages.map((mail: any) => {
              const id = getMessageId(mail);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedId(id)}
                  className={`block w-full border-b border-gray-100 px-3 py-3 text-left hover:bg-gray-50 ${selectedId === id ? 'bg-amber-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">{getSubject(mail)}</div>
                      <div className="mt-1 truncate text-xs text-gray-500">{getSender(mail)}</div>
                    </div>
                    {hasAttachments(mail) ? <span className="text-xs text-amber-600">ATT</span> : null}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">{formatMailTime(getMailTime(mail))}</div>
                </button>
              );
            })}
          </div>
        </section>

        <main className="min-w-0">
          <div className="border-b border-gray-200 p-4">
            {message ? (
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{getSubject(message)}</h2>
                <div className="mt-2 grid gap-1 text-xs text-gray-500">
                  <div>{locale === 'zh' ? '发件人：' : 'From: '}{getSender(message)}</div>
                  <div>{locale === 'zh' ? '时间：' : 'Time: '}{formatMailTime(getMailTime(message))}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">{locale === 'zh' ? '请选择一封邮件查看内容' : 'Select a message to read'}</div>
            )}
          </div>

          <div className="h-[340px] overflow-auto p-4">
            {selectedMessage.isFetching ? (
              <div className="text-sm text-gray-500">{t('common.loading', locale === 'zh' ? '加载中...' : 'Loading...')}</div>
            ) : message ? (
              getMessageHtml(message) ? (
                <iframe
                  title="mail-content"
                  sandbox=""
                  className="h-full w-full rounded border border-gray-200 bg-white"
                  srcDoc={getMessageHtml(message)}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm text-gray-800">{getMessageText(message)}</pre>
              )
            ) : null}
          </div>

          {attachments.length > 0 ? (
            <div className="border-t border-gray-200 p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">{locale === 'zh' ? '附件' : 'Attachments'}</div>
              <div className="flex flex-wrap gap-2">
                {attachments.map((att: any) => (
                  <button
                    key={att.id || att.name}
                    type="button"
                    onClick={() => downloadAttachment(att)}
                    className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    {att.name || att.fileName || att.id}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="border-t border-gray-200 p-4">
            <div className="mb-3 text-sm font-semibold text-gray-900">{locale === 'zh' ? '写信' : 'Compose'}</div>
            <div className="grid grid-cols-1 gap-3">
              <input value={compose.to} onChange={(e) => setCompose((p) => ({ ...p, to: e.target.value }))} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder={locale === 'zh' ? '收件人' : 'To'} />
              <input value={compose.subject} onChange={(e) => setCompose((p) => ({ ...p, subject: e.target.value }))} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder={locale === 'zh' ? '主题' : 'Subject'} />
              <textarea value={compose.text} onChange={(e) => setCompose((p) => ({ ...p, text: e.target.value, html: '' }))} rows={5} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder={locale === 'zh' ? '正文' : 'Message'} />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending || !compose.to || !compose.subject}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
                >
                  {sendMutation.isPending ? t('common.sending', locale === 'zh' ? '发送中...' : 'Sending...') : t('email.send.sendEmail', locale === 'zh' ? '发送邮件' : 'Send email')}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function normalizeMessages(data: any): any[] {
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.data?.messages)) return data.data.messages;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function normalizeAttachments(data: any): any[] {
  if (Array.isArray(data?.attachments)) return data.attachments;
  if (Array.isArray(data?.data?.attachments)) return data.data.attachments;
  return [];
}

function unwrapMessage(data: any): any {
  return data?.message || data?.data?.message || data;
}

function getMessageId(mail: any): string {
  return String(mail?.id || mail?.messageId || mail?.mailId || '');
}

function getSubject(mail: any): string {
  return String(mail?.subject || mail?.title || '(no subject)');
}

function getSender(mail: any): string {
  const sender = mail?.from || mail?.sender || mail?.senderEmail || mail?.fromEmail;
  if (typeof sender === 'string') return sender;
  if (sender?.email) return sender?.name ? `${sender.name} <${sender.email}>` : sender.email;
  return '';
}

function getMailTime(mail: any): string {
  return String(mail?.sentDateTime || mail?.receivedDateTime || mail?.createdDateTime || mail?.date || '');
}

function formatMailTime(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function hasAttachments(mail: any): boolean {
  return Boolean(mail?.hasAttachments || mail?.attachments?.length);
}

function getMessageHtml(mail: any): string {
  return String(mail?.body?.bodyHtml || mail?.bodyHtml || mail?.html || '');
}

function getMessageText(mail: any): string {
  return String(mail?.body?.bodyText || mail?.bodyText || mail?.text || mail?.summary || '');
}

function ModuleEditor({
  modules,
  setModules,
}: {
  modules: EmailModule[];
  setModules: (updater: (prev: EmailModule[]) => EmailModule[]) => void;
}) {
  const { locale, t } = useAdminI18n();

  const moduleTypeLabel = (type: EmailModuleType) => {
    const map: Record<EmailModuleType, string> = {
      new_arrivals: t('email.module.newArrivals', locale === 'zh' ? '新品推荐' : 'New arrivals'),
      promotion: t('email.module.promotion', locale === 'zh' ? '促销活动' : 'Promotion'),
      replacement: t('email.module.replacement', locale === 'zh' ? '缺货替代' : 'Out-of-stock replacement'),
      repair_quote: t('email.module.repairQuote', locale === 'zh' ? '维修报价' : 'Repair quote'),
    };
    return map[type] || String(type).replace(/_/g, ' ');
  };

  const add = (type: EmailModuleType) => {
    setModules((prev) => {
      const id = `m${Date.now()}`;
      return [...prev, { ...(defaultModule(type) as any), id }];
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => add('new_arrivals')} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
          + {t('email.module.newArrivals', locale === 'zh' ? '新品推荐' : 'New arrivals')}
        </button>
        <button type="button" onClick={() => add('promotion')} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
          + {t('email.module.promotion', locale === 'zh' ? '促销活动' : 'Promotion')}
        </button>
        <button type="button" onClick={() => add('replacement')} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
          + {t('email.module.replacement', locale === 'zh' ? '缺货替代' : 'Out-of-stock replacement')}
        </button>
        <button type="button" onClick={() => add('repair_quote')} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
          + {t('email.module.repairQuote', locale === 'zh' ? '维修报价' : 'Repair quote')}
        </button>
      </div>

      {modules.map((m) => (
        <div key={m.id} className="rounded-md border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-900">
              {moduleTypeLabel(m.type)}
            </div>
            <button
              type="button"
              onClick={() => setModules((prev) => prev.filter((x) => x.id !== m.id))}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-red-600 hover:bg-gray-50"
            >
              {t('common.remove', locale === 'zh' ? '移除' : 'Remove')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.title', locale === 'zh' ? '标题' : 'Title')}</label>
              <input
                value={m.title}
                onChange={(e) =>
                  setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, title: e.target.value } : x)))
                }
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('email.module.badge', locale === 'zh' ? '角标（可选）' : 'Badge (optional)')}</label>
              <input
                value={m.badge || ''}
                onChange={(e) =>
                  setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, badge: e.target.value } : x)))
                }
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder={t('email.module.badgePh', locale === 'zh' ? 'NEW / SALE / ALT' : 'NEW / SALE / ALT')}
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('email.module.body', locale === 'zh' ? '正文' : 'Body')}</label>
            <textarea
              value={m.body}
              onChange={(e) => setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, body: e.target.value } : x)))}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              rows={3}
            />
          </div>

          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('email.module.bullets', locale === 'zh' ? '要点（每行一个）' : 'Bullets (one per line)')}</label>
            <textarea
              value={(m.bullets || []).join('\n')}
              onChange={(e) =>
                setModules((prev) =>
                  prev.map((x) => (x.id === m.id ? { ...x, bullets: e.target.value.split('\n') } : x))
                )
              }
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('email.module.ctaLabel', locale === 'zh' ? '按钮文字' : 'CTA Label')}</label>
              <input
                value={m.ctaLabel}
                onChange={(e) =>
                  setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, ctaLabel: e.target.value } : x)))
                }
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('email.module.ctaUrl', locale === 'zh' ? '按钮链接' : 'CTA URL')}</label>
              <input
                value={m.ctaUrl}
                onChange={(e) =>
                  setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, ctaUrl: e.target.value } : x)))
                }
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('email.module.highlight', locale === 'zh' ? '高亮提示（可选）' : 'Highlight (optional)')}</label>
            <input
              value={m.highlight || ''}
              onChange={(e) =>
                setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, highlight: e.target.value } : x)))
              }
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder={t('email.module.highlightPh', locale === 'zh' ? '优惠码 / 交期 / 特别说明' : 'Coupon code / lead time / special note')}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
