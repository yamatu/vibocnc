'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowUpTrayIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  SparklesIcon,
  StarIcon,
  TrashIcon,
  XMarkIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';

import AdminLayout from '@/components/admin/AdminLayout';
import { CategoryService, MediaService, ProductService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import type { MediaAsset, MediaUploadResponse } from '@/services/media.service';
import type { Category } from '@/types';
import { useAdminI18n } from '@/lib/admin-i18n';

type MediaAssetUpdates = Partial<Pick<MediaAsset, 'folder' | 'tags' | 'title' | 'alt_text'>>;
type BatchUpdatePayload = { ids: number[]; folder?: string; tags?: string };

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

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

export default function AdminMediaPage() {
  const { locale, t } = useAdminI18n();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Watermark
  const [showWatermarkModal, setShowWatermarkModal] = useState(false);
  const [watermarkAssetId, setWatermarkAssetId] = useState<number | null>(null);
  const [watermarkTextSource, setWatermarkTextSource] = useState<'sku' | 'custom'>('sku');
  const [watermarkSku, setWatermarkSku] = useState('');
  const [watermarkText, setWatermarkText] = useState('');
  const [watermarkPosition, setWatermarkPosition] = useState<string>('bottom-right');

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadFolder, setUploadFolder] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showBatchEditModal, setShowBatchEditModal] = useState(false);
  const [batchFolder, setBatchFolder] = useState('');
  const [batchTags, setBatchTags] = useState('');
  const [applyBrand, setApplyBrand] = useState('fanuc');
  const [applyCategoryId, setApplyCategoryId] = useState('');
  const [applyMode, setApplyMode] = useState<'fill_empty' | 'replace_all'>('fill_empty');

  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAlt, setEditAlt] = useState('');
  const [editFolder, setEditFolder] = useState('');
  const [editTags, setEditTags] = useState('');

  const q = useDeferredValue(searchInput.trim());
  const folder = useDeferredValue(folderInput.trim());

  useEffect(() => {
    setPage(1);
  }, [q, folder]);

  const filters = useMemo(() => ({ q, folder, page, pageSize }), [q, folder, page, pageSize]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.media.list(filters),
    queryFn: () =>
      MediaService.list({
        q: q || undefined,
        folder: folder || undefined,
        page,
        page_size: pageSize,
      }),
    placeholderData: previousData => previousData,
    retry: 1,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const singleSelectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  const { data: watermarkSettings } = useQuery({
    queryKey: queryKeys.media.watermarkSettings(),
    queryFn: () => MediaService.getWatermarkSettings(),
    retry: 1,
  });

  const { data: categoriesData = [] } = useQuery({
    queryKey: queryKeys.categories.lists(),
    queryFn: () => CategoryService.getAdminCategories(),
  });
  const categories = Array.isArray(categoriesData) ? (categoriesData as Category[]) : [];

  useEffect(() => {
    // If filters changed and current page is out of range, reset.
    if (page > totalPages) setPage(1);
  }, [q, folder, page, pageSize, totalPages]);

  const uploadMutation = useMutation({
    mutationFn: () => MediaService.upload(uploadFiles, { folder: uploadFolder.trim() || undefined, tags: uploadTags.trim() || undefined }),
    onSuccess: (res: MediaUploadResponse) => {
      const dupCount = res.results.filter(r => r.duplicate).length;
      const okCount = res.success_count;
      const errCount = res.error_count;
      if (errCount > 0) {
        toast.error(
			t(
				'media.toast.uploadResultErrors',
				locale === 'zh'
					? `上传 ${okCount} 个（重复 ${dupCount}），失败 ${errCount}`
					: `Uploaded ${okCount}, duplicates ${dupCount}, errors ${errCount}`
			)
		);
      } else {
        toast.success(
			t(
				'media.toast.uploadResultOk',
				locale === 'zh' ? `上传 ${okCount} 个（重复 ${dupCount}）` : `Uploaded ${okCount} (duplicates ${dupCount})`
			)
		);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.media.lists() });
      setUploadFiles([]);
      setUploadFolder('');
      setUploadTags('');
      setShowUploadModal(false);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, t('media.toast.uploadFailed', locale === 'zh' ? '上传失败' : 'Failed to upload'))),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => MediaService.batchDelete(ids),
    onSuccess: () => {
      toast.success(t('media.toast.deleted', locale === 'zh' ? '删除成功' : 'Deleted successfully'));
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.media.lists() });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, t('media.toast.deleteFailed', locale === 'zh' ? '删除失败' : 'Failed to delete'))),
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (payload: BatchUpdatePayload) =>
      MediaService.batchUpdate(payload.ids, {
        folder: payload.folder,
        tags: payload.tags,
      }),
    onSuccess: () => {
      toast.success(t('media.toast.updated', locale === 'zh' ? '更新成功' : 'Updated successfully'));
      setSelectedIds([]);
      setShowBatchEditModal(false);
      setBatchFolder('');
      setBatchTags('');
      queryClient.invalidateQueries({ queryKey: queryKeys.media.lists() });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, t('media.toast.updateFailed', locale === 'zh' ? '更新失败' : 'Failed to update'))),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; updates: MediaAssetUpdates }) => MediaService.update(payload.id, payload.updates),
    onSuccess: () => {
      toast.success(t('common.save', locale === 'zh' ? '保存' : 'Saved'));
      setEditingAsset(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.media.lists() });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, t('common.saveFailed', locale === 'zh' ? '保存失败' : 'Failed to save'))),
  });

  const watermarkSettingsMutation = useMutation({
    mutationFn: (payload: { enabled?: boolean; watermark_position?: string; base_media_asset_id?: number | null }) =>
      MediaService.updateWatermarkSettings(payload),
    onSuccess: () => {
      toast.success(t('media.toast.watermarkSettingsUpdated', locale === 'zh' ? '水印设置已更新' : 'Watermark settings updated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.media.watermarkSettings() });
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, t('media.toast.watermarkSettingsUpdateFailed', locale === 'zh' ? '更新水印设置失败' : 'Failed to update watermark settings'))),
  });

  const watermarkMutation = useMutation({
    mutationFn: (payload: { asset_id: number; text_source: 'sku' | 'custom'; sku?: string; text?: string }) =>
      MediaService.watermarkAsset(payload),
    onSuccess: (asset) => {
      toast.success(t('media.toast.watermarkedCreated', locale === 'zh' ? '水印图片已生成' : 'Watermarked image created'));
      setShowWatermarkModal(false);
      setWatermarkAssetId(null);
      setWatermarkSku('');
      setWatermarkText('');
      queryClient.invalidateQueries({ queryKey: queryKeys.media.lists() });
      // Optional: auto-select the new asset
      setSelectedIds([asset.id]);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, t('media.toast.watermarkFailed', locale === 'zh' ? '生成水印失败' : 'Failed to watermark image'))),
  });

  const bulkCategoryImageMutation = useMutation({
    mutationFn: (payload: { media_asset_id: number; brand?: string; category_id?: string; apply_mode?: 'fill_empty' | 'replace_all'; batch_size?: number }) =>
      ProductService.bulkApplyCategoryImage(payload),
    onSuccess: (data) => {
      toast.success(
        t(
          'media.toast.categoryImageApplied',
          locale === 'zh'
            ? `批量换图完成：更新 ${data.updated}，跳过 ${data.skipped}`
            : `Batch image replacement completed: ${data.updated} updated, ${data.skipped} skipped`
        )
      );
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, t('media.toast.categoryImageApplyFailed', locale === 'zh' ? '批量换图失败' : 'Failed to apply image to products'))),
  });

  const toggleSelected = (id: number) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const selectAllOnPage = () => {
    const ids = items.map(i => i.id);
    setSelectedIds(prev => {
      const set = new Set(prev);
      for (const id of ids) set.add(id);
      return Array.from(set);
    });
  };

  const clearSelection = () => setSelectedIds([]);

  const addFiles = (files: FileList | File[]) => {
    const list = Array.isArray(files) ? files : Array.from(files);
    const onlyImages = list.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|heic|heif)$/i.test(f.name));
    if (onlyImages.length === 0) {
      toast.error(t('media.toast.onlyImages', locale === 'zh' ? '请选择图片文件' : 'Please select image files'));
      return;
    }
    setUploadFiles(prev => [...prev, ...onlyImages]);
  };

  const openEdit = (asset: MediaAsset) => {
    setEditingAsset(asset);
    setEditTitle(asset.title || '');
    setEditAlt(asset.alt_text || '');
    setEditFolder(asset.folder || '');
    setEditTags(asset.tags || '');
  };

  const canBatch = selectedIds.length > 0;

  if (isLoading && !data) {
    return (
      <AdminLayout>
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  if (error && !data) {
    return (
      <AdminLayout>
        <div className="text-center py-20">
          <div className="text-red-600 mb-4">
            {t(
              'media.error.load',
              locale === 'zh' ? '加载媒体失败：{message}' : 'Error loading media: {message}',
              { message: error instanceof Error ? error.message : t('common.unknownError', locale === 'zh' ? '未知错误' : 'Unknown error') }
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold"
          >
            {t('common.retry', locale === 'zh' ? '重试' : 'Retry')}
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('nav.media', 'Media Library')}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {t('media.subtitle', locale === 'zh' ? '上传并管理图片（按 SHA-256 去重）' : 'Upload and manage images (deduplicated by SHA-256)')}
            </p>
          </div>
          <button
            onClick={() => setShowUploadModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
            {t('media.upload', locale === 'zh' ? '上传图片' : 'Upload Images')}
          </button>
        </div>

        {/* Watermark Settings */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{t('media.watermark.defaultTitle', locale === 'zh' ? '默认产品图片（水印）' : 'Default Product Image (Watermark)')}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {t(
                  'media.watermark.defaultDesc',
                  locale === 'zh'
                    ? '当产品没有图片时使用。系统会根据产品 SKU 生成带水印的默认图片。'
                    : 'Used when a product has no images. The system generates a watermarked fallback image using the product SKU.'
                )}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={Boolean(watermarkSettings?.enabled)}
                onChange={(e) => watermarkSettingsMutation.mutate({ enabled: e.target.checked })}
                className="h-4 w-4"
              />
              {t('common.enable', locale === 'zh' ? '启用' : 'Enable')}
            </label>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 rounded-md border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
                {watermarkSettings?.base_media_asset?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={watermarkSettings.base_media_asset.url} alt="Base" className="h-full w-full object-cover" />
                ) : (
                  <PhotoIcon className="h-8 w-8 text-gray-300" />
                )}
              </div>
              <div>
                 <div className="text-sm font-medium text-gray-900">{t('media.watermark.base', locale === 'zh' ? '底图' : 'Base image')}</div>
                 <div className="text-xs text-gray-500">
                  {watermarkSettings?.base_media_asset?.original_name || t('common.notSet', locale === 'zh' ? '未设置' : 'Not set')}
                 </div>
               </div>
             </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!singleSelectedId || watermarkSettingsMutation.isPending}
                onClick={() => watermarkSettingsMutation.mutate({ base_media_asset_id: singleSelectedId })}
                className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                title={singleSelectedId ? 'Use the selected media item as base image' : 'Select exactly 1 media item to set as base'}
              >
                <StarIcon className="h-4 w-4 mr-2" />
                {t('media.watermark.setBase', locale === 'zh' ? '设为底图' : 'Set Selected As Base')}
              </button>
              <button
                type="button"
                disabled={!watermarkSettings?.base_media_asset_id || watermarkSettingsMutation.isPending}
                onClick={() => watermarkSettingsMutation.mutate({ base_media_asset_id: 0 })}
                className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                <XMarkIcon className="h-4 w-4 mr-2" />
                {t('media.watermark.clearBase', locale === 'zh' ? '清除底图' : 'Clear Base')}
              </button>
              <div className="text-xs text-gray-500">
                {t('media.watermark.tip', locale === 'zh' ? '提示：先在网格中选择一张图片，然后点击“设为底图”。' : 'Tip: select an image in the grid, then click “Set Selected As Base”.')}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="w-full sm:w-72">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.watermark.position', locale === 'zh' ? '水印位置' : 'Watermark position')}</label>
              <select
                value={watermarkSettings?.watermark_position || 'bottom-right'}
                onChange={(e) => watermarkSettingsMutation.mutate({ watermark_position: e.target.value })}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="bottom-right">{t('media.pos.br', locale === 'zh' ? '右下' : 'Bottom right')}</option>
                <option value="center">{t('media.pos.center', locale === 'zh' ? '居中' : 'Center')}</option>
                <option value="bottom-left">{t('media.pos.bl', locale === 'zh' ? '左下' : 'Bottom left')}</option>
                <option value="top-left">{t('media.pos.tl', locale === 'zh' ? '左上' : 'Top left')}</option>
                <option value="top-right">{t('media.pos.tr', locale === 'zh' ? '右上' : 'Top right')}</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {t('media.watermark.positionHint', locale === 'zh' ? '此设置会影响默认图片以及生成的水印副本。' : 'This affects both default images and generated watermark copies.')}
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.search', locale === 'zh' ? '搜索' : 'Search')}</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('media.searchPh', locale === 'zh' ? '文件名 / 哈希 / 标题...' : 'filename / hash / title...')}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.folder', locale === 'zh' ? '文件夹' : 'Folder')}</label>
              <input
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
				placeholder={t('media.folder.ph', locale === 'zh' ? '例如：homepage' : 'e.g. homepage')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.pageSize', locale === 'zh' ? '每页数量' : 'Page Size')}</label>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                {[12, 24, 48, 96].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{t('media.bulkImage.title', locale === 'zh' ? '按品牌/分类批量替换产品图' : 'Bulk Replace Product Images by Brand/Category')}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {t(
                  'media.bulkImage.desc',
                  locale === 'zh'
                    ? '先在图库网格中选择 1 张图片，再按品牌和分类批量应用到产品。支持只补空图，或直接覆盖现有产品图。'
                    : 'Select exactly one image in the media grid, then apply it to products by brand/category. You can fill empty images only or replace all existing images.'
                )}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.import.brand', locale === 'zh' ? '品牌' : 'Brand')}</label>
                <select
                  value={applyBrand}
                  onChange={(e) => setApplyBrand(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="fanuc">FANUC</option>
                  <option value="mitsubishi">Mitsubishi</option>
                  <option value="siemens">Siemens</option>
                  <option value="abb">ABB</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.field.category', locale === 'zh' ? '分类' : 'Category')}</label>
                <select
                  value={applyCategoryId}
                  onChange={(e) => setApplyCategoryId(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="">{t('products.page.allCategories', locale === 'zh' ? '全部分类' : 'All Categories')}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.bulkImage.mode', locale === 'zh' ? '换图模式' : 'Apply Mode')}</label>
                <select
                  value={applyMode}
                  onChange={(e) => setApplyMode(e.target.value === 'replace_all' ? 'replace_all' : 'fill_empty')}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="fill_empty">{t('products.bulk.imageModeFill', locale === 'zh' ? '只补空图' : 'Fill Empty Only')}</option>
                  <option value="replace_all">{t('products.bulk.imageModeReplace', locale === 'zh' ? '全部覆盖' : 'Replace All')}</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={!singleSelectedId || bulkCategoryImageMutation.isPending}
                  onClick={() => {
                    if (!singleSelectedId) {
                      toast.error(t('media.bulkImage.needOne', locale === 'zh' ? '请先在网格中选择 1 张图片' : 'Select exactly one image first'));
                      return;
                    }
                    bulkCategoryImageMutation.mutate({
                      media_asset_id: singleSelectedId,
                      brand: applyBrand || undefined,
                      category_id: applyCategoryId || undefined,
                      apply_mode: applyMode,
                      batch_size: 500,
                    });
                  }}
                  className="inline-flex items-center justify-center w-full px-4 py-2 text-sm rounded-md bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-50"
                >
                  <PhotoIcon className="h-4 w-4 mr-2" />
                  {bulkCategoryImageMutation.isPending
                    ? t('common.processing', locale === 'zh' ? '处理中...' : 'Processing...')
                    : t('media.bulkImage.apply', locale === 'zh' ? '批量应用到产品' : 'Apply to Products')}
                </button>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {singleSelectedId
                ? t('media.bulkImage.selected', locale === 'zh' ? `当前已选择图片 ID：${singleSelectedId}` : `Selected image ID: ${singleSelectedId}`)
                : t('media.bulkImage.notSelected', locale === 'zh' ? '当前未选择图片，按钮将不可用。' : 'No image selected yet, so the action is disabled.')}
            </div>
          </div>
        </div>

        {/* Batch actions */}
        {canBatch && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
            <div className="text-sm text-blue-800">
				{t('common.selected', locale === 'zh' ? '已选择' : 'Selected')}: <span className="font-semibold">{selectedIds.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
				onClick={() => {
					selectAllOnPage();
					toast.success(t('media.toast.selectedPage', locale === 'zh' ? '已选择本页全部项目' : 'Selected all items on this page'));
				}}
                className="px-3 py-2 text-sm rounded-md border border-blue-200 text-blue-700 hover:bg-blue-100"
              >
				{t('common.selectPage', locale === 'zh' ? '选择本页' : 'Select Page')}
              </button>
              <button
                onClick={() => setShowBatchEditModal(true)}
                className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-white border border-gray-200 hover:bg-gray-50"
              >
                <PencilIcon className="h-4 w-4 mr-1" />
				{t('common.batchEdit', locale === 'zh' ? '批量编辑' : 'Batch Edit')}
              </button>
				{selectedIds.length === 1 && (
					<button
						onClick={() => {
							setWatermarkAssetId(selectedIds[0]);
							setWatermarkTextSource('sku');
							setWatermarkSku('');
							setWatermarkText('');
							setWatermarkPosition(watermarkSettings?.watermark_position || 'bottom-right');
							setShowWatermarkModal(true);
						}}
						className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-white border border-gray-200 hover:bg-gray-50"
						title={t('media.watermark.title', locale === 'zh' ? '生成水印副本' : 'Create a watermarked copy')}
					>
						<SparklesIcon className="h-4 w-4 mr-1" />
						{t('media.watermark', locale === 'zh' ? '水印' : 'Watermark')}
					</button>
				)}
              <button
                onClick={() => {
                  if (
                    !window.confirm(
                      t(
                        'media.confirm.deleteSelected',
                        locale === 'zh' ? '确定要删除 {count} 个项目吗？此操作不可撤销。' : 'Delete {count} item(s)? This cannot be undone.',
                        { count: selectedIds.length }
                      )
                    )
                  )
                    return;
                  batchDeleteMutation.mutate(selectedIds);
                }}
                className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                <TrashIcon className="h-4 w-4 mr-1" />
                {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
              </button>
              <button
                onClick={clearSelection}
                className="px-3 py-2 text-sm rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                {t('common.clear', locale === 'zh' ? '清空' : 'Clear')}
              </button>
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="bg-white shadow rounded-lg p-6">
          {items.length === 0 ? (
            <div className="text-center py-16">
              <PhotoIcon className="mx-auto h-12 w-12 text-gray-300" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">{t('media.empty', locale === 'zh' ? '没有找到媒体文件' : 'No media found')}</h3>
              <p className="mt-1 text-sm text-gray-500">{t('media.emptyHint', locale === 'zh' ? '上传图片以建立你的媒体库。' : 'Upload images to build your media library.')}</p>
              <div className="mt-6">
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                >
                  <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
                  {t('media.upload', locale === 'zh' ? '上传图片' : 'Upload Images')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {items.map((asset) => {
                  const selected = selectedIds.includes(asset.id);
                  return (
                    <div
                      key={asset.id}
                      className={`group relative border rounded-lg overflow-hidden bg-white ${selected ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSelected(asset.id)}
                        className="absolute top-2 left-2 z-10 h-5 w-5 rounded bg-white/90 border border-gray-300 flex items-center justify-center"
							aria-label={t('common.select', locale === 'zh' ? '选择' : 'Select')}
                      >
                        {selected ? <span className="h-3 w-3 bg-blue-600 rounded-sm" /> : null}
                      </button>

                      <button
                        type="button"
                        onClick={() => openEdit(asset)}
                        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 rounded bg-white/90 border border-gray-200 flex items-center justify-center hover:bg-white"
							aria-label={t('common.edit', locale === 'zh' ? '编辑' : 'Edit')}
                      >
                        <PencilIcon className="h-4 w-4 text-gray-700" />
                      </button>

                      <div className="aspect-square bg-gray-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.url}
                          alt={asset.alt_text || asset.original_name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="p-2">
                        <div className="text-xs font-medium text-gray-900 truncate" title={asset.original_name}>
                          {asset.original_name}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate" title={asset.folder || ''}>
                          {asset.folder ? `/${asset.folder}` : '—'}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center justify-between">
                          <span title={asset.sha256}>{asset.sha256.slice(0, 8)}…</span>
                          <span>{formatBytes(asset.size_bytes)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              <div className="mt-6 flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {t('common.total', locale === 'zh' ? '总计：' : 'Total:')} <span className="font-medium">{total}</span>
                    {isFetching ? (
                      <span className="ml-2 text-xs text-gray-400">
                        {t('common.loading', locale === 'zh' ? '加载中...' : 'Loading...')}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-3 py-2 text-sm rounded-md border border-gray-200 disabled:opacity-50 hover:bg-gray-50"
                  >
                    {t('common.prev', locale === 'zh' ? '上一页' : 'Prev')}
                  </button>
                  <div className="text-sm text-gray-700">
                    {t('common.page', locale === 'zh' ? '第 {page} 页 / 共 {pages} 页' : 'Page {page} / {pages}', { page, pages: totalPages })}
                  </div>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="px-3 py-2 text-sm rounded-md border border-gray-200 disabled:opacity-50 hover:bg-gray-50"
                  >
                    {t('common.next', locale === 'zh' ? '下一页' : 'Next')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Watermark Modal */}
      {showWatermarkModal && watermarkAssetId && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => !watermarkMutation.isPending && setShowWatermarkModal(false)} />
            <div className="relative bg-white rounded-lg shadow-xl max-w-xl w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">{t('media.watermark.modalTitle', locale === 'zh' ? '生成水印副本' : 'Create Watermarked Copy')}</h3>
                <button
                  onClick={() => setShowWatermarkModal(false)}
                  disabled={watermarkMutation.isPending}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="text-sm text-gray-600">
                  {t('media.watermark.selectedId', locale === 'zh' ? '已选择资源 ID：' : 'Selected asset ID:')}{' '}
                  <span className="font-mono">{watermarkAssetId}</span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.watermark.textSource', locale === 'zh' ? '水印文字来源' : 'Text source')}</label>
                  <select
                    value={watermarkTextSource}
                    onChange={(e) => setWatermarkTextSource(e.target.value === 'custom' ? 'custom' : 'sku')}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="sku">{t('media.watermark.fromSku', locale === 'zh' ? '使用 SKU' : 'From SKU')}</option>
                    <option value="custom">{t('media.watermark.customText', locale === 'zh' ? '自定义' : 'Custom text')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.watermark.position', locale === 'zh' ? '水印位置' : 'Position')}</label>
                  <select
                    value={watermarkPosition}
                    onChange={(e) => setWatermarkPosition(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="bottom-right">{t('media.pos.br', locale === 'zh' ? '右下' : 'Bottom right')}</option>
                    <option value="center">{t('media.pos.center', locale === 'zh' ? '居中' : 'Center')}</option>
                    <option value="bottom-left">{t('media.pos.bl', locale === 'zh' ? '左下' : 'Bottom left')}</option>
                    <option value="top-left">{t('media.pos.tl', locale === 'zh' ? '左上' : 'Top left')}</option>
                    <option value="top-right">{t('media.pos.tr', locale === 'zh' ? '右上' : 'Top right')}</option>
                  </select>
                </div>

                {watermarkTextSource === 'sku' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                    <input
                      value={watermarkSku}
                      onChange={(e) => setWatermarkSku(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder={t('media.watermark.skuPh', locale === 'zh' ? '例如：A02B-0120-C041' : 'e.g. A02B-0120-C041')}
                    />
                    <p className="mt-1 text-xs text-gray-500">{t('media.watermark.skuHint', locale === 'zh' ? '系统会使用该 SKU 作为水印文字。' : 'We will use this SKU as watermark text.')}</p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.watermark.text', locale === 'zh' ? '水印文字' : 'Text')}</label>
                    <input
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder={t('media.watermark.textPh', locale === 'zh' ? '例如：Vcocnc' : 'e.g. Vcocnc')}
                    />
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowWatermarkModal(false)}
                    disabled={watermarkMutation.isPending}
                    className="px-4 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {t('common.cancel', locale === 'zh' ? '取消' : 'Cancel')}
                  </button>
                  <button
                    onClick={() => {
                      if (!watermarkAssetId) return;
                      watermarkMutation.mutate({
                        asset_id: watermarkAssetId,
                        text_source: watermarkTextSource,
                        sku: watermarkSku,
                        text: watermarkText,
                        watermark_position: watermarkPosition,
                      });
                    }}
                    disabled={
                      watermarkMutation.isPending ||
                      (watermarkTextSource === 'sku' ? !watermarkSku.trim() : !watermarkText.trim())
                    }
                    className="inline-flex items-center px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <SparklesIcon className="h-4 w-4 mr-2" />
                    {watermarkMutation.isPending
                      ? t('media.watermark.generating', locale === 'zh' ? '生成中...' : 'Generating...')
                      : t('media.watermark.generate', locale === 'zh' ? '生成' : 'Generate')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => !uploadMutation.isPending && setShowUploadModal(false)} />
            <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">{t('media.upload', locale === 'zh' ? '上传图片' : 'Upload Images')}</h3>
                <button
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploadMutation.isPending}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.folder.optional', locale === 'zh' ? '文件夹（可选）' : 'Folder (optional)')}</label>
                    <input
                    type="text"
                    value={uploadFolder}
                    onChange={(e) => setUploadFolder(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('media.folder.ph', locale === 'zh' ? '例如：homepage' : 'e.g. homepage')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.tags.optional', locale === 'zh' ? '标签（可选）' : 'Tags (optional)')}</label>
                    <input
                    type="text"
                    value={uploadTags}
                    onChange={(e) => setUploadTags(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('media.tags.ph', locale === 'zh' ? '逗号分隔' : 'comma-separated')}
                    />
                  </div>
                </div>

              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'
                }`}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    addFiles(e.dataTransfer.files);
                  }
                }}
              >
                <PhotoIcon className="mx-auto h-10 w-10 text-gray-300" />
                <p className="mt-2 text-sm text-gray-700">{t('media.upload.drop', locale === 'zh' ? '拖拽图片到此处' : 'Drag & drop images here')}</p>
                <p className="mt-1 text-xs text-gray-500">{t('common.or', locale === 'zh' ? '或' : 'or')}</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 inline-flex items-center px-4 py-2 text-sm rounded-md bg-white border border-gray-200 hover:bg-gray-50"
                >
                  {t('media.upload.chooseFiles', locale === 'zh' ? '选择文件' : 'Choose Files')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    // allow re-select same file
                    e.currentTarget.value = '';
                  }}
                />
              </div>

                {uploadFiles.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-gray-900">
                        {t('media.upload.selectedFiles', locale === 'zh' ? '已选择文件' : 'Selected Files')} ({uploadFiles.length})
                      </div>
                      <button
                      type="button"
                      onClick={() => setUploadFiles([])}
                      className="text-sm text-gray-600 hover:text-gray-900"
                    >
                      {t('common.clear', locale === 'zh' ? '清空' : 'Clear')}
                    </button>
                  </div>
                  <div className="max-h-44 overflow-auto border border-gray-200 rounded-md">
                    {uploadFiles.map((f, idx) => (
                      <div key={`${f.name}-${idx}`} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-b-0">
                        <div className="min-w-0">
                          <div className="truncate text-gray-900">{f.name}</div>
                          <div className="text-xs text-gray-500">{formatBytes(f.size)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setUploadFiles(prev => prev.filter((_, i) => i !== idx))}
                          className="ml-3 text-gray-400 hover:text-gray-600"
                        >
                          <XMarkIcon className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploadMutation.isPending}
                  className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('common.cancel', locale === 'zh' ? '取消' : 'Cancel')}
                </button>
                <button
                  onClick={() => {
                    if (uploadFiles.length === 0) {
                      toast.error(t('media.toast.selectOne', locale === 'zh' ? '请至少选择一张图片' : 'Please select at least one image'));
                      return;
                    }
                    uploadMutation.mutate();
                  }}
                  disabled={uploadMutation.isPending}
                  className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
                  {uploadMutation.isPending
						? t('media.uploading', locale === 'zh' ? '上传中...' : 'Uploading...')
						: t('media.upload', locale === 'zh' ? '上传' : 'Upload')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Edit Modal */}
      {showBatchEditModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => !batchUpdateMutation.isPending && setShowBatchEditModal(false)} />
            <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">{t('common.batchEdit', locale === 'zh' ? '批量编辑' : 'Batch Edit')} ({selectedIds.length})</h3>
                <button
                  onClick={() => setShowBatchEditModal(false)}
                  disabled={batchUpdateMutation.isPending}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.folder', locale === 'zh' ? '文件夹' : 'Folder')}</label>
                  <input
                    type="text"
                    value={batchFolder}
                    onChange={(e) => setBatchFolder(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('common.leaveEmptyKeep', locale === 'zh' ? '留空则不修改' : 'leave empty to keep unchanged')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.tags', locale === 'zh' ? '标签' : 'Tags')}</label>
                  <input
                    type="text"
                    value={batchTags}
                    onChange={(e) => setBatchTags(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('common.leaveEmptyKeep', locale === 'zh' ? '留空则不修改' : 'leave empty to keep unchanged')}
                  />
                </div>
                <p className="text-xs text-gray-500">{t('media.batch.hint', locale === 'zh' ? '仅会把非空字段应用到所有已选项目。' : 'Only non-empty fields will be applied to all selected items.')}</p>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowBatchEditModal(false)}
                  disabled={batchUpdateMutation.isPending}
                  className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('common.cancel', locale === 'zh' ? '取消' : 'Cancel')}
                </button>
                <button
                  onClick={() => {
                    const payload: BatchUpdatePayload = { ids: selectedIds };
                    if (batchFolder.trim()) payload.folder = batchFolder.trim();
                    if (batchTags.trim()) payload.tags = batchTags.trim();
                    if (!payload.folder && !payload.tags) {
                      toast.error(t('media.toast.setOneField', locale === 'zh' ? '请至少填写一个字段' : 'Please set at least one field'));
                      return;
                    }
                    batchUpdateMutation.mutate(payload);
                  }}
                  disabled={batchUpdateMutation.isPending}
                  className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <PencilIcon className="h-4 w-4 mr-2" />
                  {batchUpdateMutation.isPending
						? t('common.saving', locale === 'zh' ? '保存中...' : 'Saving...')
						: t('common.save', locale === 'zh' ? '保存' : 'Save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single Edit Modal */}
      {editingAsset && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => !updateMutation.isPending && setEditingAsset(null)} />
            <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">{t('media.edit', locale === 'zh' ? '编辑媒体' : 'Edit Media')}</h3>
                <button
                  onClick={() => setEditingAsset(null)}
                  disabled={updateMutation.isPending}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="border rounded-lg overflow-hidden bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={editingAsset.url} alt={editingAsset.alt_text || editingAsset.original_name} className="w-full h-auto" />
                </div>
                <div className="space-y-4">
                  <div className="text-sm">
                    <div className="text-gray-900 font-medium truncate" title={editingAsset.original_name}>{editingAsset.original_name}</div>
                    <div className="text-xs text-gray-500 mt-1">SHA256: <span className="font-mono">{editingAsset.sha256}</span></div>
                    <div className="text-xs text-gray-500">{t('media.size', locale === 'zh' ? '大小：' : 'Size:')} {formatBytes(editingAsset.size_bytes)}</div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.title', locale === 'zh' ? '标题' : 'Title')}</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.altText', locale === 'zh' ? '替代文本' : 'Alt Text')}</label>
                    <input
                      type="text"
                      value={editAlt}
                      onChange={(e) => setEditAlt(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.folder', locale === 'zh' ? '文件夹' : 'Folder')}</label>
                    <input
                      type="text"
                      value={editFolder}
                      onChange={(e) => setEditFolder(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('media.tags', locale === 'zh' ? '标签' : 'Tags')}</label>
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-between">
                  <button
                    onClick={() => {
                      if (!window.confirm(t('media.confirm.deleteOne', locale === 'zh' ? '确定要删除该媒体文件吗？此操作不可撤销。' : 'Delete this media item? This cannot be undone.'))) return;
                      batchDeleteMutation.mutate([editingAsset.id]);
                      setEditingAsset(null);
                    }}
                  disabled={updateMutation.isPending || batchDeleteMutation.isPending}
                  className="inline-flex items-center px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  <TrashIcon className="h-4 w-4 mr-2" />
                  {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingAsset(null)}
                    disabled={updateMutation.isPending}
                    className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {t('common.cancel', locale === 'zh' ? '取消' : 'Cancel')}
                  </button>
                  <button
                    onClick={() => {
                      updateMutation.mutate({
                        id: editingAsset.id,
                        updates: {
                          title: editTitle,
                          alt_text: editAlt,
                          folder: editFolder,
                          tags: editTags,
                        },
                      });
                    }}
                    disabled={updateMutation.isPending}
                    className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <PencilIcon className="h-4 w-4 mr-2" />
                    {updateMutation.isPending
                      ? t('common.saving', locale === 'zh' ? '保存中...' : 'Saving...')
                      : t('common.save', locale === 'zh' ? '保存' : 'Save')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
