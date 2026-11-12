'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDraftReporter } from '@/components/admin/homepage/useDraftReporter';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { useFieldArray, useForm } from 'react-hook-form';
import { Bars3Icon, PlusIcon, TrashIcon, PhotoIcon } from '@heroicons/react/24/outline';

import ImageField from '@/components/admin/homepage/ImageField';
import MediaPickerModal from '@/components/admin/MediaPickerModal';
import type { HomepageContent } from '@/types';
import { SortableList } from '@/components/admin/homepage/SortableList';
import { IconPreview } from '@/components/admin/homepage/icon-options';
import { DEFAULT_WORKSHOP_SECTION_DATA, type WorkshopSectionData } from '@/lib/homepage-defaults';
import { newId } from '@/components/admin/homepage/homepage-schema';
import { useAdminI18n } from '@/lib/admin-i18n';

type FacilityForm = {
  id: string;
  icon: string;
  title: string;
  description: string;
  image: string;
  featuresText: string; // one per line
};

type CapabilityForm = {
  id: string;
  icon: string;
  title: string;
  description: string;
};

type StatItemForm = { id: string; value: string; title: string; subtitle: string };

type FormValues = {
  headerTitle: string;
  headerDescription: string;
  facilities: FacilityForm[];
  capabilities: CapabilityForm[];
  statsItems: StatItemForm[];
  ctaTitle: string;
  ctaDescription: string;
  primaryCtaText: string;
  primaryCtaHref: string;
  secondaryCtaText: string;
  secondaryCtaHref: string;
  is_active: boolean;
  sort_order: number;
};

function parseData(content?: HomepageContent | null): Partial<WorkshopSectionData> | null {
  const raw: unknown = content?.data;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Partial<WorkshopSectionData>;
}

function fromContent(content?: HomepageContent | null): FormValues {
  const parsed = parseData(content);
  const base = parsed && (Array.isArray(parsed.facilities) || Array.isArray(parsed.capabilities)) ? parsed : DEFAULT_WORKSHOP_SECTION_DATA;

  const facilities = (base.facilities || DEFAULT_WORKSHOP_SECTION_DATA.facilities).map((f) => ({
    id: newId('facility'),
    icon: String(f.icon || 'beaker'),
    title: String(f.title || ''),
    description: String(f.description || ''),
    image: String(f.image || ''),
    featuresText: Array.isArray(f.features) ? f.features.join('\n') : '',
  }));

  const capabilities = (base.capabilities || DEFAULT_WORKSHOP_SECTION_DATA.capabilities).map((c) => ({
    id: newId('cap'),
    icon: String(c.icon || 'cog'),
    title: String(c.title || ''),
    description: String(c.description || ''),
  }));

  const statsItems = (base.statsBlock?.items || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.items).map((s) => ({
    id: newId('stat'),
    value: String(s.value || ''),
    title: String(s.title || ''),
    subtitle: String(s.subtitle || ''),
  }));

  return {
    headerTitle: String(base.headerTitle || content?.title || DEFAULT_WORKSHOP_SECTION_DATA.headerTitle),
    headerDescription: String(base.headerDescription || content?.description || DEFAULT_WORKSHOP_SECTION_DATA.headerDescription),
    facilities,
    capabilities,
    statsItems,
    ctaTitle: String(base.statsBlock?.ctaTitle || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.ctaTitle),
    ctaDescription: String(base.statsBlock?.ctaDescription || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.ctaDescription),
    primaryCtaText: String(base.statsBlock?.ctaPrimary?.text || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.ctaPrimary.text),
    primaryCtaHref: String(base.statsBlock?.ctaPrimary?.href || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.ctaPrimary.href),
    secondaryCtaText: String(base.statsBlock?.ctaSecondary?.text || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.ctaSecondary.text),
    secondaryCtaHref: String(base.statsBlock?.ctaSecondary?.href || DEFAULT_WORKSHOP_SECTION_DATA.statsBlock.ctaSecondary.href),
    is_active: Boolean(content?.is_active ?? true),
    sort_order: Number(content?.sort_order ?? 40),
  };
}

