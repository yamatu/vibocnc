'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDraftReporter } from '@/components/admin/homepage/useDraftReporter';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'react-hot-toast';
import { Bars3Icon, PlusIcon, TrashIcon, PhotoIcon } from '@heroicons/react/24/outline';

import ImageField from '@/components/admin/homepage/ImageField';
import MediaPickerModal from '@/components/admin/MediaPickerModal';
import type { HomepageContent } from '@/types';
import { SortableList } from '@/components/admin/homepage/SortableList';
import { DEFAULT_HERO_DATA } from '@/lib/homepage-defaults';
import { newId, type HeroEditorData } from '@/components/admin/homepage/homepage-schema';
import { useAdminI18n } from '@/lib/admin-i18n';
import { normalizeLegacyCompanyText } from '@/lib/company-facts';

type FormValues = {
  autoPlayMs: number;
  slides: Array<{
    id: string;
    title: string;
    subtitle: string;
    description: string;
    image: string;
    primaryText: string;
    primaryHref: string;
    secondaryText: string;
    secondaryHref: string;
  }>;
  is_active: boolean;
  sort_order: number;
};

function fromContent(content?: HomepageContent | null): FormValues {
  const raw = (content as any)?.data;
  const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;

  const base: any = parsed && Array.isArray(parsed.slides) ? parsed : DEFAULT_HERO_DATA;
  const slides = (base.slides || []).map((s: any) => ({
    id: String(s.id ?? newId('slide')),
    title: normalizeLegacyCompanyText(s.title),
    subtitle: normalizeLegacyCompanyText(s.subtitle),
    description: normalizeLegacyCompanyText(s.description),
    image: String(s.image || ''),
    primaryText: String(s.cta?.primary?.text || ''),
    primaryHref: String(s.cta?.primary?.href || ''),
    secondaryText: String(s.cta?.secondary?.text || ''),
    secondaryHref: String(s.cta?.secondary?.href || ''),
  }));

  // If user previously edited simple fields, reflect into first slide.
  if (slides[0]) {
    if (content?.title) slides[0].title = normalizeLegacyCompanyText(content.title);
    if (content?.subtitle) slides[0].subtitle = normalizeLegacyCompanyText(content.subtitle);
    if (content?.description) slides[0].description = normalizeLegacyCompanyText(content.description);
    if (content?.image_url) slides[0].image = content.image_url;
    if (content?.button_text) slides[0].primaryText = content.button_text;
    if (content?.button_url) slides[0].primaryHref = content.button_url;
  }

  return {
    autoPlayMs: Number(base.autoPlayMs || 6000),
    slides,
    is_active: Boolean((content as any)?.is_active ?? true),
    sort_order: Number((content as any)?.sort_order ?? 1),
  };
}

function toData(values: FormValues): HeroEditorData {
  return {
    autoPlayMs: Number(values.autoPlayMs) || 6000,
    slides: values.slides.map((s, idx) => ({
      id: idx + 1,
      title: s.title,
      subtitle: s.subtitle,
      description: s.description,
      image: s.image,
      cta: {
        primary: { text: s.primaryText, href: s.primaryHref },
        secondary: { text: s.secondaryText, href: s.secondaryHref },
      },
    })),
  } as any;
}

