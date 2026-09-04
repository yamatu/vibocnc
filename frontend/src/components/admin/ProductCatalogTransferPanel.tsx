'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, ArrowUpTrayIcon, PauseIcon, PlayIcon, StopIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';

import { BackupService } from '@/services';
import type {
  ProductCatalogImportJob,
  ProductCatalogImportOptions,
  ProductCatalogPreview,
} from '@/services/backup.service';
import { useAdminI18n } from '@/lib/admin-i18n';

function formatBytes(bytes: number) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function currentTargetIdentity() {
  const configured = String(process.env.NEXT_PUBLIC_SITE_NAME || '').trim();
  const host = typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase();
  const vcocnc = /vcocnc|vco/i.test(configured) || host.includes('vcocnc');
  return vcocnc
    ? { name: 'Vcocnc', domain: 'vcocncspare.com', email: 'sales@vcocncspare.com' }
    : { name: configured || 'Vibocnc', domain: 'vibocnc.com', email: 'sales@vibocnc.com' };
}

function defaultReplacements(preview: ProductCatalogPreview) {
  const source = `${preview.manifest.source_site} ${preview.manifest.source_url}`.toLowerCase();
  const target = currentTargetIdentity();
  if (target.name === 'Vcocnc' && source.includes('vibocnc')) {
    return [
      { from: 'sales@vibocnc.com', to: target.email },
      { from: 'vibocnc.com', to: target.domain },
      { from: 'Vibocnc', to: target.name },
    ];
  }
  if (target.name === 'Vibocnc' && (source.includes('vcocnc') || source.includes('vcocncspare'))) {
    return [
      { from: 'sales@vcocncspare.com', to: target.email },
      { from: 'vcocncspare.com', to: target.domain },
      { from: 'Vcocnc', to: target.name },
    ];
  }
  return [{ from: '', to: '' }];
}

