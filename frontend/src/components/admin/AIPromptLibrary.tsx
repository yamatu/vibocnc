'use client';

// ---------------------------------------------------------------------------
// Prompt library for the admin AI assistant.
//
// The assistant's instruction box used to offer four hard-coded suggestions and
// nothing else, so a long instruction (a bulk model import list, a recurring
// SEO audit brief, a fixed translation wording) had to be kept outside the
// product and retyped every time. This panel is the in-product home for those
// instructions: save once, then insert into the box or copy to the clipboard in
// one click, filter by tag, and pin the ones used every day.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  AIAgentPromptPreset,
  AIAgentPromptPresetInput,
  AIAgentService,
} from '@/services/ai-agent.service';

interface AIPromptLibraryProps {
  zh: boolean;
  /** Puts the preset text into the chat box (replacing what is already there). */
  onInsert: (content: string) => void;
}

type EditorState = {
  id: number | null;
  name: string;
  content: string;
  tags: string;
};

const EMPTY_EDITOR: EditorState = { id: null, name: '', content: '', tags: '' };

function splitTags(tags: string): string[] {
  return (tags || '')
    .split(/[,，;；]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default function AIPromptLibrary({ zh, onInsert }: AIPromptLibraryProps) {
  const [presets, setPresets] = useState<AIAgentPromptPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await AIAgentService.listPromptPresets();
      setPresets(items);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the prompt library');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Every tag in the library, with how many presets carry it, so the filter row
  // only offers tags that actually exist.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    presets.forEach((preset) => {
      splitTags(preset.tags).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  }, [presets]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return presets.filter((preset) => {
      if (activeTag && !splitTags(preset.tags).includes(activeTag)) return false;
      if (!needle) return true;
      return (
        preset.name.toLowerCase().includes(needle) ||
        preset.content.toLowerCase().includes(needle) ||
        preset.tags.toLowerCase().includes(needle)
      );
    });
  }, [presets, search, activeTag]);

  const handleInsert = (preset: AIAgentPromptPreset) => {
    onInsert(preset.content);
    // Optimistic: the counter is cosmetic, so the UI does not wait for the round trip.
    setPresets((previous) => previous.map((item) => (item.id === preset.id ? { ...item, usage_count: item.usage_count + 1 } : item)));
    void AIAgentService.markPromptPresetUsed(preset.id);
    toast.success(zh ? `已插入「${preset.name}」` : `Inserted "${preset.name}"`);
  };

  const handleCopy = async (preset: AIAgentPromptPreset) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(preset.content);
      } else {
        const helper = document.createElement('textarea');
        helper.value = preset.content;
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        document.body.removeChild(helper);
      }
      setCopiedId(preset.id);
      window.setTimeout(() => setCopiedId((current) => (current === preset.id ? null : current)), 1500);
      toast.success(zh ? '已复制到剪贴板' : 'Copied to clipboard');
    } catch {
      toast.error(zh ? '复制失败，请手动选择文本' : 'Copy failed; select the text manually');
    }
  };

  const handleToggleFavorite = async (preset: AIAgentPromptPreset) => {
    const next = !preset.is_favorite;
    setPresets((previous) => previous.map((item) => (item.id === preset.id ? { ...item, is_favorite: next } : item)));
    try {
      await AIAgentService.updatePromptPreset(preset.id, { is_favorite: next });
    } catch (toggleError) {
      setPresets((previous) => previous.map((item) => (item.id === preset.id ? { ...item, is_favorite: !next } : item)));
      toast.error(toggleError instanceof Error ? toggleError.message : 'Unable to update the prompt');
    }
  };

  const handleDelete = async (preset: AIAgentPromptPreset) => {
    if (!window.confirm(zh ? `删除提示词「${preset.name}」？` : `Delete prompt "${preset.name}"?`)) return;
    try {
      await AIAgentService.deletePromptPreset(preset.id);
      setPresets((previous) => previous.filter((item) => item.id !== preset.id));
      toast.success(zh ? '提示词已删除' : 'Prompt deleted');
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Unable to delete the prompt');
    }
  };

  const handleSubmit = async () => {
    if (!editor) return;
    const payload: AIAgentPromptPresetInput = {
      name: editor.name.trim(),
      content: editor.content.trim(),
      tags: editor.tags.trim(),
    };
    if (!payload.name || !payload.content) {
      toast.error(zh ? '名称和内容不能为空' : 'Name and content are required');
      return;
    }
    setSaving(true);
    try {
      if (editor.id) {
        const updated = await AIAgentService.updatePromptPreset(editor.id, payload);
        setPresets((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
        toast.success(zh ? '提示词已更新' : 'Prompt updated');
      } else {
        const created = await AIAgentService.createPromptPreset(payload);
        setPresets((previous) => [created, ...previous]);
        toast.success(zh ? '提示词已保存' : 'Prompt saved');
      }
      setEditor(null);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to save the prompt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white" role="region" aria-label={zh ? '提示词库' : 'Prompt library'}>
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-gray-300 px-2 py-1 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100">
          <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={zh ? '搜索提示词…' : 'Search prompts…'}
            className="min-w-0 flex-1 border-0 bg-transparent text-xs outline-none placeholder:text-gray-400"
            aria-label={zh ? '搜索提示词' : 'Search prompts'}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="rounded p-0.5 text-gray-400 hover:bg-gray-100" aria-label={zh ? '清空搜索' : 'Clear search'}>
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditor({ ...EMPTY_EDITOR })}
          className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {zh ? '新建' : 'New'}
        </button>
      </div>

      {tagCounts.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-gray-100 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setActiveTag('')}
            className={`rounded-full px-2 py-0.5 text-[11px] ${activeTag === '' ? 'bg-violet-100 font-semibold text-violet-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {zh ? '全部' : 'All'}
          </button>
          {tagCounts.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
              className={`rounded-full px-2 py-0.5 text-[11px] ${activeTag === tag ? 'bg-violet-100 font-semibold text-violet-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {tag} · {count}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && <p className="py-6 text-center text-xs text-gray-500">{zh ? '正在加载提示词库…' : 'Loading the prompt library…'}</p>}
        {!loading && error && (
          <div className="mx-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-900">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="mt-1 font-semibold underline">
              {zh ? '重试' : 'Retry'}
            </button>
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <p className="py-6 text-center text-xs text-gray-500">
            {presets.length === 0
              ? (zh ? '还没有保存的提示词，点右上角「新建」添加。' : 'No saved prompts yet. Use "New" to add one.')
              : (zh ? '没有匹配的提示词。' : 'No prompts match this filter.')}
          </p>
        )}

        {visible.map((preset) => (
          <article key={preset.id} className="mb-1.5 rounded-lg border border-gray-200 bg-white p-2 hover:border-violet-200">
            <div className="flex items-start gap-1.5">
              <button
                type="button"
                onClick={() => void handleToggleFavorite(preset)}
                className={`mt-0.5 rounded p-0.5 ${preset.is_favorite ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
                title={preset.is_favorite ? (zh ? '取消置顶' : 'Unpin') : (zh ? '置顶常用' : 'Pin to top')}
                aria-label={preset.is_favorite ? (zh ? '取消置顶' : 'Unpin') : (zh ? '置顶常用' : 'Pin to top')}
              >
                <StarIcon className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-gray-800">{preset.name}</p>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[11px] leading-4 text-gray-500">{preset.content}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {splitTags(preset.tags).map((tag) => (
                    <span key={tag} className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">{tag}</span>
                  ))}
                  {preset.usage_count > 0 && <span className="text-[10px] text-gray-400">{zh ? `用过 ${preset.usage_count} 次` : `used ${preset.usage_count}×`}</span>}
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleInsert(preset)}
                className="rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-700"
              >
                {zh ? '插入到输入框' : 'Insert'}
              </button>
              <button
                type="button"
                onClick={() => void handleCopy(preset)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                {copiedId === preset.id ? <ClipboardDocumentCheckIcon className="h-3 w-3 text-emerald-600" /> : <ClipboardDocumentIcon className="h-3 w-3" />}
                {copiedId === preset.id ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}
              </button>
              <button
                type="button"
                onClick={() => setEditor({ id: preset.id, name: preset.name, content: preset.content, tags: preset.tags })}
                className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label={zh ? '编辑提示词' : 'Edit prompt'}
              >
                <PencilSquareIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(preset)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                aria-label={zh ? '删除提示词' : 'Delete prompt'}
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </article>
        ))}
      </div>

      {editor && (
        <div className="border-t border-gray-200 bg-slate-50 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">{editor.id ? (zh ? '编辑提示词' : 'Edit prompt') : (zh ? '新建提示词' : 'New prompt')}</p>
            <button type="button" onClick={() => setEditor(null)} className="rounded p-0.5 text-gray-400 hover:bg-gray-200" aria-label={zh ? '关闭编辑器' : 'Close editor'}>
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            value={editor.name}
            onChange={(event) => setEditor({ ...editor, name: event.target.value })}
            placeholder={zh ? '名称，例如：批量型号入库' : 'Name, for example: bulk model import'}
            className="mb-1.5 w-full rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500"
          />
          <textarea
            value={editor.content}
            onChange={(event) => setEditor({ ...editor, content: event.target.value })}
            rows={4}
            placeholder={zh ? '提示词内容，可以带型号列表占位' : 'Prompt content, model list placeholder allowed'}
            className="mb-1.5 w-full resize-y rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500"
          />
          <input
            value={editor.tags}
            onChange={(event) => setEditor({ ...editor, tags: event.target.value })}
            placeholder={zh ? '标签，用逗号分隔，例如：product,import' : 'Tags, comma separated, for example: product,import'}
            className="mb-1.5 w-full rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:border-violet-500"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:bg-gray-300"
            >
              {saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}
            </button>
            <button type="button" onClick={() => setEditor(null)} className="rounded-md border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-100">
              {zh ? '取消' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
