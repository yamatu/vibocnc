'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bars3Icon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import EditorPanel from '@/components/admin/homepage/EditorPanel';
import ImageField from '@/components/admin/homepage/ImageField';
import { SortableList } from '@/components/admin/homepage/SortableList';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { useAdminI18n } from '@/lib/admin-i18n';
import {
  DEFAULT_CAROUSEL_BRANDS,
  brandKey,
  bundledBrandLogo,
  normalizeBrandCarouselData,
} from '@/lib/brand-logos';
import type { HomepageContent } from '@/types';

type Row = { id: string; name: string; logo: string; href: string };

let rowSeq = 0;
const nextId = () => `brand-${Date.now().toString(36)}-${rowSeq++}`;

type FormState = {
  title: string;
  subtitle: string;
  kicker: string;
  button_text: string;
  button_url: string;
  is_active: boolean;
  speed: number;
  rows: 1 | 2;
  grayscale: boolean;
  brands: Row[];
};

function fromContent(content?: HomepageContent | null): FormState {
  const data = normalizeBrandCarouselData(content?.data);
  return {
    title: content?.title || 'Brands We Supply',
    subtitle: content?.subtitle || '',
    kicker: data.kicker,
    button_text: content?.button_text || '',
    button_url: content?.button_url || '',
    is_active: content ? content.is_active !== false : true,
    speed: data.speed,
    rows: data.rows,
    grayscale: data.grayscale,
    brands: data.brands.map((b) => ({ id: nextId(), name: b.name, logo: b.logo || '', href: b.href || '' })),
  };
}

function toPayload(form: FormState, content?: HomepageContent | null): SectionPayload {
  return {
    title: form.title,
    subtitle: form.subtitle,
    description: content?.description || '',
    image_url: content?.image_url || '',
    button_text: form.button_text,
    button_url: form.button_url,
    sort_order: Number(content?.sort_order ?? 15),
    is_active: form.is_active,
    data: {
      kicker: form.kicker,
      speed: form.speed,
      rows: form.rows,
      grayscale: form.grayscale,
      brands: form.brands
        .filter((b) => b.name.trim())
        .map((b) => ({
          name: b.name.trim(),
          ...(b.logo.trim() ? { logo: b.logo.trim() } : {}),
          ...(b.href.trim() ? { href: b.href.trim() } : {}),
        })),
    },
  };
}

