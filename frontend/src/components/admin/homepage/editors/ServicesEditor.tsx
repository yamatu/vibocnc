'use client';

import { useEffect, useMemo } from 'react';
import { useDraftReporter } from '@/components/admin/homepage/useDraftReporter';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { useFieldArray, useForm } from 'react-hook-form';
import { Bars3Icon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

import type { HomepageContent } from '@/types';
import { SortableList } from '@/components/admin/homepage/SortableList';
import { IconPreview } from '@/components/admin/homepage/icon-options';
import { DEFAULT_SERVICES_SECTION_DATA } from '@/lib/homepage-defaults';
import { newId } from '@/components/admin/homepage/homepage-schema';
import { useAdminI18n } from '@/lib/admin-i18n';

type ServiceForm = {
  id: string;
  icon: string;
  title: string;
  description: string;
  color: string;
  href: string;
  featuresText: string; // 1 per line
};

type StepForm = { id: string; step: string; title: string; description: string };
type BadgeForm = { id: string; text: string };

type FormValues = {
  headerTitle: string;
  headerDescription: string;
  services: ServiceForm[];
  processTitle: string;
  processDescription: string;
  processSteps: StepForm[];
  ctaTitle: string;
  ctaDescription: string;
  primaryCtaText: string;
  primaryCtaHref: string;
  secondaryCtaText: string;
  secondaryCtaHref: string;
  badges: BadgeForm[];
  is_active: boolean;
  sort_order: number;
};

function parseData(content?: HomepageContent | null): any {
  const raw = (content as any)?.data;
  return typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
}

function fromContent(content?: HomepageContent | null): FormValues {
  const parsed = parseData(content);
  const base = parsed && (Array.isArray(parsed.services) || Array.isArray(parsed.processSteps)) ? parsed : DEFAULT_SERVICES_SECTION_DATA;

  const services = (base.services || DEFAULT_SERVICES_SECTION_DATA.services).map((s: any) => ({
    id: newId('service'),
    icon: String(s.icon || 'cog'),
    title: String(s.title || ''),
    description: String(s.description || ''),
    color: String(s.color || 'bg-yellow-500'),
    href: String(s.href || '/contact'),
    featuresText: Array.isArray(s.features) ? s.features.join('\n') : '',
  }));

  const processSteps = (base.processSteps || DEFAULT_SERVICES_SECTION_DATA.processSteps).map((s: any) => ({
    id: newId('step'),
    step: String(s.step || ''),
    title: String(s.title || ''),
    description: String(s.description || ''),
  }));

  const badges = ((base.ctaBadges || DEFAULT_SERVICES_SECTION_DATA.ctaBadges) as any[]).map((t: any) => ({
    id: newId('badge'),
    text: String(t || ''),
  }));

  return {
    headerTitle: String(base.headerTitle || content?.title || DEFAULT_SERVICES_SECTION_DATA.headerTitle),
    headerDescription: String(base.headerDescription || content?.description || DEFAULT_SERVICES_SECTION_DATA.headerDescription),
    services,
    processTitle: String(base.processTitle || DEFAULT_SERVICES_SECTION_DATA.processTitle),
    processDescription: String(base.processDescription || DEFAULT_SERVICES_SECTION_DATA.processDescription),
    processSteps,
    ctaTitle: String(base.ctaTitle || DEFAULT_SERVICES_SECTION_DATA.ctaTitle),
    ctaDescription: String(base.ctaDescription || DEFAULT_SERVICES_SECTION_DATA.ctaDescription),
    primaryCtaText: String(base.ctaPrimary?.text || DEFAULT_SERVICES_SECTION_DATA.ctaPrimary.text),
    primaryCtaHref: String(base.ctaPrimary?.href || DEFAULT_SERVICES_SECTION_DATA.ctaPrimary.href),
    secondaryCtaText: String(base.ctaSecondary?.text || DEFAULT_SERVICES_SECTION_DATA.ctaSecondary.text),
    secondaryCtaHref: String(base.ctaSecondary?.href || DEFAULT_SERVICES_SECTION_DATA.ctaSecondary.href),
    badges,
    is_active: Boolean((content as any)?.is_active ?? true),
    sort_order: Number((content as any)?.sort_order ?? 50),
  };
}

function splitLines(v: string): string[] {
  return String(v || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toData(values: FormValues): any {
  return {
    headerTitle: values.headerTitle,
    headerDescription: values.headerDescription,
    services: values.services.map((s) => ({
      id: 0,
      icon: s.icon,
      title: s.title,
      description: s.description,
      features: splitLines(s.featuresText),
      color: s.color,
      href: s.href,
    })),
    processTitle: values.processTitle,
    processDescription: values.processDescription,
    processSteps: values.processSteps.map((s) => ({
      step: s.step,
      title: s.title,
      description: s.description,
    })),
    ctaTitle: values.ctaTitle,
    ctaDescription: values.ctaDescription,
    ctaPrimary: { text: values.primaryCtaText, href: values.primaryCtaHref },
    ctaSecondary: { text: values.secondaryCtaText, href: values.secondaryCtaHref },
    ctaBadges: values.badges.map((b) => b.text).filter(Boolean),
  };
}

const SERVICE_ICON_OPTIONS: string[] = ['cog', 'wrench', 'phone', 'truck', 'shield', 'cap'];
const COLOR_OPTIONS: string[] = ['bg-yellow-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-red-500', 'bg-indigo-500'];

export default function ServicesEditor({
  content,
  onSave,
  onDraftChange,
}: {
  content?: HomepageContent | null;
  onSave: (payload: { data: any; title?: string; description?: string; button_text?: string; button_url?: string; is_active: boolean; sort_order: number }) => Promise<void>;
  onDraftChange?: (payload: Partial<SectionPayload>) => void;
}) {
  const { locale, t } = useAdminI18n();
  const defaults = useMemo(() => fromContent(content), [content]);
  const { register, control, handleSubmit, reset, watch, formState } = useForm<FormValues>({ defaultValues: defaults });
  useEffect(() => reset(defaults), [defaults, reset]);

  const servicesFA = useFieldArray({ control, name: 'services' });
  const stepsFA = useFieldArray({ control, name: 'processSteps' });
  const badgesFA = useFieldArray({ control, name: 'badges' });

  const services = watch('services');
  const steps = watch('processSteps');
  const badges = watch('badges');

  const serviceIconLabel = (value: string) => {
    const v = String(value || '').toLowerCase();
    const map: Record<string, string> = {
      cog: t('homepage.icon.cog', locale === 'zh' ? '齿轮' : 'Cog'),
      wrench: t('homepage.icon.wrench', locale === 'zh' ? '扳手' : 'Wrench'),
      phone: t('homepage.icon.phone', locale === 'zh' ? '电话' : 'Phone'),
      truck: t('homepage.icon.truck', locale === 'zh' ? '卡车' : 'Truck'),
      shield: t('homepage.icon.shield', locale === 'zh' ? '盾牌' : 'Shield'),
      cap: t('homepage.icon.cap', locale === 'zh' ? '帽子' : 'Cap'),
    };
    return map[v] || value;
  };

  const colorLabel = (value: string) => {
    const v = String(value || '');
    const map: Record<string, string> = {
      'bg-yellow-500': t('common.color.yellow', locale === 'zh' ? '黄色' : 'Yellow'),
      'bg-green-500': t('common.color.green', locale === 'zh' ? '绿色' : 'Green'),
      'bg-purple-500': t('common.color.purple', locale === 'zh' ? '紫色' : 'Purple'),
      'bg-orange-500': t('common.color.orange', locale === 'zh' ? '橙色' : 'Orange'),
      'bg-red-500': t('common.color.red', locale === 'zh' ? '红色' : 'Red'),
      'bg-indigo-500': t('common.color.indigo', locale === 'zh' ? '靛蓝' : 'Indigo'),
    };
    return map[v] || value;
  };

  const buildPayload = (values: FormValues) => {
    const data = toData(values);
    return ({
      data,
      title: values.headerTitle,
      description: values.headerDescription,
      button_text: values.primaryCtaText,
      button_url: values.primaryCtaHref,
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

      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium text-gray-900">{t('homepage.services.cards', locale === 'zh' ? '服务卡片' : 'Service Cards')}</div>
          <button
            type="button"
            onClick={() => servicesFA.append({ id: newId('service'), icon: 'cog', title: '', description: '', color: 'bg-yellow-500', href: '/contact', featuresText: '' })}
            className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            <PlusIcon className="h-4 w-4" />
            {t('common.add', locale === 'zh' ? '添加' : 'Add')}
          </button>
        </div>

        <SortableList
          items={(servicesFA.fields || []).map((f, i) => ({ id: String(f.id), _i: i }))}
          onReorder={(next) => {
            const nextItems = next.map((n) => services[n._i]);
            servicesFA.replace(nextItems as any);
          }}
        >
          {(item, drag) => {
            const idx = item._i as number;
            const s = services?.[idx];
            return (
              <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
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
                  <IconPreview name={String(s?.icon || 'cog')} />
                  <div className="flex-1 font-medium text-gray-900 truncate">
                    {s?.title?.trim() ? s.title : t('homepage.services.cardN', locale === 'zh' ? '服务 {n}' : 'Service {n}', { n: idx + 1 })}
                  </div>
                  <button
                    type="button"
                    onClick={() => servicesFA.remove(idx)}
                    className="p-2 rounded-md border border-gray-200 text-red-600 hover:bg-red-50"
                    title={t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.icon', locale === 'zh' ? '图标' : 'Icon')}</label>
                    <select {...register(`services.${idx}.icon` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                      {SERVICE_ICON_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {serviceIconLabel(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.color', locale === 'zh' ? '颜色' : 'Color')}</label>
                    <select {...register(`services.${idx}.color` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                      {COLOR_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {colorLabel(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="@xl:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.title', locale === 'zh' ? '标题' : 'Title')}</label>
                    <input {...register(`services.${idx}.title` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                  </div>
                  <div className="@xl:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.description', locale === 'zh' ? '描述' : 'Description')}</label>
                    <textarea rows={2} {...register(`services.${idx}.description` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                  </div>
                  <div className="@xl:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.linkUrl', locale === 'zh' ? '链接' : 'Link URL')}</label>
                    <input {...register(`services.${idx}.href` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                  </div>
                  <div className="@xl:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('homepage.featuresPerLine', locale === 'zh' ? '特点（每行一个）' : 'Features (1 per line)')}</label>
                    <textarea rows={4} {...register(`services.${idx}.featuresText` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs" />
                  </div>
                </div>
              </div>
            );
          }}
        </SortableList>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div className="font-medium text-gray-900">{t('homepage.processSteps', locale === 'zh' ? '流程步骤' : 'Process Steps')}</div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.process.title', locale === 'zh' ? '流程标题' : 'Process Title')}</label>
          <input {...register('processTitle')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.process.desc', locale === 'zh' ? '流程描述' : 'Process Description')}</label>
          <textarea rows={2} {...register('processDescription')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-900">{t('homepage.steps', locale === 'zh' ? '步骤' : 'Steps')}</div>
          <button type="button" onClick={() => stepsFA.append({ id: newId('step'), step: '', title: '', description: '' })} className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
            <PlusIcon className="h-4 w-4" />
            {t('common.add', locale === 'zh' ? '添加' : 'Add')}
          </button>
        </div>

        <SortableList
          items={(stepsFA.fields || []).map((f, i) => ({ id: String(f.id), _i: i }))}
          onReorder={(next) => {
            const nextItems = next.map((n) => steps[n._i]);
            stepsFA.replace(nextItems as any);
          }}
        >
          {(item, drag) => {
            const idx = item._i as number;
            return (
              <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    ref={drag.setActivatorNodeRef as any}
                    {...drag.attributes}
                    {...drag.listeners}
                    className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                  >
                    <Bars3Icon className="h-5 w-5" />
                  </button>
                  <div className="font-medium text-gray-900">{t('homepage.step', locale === 'zh' ? '步骤' : 'Step')}</div>
                  <input {...register(`processSteps.${idx}.step` as const)} className="w-20 px-2 py-1 border border-gray-300 rounded-md text-sm" placeholder="01" />
                  <div className="flex-1" />
                  <button type="button" onClick={() => stepsFA.remove(idx)} className="p-2 rounded-md border border-gray-200 text-red-600 hover:bg-red-50">
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
                    <div className="@xl:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.title', locale === 'zh' ? '标题' : 'Title')}</label>
                      <input {...register(`processSteps.${idx}.title` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div className="@xl:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.description', locale === 'zh' ? '描述' : 'Description')}</label>
                      <textarea rows={2} {...register(`processSteps.${idx}.description` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                </div>
              </div>
            );
          }}
        </SortableList>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div className="font-medium text-gray-900">{t('homepage.stats.bottomCta', locale === 'zh' ? '底部 CTA' : 'Bottom CTA')}</div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.title', locale === 'zh' ? 'CTA 标题' : 'CTA Title')}</label>
          <input {...register('ctaTitle')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.desc', locale === 'zh' ? 'CTA 描述' : 'CTA Description')}</label>
          <textarea rows={3} {...register('ctaDescription')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.primaryText', locale === 'zh' ? '主按钮文字' : 'Primary Button Text')}</label>
            <input {...register('primaryCtaText')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.primaryUrl', locale === 'zh' ? '主按钮链接' : 'Primary Button URL')}</label>
            <input {...register('primaryCtaHref')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.secondaryText', locale === 'zh' ? '次按钮文字' : 'Secondary Button Text')}</label>
            <input {...register('secondaryCtaText')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.cta.secondaryUrl', locale === 'zh' ? '次按钮链接' : 'Secondary Button URL')}</label>
            <input {...register('secondaryCtaHref')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-900">{t('homepage.badges', locale === 'zh' ? '角标' : 'Badges')}</div>
          <button type="button" onClick={() => badgesFA.append({ id: newId('badge'), text: '' })} className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
            <PlusIcon className="h-4 w-4" />
            {t('common.add', locale === 'zh' ? '添加' : 'Add')}
          </button>
        </div>
        <SortableList
          items={(badgesFA.fields || []).map((f, i) => ({ id: String(f.id), _i: i }))}
          onReorder={(next) => {
            const nextItems = next.map((n) => badges[n._i]);
            badgesFA.replace(nextItems as any);
          }}
        >
          {(item, drag) => {
            const idx = item._i as number;
            return (
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg p-3 bg-white">
                <button
                  type="button"
                  ref={drag.setActivatorNodeRef as any}
                  {...drag.attributes}
                  {...drag.listeners}
                  className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                >
                  <Bars3Icon className="h-5 w-5" />
                </button>
                <input
                  {...register(`badges.${idx}.text` as const)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder={t('homepage.badgeTextPh', locale === 'zh' ? '角标文字' : 'Badge text')}
                />
                <button type="button" onClick={() => badgesFA.remove(idx)} className="p-2 rounded-md border border-gray-200 text-red-600 hover:bg-red-50">
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>
            );
          }}
        </SortableList>
      </div>

      <div className="flex items-center justify-between">
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
