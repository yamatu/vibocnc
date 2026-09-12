'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PhotoIcon } from '@heroicons/react/24/outline';

import MediaPickerModal from '@/components/admin/MediaPickerModal';
import EditorPanel from '@/components/admin/homepage/EditorPanel';
import type { HomepageContent } from '@/types';
import { useAdminI18n } from '@/lib/admin-i18n';

type FormValues = {
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  button_text: string;
  button_url: string;
  data_json: string;
  sort_order: number;
  is_active: boolean;
};

function fromContent(content?: HomepageContent | null): FormValues {
  const raw = (content as any)?.data;
  const dataJson =
    raw == null
      ? ''
      : typeof raw === 'string'
        ? raw
        : (() => {
            try {
              return JSON.stringify(raw, null, 2);
            } catch {
              return '';
            }
          })();

  return {
    title: content?.title || '',
    subtitle: content?.subtitle || '',
    description: content?.description || '',
    image_url: content?.image_url || '',
    button_text: content?.button_text || '',
    button_url: content?.button_url || '',
    data_json: dataJson,
    sort_order: Number((content as any)?.sort_order ?? 0),
    is_active: Boolean((content as any)?.is_active ?? false),
  };
}

export default function SimpleSectionEditor({
  content,
  onSave,
}: {
  content?: HomepageContent | null;
  onSave: (payload: { title: string; subtitle: string; description: string; image_url: string; button_text: string; button_url: string; sort_order: number; is_active: boolean; data?: any }) => Promise<void>;
}) {
  const { locale, t } = useAdminI18n();
  const defaults = useMemo(() => fromContent(content), [content]);
  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<FormValues>({ defaultValues: defaults });
  useEffect(() => reset(defaults), [defaults, reset]);

  const imageUrl = watch('image_url');
  const [pickerOpen, setPickerOpen] = useState(false);

  const onSubmit = async (values: FormValues) => {
    const payload: any = {
      title: values.title,
      subtitle: values.subtitle,
      description: values.description,
      image_url: values.image_url,
      button_text: values.button_text,
      button_url: values.button_url,
      sort_order: values.sort_order,
      is_active: values.is_active,
    };

    const raw = String(values.data_json || '').trim();
    if (raw) {
      try {
        payload.data = JSON.parse(raw);
      } catch {
        // Keep it as string if user provides non-JSON; backend will store it as-is.
        payload.data = raw;
      }
    } else {
      payload.data = null;
    }

    await onSave(payload);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <EditorPanel title={t('homepage.editor.basics', locale === 'zh' ? '基础' : 'Basics')} defaultOpen={true}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.sortOrder', locale === 'zh' ? '排序' : 'Sort Order')}</label>
            <input type="number" {...register('sort_order', { valueAsNumber: true })} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" {...register('is_active')} className="h-4 w-4 rounded border-gray-300" />
              {t('common.active', locale === 'zh' ? '启用' : 'Active')}
            </label>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.title', locale === 'zh' ? '标题' : 'Title')}</label>
          <input {...register('title')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.subtitle', locale === 'zh' ? '副标题' : 'Subtitle')}</label>
          <input {...register('subtitle')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.description', locale === 'zh' ? '描述' : 'Description')}</label>
          <textarea rows={6} {...register('description')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
      </EditorPanel>

      <EditorPanel title={t('common.image', locale === 'zh' ? '图片' : 'Image')} defaultOpen={true}>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.image', locale === 'zh' ? '图片' : 'Image')}</label>
          <div className="flex gap-2">
            <input {...register('image_url')} className="flex-1 px-3 py-2 border border-gray-300 rounded-md" placeholder="/uploads/..." />
            <button type="button" onClick={() => setPickerOpen(true)} className="px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50">
              <PhotoIcon className="h-5 w-5" />
            </button>
          </div>
          {imageUrl ? (
              <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                { }
                <img src={imageUrl} alt={t('common.preview', locale === 'zh' ? '预览' : 'Preview')} className="w-full h-auto" />
              </div>
            ) : null}
        </div>
      </EditorPanel>

      <EditorPanel title={t('common.button', locale === 'zh' ? '按钮' : 'Button')} defaultOpen={false}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.buttonText', locale === 'zh' ? '按钮文字' : 'Button Text')}</label>
            <input {...register('button_text')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.buttonUrl', locale === 'zh' ? '按钮链接' : 'Button URL')}</label>
            <input {...register('button_url')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
        </div>
      </EditorPanel>

      <EditorPanel title={t('homepage.editor.advanced', locale === 'zh' ? '高级（区块 JSON 数据）' : 'Advanced (Section data JSON)')} defaultOpen={false}>
        <div>
          <div className="text-xs text-gray-500 mb-2">
            {t(
              'homepage.editor.advancedHint',
              locale === 'zh'
                ? '仅在需要结构化数据进行自定义渲染时使用；普通区块留空即可。'
                : 'Use this only when you need structured data for custom rendering. Leave empty for normal sections.'
            )}
          </div>
          <textarea
            rows={10}
            {...register('data_json')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
            placeholder='{"items": []}'
          />
        </div>
      </EditorPanel>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => reset(defaults)} className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50" disabled={formState.isSubmitting}>
            {t('common.reset', locale === 'zh' ? '重置' : 'Reset')}
          </button>
          <button type="submit" className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" disabled={formState.isSubmitting}>
            {t('common.save', locale === 'zh' ? '保存' : 'Save')}
          </button>
        </div>
      </div>

      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiple={false}
        title={t('media.picker.title.single', locale === 'zh' ? '选择图片' : 'Select an image')}
        onSelect={(assets) => {
          if (assets[0]) setValue('image_url', assets[0].url, { shouldDirty: true });
        }}
      />
    </form>
  );
}
