'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bars3Icon, DocumentDuplicateIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import EditorPanel from '@/components/admin/homepage/EditorPanel';
import ImageField from '@/components/admin/homepage/ImageField';
import { SortableList } from '@/components/admin/homepage/SortableList';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { useAdminI18n } from '@/lib/admin-i18n';
import {
  TEMPLATE_DEFINITIONS,
  getTemplateDefinition,
  templateModelToPayload,
  toTemplateModel,
  type ItemField,
  type SectionBackground,
  type SectionStyle,
  type TemplateItem,
  type TemplateSectionModel,
} from '@/lib/section-templates';
import type { HomepageContent } from '@/types';

type Row = TemplateItem & { id: string };
type State = Omit<TemplateSectionModel, 'items'> & { items: Row[]; is_active: boolean };

let seq = 0;
const rid = () => `item-${Date.now().toString(36)}-${seq++}`;

function fromContent(content: HomepageContent): State {
  const model = toTemplateModel(content)!;
  return { ...model, items: model.items.map((it) => ({ ...it, id: rid() })), is_active: content.is_active !== false };
}

function toPayload(state: State, content: HomepageContent): SectionPayload {
  const { is_active, items, ...model } = state;
  const base = templateModelToPayload({
    ...model,
    items: items.map((row) => ({ title: row.title, text: row.text, image: row.image, value: row.value, href: row.href })),
  });
  return { ...base, is_active, sort_order: Number(content.sort_order ?? 999) };
}

const BACKGROUNDS: Array<{ id: SectionBackground; zh: string; en: string; swatch: string }> = [
  { id: 'white', zh: '白色', en: 'White', swatch: 'bg-white' },
  { id: 'light', zh: '浅色', en: 'Light', swatch: 'bg-blue-50' },
  { id: 'brand', zh: '品牌色', en: 'Brand', swatch: 'bg-gradient-to-br from-blue-600 to-blue-800' },
  { id: 'dark', zh: '深色', en: 'Dark', swatch: 'bg-slate-900' },
  { id: 'image', zh: '背景图', en: 'Image', swatch: 'bg-[linear-gradient(135deg,#94a3b8,#334155)]' },
];

