'use client';

import AdminLayout from '@/components/admin/AdminLayout';
import { useAdminI18n } from '@/lib/admin-i18n';
import { IndexNowService } from '@/services/indexnow.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

function splitLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatMutationError(error: any): string {
  const details = error?.details || error?.response?.data;
  if (details) {
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(error?.message || 'Request failed');
    }
  }
  return String(error?.message || 'Request failed');
}

function isOwnershipVerificationError(error: any): boolean {
  const text = [
    error?.message,
    error?.details?.error,
    error?.details?.message,
    typeof error?.details === 'string' ? error.details : '',
    (() => {
      try {
        return JSON.stringify(error?.details || {});
      } catch {
        return '';
      }
    })(),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes('userforbiddedtoaccesssite') ||
    text.includes('user is unauthorized to access the site') ||
    text.includes('site verification is not ready yet');
}

function buildOwnershipVerificationMessage(locale: string): string {
  if (locale === 'zh') {
    return 'Bing 还没有完成当前站点的 IndexNow 验证。key.txt 已经可访问，但 Bing 侧尚未放行提交。请先在 Bing Webmaster Tools 重新验证域名，等待生效后再提交。';
  }
  return 'Bing has not finished IndexNow ownership verification for this site yet. The key.txt file is reachable, but Bing is still rejecting submissions. Re-verify the domain in Bing Webmaster Tools and wait for it to propagate before submitting again.';
}

export default function AdminIndexNowPage() {
  const { locale, t } = useAdminI18n();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['indexnow', 'settings'],
    queryFn: () => IndexNowService.getSettings(),
  });
  const { data: productStatus, refetch: refetchProductStatus } = useQuery({
    queryKey: ['indexnow', 'product-status'],
    queryFn: () => IndexNowService.getProductStatus(),
  });

  const [enabled, setEnabled] = useState(false);
  const [key, setKey] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [autoSubmitProductUpdates, setAutoSubmitProductUpdates] = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [productIdsInput, setProductIdsInput] = useState('');
  const [batchLimit, setBatchLimit] = useState('0');
  const [lastActionMessage, setLastActionMessage] = useState('');

  useEffect(() => {
    if (!data) return;
    setEnabled(Boolean(data.enabled));
    setKey(String(data.key || ''));
    setSiteUrl(String(data.site_url || ''));
    setAutoSubmitProductUpdates(Boolean(data.auto_submit_product_updates));
  }, [data]);

  const keyFileUrl = data?.key_location || '';
  const keyPreview = useMemo(() => `${(key || '').trim()}.txt`, [key]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return IndexNowService.updateSettings({
        enabled,
        key: key.trim(),
        site_url: siteUrl.trim(),
        auto_submit_product_updates: autoSubmitProductUpdates,
      });
    },
    onSuccess: async () => {
      setLastActionMessage('');
      toast.success(t('indexnow.saved', locale === 'zh' ? '已保存' : 'Saved'));
      await qc.invalidateQueries({ queryKey: ['indexnow'] });
      refetch();
      refetchProductStatus();
    },
    onError: (e: any) => toast.error(e?.message || t('indexnow.saveFailed', locale === 'zh' ? '保存失败' : 'Failed to save')),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const urls = splitLines(urlInput);
      const productIds = splitLines(productIdsInput)
        .map((item) => Number(item))
        .filter((value) => Number.isFinite(value) && value > 0);

      return IndexNowService.submit({
        urls,
        product_ids: productIds,
      });
    },
    onSuccess: async (result) => {
      setLastActionMessage(JSON.stringify(result, null, 2));
      toast.success(
        t(
          'indexnow.submitted',
          locale === 'zh' ? `已提交 ${result.submitted_urls} 条 URL` : `Submitted ${result.submitted_urls} URLs`
        )
      );
      await qc.invalidateQueries({ queryKey: ['indexnow'] });
      refetch();
      refetchProductStatus();
    },
    onError: (e: any) => {
      const message = isOwnershipVerificationError(e) ? buildOwnershipVerificationMessage(locale) : formatMutationError(e);
      setLastActionMessage(message);
      toast.error(
        isOwnershipVerificationError(e)
          ? (locale === 'zh' ? 'Bing 站点验证尚未生效' : 'Bing site verification is not ready yet')
          : (e?.message || t('indexnow.submitFailed', locale === 'zh' ? '提交失败' : 'Submission failed'))
      );
    },
  });

  const submitAllProductsMutation = useMutation({
    mutationFn: async () =>
      IndexNowService.submitProducts({
        mode: 'all',
        limit: Math.max(0, Number(batchLimit) || 0),
        batch_size: 100,
      }),
    onSuccess: async (result) => {
      setLastActionMessage(JSON.stringify(result, null, 2));
      toast.success(
        locale === 'zh'
          ? `已批量提交 ${result.submitted_products} 个产品`
          : `Submitted ${result.submitted_products} products`
      );
      await qc.invalidateQueries({ queryKey: ['indexnow'] });
      refetch();
      refetchProductStatus();
    },
    onError: (e: any) => {
      const message = isOwnershipVerificationError(e) ? buildOwnershipVerificationMessage(locale) : formatMutationError(e);
      setLastActionMessage(message);
      toast.error(
        isOwnershipVerificationError(e)
          ? (locale === 'zh' ? 'Bing 站点验证尚未生效，批量提交已阻止' : 'Bing site verification is not ready, batch submission blocked')
          : (e?.message || (locale === 'zh' ? '批量提交失败' : 'Batch submission failed'))
      );
    },
  });

  const submitUnsubmittedProductsMutation = useMutation({
    mutationFn: async () =>
      IndexNowService.submitProducts({
        mode: 'unsubmitted',
        limit: Math.max(0, Number(batchLimit) || 0),
        batch_size: 100,
      }),
    onSuccess: async (result) => {
      setLastActionMessage(JSON.stringify(result, null, 2));
      toast.success(
        locale === 'zh'
          ? `已提交 ${result.submitted_products} 个未提交产品`
          : `Submitted ${result.submitted_products} unsubmitted products`
      );
      await qc.invalidateQueries({ queryKey: ['indexnow'] });
      refetch();
      refetchProductStatus();
    },
    onError: (e: any) => {
      const message = isOwnershipVerificationError(e) ? buildOwnershipVerificationMessage(locale) : formatMutationError(e);
      setLastActionMessage(message);
      toast.error(
        isOwnershipVerificationError(e)
          ? (locale === 'zh' ? 'Bing 站点验证尚未生效，批量提交已阻止' : 'Bing site verification is not ready, batch submission blocked')
          : (e?.message || (locale === 'zh' ? '未提交产品批量提交失败' : 'Unsubmitted batch submission failed'))
      );
    },
  });

  const verifyKeyMutation = useMutation({
    mutationFn: () => IndexNowService.verifyKey(),
    onSuccess: (result) => {
      setLastActionMessage(JSON.stringify(result, null, 2));
      toast.success(locale === 'zh' ? 'Key 文件验证通过' : 'Key file verification passed');
    },
    onError: (e: any) => {
      setLastActionMessage(formatMutationError(e));
      toast.error(e?.message || (locale === 'zh' ? 'Key 文件验证失败' : 'Key file verification failed'));
    },
  });

  const submitSampleMutation = useMutation({
    mutationFn: () => IndexNowService.submitSample(),
    onSuccess: async (result) => {
      setLastActionMessage(JSON.stringify(result, null, 2));
      toast.success(locale === 'zh' ? '最小样本提交成功' : 'Sample submission succeeded');
      refetchProductStatus();
    },
    onError: (e: any) => {
      const message = isOwnershipVerificationError(e) ? buildOwnershipVerificationMessage(locale) : formatMutationError(e);
      setLastActionMessage(message);
      toast.error(
        isOwnershipVerificationError(e)
          ? (locale === 'zh' ? 'Bing 站点验证尚未生效' : 'Bing site verification is not ready yet')
          : (e?.message || (locale === 'zh' ? '最小样本提交失败' : 'Sample submission failed'))
      );
    },
  });

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('indexnow.title', locale === 'zh' ? 'IndexNow / Bing 提交' : 'IndexNow / Bing Submission')}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {t(
              'indexnow.subtitle',
              locale === 'zh'
                ? '管理 Bing IndexNow key、根目录验证文件，以及手动/自动 URL 提交。'
                : 'Manage the Bing IndexNow key, root verification file, and manual/automatic URL submission.'
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
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg shadow p-5">
                <div className="text-sm text-gray-500">{locale === 'zh' ? '产品总数' : 'Total Products'}</div>
                <div className="mt-2 text-2xl font-bold text-gray-900">{productStatus?.total_products ?? 0}</div>
              </div>
              <div className="bg-white rounded-lg shadow p-5">
                <div className="text-sm text-gray-500">{locale === 'zh' ? '已提交产品' : 'Submitted Products'}</div>
                <div className="mt-2 text-2xl font-bold text-green-700">{productStatus?.submitted_products ?? 0}</div>
              </div>
              <div className="bg-white rounded-lg shadow p-5">
                <div className="text-sm text-gray-500">{locale === 'zh' ? '未提交产品' : 'Unsubmitted Products'}</div>
                <div className="mt-2 text-2xl font-bold text-amber-700">{productStatus?.unsubmitted_products ?? 0}</div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('indexnow.settings', locale === 'zh' ? 'IndexNow 设置' : 'IndexNow Settings')}
                </h2>
                <div className={`px-3 py-1 rounded-full text-sm font-medium ${enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                  {enabled
                    ? t('indexnow.enabled', locale === 'zh' ? '已启用' : 'Enabled')
                    : t('indexnow.disabled', locale === 'zh' ? '已禁用' : 'Disabled')}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    {t('indexnow.key', locale === 'zh' ? 'API Key' : 'API Key')}
                  </div>
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                    placeholder="dcc05b47d6dc45bbb885d7ad69062c57"
                  />
                </label>

                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    {t('indexnow.siteUrl', locale === 'zh' ? '站点 URL' : 'Site URL')}
                  </div>
                  <input
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                    placeholder="https://www.vcocncspare.com"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  {t('indexnow.enableFeature', locale === 'zh' ? '启用 IndexNow 提交' : 'Enable IndexNow submission')}
                </label>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={autoSubmitProductUpdates}
                    onChange={(e) => setAutoSubmitProductUpdates(e.target.checked)}
                  />
                  {t(
                    'indexnow.autoSubmit',
                    locale === 'zh' ? '产品新增/更新后自动提交' : 'Auto-submit on product create/update'
                  )}
                </label>
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-2">
                <div className="text-sm font-medium text-gray-900">
                  {t('indexnow.keyFile', locale === 'zh' ? '验证文件' : 'Verification File')}
                </div>
                <div className="text-sm text-gray-600">
                  {t(
                    'indexnow.keyFileDesc',
                    locale === 'zh'
                      ? '保存后，网站根目录会自动提供这个 UTF-8 文本文件，不需要你手动传服务器。'
                      : 'After saving, the site root will automatically serve this UTF-8 text file. No manual upload is required.'
                  )}
                </div>
                <div className="font-mono text-sm text-gray-800 break-all">
                  {keyFileUrl || `${siteUrl || 'https://www.vcocncspare.com'}/${keyPreview}`}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={verifyKeyMutation.isPending}
                  onClick={() => verifyKeyMutation.mutate()}
                  className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                >
                  {verifyKeyMutation.isPending
                    ? (locale === 'zh' ? '验证中...' : 'Verifying...')
                    : (locale === 'zh' ? '验证 key.txt' : 'Verify key.txt')}
                </button>
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

            <div className="bg-white rounded-lg shadow p-6 space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {locale === 'zh' ? '批量提交产品' : 'Bulk Product Submission'}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    {locale === 'zh' ? '提交数量上限' : 'Submission Limit'}
                  </div>
                  <input
                    value={batchLimit}
                    onChange={(e) => setBatchLimit(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                    placeholder={locale === 'zh' ? '0 表示全部提交' : '0 means submit all'}
                  />
                </label>
                <div className="rounded-md bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700">
                  <div>{locale === 'zh' ? '说明' : 'Notes'}</div>
                  <div className="mt-2">
                    {locale === 'zh'
                      ? '“提交全部产品”会批量提交当前所有已启用产品；“只提交未提交产品”只处理还没有 IndexNow 提交记录的产品。'
                      : '"Submit all products" sends all active products; "Submit unsubmitted products" only sends products without an IndexNow submission record.'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={submitSampleMutation.isPending}
                  onClick={() => submitSampleMutation.mutate()}
                  className="inline-flex items-center rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {submitSampleMutation.isPending
                    ? (locale === 'zh' ? '样本提交中...' : 'Submitting sample...')
                    : (locale === 'zh' ? '最小样本提交' : 'Submit Sample Product')}
                </button>
                <button
                  type="button"
                  disabled={submitAllProductsMutation.isPending}
                  onClick={() => submitAllProductsMutation.mutate()}
                  className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {submitAllProductsMutation.isPending
                    ? (locale === 'zh' ? '全部提交中...' : 'Submitting all...')
                    : (locale === 'zh' ? '提交全部产品' : 'Submit All Products')}
                </button>
                <button
                  type="button"
                  disabled={submitUnsubmittedProductsMutation.isPending}
                  onClick={() => submitUnsubmittedProductsMutation.mutate()}
                  className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {submitUnsubmittedProductsMutation.isPending
                    ? (locale === 'zh' ? '未提交产品提交中...' : 'Submitting unsubmitted...')
                    : (locale === 'zh' ? '只提交未提交产品' : 'Submit Unsubmitted Products')}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {t('indexnow.manualSubmit', locale === 'zh' ? '手动提交 URL' : 'Manual URL Submission')}
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    {t('indexnow.urls', locale === 'zh' ? 'URL 列表，每行一个' : 'URL list, one per line')}
                  </div>
                  <textarea
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    rows={8}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                    placeholder={`https://www.vcocncspare.com/products/A06B-6290-H205\nhttps://www.vcocncspare.com/shipping-policy`}
                  />
                </label>

                <label className="block">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    {t('indexnow.productIds', locale === 'zh' ? '产品 ID，每行一个' : 'Product IDs, one per line')}
                  </div>
                  <textarea
                    value={productIdsInput}
                    onChange={(e) => setProductIdsInput(e.target.value)}
                    rows={8}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
                    placeholder={`1\n25\n108`}
                  />
                </label>
              </div>

              <div className="rounded-md bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800 space-y-1">
                <div>
                  {t(
                    'indexnow.tip1',
                    locale === 'zh'
                      ? '建议优先提交：新产品页、更新过描述的产品页、政策页、分类页。留空直接提交默认重要页面和 sitemap。'
                      : 'Best candidates: new product pages, updated product pages, policy pages, and category pages. Leave both fields empty to submit the default important pages and sitemaps.'
                  )}
                </div>
                <div>
                  {t(
                    'indexnow.tip2',
                    locale === 'zh'
                      ? '提交的 URL 必须和当前站点 host 一致，否则 Bing 会返回 422。'
                      : 'Submitted URLs must belong to the configured host, otherwise Bing will return 422.'
                  )}
                </div>
              </div>

              {data?.last_submitted_at && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 space-y-1">
                  <div>
                    {t('indexnow.lastSubmit', locale === 'zh' ? '最近一次提交' : 'Last submission')}:
                    {' '}
                    {new Date(data.last_submitted_at).toLocaleString()}
                  </div>
                  <div>HTTP: {data.last_submission_code || '—'}</div>
                  <div>
                    {t('indexnow.lastCount', locale === 'zh' ? 'URL 数量' : 'URL count')}:
                    {' '}
                    {data.last_submission_urls || 0}
                  </div>
                  {data.last_submission_note && <div>{data.last_submission_note}</div>}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setUrlInput('');
                    setProductIdsInput('');
                  }}
                  className="inline-flex items-center rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {t('common.clear', locale === 'zh' ? '清空' : 'Clear')}
                </button>
                <button
                  type="button"
                  disabled={submitMutation.isPending}
                  onClick={() => submitMutation.mutate()}
                  className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {submitMutation.isPending
                    ? t('indexnow.submitting', locale === 'zh' ? '提交中...' : 'Submitting...')
                    : t('indexnow.submitNow', locale === 'zh' ? '立即提交' : 'Submit Now')}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">
                {locale === 'zh' ? '最近一次结果' : 'Latest Result'}
              </h2>
              <pre className="overflow-x-auto rounded-md bg-gray-950 p-4 text-xs text-gray-100 whitespace-pre-wrap">
                {lastActionMessage || (locale === 'zh' ? '这里会显示最近一次验证或提交的详细结果。' : 'The latest verification or submission result will appear here.')}
              </pre>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