export default function HeroEditor({
  content,
  onSave,
  onDraftChange,
}: {
  content?: HomepageContent | null;
  onSave: (payload: { data: any; title?: string; subtitle?: string; description?: string; image_url?: string; button_text?: string; button_url?: string; is_active: boolean; sort_order: number }) => Promise<void>;
  onDraftChange?: (payload: Partial<SectionPayload>) => void;
}) {
  const { locale, t } = useAdminI18n();
  const defaults = useMemo(() => fromContent(content), [content]);
  const { register, control, handleSubmit, reset, setValue, watch, formState } = useForm<FormValues>({
    defaultValues: defaults,
  });

  useEffect(() => reset(defaults), [defaults, reset]);

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'slides' });
  const slides = watch('slides');

  const [picker, setPicker] = useState<{ open: boolean; idx: number | null }>({ open: false, idx: null });

  const buildPayload = (values: FormValues) => {
    if (!values.slides || values.slides.length === 0) return null;
    const data = toData(values);
    const first = values.slides[0];
    return {
      data,
      // Keep simple fields in sync for SEO/back-compat.
      title: first.title,
      subtitle: first.subtitle,
      description: first.description,
      image_url: first.image,
      button_text: first.primaryText,
      button_url: first.primaryHref,
      is_active: values.is_active,
      sort_order: values.sort_order,
    };
  };

  const onSubmit = async (values: FormValues) => {
    const payload = buildPayload(values);
    if (!payload) {
      toast.error(t('homepage.hero.minOneSlide', locale === 'zh' ? '至少需要 1 张轮播图' : 'At least 1 slide is required'));
      return;
    }
    await onSave(payload);
  };
  useDraftReporter(watch, buildPayload, onDraftChange);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-6">
        <div className="@4xl:col-span-5">
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <div className="font-medium text-gray-900">{t('homepage.hero.slides', locale === 'zh' ? '轮播列表' : 'Slides')}</div>
                <button
                type="button"
                onClick={() =>
                  append({
                    id: newId('slide'),
                    title: '',
                    subtitle: '',
                    description: '',
                    image: '',
                    primaryText: '',
                    primaryHref: '/products',
                    secondaryText: '',
                    secondaryHref: '/about',
                  })
                }
                className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                <PlusIcon className="h-4 w-4" />
                {t('common.add', locale === 'zh' ? '添加' : 'Add')}
              </button>
            </div>

            <div className="p-4">
              <SortableList
                items={fields.map((f, i) => ({ id: String(f.id), _i: i }))}
                onReorder={(next) => {
                  const nextSlides = next.map((n) => slides[n._i]);
                  replace(nextSlides as any);
                }}
              >
                {(item, drag) => {
                  const idx = item._i as number;
                  const s = slides?.[idx];
                  return (
                    <div className="flex items-center gap-3 border border-gray-200 rounded-lg p-3 bg-white">
                      <button
                        type="button"
                        ref={drag.setActivatorNodeRef as any}
                        {...drag.attributes}
                        {...drag.listeners}
                        className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                        title={t('common.dragToReorder', locale === 'zh' ? '拖拽排序' : 'Drag to reorder')}
                      >
                        <Bars3Icon className="h-5 w-5" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {s?.title?.trim()
                            ? s.title
                            : t('homepage.hero.slideN', locale === 'zh' ? '轮播 {n}' : 'Slide {n}', { n: idx + 1 })}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{s?.subtitle || ''}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPicker({ open: true, idx })}
                        className="p-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
                        title={t('common.chooseImage', locale === 'zh' ? '选择图片' : 'Choose image')}
                      >
                        <PhotoIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(idx)}
                        className="p-2 rounded-md border border-gray-200 text-red-600 hover:bg-red-50"
                        title={t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  );
                }}
              </SortableList>
            </div>
          </div>
        </div>

        <div className="@4xl:col-span-7">
          <form onSubmit={handleSubmit(onSubmit)} className="bg-white border border-gray-200 rounded-lg p-6 space-y-6">
            <div className="grid grid-cols-1 @xl:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.hero.autoPlay', locale === 'zh' ? '自动播放（毫秒）' : 'Auto Play (ms)')}</label>
                <input
                  type="number"
                  {...register('autoPlayMs', { valueAsNumber: true })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.sortOrder', locale === 'zh' ? '排序' : 'Sort Order')}</label>
                <input
                  type="number"
                  {...register('sort_order', { valueAsNumber: true })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" {...register('is_active')} className="h-4 w-4 rounded border-gray-300" />
                  {t('common.active', locale === 'zh' ? '启用' : 'Active')}
                </label>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <div className="text-sm font-medium text-gray-900 mb-4">{t('homepage.hero.editSlides', locale === 'zh' ? '编辑轮播内容' : 'Edit Slides')}</div>
              <div className="space-y-8">
                {fields.map((f, idx) => (
                  <div key={f.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-medium text-gray-900">{t('homepage.hero.slideN', locale === 'zh' ? '轮播 {n}' : 'Slide {n}', { n: idx + 1 })}</div>
                      <button
                        type="button"
                        onClick={() => remove(idx)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
                      <div className="@xl:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.title', locale === 'zh' ? '标题' : 'Title')}</label>
                        <input {...register(`slides.${idx}.title` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </div>
                      <div className="@xl:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.subtitle', locale === 'zh' ? '副标题' : 'Subtitle')}</label>
                        <input {...register(`slides.${idx}.subtitle` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </div>
                      <div className="@xl:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.description', locale === 'zh' ? '描述' : 'Description')}</label>
                        <textarea rows={4} {...register(`slides.${idx}.description` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </div>

                      <div className="@xl:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.image', locale === 'zh' ? '图片' : 'Image')}</label>
                        <ImageField value={slides?.[idx]?.image || ''} onChange={(url) => setValue(`slides.${idx}.image` as const, url, { shouldDirty: true })} />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.primaryText', locale === 'zh' ? '主按钮文字' : 'Primary CTA Text')}</label>
                        <input {...register(`slides.${idx}.primaryText` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.primaryUrl', locale === 'zh' ? '主按钮链接' : 'Primary CTA URL')}</label>
                        <input {...register(`slides.${idx}.primaryHref` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.secondaryText', locale === 'zh' ? '次按钮文字' : 'Secondary CTA Text')}</label>
                        <input {...register(`slides.${idx}.secondaryText` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.secondaryUrl', locale === 'zh' ? '次按钮链接' : 'Secondary CTA URL')}</label>
                        <input {...register(`slides.${idx}.secondaryHref` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => reset(defaults)}
                className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
                disabled={formState.isSubmitting}
              >
                {t('common.reset', locale === 'zh' ? '重置' : 'Reset')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={formState.isSubmitting}
              >
                {t('common.save', locale === 'zh' ? '保存' : 'Save')}
              </button>
            </div>
          </form>
        </div>
      </div>

      <MediaPickerModal
        open={picker.open}
        onClose={() => setPicker({ open: false, idx: null })}
        multiple={false}
        title={t('media.picker.title.single', locale === 'zh' ? '选择图片' : 'Select an image')}
        onSelect={(assets) => {
          if (picker.idx == null) return;
          if (assets[0]) setValue(`slides.${picker.idx}.image` as const, assets[0].url, { shouldDirty: true });
        }}
      />
    </div>
  );
}
