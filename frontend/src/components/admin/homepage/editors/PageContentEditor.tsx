'use client';

import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ArrowUturnLeftIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import type { HomepageContent } from '@/types';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { useDraftReporter } from '@/components/admin/homepage/useDraftReporter';
import EditorPanel from '@/components/admin/homepage/EditorPanel';
import ImageField from '@/components/admin/homepage/ImageField';
import { useAdminI18n } from '@/lib/admin-i18n';
import { parsePageData, schemaFields, type PageData, type PageSchema } from '@/lib/page-content';

type Props = {
  schema: PageSchema;
  content?: HomepageContent | null;
  onSave: (payload: Partial<SectionPayload>) => Promise<void>;
  onDraftChange?: (payload: Partial<SectionPayload>) => void;
};

export default function PageContentEditor({ schema, content, onSave, onDraftChange }: Props) {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const L = (z: string, e: string) => (zh ? z : e);
  const fields = useMemo(() => schemaFields(schema), [schema]);
  const hasLocalizedText = fields.some((field) => field.i18nKey);

  const defaults = useMemo(() => {
    const saved = parsePageData(content);
    return Object.fromEntries(fields.map((field) => [field.key, saved[field.key] || ''])) as PageData;
  }, [content, fields]);

  const { register, control, handleSubmit, reset, watch, setValue, formState } = useForm<PageData>({ defaultValues: defaults });
  useEffect(() => reset(defaults), [defaults, reset]);

  // Only filled fields are stored; an empty field keeps the built-in content.
  const buildPayload = (values: PageData): Partial<SectionPayload> => {
    const data = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, String(value ?? '').trim()]).filter(([, value]) => value),
    );
    return { title: schema.en, data, is_active: true, sort_order: 0 };
  };
  useDraftReporter(watch, buildPayload, onDraftChange);

  const values = watch();
  const customized = fields.filter((field) => String(values[field.key] ?? '').trim()).length;

  return (
    <form onSubmit={handleSubmit((v) => onSave(buildPayload(v)))} className="space-y-3">
      {/* Kept at the top: floating admin widgets sit in the bottom-right corner. */}
      <div className="sticky top-0 z-10 -mx-3 -mt-3 flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-3">
        <button
          type="button"
          onClick={() => reset(defaults)}
          disabled={formState.isSubmitting}
          className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          {L('撤销未保存修改', 'Discard changes')}
        </button>
        <button
          type="submit"
          disabled={formState.isSubmitting}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {formState.isSubmitting ? L('保存中…', 'Saving…') : L('保存并发布', 'Save & publish')}
        </button>
      </div>
      <div className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
        <InformationCircleIcon className="h-5 w-5 shrink-0" />
        <div>
          {L('留空的字段显示网站原有内容（灰色提示文字即当前内容），只需填写想修改的部分。', 'Empty fields keep the built-in content (shown as grey placeholder); fill in only what you want to change.')}
          {hasLocalizedText
            ? ` ${L('文字修改显示在英文页面，其他语言继续使用内置翻译；图片、电话、邮箱、地址对所有语言生效。', 'Text changes appear on the English page; other languages keep their translations. Images, phone, email and address apply to every language.')}`
            : ''}
          <div className="mt-1 font-semibold">{L(`已自定义 ${customized} / ${fields.length} 项`, `${customized} of ${fields.length} fields customised`)}</div>
        </div>
      </div>

      {schema.groups.map((group, groupIndex) => (
        <EditorPanel key={group.en} title={zh ? group.zh : group.en} defaultOpen={groupIndex === 0}>
          <div className="space-y-4">
            {group.fields.map((field) => {
              const label = zh ? field.zh : field.en;
              const isCustom = Boolean(String(values[field.key] ?? '').trim());
              const resetButton = isCustom ? (
                <button
                  type="button"
                  onClick={() => setValue(field.key, '', { shouldDirty: true })}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-700"
                  title={L('恢复为原有内容', 'Restore built-in content')}
                >
                  <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                  {L('恢复默认', 'Reset')}
                </button>
              ) : null;
              return (
                <div key={field.key}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor={`page-field-${field.key}`} className="text-sm font-medium text-gray-700">
                      {label}
                      {isCustom ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{L('已修改', 'Custom')}</span> : null}
                    </label>
                    {resetButton}
                  </div>
                  {field.type === 'image' ? (
                    <Controller
                      control={control}
                      name={field.key}
                      render={({ field: input }) => (
                        <ImageField value={input.value || ''} onChange={input.onChange} fallbackSrc={field.fallback || undefined} folder="pages" />
                      )}
                    />
                  ) : field.type === 'textarea' ? (
                    <textarea
                      id={`page-field-${field.key}`}
                      rows={4}
                      {...register(field.key)}
                      placeholder={field.fallback}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400"
                    />
                  ) : (
                    <input
                      id={`page-field-${field.key}`}
                      {...register(field.key)}
                      placeholder={field.fallback}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400"
                    />
                  )}
                  {field.hint ? <p className="mt-1 text-xs text-gray-500">{zh ? field.hint.zh : field.hint.en}</p> : null}
                </div>
              );
            })}
          </div>
        </EditorPanel>
      ))}
    </form>
  );
}