export default function ProductCatalogTransferPanel() {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const [file, setFile] = useState<File | null>(null);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [job, setJob] = useState<ProductCatalogImportJob | null>(null);
  const [preview, setPreview] = useState<ProductCatalogPreview | null>(null);
  const [busy, setBusy] = useState<'export' | 'upload' | 'apply' | 'state' | null>(null);
  const [conflictPolicy, setConflictPolicy] = useState<ProductCatalogImportOptions['conflict_policy']>('upsert');
  const [createCategories, setCreateCategories] = useState(true);
  const [overwriteLocalFiles, setOverwriteLocalFiles] = useState(false);
  const [brandMap, setBrandMap] = useState<Record<string, string>>({});
  const [replacements, setReplacements] = useState<Array<{ from: string; to: string }>>([{ from: '', to: '' }]);

  const active = job && ['queued', 'running'].includes(job.status);
  const progress = useMemo(() => {
    if (!job) return uploadPercent;
    if (job.status === 'uploading' && job.file_size > 0) return Math.round((job.uploaded_bytes / job.file_size) * 100);
    if (job.total_products > 0) return Math.round((job.processed_products / job.total_products) * 100);
    return uploadPercent;
  }, [job, uploadPercent]);

  const jobID = job?.id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobID || !jobStatus || !['queued', 'running'].includes(jobStatus)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await BackupService.getProductCatalogImport(jobID);
        setJob(next);
      } catch {
        // A transient polling failure must not stop the server-side task.
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [jobID, jobStatus]);

  const handleExport = async () => {
    setBusy('export');
    try {
      await BackupService.downloadProductCatalog();
      toast.success(zh ? '产品库备份已下载' : 'Product catalog backup downloaded');
    } catch (error: unknown) {
      toast.error(errorMessage(error, zh ? '产品库导出失败' : 'Catalog export failed'));
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setBusy('upload');
    try {
      const result = await BackupService.uploadProductCatalog(file, value => setUploadPercent(value.percent));
      setJob(result.job);
      setPreview(result.preview);
      setBrandMap(Object.fromEntries(result.preview.source_brands.map(brand => [brand, brand])));
      setReplacements(defaultReplacements(result.preview));
      toast.success(zh ? '文件校验完成，请确认映射后开始导入' : 'Archive validated; review mappings before importing');
    } catch (error: unknown) {
      toast.error(errorMessage(error, zh ? '产品库上传失败' : 'Catalog upload failed'));
    } finally {
      setBusy(null);
    }
  };

  const handleApply = async () => {
    if (!job) return;
    setBusy('apply');
    try {
      const next = await BackupService.applyProductCatalogImport(job.id, {
        conflict_policy: conflictPolicy,
        create_categories: createCategories,
        overwrite_local_files: overwriteLocalFiles,
        brand_map: brandMap,
        text_replacements: replacements.filter(item => item.from.trim()),
      });
      setJob(next);
      toast.success(zh ? '后台导入任务已启动，关闭网页也会继续执行' : 'Background import started and will continue after you leave this page');
    } catch (error: unknown) {
      toast.error(errorMessage(error, zh ? '启动导入失败' : 'Failed to start import'));
    } finally {
      setBusy(null);
    }
  };

  const changeState = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!job) return;
    setBusy('state');
    try {
      const next = action === 'pause'
        ? await BackupService.pauseProductCatalogImport(job.id)
        : action === 'resume'
          ? await BackupService.resumeProductCatalogImport(job.id)
          : await BackupService.cancelProductCatalogImport(job.id);
      setJob(next);
    } catch (error: unknown) {
      toast.error(errorMessage(error, zh ? '任务状态更新失败' : 'Failed to update task'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{zh ? '产品库备份与迁移' : 'Product Library Backup & Transfer'}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {zh ? '按 SKU 导出/导入产品、分类、描述、SEO、属性、翻译、购买链接和被引用的本地图片。大文件使用断点分片上传，导入在后台持续执行。' : 'Transfer products and referenced local images by SKU with resumable uploads and background processing.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={handleExport} disabled={busy !== null} className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          <ArrowDownTrayIcon className="mr-2 h-4 w-4" />
          {busy === 'export' ? (zh ? '正在生成…' : 'Generating…') : (zh ? '导出产品库 ZIP' : 'Export Product Catalog ZIP')}
        </button>
      </div>

      <div className="border-t border-gray-200 pt-4 space-y-3">
        <div className="text-sm font-medium text-gray-900">{zh ? '导入产品库 ZIP' : 'Import Product Catalog ZIP'}</div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input type="file" accept=".zip,application/zip" onChange={event => setFile(event.target.files?.[0] || null)} className="block w-full text-sm text-gray-700" />
          <div className="truncate text-sm text-gray-500 sm:w-[320px]">{file ? `${file.name} (${formatBytes(file.size)})` : (zh ? '未选择文件' : 'No file selected')}</div>
        </div>
        <button type="button" onClick={handleUpload} disabled={!file || busy !== null || Boolean(active)} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          <ArrowUpTrayIcon className="mr-2 h-4 w-4" />
          {busy === 'upload' ? (zh ? `上传并校验 ${uploadPercent}%` : `Uploading ${uploadPercent}%`) : (zh ? '分片上传并预览' : 'Upload in Chunks & Preview')}
        </button>
      </div>

      {(job || busy === 'upload') && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-gray-900">{job?.message || (zh ? '正在上传产品库' : 'Uploading product catalog')}</span>
            <span className="text-gray-600">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>
          {job && (
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-4">
              <div>{zh ? '已处理' : 'Processed'}: {job.processed_products}/{job.total_products}</div>
              <div>{zh ? '新建' : 'Created'}: {job.created_products}</div>
              <div>{zh ? '更新' : 'Updated'}: {job.updated_products}</div>
              <div>{zh ? '失败' : 'Failed'}: {job.failed_products}</div>
            </div>
          )}
          {job?.error && <div className="text-sm text-red-700">{job.error}</div>}
          {job && (
            <div className="flex flex-wrap gap-2">
              {['queued', 'running'].includes(job.status) && <button type="button" onClick={() => changeState('pause')} disabled={busy !== null} className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800"><PauseIcon className="mr-1 h-4 w-4" />{zh ? '暂停' : 'Pause'}</button>}
              {job.status === 'paused' && <button type="button" onClick={() => changeState('resume')} disabled={busy !== null} className="inline-flex items-center rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"><PlayIcon className="mr-1 h-4 w-4" />{zh ? '继续' : 'Resume'}</button>}
              {!['completed', 'canceled'].includes(job.status) && <button type="button" onClick={() => changeState('cancel')} disabled={busy !== null} className="inline-flex items-center rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700"><StopIcon className="mr-1 h-4 w-4" />{zh ? '取消' : 'Cancel'}</button>}
            </div>
          )}
        </div>
      )}

      {preview && job?.status === 'ready' && (
        <div className="space-y-5 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div><span className="block text-gray-500">{zh ? '来源站点' : 'Source'}</span><b>{preview.manifest.source_site || '-'}</b></div>
            <div><span className="block text-gray-500">{zh ? '产品总数' : 'Products'}</span><b>{preview.manifest.product_count}</b></div>
            <div><span className="block text-gray-500">{zh ? '新增' : 'New'}</span><b>{preview.new_products}</b></div>
            <div><span className="block text-gray-500">{zh ? '已存在' : 'Existing'}</span><b>{preview.existing_products}</b></div>
            <div><span className="block text-gray-500">{zh ? '缺少分类' : 'Missing categories'}</span><b>{preview.missing_categories}</b></div>
          </div>

          {preview.warnings.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{preview.warnings.map(warning => <div key={warning}>• {warning}</div>)}</div>}

          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm text-gray-700">{zh ? 'SKU 冲突策略' : 'SKU conflict policy'}
              <select value={conflictPolicy} onChange={event => setConflictPolicy(event.target.value as ProductCatalogImportOptions['conflict_policy'])} className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2">
                <option value="upsert">{zh ? '存在则更新，不存在则新建' : 'Upsert'}</option>
                <option value="update">{zh ? '只更新已有 SKU' : 'Update existing only'}</option>
                <option value="skip">{zh ? '跳过已有 SKU' : 'Skip existing'}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"><input type="checkbox" checked={createCategories} onChange={event => setCreateCategories(event.target.checked)} />{zh ? '自动创建缺少的分类' : 'Create missing categories'}</label>
            <label className="flex items-center gap-2 self-end rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"><input type="checkbox" checked={overwriteLocalFiles} onChange={event => setOverwriteLocalFiles(event.target.checked)} />{zh ? '覆盖同路径本地图片' : 'Overwrite same-path local images'}</label>
          </div>

          {preview.source_brands.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium text-gray-900">{zh ? '品牌精确映射（左侧来源 → 右侧目标）' : 'Exact brand mapping'}</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {preview.source_brands.map(brand => <label key={brand} className="flex items-center gap-2 text-sm"><span className="w-28 truncate text-gray-600" title={brand}>{brand}</span><span>→</span><input value={brandMap[brand] ?? brand} onChange={event => setBrandMap(current => ({ ...current, [brand]: event.target.value }))} className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5" /></label>)}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-gray-900">{zh ? '站点文字、域名和邮箱替换' : 'Site text/domain/email replacements'}</span><button type="button" onClick={() => setReplacements(current => [...current, { from: '', to: '' }])} className="text-xs font-medium text-blue-700 hover:underline">{zh ? '添加一行' : 'Add row'}</button></div>
            <div className="space-y-2">{replacements.map((item, index) => <div key={index} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2"><input value={item.from} onChange={event => setReplacements(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, from: event.target.value } : row))} placeholder={zh ? '来源文字' : 'From'} className="min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" /><span>→</span><input value={item.to} onChange={event => setReplacements(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, to: event.target.value } : row))} placeholder={zh ? '目标文字' : 'To'} className="min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" /><button type="button" onClick={() => setReplacements(current => current.filter((_, rowIndex) => rowIndex !== index))} className="px-1 text-sm text-red-600">×</button></div>)}</div>
          </div>

          <button type="button" onClick={handleApply} disabled={busy !== null} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy === 'apply' ? (zh ? '正在启动…' : 'Starting…') : (zh ? '确认映射并后台导入' : 'Apply Mapping & Start Background Import')}</button>
        </div>
      )}
    </div>
  );
}