export default function BrandCarouselEditor({
  content,
  onSave,
  onDraftChange,
}: {
  content?: HomepageContent | null;
  onSave: (payload: SectionPayload) => Promise<void>;
  onDraftChange?: (payload: SectionPayload) => void;
}) {
  const { locale } = useAdminI18n();
  const L = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const initial = useMemo(() => fromContent(content), [content]);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const firstRender = useRef(true);

  useEffect(() => setForm(initial), [initial]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    onDraftChange?.(toPayload(form, content));
  }, [form, content, onDraftChange]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const updateBrand = (id: string, patch: Partial<Row>) =>
    setForm((f) => ({ ...f, brands: f.brands.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));

  const present = new Set(form.brands.map((b) => brandKey(b.name)));
  const missingBuiltIns = DEFAULT_CAROUSEL_BRANDS.filter((b) => !present.has(brandKey(b.name)));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(toPayload(form, content));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <EditorPanel title={L('标题与按钮', 'Heading & button')}>
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
          <label className="block text-sm @xl:col-span-2">
            <span className="mb-1 block font-medium text-gray-700">{L('小标签', 'Kicker')}</span>
            <input value={form.kicker} onChange={(e) => set('kicker', e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <label className="block text-sm @xl:col-span-2">
            <span className="mb-1 block font-medium text-gray-700">{L('标题', 'Title')}</span>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <label className="block text-sm @xl:col-span-2">
            <span className="mb-1 block font-medium text-gray-700">{L('副标题', 'Subtitle')}</span>
            <textarea rows={2} value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('按钮文字', 'Button text')}</span>
            <input value={form.button_text} onChange={(e) => set('button_text', e.target.value)} placeholder="View all products" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('按钮链接', 'Button URL')}</span>
            <input value={form.button_url} onChange={(e) => set('button_url', e.target.value)} placeholder="/products" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
        </div>
      </EditorPanel>

      <EditorPanel title={L('轮播样式', 'Carousel style')}>
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('滚动速度', 'Speed')}: {form.speed}s</span>
            <input type="range" min={15} max={120} step={5} value={form.speed} onChange={(e) => set('speed', Number(e.target.value))} className="w-full" />
            <span className="text-xs text-gray-500">{L('数值越小越快', 'Lower is faster')}</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('行数', 'Rows')}</span>
            <select value={form.rows} onChange={(e) => set('rows', Number(e.target.value) === 2 ? 2 : 1)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value={1}>{L('单行', 'One row')}</option>
              <option value={2}>{L('双行（反向滚动）', 'Two rows (opposite directions)')}</option>
            </select>
          </label>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" checked={form.grayscale} onChange={(e) => set('grayscale', e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
              {L('灰度 logo（悬停变彩色）', 'Grayscale logos (color on hover)')}
            </label>
          </div>
        </div>
      </EditorPanel>

      <EditorPanel title={L(`品牌（${form.brands.length}）`, `Brands (${form.brands.length})`)}>
        <p className="mb-3 text-xs text-gray-500">
          {L('拖动左侧把手排序。内置品牌自带官方 logo，可上传图片替换；自定义品牌请上传 logo（未上传时显示品牌文字）。',
            'Drag the handle to reorder. Built-in brands include an official logo you can replace; upload a logo for custom brands (the name is shown otherwise).')}
        </p>
        <SortableList items={form.brands} onReorder={(next) => set('brands', next)}>
          {(brand, drag) => {
            const bundled = bundledBrandLogo(brand.name);
            const open = expanded === brand.id;
            return (
              <div className="mb-2 rounded-xl border border-gray-200 bg-white">
                <div className="flex items-center gap-2 p-2">
                  <button type="button" ref={drag.setActivatorNodeRef} {...drag.attributes} {...drag.listeners} className="cursor-grab touch-none rounded p-1.5 text-gray-400 hover:bg-gray-100" aria-label={L('拖动排序', 'Drag to reorder')}>
                    <Bars3Icon className="h-5 w-5" />
                  </button>
                  <div className="flex h-10 w-20 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-gray-50">
                    {brand.logo || bundled ? (
                       
                      <img src={brand.logo || bundled} alt="" className="max-h-7 max-w-[68px] object-contain" />
                    ) : (
                      <span className="text-[10px] font-bold uppercase text-gray-500">{brand.name.slice(0, 8)}</span>
                    )}
                  </div>
                  <input
                    value={brand.name}
                    onChange={(e) => updateBrand(brand.id, { name: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder={L('品牌名称', 'Brand name')}
                  />
                  <button type="button" onClick={() => setExpanded(open ? null : brand.id)} className="shrink-0 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                    {open ? L('收起', 'Close') : L('Logo/链接', 'Logo/link')}
                  </button>
                  <button
                    type="button"
                    onClick={() => set('brands', form.brands.filter((b) => b.id !== brand.id))}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={L('删除', 'Remove')}
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
                {open ? (
                  <div className="grid grid-cols-1 gap-3 border-t border-gray-100 p-3 @xl:grid-cols-2">
                    <ImageField
                      label={L('Logo 图片', 'Logo image')}
                      value={brand.logo}
                      fallbackSrc={bundled}
                      aspect="logo"
                      folder="brands"
                      onChange={(url) => updateBrand(brand.id, { logo: url })}
                    />
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-gray-700">{L('点击跳转链接', 'Link')}</span>
                      <input
                        value={brand.href}
                        onChange={(e) => updateBrand(brand.id, { href: e.target.value })}
                        placeholder={L('留空则自动链接到该品牌商品', 'Empty = link to this brand’s products')}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                      {bundled && !brand.logo ? (
                        <span className="mt-2 block text-xs text-gray-500">{L('当前使用内置官方 logo', 'Using the built-in official logo')}</span>
                      ) : null}
                    </label>
                  </div>
                ) : null}
              </div>
            );
          }}
        </SortableList>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const id = nextId();
              set('brands', [...form.brands, { id, name: '', logo: '', href: '' }]);
              setExpanded(id);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <PlusIcon className="h-4 w-4" />{L('添加自定义品牌', 'Add custom brand')}
          </button>
          {missingBuiltIns.map((b) => (
            <button
              key={b.name}
              type="button"
              onClick={() => set('brands', [...form.brands, { id: nextId(), name: b.name, logo: '', href: '' }])}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-blue-300 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50"
            >
              <PlusIcon className="h-3.5 w-3.5" />{b.name}
            </button>
          ))}
        </div>
      </EditorPanel>

      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white/95 p-3 backdrop-blur">
        <button type="button" onClick={() => setForm(initial)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" disabled={saving}>
          {L('撤销修改', 'Discard changes')}
        </button>
        <button type="button" onClick={save} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50" disabled={saving}>
          {saving ? L('保存中…', 'Saving…') : L('保存修改', 'Save changes')}
        </button>
      </div>
    </div>
  );
}
