'use client';

import { useRef, useState } from 'react';
import { ArrowUpTrayIcon, PhotoIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import MediaPickerModal from '@/components/admin/MediaPickerModal';
import { MediaService } from '@/services/media.service';
import { useAdminI18n } from '@/lib/admin-i18n';

type Props = {
  label?: string;
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  /** Optional image shown (dimmed) when value is empty, e.g. a bundled default. */
  fallbackSrc?: string;
  aspect?: 'wide' | 'square' | 'logo';
  folder?: string;
};

const ASPECT_CLASS: Record<NonNullable<Props['aspect']>, string> = {
  wide: 'aspect-[16/7]',
  square: 'aspect-square',
  logo: 'h-20',
};

export default function ImageField({ label, value, onChange, placeholder, fallbackSrc, aspect = 'wide', folder = 'homepage' }: Props) {
  const { locale } = useAdminI18n();
  const L = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(L('请上传图片文件', 'Please choose an image file'));
      return;
    }
    setUploading(true);
    try {
      const res = await MediaService.upload([file], { folder });
      const asset = res.results.find((r) => r.asset)?.asset;
      if (!asset) throw new Error(res.results[0]?.error || 'Upload failed');
      onChange(asset.url);
      toast.success(L('图片已上传', 'Image uploaded'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : L('上传失败', 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const shown = value || fallbackSrc || '';

  return (
    <div>
      {label ? <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span> : null}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
        className={`group relative flex w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-gray-50 transition ${ASPECT_CLASS[aspect]} ${
          dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
        }`}
      >
        {shown ? (
           
          <img
            src={shown}
            alt=""
            className={`h-full w-full ${aspect === 'logo' ? 'object-contain p-3' : 'object-cover'} ${value ? '' : 'opacity-50'}`}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 px-3 text-center text-xs text-gray-500">
            <PhotoIcon className="h-7 w-7 text-gray-400" />
            {L('拖拽图片到这里上传', 'Drop an image here')}
          </div>
        )}
        <div className={`absolute inset-0 flex items-center justify-center gap-2 bg-gray-900/45 transition ${uploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}>
          {uploading ? (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-800">{L('上传中…', 'Uploading…')}</span>
          ) : (
            <>
              <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-800 shadow hover:bg-gray-100">
                <ArrowUpTrayIcon className="h-4 w-4" />{L('上传', 'Upload')}
              </button>
              <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-800 shadow hover:bg-gray-100">
                <PhotoIcon className="h-4 w-4" />{L('图库', 'Library')}
              </button>
              {value ? (
                <button type="button" onClick={() => onChange('')} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-red-600 shadow hover:bg-red-50">
                  <XMarkIcon className="h-4 w-4" />{L('清除', 'Clear')}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || L('或粘贴图片地址 /uploads/...', 'or paste an image URL /uploads/...')}
        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:ring-blue-500"
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiple={false}
        title={L('选择图片', 'Select an image')}
        onSelect={(assets) => {
          if (assets[0]) onChange(assets[0].url);
        }}
      />
    </div>
  );
}
