'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { XMarkIcon, MagnifyingGlassIcon, PhotoIcon, ArrowUpTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import { MediaService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import type { MediaAsset } from '@/services/media.service';
import { useAdminI18n } from '@/lib/admin-i18n';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (assets: MediaAsset[]) => void;
  multiple?: boolean;
  title?: string;
  initialQuery?: string;
  initialFolder?: string;
};

export default function MediaPickerModal({ open, onClose, onSelect, multiple = false, title = 'Select from Media Library', initialQuery = '', initialFolder = '' }: Props) {
  const { t } = useAdminI18n();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 24;
  const [selected, setSelected] = useState<MediaAsset[]>([]);

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadFolder, setUploadFolder] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Reset modal state on each open so it behaves predictably across different pages.
    setQ(initialQuery);
    setFolder(initialFolder);
    setPage(1);
    setSelected([]);
    setUploadFiles([]);
    setUploadFolder('');
    setUploadTags('');
    setIsDragging(false);
  }, [open, initialFolder, initialQuery]);

  const filters = useMemo(() => ({ q, folder, page, pageSize }), [q, folder, page, pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.media.list(filters),
    queryFn: () => MediaService.list({ q: q.trim() || undefined, folder: folder.trim() || undefined, page, page_size: pageSize }),
    enabled: open,
    retry: 1,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const isSelected = (id: number) => selected.some((s) => s.id === id);

  const toggle = (asset: MediaAsset) => {
    if (!multiple) {
      setSelected([asset]);
      return;
    }
    setSelected((prev) => (prev.some((x) => x.id === asset.id) ? prev.filter((x) => x.id !== asset.id) : [...prev, asset]));
  };

  const addFiles = (files: FileList | File[]) => {
    const list = Array.isArray(files) ? files : Array.from(files);
    const onlyImages = list.filter(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|heic|heif)$/i.test(f.name)
    );
    if (onlyImages.length === 0) {
      toast.error(t('media.picker.onlyImages', 'Please select image files'));
      return;
    }
    setUploadFiles((prev) => [...prev, ...onlyImages]);
  };

  const uploadMutation = useMutation({
    mutationFn: () =>
      MediaService.upload(uploadFiles, {
        folder: uploadFolder.trim() || undefined,
        tags: uploadTags.trim() || undefined,
      }),
    onSuccess: (res) => {
      const dupCount = res.results.filter((r) => r.duplicate).length;
      const okCount = res.success_count;
      const errCount = res.error_count;

      if (errCount > 0) toast.error(t('media.picker.uploadResultErrors', 'Uploaded {ok}, duplicates {dup}, errors {err}', { ok: okCount, dup: dupCount, err: errCount }));
      else toast.success(t('media.picker.uploadResultOk', 'Uploaded {ok} (duplicates {dup})', { ok: okCount, dup: dupCount }));

      const uploadedAssets = res.results.map((r) => r.asset).filter(Boolean) as MediaAsset[];
      if (uploadedAssets.length > 0) {
        if (!multiple) {
          setSelected([uploadedAssets[0]]);
        } else {
          setSelected((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const next = [...prev];
            for (const a of uploadedAssets) {
              if (!seen.has(a.id)) {
                next.push(a);
                seen.add(a.id);
              }
            }
            return next;
          });
        }
        setPage(1);
      }

      setUploadFiles([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.media.lists() });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, t('media.picker.uploadFailed', 'Failed to upload'))),
  });

  const confirm = () => {
    if (selected.length === 0) return;
    onSelect(selected);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={onClose} />

        <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px_auto_auto] gap-3 mb-4">
            <div className="flex-1">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('media.picker.search', 'Search...')}
                />
              </div>
            </div>
            <input
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setPage(1);
              }}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder={t('media.picker.folderFilter', 'Folder filter')}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.bmp,.tif,.tiff,.heic,.heif"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
                // allow selecting the same file twice
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50"
            >
              <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
              {t('media.picker.upload', 'Upload')}
            </button>
            <div className="text-sm text-gray-600">
              {t('media.picker.selected', 'Selected: {count}', { count: selected.length })}{' '}
            </div>
          </div>

          <div
            className={`mb-4 rounded-lg border-2 border-dashed p-4 ${
              isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50'
            }`}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm text-gray-700">
                <div className="font-medium">{t('media.picker.dropHint', 'Drag & drop images here')}</div>
                <div className="text-gray-500">
                  {t('media.picker.dropSub', 'Or click Upload to choose multiple files')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={uploadFiles.length === 0 || uploadMutation.isPending}
                  onClick={() => uploadMutation.mutate()}
                  className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
                  {uploadMutation.isPending ? t('media.picker.uploading', 'Uploading...') : t('media.picker.uploadNow', 'Upload Now')}
                </button>
                <button
                  type="button"
                  disabled={uploadFiles.length === 0 || uploadMutation.isPending}
                  onClick={() => setUploadFiles([])}
                  className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  title={t('media.picker.clearUpload', 'Clear')}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white"
                placeholder={t('media.picker.folder', 'Folder (optional)')}
              />
              <input
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white"
                placeholder={t('media.picker.tags', 'Tags (optional, comma-separated)')}
              />
            </div>

            {uploadFiles.length > 0 ? (
              <div className="mt-3 text-xs text-gray-600">
                {t('media.picker.filesReady', '{count} file(s) ready to upload', { count: uploadFiles.length })}
              </div>
            ) : null}
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="p-10 text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
                <p className="mt-3 text-gray-500 text-sm">{t('media.picker.loading', 'Loading...')}</p>
              </div>
            ) : items.length === 0 ? (
              <div className="p-10 text-center">
                <PhotoIcon className="h-10 w-10 text-gray-300 mx-auto" />
                <p className="mt-3 text-gray-500 text-sm">{t('media.picker.empty', 'No images found')}</p>
              </div>
            ) : (
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {items.map((asset) => {
                  const sel = isSelected(asset.id);
                  return (
                    <button
                      type="button"
                      key={asset.id}
                      onClick={() => toggle(asset)}
                      className={`text-left border rounded-lg overflow-hidden bg-white hover:border-gray-300 ${
                        sel ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200'
                      }`}
                      title={asset.original_name}
                    >
                      <div className="aspect-square bg-gray-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={asset.url} alt={asset.alt_text || asset.original_name} className="h-full w-full object-cover" loading="lazy" />
                      </div>
                      <div className="p-2">
                        <div className="text-xs font-medium text-gray-900 truncate">{asset.original_name}</div>
                        <div className="text-[11px] text-gray-500 truncate">{asset.folder ? `/${asset.folder}` : '—'}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {t('media.picker.total', 'Total: {total}', { total })}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-2 text-sm rounded-md border border-gray-200 disabled:opacity-50 hover:bg-gray-50"
              >
                {t('media.picker.prev', 'Prev')}
              </button>
              <div className="text-sm text-gray-700">
                {t('common.page', 'Page {page} / {pages}', { page, pages: totalPages })}
              </div>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-2 text-sm rounded-md border border-gray-200 disabled:opacity-50 hover:bg-gray-50"
              >
                {t('media.picker.next', 'Next')}
              </button>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50">
              {t('media.picker.cancel', 'Cancel')}
            </button>
            <button
              onClick={confirm}
              disabled={selected.length === 0}
              className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t('media.picker.useSelected', 'Use Selected')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
