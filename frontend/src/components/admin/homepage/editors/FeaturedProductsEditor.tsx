'use client';

import { useEffect, useMemo } from 'react';
import { useDraftReporter } from '@/components/admin/homepage/useDraftReporter';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { useForm } from 'react-hook-form';

import type { HomepageContent } from '@/types';
import { DEFAULT_FEATURED_PRODUCTS_SECTION_DATA } from '@/lib/homepage-defaults';
import { useAdminI18n } from '@/lib/admin-i18n';

type FormValues = {
  headerTitle: string;
  headerDescription: string;
  ctaText: string;
  ctaHref: string;
  is_active: boolean;
  sort_order: number;
};

function fromContent(content?: HomepageContent | null): FormValues {
  return {
    headerTitle: content?.title || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.headerTitle,
    headerDescription: content?.description || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.headerDescription,
    ctaText: content?.button_text || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.ctaText,
    ctaHref: content?.button_url || DEFAULT_FEATURED_PRODUCTS_SECTION_DATA.ctaHref,
    is_active: Boolean((content as any)?.is_active ?? true),
    sort_order: Number((content as any)?.sort_order ?? 30),
  };
}

export default function FeaturedProductsEditor({
  content,
  onSave,
  onDraftChange,
}: {
  content?: HomepageContent | null;
  onSave: (payload: { title: string; description: string; button_text: string; button_url: string; is_active: boolean; sort_order: number; data?: any }) => Promise<void>;
  onDraftChange?: (payload: Partial<SectionPayload>) => void;
}) {
  const { locale, t } = useAdminI18n();
  const defaults = useMemo(() => fromContent(content), [content]);
  const { register, handleSubmit, reset, watch, formState } = useForm<FormValues>({ defaultValues: defaults });
  useEffect(() => reset(defaults), [defaults, reset]);

  const buildPayload = (values: FormValues) => {
    return ({
      title: values.headerTitle,
      description: values.headerDescription,
      button_text: values.ctaText,
      button_url: values.ctaHref,
      is_active: values.is_active,
      sort_order: values.sort_order,
      // Keep data in sync for future use (optional)
      data: {
        headerTitle: values.headerTitle,
        headerDescription: values.headerDescription,
        ctaText: values.ctaText,
        ctaHref: values.ctaHref,
      },
    });
  };
  const onSubmit = async (values: FormValues) => {
    await onSave(buildPayload(values));
  };
  useDraftReporter(watch, buildPayload, onDraftChange);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-white border border-gray-200 rounded-lg p-6 space-y-6">
      <div className="grid grid-cols-1 @xl:grid-cols-3 gap-4">
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.featured.title', locale === 'zh' ? '区块标题' : 'Section Title')}</label>
        <input {...register('headerTitle')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.featured.desc', locale === 'zh' ? '区块描述' : 'Section Description')}</label>
        <textarea rows={4} {...register('headerDescription')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
      </div>

      <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.buttonText', locale === 'zh' ? '按钮文字' : 'CTA Text')}</label>
          <input {...register('ctaText')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.buttonUrl', locale === 'zh' ? '按钮链接' : 'CTA URL')}</label>
          <input {...register('ctaHref')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={() => reset(defaults)} className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50" disabled={formState.isSubmitting}>
          {t('common.reset', locale === 'zh' ? '重置' : 'Reset')}
        </button>
        <button type="submit" className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" disabled={formState.isSubmitting}>
          {t('common.save', locale === 'zh' ? '保存' : 'Save')}
        </button>
      </div>
    </form>
  );
}