const FIELD_LABELS: Record<ItemField, { zh: string; en: string }> = {
  title: { zh: '标题', en: 'Title' },
  text: { zh: '说明', en: 'Text' },
  image: { zh: '图片', en: 'Image' },
  value: { zh: '数值', en: 'Value' },
  href: { zh: '链接', en: 'Link' },
};

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${value === o.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function TemplateSectionEditor({
  content,
  onSave,
  onDraftChange,
}: {
  content: HomepageContent;
  onSave: (payload: SectionPayload) => Promise<void>;
  onDraftChange?: (payload: SectionPayload) => void;
}) {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const L = (z: string, e: string) => (zh ? z : e);
  const initial = useMemo(() => fromContent(content), [content]);
  const [state, setState] = useState<State>(initial);
  const [saving, setSaving] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => setState(initial), [initial]);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    onDraftChange?.(toPayload(state, content));
  }, [state, content, onDraftChange]);

  const def = getTemplateDefinition(state.template)!;
  const set = <K extends keyof State>(key: K, value: State[K]) => setState((s) => ({ ...s, [key]: value }));
  const setStyle = <K extends keyof SectionStyle>(key: K, value: SectionStyle[K]) =>
    setState((s) => ({ ...s, style: { ...s.style, [key]: value } }));
  const updateItem = (id: string, patch: Partial<TemplateItem>) =>
    setState((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500';
  const has = (opt: keyof SectionStyle) => def.styleOptions.includes(opt);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(toPayload(state, content));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm">
        <span className="font-medium text-blue-900">{L('区块样式', 'Block style')}:</span>
        <select
          value={state.template}
          onChange={(e) => set('template', e.target.value as State['template'])}
          className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-sm"
        >
          {TEMPLATE_DEFINITIONS.map((t) => <option key={t.id} value={t.id}>{zh ? t.name.zh : t.name.en}</option>)}
        </select>
        <span className="text-xs text-blue-800/70">{zh ? def.description.zh : def.description.en}</span>
      </div>

      <EditorPanel title={L('内容', 'Content')}>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('小标签', 'Kicker')}</span>
            <input value={state.kicker} onChange={(e) => set('kicker', e.target.value)} className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('标题', 'Title')}</span>
            <input value={state.title} onChange={(e) => set('title', e.target.value)} className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('副标题', 'Subtitle')}</span>
            <input value={state.subtitle} onChange={(e) => set('subtitle', e.target.value)} className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{L('正文', 'Body text')}</span>
            <textarea rows={4} value={state.description} onChange={(e) => set('description', e.target.value)} className={input} />
          </label>
          {def.usesImage ? <ImageField label={L('主图', 'Main image')} value={state.image} onChange={(v) => set('image', v)} /> : null}
          <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('主按钮文字', 'Primary button')}</span>
              <input value={state.buttonText} onChange={(e) => set('buttonText', e.target.value)} className={input} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('主按钮链接', 'Primary link')}</span>
              <input value={state.buttonHref} onChange={(e) => set('buttonHref', e.target.value)} placeholder="/contact" className={input} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('次按钮文字', 'Secondary button')}</span>
              <input value={state.secondaryText} onChange={(e) => set('secondaryText', e.target.value)} className={input} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">{L('次按钮链接', 'Secondary link')}</span>
              <input value={state.secondaryHref} onChange={(e) => set('secondaryHref', e.target.value)} placeholder="/about" className={input} />
            </label>
          </div>
        </div>
      </EditorPanel>

      {def.itemFields.length > 0 ? (
        <EditorPanel title={`${zh ? def.itemLabel.zh : def.itemLabel.en} (${state.items.length})`}>
          <SortableList items={state.items} onReorder={(next) => set('items', next)}>
            {(item, drag) => (
              <div className="mb-2 rounded-xl border border-gray-200 bg-white p-3">
                <div className="mb-2 flex items-center gap-2">
                  <button type="button" ref={drag.setActivatorNodeRef} {...drag.attributes} {...drag.listeners} className="cursor-grab touch-none rounded p-1 text-gray-400 hover:bg-gray-100" aria-label={L('拖动排序', 'Drag to reorder')}>
                    <Bars3Icon className="h-5 w-5" />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{item.title || item.value || L('（未填写）', '(empty)')}</span>
                  <button type="button" onClick={() => set('items', [...state.items, { ...item, id: rid() }])} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label={L('复制', 'Duplicate')}>
                    <DocumentDuplicateIcon className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => set('items', state.items.filter((it) => it.id !== item.id))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={L('删除', 'Remove')}>
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-2">
                  {def.itemFields.includes('image') ? (
                    <ImageField
                      value={item.image}
                      aspect={state.template === 'logo_wall' ? 'logo' : 'wide'}
                      onChange={(v) => updateItem(item.id, { image: v })}
                    />
                  ) : null}
                  {def.itemFields.filter((f) => f !== 'image').map((field) => (
                    field === 'text' ? (
                      <textarea key={field} rows={2} value={item.text} placeholder={zh ? FIELD_LABELS.text.zh : FIELD_LABELS.text.en} onChange={(e) => updateItem(item.id, { text: e.target.value })} className={input} />
                    ) : (
                      <input key={field} value={item[field]} placeholder={zh ? FIELD_LABELS[field].zh : FIELD_LABELS[field].en} onChange={(e) => updateItem(item.id, { [field]: e.target.value })} className={input} />
                    )
                  ))}
                </div>
              </div>
            )}
          </SortableList>
          <button
            type="button"
            onClick={() => set('items', [...state.items, { id: rid(), title: '', text: '', image: '', value: '', href: '' }])}
            className="mt-1 inline-flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-blue-400 hover:text-blue-700"
          >
            <PlusIcon className="h-4 w-4" />{L(`添加${def.itemLabel.zh}`, `Add ${def.itemLabel.en.toLowerCase()}`)}
          </button>
        </EditorPanel>
      ) : null}

      <EditorPanel title={L('样式', 'Style')}>
        <div className="space-y-4 text-sm">
          {has('background') ? (
            <div>
              <span className="mb-2 block font-medium text-gray-700">{L('背景', 'Background')}</span>
              <div className="flex flex-wrap gap-2">
                {BACKGROUNDS.map((bg) => (
                  <button
                    key={bg.id}
                    type="button"
                    onClick={() => setStyle('background', bg.id)}
                    className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-xs ${state.style.background === bg.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <span className={`h-8 w-12 rounded-md border border-gray-200 ${bg.swatch}`} />
                    {zh ? bg.zh : bg.en}
                  </button>
                ))}
              </div>
              {state.style.background === 'image' ? (
                <div className="mt-3">
                  <ImageField label={L('背景图片', 'Background image')} value={state.style.backgroundImage} onChange={(v) => setStyle('backgroundImage', v)} />
                </div>
              ) : null}
            </div>
          ) : null}
          {has('imagePosition') ? (
            <div>
              <span className="mb-2 block font-medium text-gray-700">{L('图片位置', 'Image position')}</span>
              <Segmented value={state.style.imagePosition} onChange={(v) => setStyle('imagePosition', v)} options={[{ value: 'left', label: L('左侧', 'Left') }, { value: 'right', label: L('右侧', 'Right') }]} />
            </div>
          ) : null}
          {has('columns') ? (
            <div>
              <span className="mb-2 block font-medium text-gray-700">{L('每行列数', 'Columns')}</span>
              <Segmented value={state.style.columns} onChange={(v) => setStyle('columns', v)} options={[{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]} />
            </div>
          ) : null}
          {has('align') ? (
            <div>
              <span className="mb-2 block font-medium text-gray-700">{L('对齐', 'Alignment')}</span>
              <Segmented value={state.style.align} onChange={(v) => setStyle('align', v)} options={[{ value: 'left', label: L('左对齐', 'Left') }, { value: 'center', label: L('居中', 'Center') }]} />
            </div>
          ) : null}
          {has('spacing') ? (
            <div>
              <span className="mb-2 block font-medium text-gray-700">{L('上下间距', 'Spacing')}</span>
              <Segmented value={state.style.spacing} onChange={(v) => setStyle('spacing', v)} options={[{ value: 'compact', label: L('紧凑', 'Compact') }, { value: 'normal', label: L('标准', 'Normal') }, { value: 'spacious', label: L('宽松', 'Spacious') }]} />
            </div>
          ) : null}
          {has('rounded') ? (
            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" checked={state.style.rounded} onChange={(e) => setStyle('rounded', e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
              {L('圆角卡片', 'Rounded corners')}
            </label>
          ) : null}
        </div>
      </EditorPanel>

      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white/95 p-3 backdrop-blur">
        <button type="button" onClick={() => setState(initial)} disabled={saving} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
          {L('撤销修改', 'Discard changes')}
        </button>
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? L('保存中…', 'Saving…') : L('保存修改', 'Save changes')}
        </button>
      </div>
    </div>
  );
}
