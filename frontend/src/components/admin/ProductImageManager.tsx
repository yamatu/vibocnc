'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  LinkIcon,
  PhotoIcon,
  StarIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import MediaPickerModal from '@/components/admin/MediaPickerModal';
import { useAdminI18n } from '@/lib/admin-i18n';
import { queryKeys } from '@/lib/react-query';
import { MediaService } from '@/services';

export type ManagedProductImage = {
  url: string;
  alt_text?: string;
  is_primary?: boolean;
  sort_order?: number;
  media_asset_id?: number;
  source?: 'media' | 'admin_external' | 'archive';
};

type Props = {
  images: ManagedProductImage[];
  onChange: (images: ManagedProductImage[]) => void;
  sku?: string;
};

function normalizeImages(images: ManagedProductImage[]) {
  return images.map((image, index) => ({
    ...image,
    sort_order: index,
    is_primary: index === 0,
  }));
}

function skuFolder(sku?: string) {
  const clean = String(sku || '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean ? `products/${clean}` : 'products/unassigned';
}

function isValidImageUrl(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('/')) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ProductImageManager({ images, onChange, sku }: Props) {
  const { locale } = useAdminI18n();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const [showPicker, setShowPicker] = useState(false);
  const [showUrls, setShowUrls] = useState(false);
  const [urlText, setUrlText] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const folder = useMemo(() => skuFolder(sku), [sku]);

  const appendImages = (incoming: ManagedProductImage[]) => {
    const current = imagesRef.current;
    const seen = new Set(current.map((image) => image.url));
    const additions = incoming.filter((image) => {
      if (!image.url || seen.has(image.url)) return false;
      seen.add(image.url);
      return true;
    });
    onChange(normalizeImages([...current, ...additions]));
  };

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => MediaService.upload(files, { folder, tags: sku ? `product,${sku}` : 'product' }),
    onSuccess: (response) => {
      const assets = response.results.map((item) => item.asset).filter(Boolean);
      appendImages(
        assets.map((asset) => ({
          url: asset!.url,
          alt_text: asset!.alt_text || sku || asset!.original_name,
          media_asset_id: asset!.id,
          source: 'media',
        }))
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.media.lists() });
      const failed = response.error_count;
      toast.success(
        locale === 'zh'
          ? `已上传并同步到图库 ${response.success_count} 张${failed ? `，失败 ${failed} 张` : ''}`
          : `Uploaded and synced ${response.success_count} image(s)${failed ? `; ${failed} failed` : ''}`
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : locale === 'zh' ? '图片上传失败' : 'Image upload failed'),
  });

  const rotateMutation = useMutation({
    mutationFn: ({ image, degrees }: { image: ManagedProductImage; degrees: 90 | 180 | 270 }) =>
      MediaService.rotate({ asset_id: image.media_asset_id, url: image.url, folder, degrees }),
    onSuccess: (asset, variables) => {
      const index = images.findIndex((image) => image === variables.image || image.url === variables.image.url);
      if (index < 0) return;
      const next = [...images];
      next[index] = {
        ...next[index],
        url: asset.url,
        media_asset_id: asset.id,
        alt_text: next[index].alt_text || asset.alt_text,
      };
      onChange(normalizeImages(next));
      queryClient.invalidateQueries({ queryKey: queryKeys.media.lists() });
      toast.success(locale === 'zh' ? '已生成旋转后的图库图片' : 'Rotated image saved to the media library');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : locale === 'zh' ? '图片旋转失败' : 'Failed to rotate image'),
  });

  const addFiles = (files: FileList | File[]) => {
    if (!String(sku || '').trim()) {
      toast.error(locale === 'zh' ? '请先填写 SKU，再上传图片以便自动匹配图库目录' : 'Enter the SKU before uploading so the media folder can be matched');
      return;
    }
    const list = Array.isArray(files) ? files : Array.from(files);
    const imageFiles = list.filter(
      (file) => file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name)
    );
    if (!imageFiles.length) {
      toast.error(locale === 'zh' ? '请拖入、粘贴或选择图片文件' : 'Please add image files');
      return;
    }
    uploadMutation.mutate(imageFiles);
  };

  const importUrls = () => {
    const urls = urlText
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const invalid = urls.filter((url) => !isValidImageUrl(url));
    if (!urls.length || invalid.length) {
      toast.error(
        locale === 'zh'
          ? invalid.length
            ? `发现 ${invalid.length} 个无效图片链接`
            : '请输入图片链接'
          : invalid.length
            ? `${invalid.length} invalid image URL(s)`
            : 'Enter image URLs'
      );
      return;
    }
    appendImages(urls.map((url) => ({ url, alt_text: sku || '', source: 'admin_external' })));
    setUrlText('');
    setShowUrls(false);
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(normalizeImages(next));
  };

  const remove = (index: number) => {
    onChange(normalizeImages(images.filter((_, imageIndex) => imageIndex !== index)));
    if (previewIndex === index) setPreviewIndex(null);
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">{locale === 'zh' ? '产品图片' : 'Product Images'}</h3>
          <p className="mt-1 text-xs text-gray-500">
            {locale === 'zh'
              ? `图片完整显示；上传内容自动同步到图库目录 /${folder}`
              : `Images use fit-to-frame display. Uploads sync to /${folder}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700">
            <ArrowUpTrayIcon className="mr-1 h-4 w-4" />
            {locale === 'zh' ? '上传图片' : 'Upload'}
          </button>
          <button type="button" onClick={() => setShowPicker(true)} className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <PhotoIcon className="mr-1 h-4 w-4" />
            {locale === 'zh' ? '从图库选择' : 'Media Library'}
          </button>
          <button type="button" onClick={() => setShowUrls((value) => !value)} className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <LinkIcon className="mr-1 h-4 w-4" />
            {locale === 'zh' ? '批量导入链接' : 'Import URLs'}
          </button>
          {images.length > 0 ? (
            <button type="button" onClick={() => onChange([])} className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100">
              <TrashIcon className="mr-1 h-4 w-4" />
              {locale === 'zh' ? `清空 (${images.length})` : `Clear (${images.length})`}
            </button>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) addFiles(event.target.files);
            event.currentTarget.value = '';
          }}
        />
      </div>

      {showUrls ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <textarea
            value={urlText}
            onChange={(event) => setUrlText(event.target.value)}
            rows={5}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder={locale === 'zh' ? '每行一个图片链接' : 'One image URL per line'}
          />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={importUrls} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
              {locale === 'zh' ? '导入全部链接' : 'Import all'}
            </button>
            <button type="button" onClick={() => setShowUrls(false)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
              {locale === 'zh' ? '取消' : 'Cancel'}
            </button>
          </div>
        </div>
      ) : null}

      <div
        tabIndex={0}
        className={`mt-4 rounded-lg border-2 border-dashed p-5 outline-none transition-colors ${
          isDraggingFiles ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 focus:border-blue-400'
        }`}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files || []);
          if (files.length) {
            event.preventDefault();
            addFiles(files);
          }
        }}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setIsDraggingFiles(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDragLeave={() => setIsDraggingFiles(false)}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setIsDraggingFiles(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <div className="text-center text-sm text-gray-600">
          {uploadMutation.isPending
            ? locale === 'zh'
              ? '正在上传并同步到图库...'
              : 'Uploading and syncing...'
            : locale === 'zh'
              ? '拖拽图片到这里，或先点击此区域再粘贴截图/图片'
              : 'Drop images here, or focus this area and paste an image'}
        </div>
      </div>

      {images.length ? (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {images.map((image, index) => (
            <div
              key={`${image.url}-${index}`}
              draggable
              onDragStart={() => {
                dragIndexRef.current = index;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragIndexRef.current;
                dragIndexRef.current = null;
                if (from === null || from === index) return;
                const next = [...images];
                const [item] = next.splice(from, 1);
                next.splice(index, 0, item);
                onChange(normalizeImages(next));
              }}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
            >
              <button type="button" onClick={() => setPreviewIndex(index)} className="relative block h-44 w-full bg-gray-100 p-2" title={locale === 'zh' ? '点击放大预览' : 'Click to preview'}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={image.alt_text || sku || `Image ${index + 1}`} className="h-full w-full object-contain" />
                <span className="absolute bottom-2 right-2 rounded bg-black/60 p-1 text-white"><EyeIcon className="h-4 w-4" /></span>
                {index === 0 ? <span className="absolute left-2 top-2 inline-flex items-center rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800"><StarIcon className="mr-1 h-3 w-3" />{locale === 'zh' ? '主图' : 'Main'}</span> : null}
              </button>
              <div className="flex items-center justify-between gap-1 border-t p-2">
                <div className="flex gap-1">
                  <button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="rounded border p-1.5 disabled:opacity-30" title={locale === 'zh' ? '左移' : 'Move left'}><ChevronLeftIcon className="h-4 w-4" /></button>
                  <button type="button" disabled={index === 0} onClick={() => move(index, -index)} className="rounded border p-1.5 disabled:opacity-30" title={locale === 'zh' ? '设为主图' : 'Set main'}><StarIcon className="h-4 w-4 text-amber-600" /></button>
                  <button type="button" disabled={index === images.length - 1} onClick={() => move(index, 1)} className="rounded border p-1.5 disabled:opacity-30" title={locale === 'zh' ? '右移' : 'Move right'}><ChevronRightIcon className="h-4 w-4" /></button>
                </div>
                <div className="flex gap-1">
                  <button type="button" disabled={rotateMutation.isPending} onClick={() => rotateMutation.mutate({ image, degrees: 270 })} className="rounded border p-1.5 disabled:opacity-40" title={locale === 'zh' ? '向左旋转 90°' : 'Rotate left'}><ArrowPathIcon className="h-4 w-4 -scale-x-100" /></button>
                  <button type="button" disabled={rotateMutation.isPending} onClick={() => rotateMutation.mutate({ image, degrees: 90 })} className="rounded border p-1.5 disabled:opacity-40" title={locale === 'zh' ? '向右旋转 90°' : 'Rotate right'}><ArrowPathIcon className="h-4 w-4" /></button>
                  <button type="button" onClick={() => remove(index)} className="rounded border border-red-200 p-1.5 text-red-600" title={locale === 'zh' ? '移除' : 'Remove'}><XMarkIcon className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-gray-500">{locale === 'zh' ? '暂无产品图片' : 'No product images yet'}</div>
      )}

      <MediaPickerModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        multiple
        initialFolder={folder}
        title={locale === 'zh' ? `选择 ${sku || '产品'} 的图片` : `Select images for ${sku || 'product'}`}
        onSelect={(assets) =>
          appendImages(
            assets.map((asset) => ({
              url: asset.url,
              alt_text: asset.alt_text || sku || asset.original_name,
              media_asset_id: asset.id,
            }))
          )
        }
      />

      {previewIndex !== null && images[previewIndex] ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => setPreviewIndex(null)}>
          <button type="button" onClick={() => setPreviewIndex(null)} className="absolute right-5 top-5 rounded-full bg-white/90 p-2 text-gray-800"><XMarkIcon className="h-6 w-6" /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[previewIndex].url} alt={images[previewIndex].alt_text || sku || 'Preview'} className="max-h-[90vh] max-w-[94vw] object-contain" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  );
}
