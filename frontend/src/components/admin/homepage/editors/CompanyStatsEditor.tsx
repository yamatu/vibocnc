'use client';

import { useEffect, useMemo } from 'react';
import { useDraftReporter } from '@/components/admin/homepage/useDraftReporter';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { useFieldArray, useForm } from 'react-hook-form';
import { Bars3Icon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

import type { HomepageContent } from '@/types';
import { SortableList } from '@/components/admin/homepage/SortableList';
import { IconPreview } from '@/components/admin/homepage/icon-options';
import { DEFAULT_COMPANY_STATS_DATA } from '@/lib/homepage-defaults';
import { newId } from '@/components/admin/homepage/homepage-schema';
import { useAdminI18n } from '@/lib/admin-i18n';
import { normalizeCompanyStat, normalizeLegacyCompanyText } from '@/lib/company-facts';

type StatForm = {
  id: string;
  icon: string;
  value: number;
  suffix: string;
  label: string;
  description: string;
  color: string;
};

type FormValues = {
  headerTitle: string;
  headerDescription: string;
  stats: StatForm[];
  ctaTitle: string;
  ctaDescription: string;
  primaryCtaText: string;
  primaryCtaHref: string;
  secondaryCtaText: string;
  secondaryCtaHref: string;
  is_active: boolean;
  sort_order: number;
};

function parseData(content?: HomepageContent | null): any {
  const raw = (content as any)?.data;
  return typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
}

function fromContent(content?: HomepageContent | null): FormValues {
  const parsed = parseData(content);
  const base = parsed && Array.isArray(parsed.stats) ? parsed : DEFAULT_COMPANY_STATS_DATA;
  const stats = (base.stats || DEFAULT_COMPANY_STATS_DATA.stats).map((rawStat: any) => {
    const s = normalizeCompanyStat(rawStat);
    return {
      id: newId('stat'),
      icon: String(s.icon || 'calendar'),
      value: Number(s.value || 0),
      suffix: String(s.suffix || ''),
      label: normalizeLegacyCompanyText(s.label),
      description: normalizeLegacyCompanyText(s.description),
      color: String(s.color || 'text-yellow-600'),
    };
  });

  return {
    headerTitle: normalizeLegacyCompanyText(base.headerTitle || content?.title || DEFAULT_COMPANY_STATS_DATA.headerTitle),
    headerDescription: normalizeLegacyCompanyText(base.headerDescription || content?.description || DEFAULT_COMPANY_STATS_DATA.headerDescription),
    stats,
    ctaTitle: normalizeLegacyCompanyText(base.ctaTitle || DEFAULT_COMPANY_STATS_DATA.ctaTitle),
    ctaDescription: normalizeLegacyCompanyText(base.ctaDescription || DEFAULT_COMPANY_STATS_DATA.ctaDescription),
    primaryCtaText: String(base.ctaPrimary?.text || DEFAULT_COMPANY_STATS_DATA.ctaPrimary.text),
    primaryCtaHref: String(base.ctaPrimary?.href || DEFAULT_COMPANY_STATS_DATA.ctaPrimary.href),
    secondaryCtaText: String(base.ctaSecondary?.text || DEFAULT_COMPANY_STATS_DATA.ctaSecondary.text),
    secondaryCtaHref: String(base.ctaSecondary?.href || DEFAULT_COMPANY_STATS_DATA.ctaSecondary.href),
    is_active: Boolean((content as any)?.is_active ?? true),
    sort_order: Number((content as any)?.sort_order ?? 10),
  };
}

function toData(values: FormValues): any {
  return {
    headerTitle: values.headerTitle,
    headerDescription: values.headerDescription,
    stats: values.stats.map((s) => ({
      id: Number(s.id.replace(/\D/g, '') || 0) || undefined,
      icon: s.icon,
      value: Number(s.value) || 0,
      suffix: s.suffix,
      label: s.label,
      description: s.description,
      color: s.color || 'text-yellow-600',
    })),
    ctaTitle: values.ctaTitle,
    ctaDescription: values.ctaDescription,
    ctaPrimary: { text: values.primaryCtaText, href: values.primaryCtaHref },
    ctaSecondary: { text: values.secondaryCtaText, href: values.secondaryCtaHref },
  };
}

const STAT_ICON_OPTIONS: string[] = ['calendar', 'building', 'users', 'shield', 'cog', 'truck', 'globe', 'clock'];

export default function CompanyStatsEditor({
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
  const { register, control, handleSubmit, reset, watch, formState } = useForm<FormValues>({
    defaultValues: defaults,
  });
  useEffect(() => reset(defaults), [defaults, reset]);

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'stats' });
  const stats = watch('stats');
  const previewTitle = watch('headerTitle');
  const previewDescription = watch('headerDescription');

  const iconLabel = (value: string) => {
    const key = String(value || '').toLowerCase();
    const map: Record<string, string> = {
      calendar: t('homepage.icon.calendar', locale === 'zh' ? '日历' : 'Calendar'),
      building: t('homepage.icon.building', locale === 'zh' ? '大楼' : 'Building'),
      users: t('homepage.icon.users', locale === 'zh' ? '用户' : 'Users'),
      shield: t('homepage.icon.shield', locale === 'zh' ? '盾牌' : 'Shield'),
      cog: t('homepage.icon.cog', locale === 'zh' ? '齿轮' : 'Cog'),
      truck: t('homepage.icon.truck', locale === 'zh' ? '卡车' : 'Truck'),
      globe: t('homepage.icon.globe', locale === 'zh' ? '地球' : 'Globe'),
      clock: t('homepage.icon.clock', locale === 'zh' ? '时钟' : 'Clock'),
    };
    return map[key] || value;
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
    <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-6">
      <div className="@4xl:col-span-5 space-y-4 @4xl:sticky @4xl:top-4 @4xl:self-start">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-xs font-semibold uppercase text-orange-300">
              {locale === 'zh' ? '实时预览' : 'Live Preview'}
            </div>
            <h3 className="mt-2 text-lg font-semibold leading-snug">
              {previewTitle?.trim() || (locale === 'zh' ? '公司数据标题' : 'Company stats title')}
            </h3>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-300">
              {previewDescription?.trim() || (locale === 'zh' ? '区块描述会显示在这里。' : 'The section description will appear here.')}
            </p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-white/10">
            {(stats || []).slice(0, 8).map((stat, index) => (
              <div key={stat.id || index} className="min-h-28 p-4">
                <div className="flex items-center gap-2 text-orange-300">
                  <IconPreview name={String(stat.icon || 'calendar')} />
                  <span className="text-xl font-bold text-white">
                    {Number(stat.value || 0).toLocaleString()}{stat.suffix || ''}
                  </span>
                </div>
                <div className="mt-2 text-xs font-medium leading-5 text-slate-200">
                  {stat.label || `${locale === 'zh' ? '项目' : 'Item'} ${index + 1}`}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div className="font-medium text-gray-900">{t('homepage.stats.items', locale === 'zh' ? '统计项' : 'Stats Items')}</div>
            <button
              type="button"
              onClick={() =>
                append({
                  id: newId('stat'),
                  icon: 'calendar',
                  value: 0,
                  suffix: '',
                  label: '',
                  description: '',
                  color: 'text-yellow-600',
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
                const nextStats = next.map((n) => stats[n._i]);
                replace(nextStats as any);
              }}
            >
              {(item, drag) => {
                const idx = item._i as number;
                const s = stats?.[idx];
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
                    <div className="text-gray-700">
                      <IconPreview name={String(s?.icon || 'calendar')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {s?.label?.trim()
                          ? s.label
                          : t('common.itemN', locale === 'zh' ? '项目 {n}' : 'Item {n}', { n: idx + 1 })}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {Number(s?.value ?? 0).toLocaleString()}
                        {s?.suffix || ''}
                      </div>
                    </div>
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

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.stats.headerTitle', locale === 'zh' ? '标题' : 'Header Title')}</label>
              <input {...register('headerTitle')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('homepage.stats.headerDesc', locale === 'zh' ? '描述' : 'Header Description')}</label>
              <textarea rows={4} {...register('headerDescription')} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6 space-y-6">
            <div className="text-sm font-medium text-gray-900">{t('homepage.stats.editItems', locale === 'zh' ? '编辑统计项' : 'Edit Stats Items')}</div>
            <div className="space-y-6">
              {fields.map((f, idx) => (
                <div key={f.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-medium text-gray-900">{t('common.itemN', locale === 'zh' ? '项目 {n}' : 'Item {n}', { n: idx + 1 })}</div>
                    <button type="button" onClick={() => remove(idx)} className="text-sm text-red-600 hover:text-red-700">
                      {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.icon', locale === 'zh' ? '图标' : 'Icon')}</label>
                      <div className="flex items-center gap-2">
                        <select {...register(`stats.${idx}.icon` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                          {STAT_ICON_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                              {iconLabel(value)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.value', locale === 'zh' ? '数值' : 'Value')}</label>
                      <input type="number" {...register(`stats.${idx}.value` as const, { valueAsNumber: true })} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.suffix', locale === 'zh' ? '后缀' : 'Suffix')}</label>
                      <input
                        {...register(`stats.${idx}.suffix` as const)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        placeholder={t('common.suffixPh', locale === 'zh' ? '例如：+、sqm' : 'e.g. +, sqm')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.label', locale === 'zh' ? '名称' : 'Label')}</label>
                      <input {...register(`stats.${idx}.label` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    </div>
                    <div className="@xl:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.description', locale === 'zh' ? '描述' : 'Description')}</label>
                      <input {...register(`stats.${idx}.description` as const)} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6 space-y-4">
            <div className="text-sm font-medium text-gray-900">{t('homepage.stats.bottomCta', locale === 'zh' ? '底部 CTA' : 'Bottom CTA')}</div>
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
      </div>
    </div>
  );
}
