'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArchiveBoxArrowDownIcon,
  ArrowUpTrayIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  ShieldCheckIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';

import { MediaService, ProductService } from '@/services';
import type { SKUImageArchiveJob } from '@/services/media.service';
import type {
  ProductImageAutofillBrand,
  ProductImageCleanupJob,
  ProductImageCleanupPreview,
  ProductImageCleanupScope,
} from '@/services/product.service';
import type { Category } from '@/types';

type Locale = 'zh' | 'en';

interface ProductImageGovernancePanelProps {
  locale: Locale;
  categories: Category[];
  brands: ProductImageAutofillBrand[];
  onProductsChanged: () => void;
  onMediaChanged: () => void;
}

const cleanupJobKey = ['media', 'image-cleanup', 'latest'] as const;
const imagePolicyKey = ['media', 'image-cleanup', 'settings'] as const;
const archiveJobKey = ['media', 'sku-archive', 'latest'] as const;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseDomains(value: string) {
  return Array.from(new Set(value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean)));
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function jobProgress(processed: number, total: number, finished: boolean) {
  if (finished) return 100;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((processed / total) * 100));
}

export default function ProductImageGovernancePanel({
  locale,
  categories,
  brands,
  onProductsChanged,
  onMediaChanged,
}: ProductImageGovernancePanelProps) {
  const queryClient = useQueryClient();
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const settingsInitialized = useRef(false);

  const [trustedDomainsText, setTrustedDomainsText] = useState('');
  const [cleanupBrand, setCleanupBrand] = useState('');
  const [cleanupCategoryID, setCleanupCategoryID] = useState('');
  const [cleanupProductStatus, setCleanupProductStatus] = useState<'active' | 'inactive' | 'all'>('all');
  const [cleanupPreview, setCleanupPreview] = useState<ProductImageCleanupPreview | null>(null);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState({ uploadedBytes: 0, totalBytes: 0, percent: 0 });

  const { data: policySettings } = useQuery({
    queryKey: imagePolicyKey,
    queryFn: () => ProductService.getProductImagePolicySettings(),
    retry: 1,
  });

  useEffect(() => {
    if (!policySettings || settingsInitialized.current) return;
    settingsInitialized.current = true;
    setTrustedDomainsText(policySettings.trusted_domains.join('\n'));
  }, [policySettings]);

  const { data: cleanupJob } = useQuery({
    queryKey: cleanupJobKey,
    queryFn: () => ProductService.getLatestProductImageCleanupJob(),
    retry: 1,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' || status === 'paused' ? 2000 : 10000;
    },
  });

  const { data: archiveJob } = useQuery({
    queryKey: archiveJobKey,
    queryFn: () => MediaService.getLatestSKUImageArchiveJob(),
    retry: 1,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'uploading' || status === 'queued' || status === 'running' || status === 'paused' ? 2000 : 10000;
    },
  });

  const trustedDomains = useMemo(() => parseDomains(trustedDomainsText), [trustedDomainsText]);
  const cleanupScope = (): ProductImageCleanupScope => ({
    trusted_domains: trustedDomains,
    brand: cleanupBrand || undefined,
    category_id: cleanupCategoryID ? Number(cleanupCategoryID) : undefined,
    include_descendants: Boolean(cleanupCategoryID),
    product_status: cleanupProductStatus,
    batch_size: 250,
  });

  const savePolicyMutation = useMutation({
    mutationFn: () => ProductService.updateProductImagePolicySettings(trustedDomains),
    onSuccess: (settings) => {
      queryClient.setQueryData(imagePolicyKey, settings);
      setTrustedDomainsText(settings.trusted_domains.join('\n'));
      setCleanupPreview(null);
      toast.success(locale === 'zh' ? '可信外链域名已保存' : 'Trusted external domains saved');
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, locale === 'zh' ? '保存图片来源配置失败' : 'Failed to save image policy')),
  });

  const previewMutation = useMutation({
    mutationFn: () => ProductService.previewUntrustedProductImages(cleanupScope()),
    onSuccess: (preview) => {
      setCleanupPreview(preview);
      if (preview.removable_images === 0) {
        toast.success(locale === 'zh' ? '没有发现需要清理的不可信外链图片' : 'No untrusted external images found');
      }
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, locale === 'zh' ? '预览外链图片失败' : 'Failed to preview external images')),
  });

  const cleanupMutation = useMutation({
    mutationFn: () => ProductService.startUntrustedProductImageCleanup(cleanupScope()),
    onSuccess: (job: ProductImageCleanupJob) => {
      queryClient.setQueryData(cleanupJobKey, job);
      setCleanupPreview(null);
      toast.success(locale === 'zh' ? '图片来源清理后台任务已启动' : 'Image cleanup task started');
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, locale === 'zh' ? '启动图片清理失败' : 'Failed to start image cleanup')),
  });

  const cleanupControlMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' }) => (
      action === 'pause' ? ProductService.pauseProductImageCleanupJob(id) : ProductService.resumeProductImageCleanupJob(id)
    ),
    onSuccess: (job: ProductImageCleanupJob) => queryClient.setQueryData(cleanupJobKey, job),
    onError: (error: unknown) => toast.error(getErrorMessage(error, locale === 'zh' ? '更新清理任务失败' : 'Failed to update cleanup task')),
  });

  const archiveUploadMutation = useMutation({
    mutationFn: (file: File) => MediaService.uploadSKUImageArchive(file, setUploadProgress),
    onSuccess: (job: SKUImageArchiveJob) => {
      queryClient.setQueryData(archiveJobKey, job);
      setArchiveFile(null);
      toast.success(locale === 'zh' ? 'ZIP 上传完成，后台正在匹配 SKU 并替换图片' : 'ZIP uploaded; SKU matching is running in the background');
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, locale === 'zh' ? 'ZIP 上传中断；重新选择同一文件即可续传' : 'ZIP upload stopped; select the same file to resume')),
  });

  const archiveControlMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'cancel' }) => {
      if (action === 'pause') return MediaService.pauseSKUImageArchiveJob(id);
      if (action === 'resume') return MediaService.resumeSKUImageArchiveJob(id);
      return MediaService.cancelSKUImageArchiveJob(id);
    },
    onSuccess: (job: SKUImageArchiveJob) => {
      queryClient.setQueryData(archiveJobKey, job);
      if (job.status === 'completed' || job.status === 'completed_with_errors') {
        onProductsChanged();
        onMediaChanged();
      }
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, locale === 'zh' ? '更新 ZIP 任务失败' : 'Failed to update ZIP task')),
  });

  useEffect(() => {
    if (cleanupJob?.status === 'completed' || cleanupJob?.status === 'completed_with_errors') {
      onProductsChanged();
    }
  }, [cleanupJob?.status, onProductsChanged]);

  useEffect(() => {
    if (archiveJob?.status === 'completed' || archiveJob?.status === 'completed_with_errors') {
      onProductsChanged();
      onMediaChanged();
    }
  }, [archiveJob?.status, onMediaChanged, onProductsChanged]);

  const cleanupActive = cleanupJob?.status === 'queued' || cleanupJob?.status === 'running' || cleanupJob?.status === 'paused';
  const cleanupFinished = cleanupJob?.status === 'completed' || cleanupJob?.status === 'completed_with_errors';
  const cleanupPercent = cleanupJob ? jobProgress(cleanupJob.processed, cleanupJob.total, Boolean(cleanupFinished)) : 0;
  const archiveFinished = archiveJob?.status === 'completed' || archiveJob?.status === 'completed_with_errors';
  const archivePercent = archiveJob?.status === 'uploading'
    ? (archiveJob.file_size > 0 ? Math.round((archiveJob.uploaded_bytes / archiveJob.file_size) * 100) : 0)
    : archiveJob ? jobProgress(archiveJob.processed_folders, archiveJob.total_folders, Boolean(archiveFinished)) : 0;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-l-4 border-amber-500 px-5 py-4">
          <div className="flex items-start gap-3">
            <ShieldCheckIcon className="mt-0.5 h-6 w-6 text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">{locale === 'zh' ? '安全清理非自有图片来源' : 'Safely remove unowned image sources'}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {locale === 'zh'
                  ? '本地 /uploads/、VIBOCNC 域名、SKU 默认图、产品编辑器中手动添加的外链和下方可信域名始终保留。必须先预览，确认后才会后台删除其余 HTTP(S) 外链。'
                  : 'Local /uploads/, VIBOCNC hosts, SKU fallbacks, external links explicitly added in the product editor, and trusted hosts are always kept. Preview is required before background removal.'}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <label className="block text-sm font-medium text-slate-700">{locale === 'zh' ? '可信外链域名' : 'Trusted external hosts'}</label>
              <textarea
                value={trustedDomainsText}
                onChange={(event) => { setTrustedDomainsText(event.target.value); setCleanupPreview(null); }}
                rows={3}
                placeholder={locale === 'zh' ? '例如：cdn.example.com（每行一个）' : 'Example: cdn.example.com (one per line)'}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-amber-500"
              />
              <button
                type="button"
                disabled={savePolicyMutation.isPending}
                onClick={() => savePolicyMutation.mutate()}
                className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {locale === 'zh' ? '保存可信域名' : 'Save trusted hosts'}
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">{locale === 'zh' ? '品牌' : 'Brand'}</label>
              <select value={cleanupBrand} onChange={(event) => { setCleanupBrand(event.target.value); setCleanupPreview(null); }} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">{locale === 'zh' ? '全部品牌' : 'All brands'}</option>
                {brands.map(brand => <option key={brand.name.toLowerCase()} value={brand.name}>{brand.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">{locale === 'zh' ? '分类' : 'Category'}</label>
              <select value={cleanupCategoryID} onChange={(event) => { setCleanupCategoryID(event.target.value); setCleanupPreview(null); }} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">{locale === 'zh' ? '全部分类' : 'All categories'}</option>
                {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">{locale === 'zh' ? '产品状态' : 'Product status'}</label>
              <select
                value={cleanupProductStatus}
                onChange={(event) => {
                  const value = event.target.value;
                  setCleanupProductStatus(value === 'active' || value === 'inactive' ? value : 'all');
                  setCleanupPreview(null);
                }}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">{locale === 'zh' ? '全部' : 'All'}</option>
                <option value="active">{locale === 'zh' ? '启用' : 'Active'}</option>
                <option value="inactive">{locale === 'zh' ? '未启用' : 'Inactive'}</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!policySettings || previewMutation.isPending || Boolean(cleanupActive)}
              onClick={() => previewMutation.mutate()}
              className="inline-flex items-center rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              <MagnifyingGlassIcon className="mr-2 h-4 w-4" />
              {previewMutation.isPending ? (locale === 'zh' ? '扫描中...' : 'Scanning...') : (locale === 'zh' ? '先预览可清理图片' : 'Preview removable images')}
            </button>
            <button
              type="button"
              disabled={!cleanupPreview || cleanupPreview.removable_images === 0 || cleanupMutation.isPending || Boolean(cleanupActive)}
              onClick={() => {
                if (!cleanupPreview) return;
                const confirmed = window.confirm(locale === 'zh'
                  ? `确认后台移除 ${cleanupPreview.affected_products} 个产品中的 ${cleanupPreview.removable_images} 条不可信图片引用？本地图片和可信外链会保留。`
                  : `Remove ${cleanupPreview.removable_images} untrusted image references from ${cleanupPreview.affected_products} products in the background?`);
                if (confirmed) cleanupMutation.mutate();
              }}
              className="inline-flex items-center rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <TrashIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '确认并后台清理' : 'Confirm background cleanup'}
            </button>
          </div>

          {cleanupPreview && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div><div className="text-slate-500">{locale === 'zh' ? '扫描产品' : 'Scanned'}</div><div className="font-semibold text-slate-900">{cleanupPreview.scanned_products.toLocaleString()}</div></div>
                <div><div className="text-slate-500">{locale === 'zh' ? '受影响产品' : 'Affected'}</div><div className="font-semibold text-amber-800">{cleanupPreview.affected_products.toLocaleString()}</div></div>
                <div><div className="text-slate-500">{locale === 'zh' ? '将移除引用' : 'Remove'}</div><div className="font-semibold text-rose-700">{cleanupPreview.removable_images.toLocaleString()}</div></div>
                <div><div className="text-slate-500">{locale === 'zh' ? '保留引用' : 'Preserve'}</div><div className="font-semibold text-emerald-700">{cleanupPreview.preserved_images.toLocaleString()}</div></div>
              </div>
              {cleanupPreview.samples.length > 0 && (
                <div className="mt-3 max-h-36 overflow-auto border-t border-amber-200 pt-2 text-xs text-slate-600">
                  {cleanupPreview.samples.slice(0, 20).map((sample, index) => (
                    <div key={`${sample.product_id}-${sample.image_url}-${index}`} className="truncate py-0.5" title={sample.image_url}>
                      {sample.sku} · {sample.hostname || sample.image_url}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {cleanupJob && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{locale === 'zh' ? '最近清理任务' : 'Latest cleanup task'} · {cleanupJob.status}</div>
                  <div className="mt-1 text-xs text-slate-600">
                    {locale === 'zh'
                      ? `已扫描 ${cleanupJob.processed.toLocaleString()} / ${cleanupJob.total.toLocaleString()}，更新 ${cleanupJob.updated_products.toLocaleString()} 个产品，移除 ${cleanupJob.removed_images.toLocaleString()} 条引用`
                      : `Scanned ${cleanupJob.processed.toLocaleString()} / ${cleanupJob.total.toLocaleString()}; updated ${cleanupJob.updated_products.toLocaleString()} products and removed ${cleanupJob.removed_images.toLocaleString()} references`}
                  </div>
                </div>
                <div className="flex gap-2">
                  {(cleanupJob.status === 'queued' || cleanupJob.status === 'running') && <button type="button" onClick={() => cleanupControlMutation.mutate({ id: cleanupJob.id, action: 'pause' })} className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"><PauseIcon className="mr-1 h-4 w-4" />{locale === 'zh' ? '暂停' : 'Pause'}</button>}
                  {cleanupJob.status === 'paused' && <button type="button" onClick={() => cleanupControlMutation.mutate({ id: cleanupJob.id, action: 'resume' })} className="inline-flex items-center rounded bg-slate-800 px-3 py-1.5 text-sm text-white"><PlayIcon className="mr-1 h-4 w-4" />{locale === 'zh' ? '继续' : 'Resume'}</button>}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-amber-500 transition-all" style={{ width: `${cleanupPercent}%` }} /></div>
              {cleanupJob.error && <div className="mt-2 text-xs text-rose-700">{cleanupJob.error}</div>}
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-l-4 border-emerald-600 px-5 py-4">
          <div className="flex items-start gap-3">
            <ArchiveBoxArrowDownIcon className="mt-0.5 h-6 w-6 text-emerald-700" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">{locale === 'zh' ? '按 SKU 文件夹批量导入产品图片' : 'Import product images from SKU folders'}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {locale === 'zh'
                  ? 'ZIP 内每个文件夹用产品 SKU 命名，文件夹内放该产品全部图片。支持外层总文件夹、分片续传、失败重试和后台重启恢复；匹配成功后替换该 SKU 的全部产品图。'
                  : 'Name each ZIP folder with a product SKU and place all product images inside. Wrapper folders, resumable chunks, retries, and restart-safe processing are supported.'}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label className="block text-sm font-medium text-slate-700">{locale === 'zh' ? 'ZIP 压缩包' : 'ZIP archive'}</label>
              <div className="mt-1 flex items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3">
                <button type="button" onClick={() => archiveInputRef.current?.click()} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                  {locale === 'zh' ? '选择 ZIP' : 'Choose ZIP'}
                </button>
                <div className="min-w-0 flex-1 truncate text-sm text-slate-600">
                  {archiveFile ? `${archiveFile.name} · ${formatBytes(archiveFile.size)}` : (locale === 'zh' ? '可重新选择同一文件继续未完成上传' : 'Reselect the same file to resume an interrupted upload')}
                </div>
                {archiveFile && <button type="button" onClick={() => setArchiveFile(null)} className="text-slate-400 hover:text-slate-700"><XMarkIcon className="h-5 w-5" /></button>}
                <input
                  ref={archiveInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setArchiveFile(file);
                    if (file) setUploadProgress({ uploadedBytes: 0, totalBytes: file.size, percent: 0 });
                    event.currentTarget.value = '';
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={!archiveFile || archiveUploadMutation.isPending || archiveJob?.status === 'queued' || archiveJob?.status === 'running' || archiveJob?.status === 'paused'}
              onClick={() => archiveFile && archiveUploadMutation.mutate(archiveFile)}
              className="inline-flex items-center justify-center rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              <ArrowUpTrayIcon className="mr-2 h-4 w-4" />
              {archiveUploadMutation.isPending ? (locale === 'zh' ? `上传中 ${uploadProgress.percent}%` : `Uploading ${uploadProgress.percent}%`) : (locale === 'zh' ? '分片上传并后台导入' : 'Upload chunks and import')}
            </button>
          </div>

          {archiveUploadMutation.isPending && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-600"><span>{formatBytes(uploadProgress.uploadedBytes)} / {formatBytes(uploadProgress.totalBytes)}</span><span>{uploadProgress.percent}%</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${uploadProgress.percent}%` }} /></div>
            </div>
          )}

          {archiveJob && (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{archiveJob.file_name} · {archiveJob.status}</div>
                  <div className="mt-1 text-xs text-slate-600">
                    {archiveJob.status === 'uploading'
                      ? `${formatBytes(archiveJob.uploaded_bytes)} / ${formatBytes(archiveJob.file_size)}`
                      : (locale === 'zh'
                        ? `文件夹 ${archiveJob.processed_folders.toLocaleString()} / ${archiveJob.total_folders.toLocaleString()}，匹配产品 ${archiveJob.matched_products.toLocaleString()}，更新 ${archiveJob.updated_products.toLocaleString()}，新图片 ${archiveJob.imported_images.toLocaleString()}，未匹配 ${archiveJob.skipped_folders.toLocaleString()}，失败 ${archiveJob.failed_folders.toLocaleString()}`
                        : `Folders ${archiveJob.processed_folders.toLocaleString()} / ${archiveJob.total_folders.toLocaleString()}; matched ${archiveJob.matched_products.toLocaleString()}, updated ${archiveJob.updated_products.toLocaleString()}, new images ${archiveJob.imported_images.toLocaleString()}, unmatched ${archiveJob.skipped_folders.toLocaleString()}, failed ${archiveJob.failed_folders.toLocaleString()}`)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(archiveJob.status === 'queued' || archiveJob.status === 'running') && <button type="button" onClick={() => archiveControlMutation.mutate({ id: archiveJob.id, action: 'pause' })} className="inline-flex items-center rounded border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-800"><PauseIcon className="mr-1 h-4 w-4" />{locale === 'zh' ? '暂停处理' : 'Pause'}</button>}
                  {archiveJob.status === 'paused' && <button type="button" onClick={() => archiveControlMutation.mutate({ id: archiveJob.id, action: 'resume' })} className="inline-flex items-center rounded bg-emerald-700 px-3 py-1.5 text-sm text-white"><PlayIcon className="mr-1 h-4 w-4" />{locale === 'zh' ? '继续处理' : 'Resume'}</button>}
                  {(archiveJob.status === 'uploading' || archiveJob.status === 'queued' || archiveJob.status === 'paused' || archiveJob.status === 'failed') && <button type="button" onClick={() => { if (window.confirm(locale === 'zh' ? '取消并删除服务器上的临时 ZIP？' : 'Cancel and delete the temporary ZIP?')) archiveControlMutation.mutate({ id: archiveJob.id, action: 'cancel' }); }} className="inline-flex items-center rounded border border-rose-300 bg-white px-3 py-1.5 text-sm text-rose-700"><XMarkIcon className="mr-1 h-4 w-4" />{locale === 'zh' ? '取消任务' : 'Cancel'}</button>}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${archivePercent}%` }} /></div>
              {archiveJob.error && <div className="mt-2 text-xs text-rose-700">{archiveJob.error}</div>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
