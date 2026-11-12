'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { TEMPLATE_DEFINITIONS, type TemplateId } from '@/lib/section-templates';

const bar = 'rounded-sm bg-slate-300';

function Thumb({ id }: { id: TemplateId }) {
  switch (id) {
    case 'image_text':
      return (
        <div className="grid h-full grid-cols-2 items-center gap-2 p-3">
          <div className="space-y-1.5"><div className={`${bar} h-1.5 w-8 bg-blue-300`} /><div className={`${bar} h-2.5 w-full bg-slate-500`} /><div className={`${bar} h-1.5 w-4/5`} /><div className={`${bar} h-1.5 w-3/5`} /><div className="mt-2 h-3 w-10 rounded-full bg-orange-400" /></div>
          <div className="h-full rounded-md bg-gradient-to-br from-blue-200 to-blue-400" />
        </div>
      );
    case 'card_grid':
      return (
        <div className="flex h-full flex-col gap-2 p-3">
          <div className={`${bar} mx-auto h-2 w-1/2 bg-slate-500`} />
          <div className="grid flex-1 grid-cols-3 gap-1.5">{[0, 1, 2].map((i) => <div key={i} className="rounded-md border border-slate-200 bg-white p-1"><div className="h-1/2 rounded-sm bg-blue-200" /><div className={`${bar} mt-1 h-1`} /></div>)}</div>
        </div>
      );
    case 'cta_banner':
      return (
        <div className="flex h-full items-center justify-center p-3">
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800">
            <div className="h-2 w-2/3 rounded-sm bg-white/90" /><div className="h-1.5 w-1/2 rounded-sm bg-white/50" /><div className="mt-1 h-3 w-10 rounded-full bg-orange-400" />
          </div>
        </div>
      );
    case 'gallery':
      return <div className="grid h-full grid-cols-3 gap-1 p-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="rounded-sm bg-gradient-to-br from-slate-300 to-slate-400" />)}</div>;
    case 'faq':
      return <div className="flex h-full flex-col justify-center gap-1.5 p-3">{[0, 1, 2, 3].map((i) => <div key={i} className="flex h-3.5 items-center justify-between rounded border border-slate-200 bg-white px-1.5"><div className={`${bar} h-1 w-2/3`} /><span className="text-[8px] leading-none text-blue-500">+</span></div>)}</div>;
    case 'stats_band':
      return <div className="grid h-full grid-cols-4 items-center gap-1 rounded-md bg-slate-800 p-3">{[0, 1, 2, 3].map((i) => <div key={i} className="space-y-1 text-center"><div className="mx-auto h-3 w-6 rounded-sm bg-blue-300" /><div className="mx-auto h-1 w-7 rounded-sm bg-white/50" /></div>)}</div>;
    case 'steps':
      return <div className="grid h-full grid-cols-4 items-center gap-1 p-3">{[1, 2, 3, 4].map((i) => <div key={i} className="flex flex-col items-center gap-1"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[8px] font-bold text-white">{i}</span><div className={`${bar} h-1 w-6`} /></div>)}</div>;
    case 'logo_wall':
      return <div className="grid h-full grid-cols-4 items-center gap-1.5 p-3">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="flex h-5 items-center justify-center rounded border border-slate-200 bg-white"><div className="h-1.5 w-5 rounded-sm bg-slate-400" /></div>)}</div>;
    default:
      return null;
  }
}

export default function TemplateLibraryModal({
  open,
  locale,
  creating,
  onClose,
  onChoose,
}: {
  open: boolean;
  locale: string;
  creating: boolean;
  onClose: () => void;
  onChoose: (id: TemplateId) => void;
}) {
  if (!open) return null;
  const zh = locale === 'zh';
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{zh ? '添加区块' : 'Add a block'}</h2>
            <p className="text-xs text-gray-500">{zh ? '选择一个预设样式，插入后可自由修改文字、图片和样式' : 'Pick a preset style. You can edit text, images and style after inserting.'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2 lg:grid-cols-4">
          {TEMPLATE_DEFINITIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={creating}
              onClick={() => onChoose(t.id)}
              className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 text-left transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-lg disabled:opacity-50"
            >
              <div className="aspect-[16/10] bg-slate-50"><Thumb id={t.id} /></div>
              <div className="border-t border-gray-100 p-3">
                <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">{zh ? t.name.zh : t.name.en}</div>
                <div className="mt-0.5 text-xs leading-5 text-gray-500">{zh ? t.description.zh : t.description.en}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