function splitLines(v: string): string[] {
  return String(v || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toData(values: FormValues): WorkshopSectionData {
  return {
    headerTitle: values.headerTitle,
    headerDescription: values.headerDescription,
    facilities: values.facilities.map((f) => ({
      id: 0,
      icon: f.icon,
      title: f.title,
      description: f.description,
      image: f.image,
      features: splitLines(f.featuresText),
    })),
    capabilities: values.capabilities.map((c) => ({
      icon: c.icon,
      title: c.title,
      description: c.description,
    })),
    statsBlock: {
      items: values.statsItems.map((s) => ({ value: s.value, title: s.title, subtitle: s.subtitle })),
      ctaTitle: values.ctaTitle,
      ctaDescription: values.ctaDescription,
      ctaPrimary: { text: values.primaryCtaText, href: values.primaryCtaHref },
      ctaSecondary: { text: values.secondaryCtaText, href: values.secondaryCtaHref },
    },
  };
}

const FACILITY_ICON_OPTIONS: string[] = ['beaker', 'archive', 'wrench', 'shield'];
const CAP_ICON_OPTIONS: string[] = ['cog', 'clipboard', 'truck', 'check'];

export default function WorkshopEditor({
  content,
  onSave,
  onDraftChange,
}: {
  content?: HomepageContent | null;
  onSave: (payload: { data: WorkshopSectionData; title?: string; description?: string; is_active: boolean; sort_order: number }) => Promise<void>;
  onDraftChange?: (payload: Partial<SectionPayload>) => void;
}) {
  const { locale, t } = useAdminI18n();
  const defaults = useMemo(() => fromContent(content), [content]);
  const { register, control, handleSubmit, reset, setValue, watch, formState } = useForm<FormValues>({ defaultValues: defaults });
  useEffect(() => reset(defaults), [defaults, reset]);

  const facilitiesFA = useFieldArray({ control, name: 'facilities' });
  const capabilitiesFA = useFieldArray({ control, name: 'capabilities' });
  const statsFA = useFieldArray({ control, name: 'statsItems' });

  const facilities = watch('facilities');
  const capabilities = watch('capabilities');
  const statsItems = watch('statsItems');

  const facilityIconLabel = (value: string) => {
    const v = String(value || '').toLowerCase();
    const map: Record<string, string> = {
      beaker: t('homepage.icon.beaker', locale === 'zh' ? '烧杯' : 'Beaker'),
      archive: t('homepage.icon.archive', locale === 'zh' ? '档案盒' : 'Archive'),
      wrench: t('homepage.icon.wrench', locale === 'zh' ? '扳手' : 'Wrench'),
      shield: t('homepage.icon.shield', locale === 'zh' ? '盾牌' : 'Shield'),
    };
    return map[v] || value;
  };

  const capIconLabel = (value: string) => {
    const v = String(value || '').toLowerCase();
    const map: Record<string, string> = {
      cog: t('homepage.icon.cog', locale === 'zh' ? '齿轮' : 'Cog'),
      clipboard: t('homepage.icon.clipboard', locale === 'zh' ? '清单' : 'Clipboard'),
      truck: t('homepage.icon.truck', locale === 'zh' ? '卡车' : 'Truck'),
      check: t('homepage.icon.check', locale === 'zh' ? '勾选' : 'Check'),
    };
    return map[v] || value;
  };

  const [picker, setPicker] = useState<{ open: boolean; facilityIdx: number | null }>({ open: false, facilityIdx: null });

  const buildPayload = (values: FormValues) => {
    const data = toData(values);
    return ({
      data,
      title: values.headerTitle,
      description: values.headerDescription,
      is_active: values.is_active,
      sort_order: values.sort_order,
    });
  };
  const onSubmit = async (values: FormValues) => {
    await onSave(buildPayload(values));
  };
  useDraftReporter(watch, buildPayload, onDraftChange);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-6">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.title', locale === 'zh' ? '标题' : 'Header Title')}</label>
          <input {...register('headerTitle')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.description', locale === 'zh' ? '描述' : 'Header Description')}</label>
          <textarea rows={3} {...register('headerDescription')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-6">
        <div className="@4xl:col-span-6 bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-medium text-gray-900">{t('homepage.workshop.facilities', locale === 'zh' ? '设施（标签页）' : 'Facilities (Tabs)')}</div>
            <button
              type="button"
              onClick={() => facilitiesFA.append({ id: newId('facility'), icon: 'beaker', title: '', description: '', image: '', featuresText: '' })}
              className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('common.add', locale === 'zh' ? '添加' : 'Add')}
            </button>
          </div>

          <SortableList
            items={(facilitiesFA.fields || []).map((f, i) => ({ id: String(f.id), _i: i }))}
            onReorder={(next) => {
              const nextFacilities = next.map((n) => facilities[n._i]);
              facilitiesFA.replace(nextFacilities);
            }}
          >
            {(item, drag) => {
              const idx = item._i as number;
              const f = facilities?.[idx];
              return (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      ref={drag.setActivatorNodeRef}
                      {...drag.attributes}
                      {...drag.listeners}
                      className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                      title={t('common.dragToReorder', locale === 'zh' ? '拖拽排序' : 'Drag to reorder')}
                    >
                      <Bars3Icon className="h-5 w-5" />
                    </button>
                    <IconPreview name={String(f?.icon || 'beaker')} />
                    <div className="flex-1 font-medium text-gray-900 truncate">{f?.title?.trim() ? f.title : `Facility ${idx + 1}`}</div>
                    <button
                      type="button"
                      onClick={() => setPicker({ open: true, facilityIdx: idx })}
                      className="p-2 rounded-md border border-gray-200 hover:bg-gray-50"
                      title={t('common.chooseImage', locale === 'zh' ? '选择图片' : 'Choose image')}
                    >
                      <PhotoIcon className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => facilitiesFA.remove(idx)}
                      className="p-2 rounded-md border border-gray-200 text-red-600 hover:bg-red-50"
                      title={t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                    >
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Icon</label>
                      <select {...register(`facilities.${idx}.icon` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                        {FACILITY_ICON_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {facilityIconLabel(value)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="@xl:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                      <input {...register(`facilities.${idx}.title` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div className="@xl:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                      <textarea rows={2} {...register(`facilities.${idx}.description` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div className="@xl:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Image</label>
                      <ImageField value={watch(`facilities.${idx}.image` as const) || ''} onChange={(url) => setValue(`facilities.${idx}.image` as const, url, { shouldDirty: true })} />
                    </div>
                    <div className="@xl:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Features (1 per line)</label>
                      <textarea rows={4} {...register(`facilities.${idx}.featuresText` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs" />
                    </div>
                  </div>
                </div>
              );
            }}
          </SortableList>
        </div>

        <div className="@4xl:col-span-6 bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-medium text-gray-900">{t('homepage.workshop.capabilities', locale === 'zh' ? '能力' : 'Capabilities')}</div>
            <button
              type="button"
              onClick={() => capabilitiesFA.append({ id: newId('cap'), icon: 'cog', title: '', description: '' })}
              className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              Add
            </button>
          </div>

          <SortableList
            items={(capabilitiesFA.fields || []).map((f, i) => ({ id: String(f.id), _i: i }))}
            onReorder={(next) => {
              const nextItems = next.map((n) => capabilities[n._i]);
              capabilitiesFA.replace(nextItems);
            }}
          >
            {(item, drag) => {
              const idx = item._i as number;
              const c = capabilities?.[idx];
              return (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      ref={drag.setActivatorNodeRef}
                      {...drag.attributes}
                      {...drag.listeners}
                      className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                    >
                      <Bars3Icon className="h-5 w-5" />
                    </button>
                    <IconPreview name={String(c?.icon || 'cog')} />
                    <div className="flex-1 font-medium text-gray-900 truncate">{c?.title?.trim() ? c.title : `Capability ${idx + 1}`}</div>
                    <button type="button" onClick={() => capabilitiesFA.remove(idx)} className="p-2 rounded-md border border-gray-200 text-red-600 hover:bg-red-50">
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Icon</label>
                      <select {...register(`capabilities.${idx}.icon` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                        {CAP_ICON_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {capIconLabel(value)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                      <input {...register(`capabilities.${idx}.title` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div className="@xl:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                      <textarea rows={2} {...register(`capabilities.${idx}.description` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                  </div>
                </div>
              );
            }}
          </SortableList>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div className="font-medium text-gray-900">{t('homepage.workshop.bottomBlock', locale === 'zh' ? '底部统计 + CTA（黄色区块）' : 'Bottom Stats + CTA (Yellow Block)')}</div>

        <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-6">
          <div className="@4xl:col-span-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-gray-900">Stats Items</div>
              <button type="button" onClick={() => statsFA.append({ id: newId('stat'), value: '', title: '', subtitle: '' })} className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
                <PlusIcon className="h-4 w-4" />
                Add
              </button>
            </div>
            <SortableList
              items={(statsFA.fields || []).map((f, i) => ({ id: String(f.id), _i: i }))}
              onReorder={(next) => {
                const nextItems = next.map((n) => statsItems[n._i]);
                statsFA.replace(nextItems);
              }}
            >
              {(item, drag) => {
                const idx = item._i as number;
                return (
                  <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        ref={drag.setActivatorNodeRef}
                        {...drag.attributes}
                        {...drag.listeners}
                        className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                      >
                        <Bars3Icon className="h-5 w-5" />
                      </button>
                      <div className="font-medium text-gray-900">Item {idx + 1}</div>
                      <div className="flex-1" />
                      <button type="button" onClick={() => statsFA.remove(idx)} className="p-2 rounded-md border border-gray-200 text-red-600 hover:bg-red-50">
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 @xl:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
                        <input {...register(`statsItems.${idx}.value` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                        <input {...register(`statsItems.${idx}.title` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Subtitle</label>
                        <input {...register(`statsItems.${idx}.subtitle` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                      </div>
                    </div>
                  </div>
                );
              }}
            </SortableList>
          </div>

          <div className="@4xl:col-span-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CTA Title</label>
              <input {...register('ctaTitle')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CTA Description</label>
              <textarea rows={3} {...register('ctaDescription')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary Button Text</label>
                <input {...register('primaryCtaText')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary Button URL</label>
                <input {...register('primaryCtaHref')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Button Text</label>
                <input {...register('secondaryCtaText')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Button URL</label>
                <input {...register('secondaryCtaHref')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
            </div>
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
      </div>

      <MediaPickerModal
        open={picker.open}
        onClose={() => setPicker({ open: false, facilityIdx: null })}
        multiple={false}
        title={t('media.picker.title.single', locale === 'zh' ? '选择图片' : 'Select an image')}
        onSelect={(assets) => {
          if (picker.facilityIdx == null) return;
          if (assets[0]) setValue(`facilities.${picker.facilityIdx}.image` as const, assets[0].url, { shouldDirty: true });
        }}
      />
    </form>
  );
}
