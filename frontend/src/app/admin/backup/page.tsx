'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { ArrowDownTrayIcon, ArrowUpTrayIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

import AdminLayout from '@/components/admin/AdminLayout';
import ProductCatalogTransferPanel from '@/components/admin/ProductCatalogTransferPanel';
import { BackupService } from '@/services';
import { useAdminI18n } from '@/lib/admin-i18n';

function formatBytes(bytes: number) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function AdminBackupPage() {
  const { t } = useAdminI18n();

  const [dbZip, setDbZip] = useState<File | null>(null);
  const [mediaZip, setMediaZip] = useState<File | null>(null);
  const [dbConfirm, setDbConfirm] = useState(false);
  const [mediaConfirm, setMediaConfirm] = useState(false);

  const dbZipLabel = useMemo(() => {
    if (!dbZip) return t('backup.noFile', 'No file selected');
    return `${dbZip.name} (${formatBytes(dbZip.size)})`;
  }, [dbZip, t]);

  const mediaZipLabel = useMemo(() => {
    if (!mediaZip) return t('backup.noFile', 'No file selected');
    return `${mediaZip.name} (${formatBytes(mediaZip.size)})`;
  }, [mediaZip, t]);

  const downloadDbMutation = useMutation({
    mutationFn: () => BackupService.downloadDbZip(),
    onError: (error: unknown) => toast.error(errorMessage(error, t('backup.downloadFailed', 'Download failed'))),
  });

  const downloadMediaMutation = useMutation({
    mutationFn: () => BackupService.downloadMediaZip(),
    onError: (error: unknown) => toast.error(errorMessage(error, t('backup.downloadFailed', 'Download failed'))),
  });

  const restoreDbMutation = useMutation({
    mutationFn: (file: File) => BackupService.restoreDbZip(file),
    onSuccess: () => {
      toast.success(t('backup.dbRestoreOk', 'Database restored successfully'));
      setDbZip(null);
      setDbConfirm(false);
    },
    onError: (error: unknown) => toast.error(errorMessage(error, t('backup.restoreFailed', 'Restore failed'))),
  });

  const restoreMediaMutation = useMutation({
    mutationFn: (file: File) => BackupService.restoreMediaZip(file),
    onSuccess: () => {
      toast.success(t('backup.mediaRestoreOk', 'Media library restored successfully'));
      setMediaZip(null);
      setMediaConfirm(false);
    },
    onError: (error: unknown) => toast.error(errorMessage(error, t('backup.restoreFailed', 'Restore failed'))),
  });

  const busy =
    downloadDbMutation.isPending ||
    downloadMediaMutation.isPending ||
    restoreDbMutation.isPending ||
    restoreMediaMutation.isPending;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('nav.backup', 'Backup & Restore')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('backup.subtitle', 'Download backups as ZIP files, and restore by uploading a ZIP.')}
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm text-amber-900">
              <div className="font-semibold">{t('backup.warningTitle', 'Warning')}</div>
              <div className="mt-1">
                {t('backup.warningBody', 'Restore will overwrite data. Please backup first and proceed carefully.')}
              </div>
            </div>
          </div>
        </div>

        <ProductCatalogTransferPanel />

        {/* Database */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('backup.db.title', 'Database')}</h2>
            <p className="text-sm text-gray-500">{t('backup.db.desc', 'Backup/restore MySQL data (ZIP contains db.sql).')}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={() => downloadDbMutation.mutate()}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
            >
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
              {t('backup.downloadDb', 'Download DB Backup')}
            </button>
          </div>

          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="text-sm font-medium text-gray-900">{t('backup.restoreDb', 'Restore DB Backup')}</div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setDbZip(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-700"
              />
              <div className="text-sm text-gray-500 sm:w-[320px] truncate">{dbZipLabel}</div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={dbConfirm}
                onChange={(e) => setDbConfirm(e.target.checked)}
              />
              {t('backup.confirmDb', 'I understand this will overwrite the database')}
            </label>

            <button
              disabled={busy || !dbZip || !dbConfirm}
              onClick={() => dbZip && restoreDbMutation.mutate(dbZip)}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
            >
              <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
              {t('backup.restoreNow', 'Restore Now')}
            </button>
          </div>
        </div>

        {/* Media */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('backup.media.title', 'Media Library')}</h2>
            <p className="text-sm text-gray-500">
              {t('backup.media.desc', 'Backup/restore uploaded files (ZIP of uploads directory).')}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={() => downloadMediaMutation.mutate()}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
            >
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
              {t('backup.downloadMedia', 'Download Media Backup')}
            </button>
          </div>

          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="text-sm font-medium text-gray-900">{t('backup.restoreMedia', 'Restore Media Backup')}</div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setMediaZip(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-700"
              />
              <div className="text-sm text-gray-500 sm:w-[320px] truncate">{mediaZipLabel}</div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={mediaConfirm}
                onChange={(e) => setMediaConfirm(e.target.checked)}
              />
              {t('backup.confirmMedia', 'I understand this will overwrite the media library')}
            </label>

            <button
              disabled={busy || !mediaZip || !mediaConfirm}
              onClick={() => mediaZip && restoreMediaMutation.mutate(mediaZip)}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
            >
              <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
              {t('backup.restoreNow', 'Restore Now')}
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

