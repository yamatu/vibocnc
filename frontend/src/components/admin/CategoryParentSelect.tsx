'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { Category } from '@/types';
import { useAdminI18n } from '@/lib/admin-i18n';

interface CategoryParentSelectProps {
  categories: Category[];
  value: string;
  onChange: (value: string) => void;
  /** Category being edited. It and its descendants are hidden to prevent cycles. */
  excludeId?: number | null;
  disabled?: boolean;
}

interface Option {
  id: number;
  name: string;
  path: string;
  depth: number;
}

const MAX_VISIBLE_RESULTS = 200;

/**
 * Searchable parent picker. A native select becomes unusable once the taxonomy
 * reaches a few hundred entries, which is the normal state of this catalogue,
 * so the parent is chosen from a filtered list instead.
 */
export default function CategoryParentSelect({
  categories,
  value,
  onChange,
  excludeId,
  disabled,
}: CategoryParentSelectProps) {
  const { locale, t } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const options = useMemo<Option[]>(() => {
    const byParent = new Map<number | null, Category[]>();
    for (const category of categories) {
      const pid = category.parent_id ? Number(category.parent_id) : null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(category);
    }

    const sort = (a: Category, b: Category) => {
      const ao = Number(a.sort_order ?? 0);
      const bo = Number(b.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), locale === 'zh' ? 'zh' : 'en');
    };
    for (const list of byParent.values()) list.sort(sort);

    // Excluding the edited node also removes every descendant, which is what
    // keeps a category from being reparented into itself.
    const blocked = new Set<number>();
    if (excludeId) {
      blocked.add(Number(excludeId));
      const queue = [Number(excludeId)];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const child of byParent.get(current) || []) {
          const childId = Number(child.id);
          if (blocked.has(childId)) continue;
          blocked.add(childId);
          queue.push(childId);
        }
      }
    }

    const out: Option[] = [];
    const walk = (pid: number | null, depth: number) => {
      for (const category of byParent.get(pid) || []) {
        const id = Number(category.id);
        if (blocked.has(id)) continue;
        out.push({
          id,
          name: category.name,
          path: `/${category.path || category.slug}`,
          depth,
        });
        walk(id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [categories, excludeId, locale]);

  const selected = useMemo(
    () => options.find((option) => String(option.id) === value) || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.name.toLowerCase().includes(q) || option.path.toLowerCase().includes(q),
    );
  }, [options, query]);

  const visible = filtered.slice(0, MAX_VISIBLE_RESULTS);
  const truncated = filtered.length - visible.length;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      searchRef.current?.focus();
    }
  }, [open]);

  const commit = (option: Option | null) => {
    onChange(option ? String(option.id) : '');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((prev) => Math.min(visible.length - 1, prev + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((prev) => Math.max(0, prev - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[highlight];
      if (option) commit(option);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate text-sm">
          {selected ? (
            <>
              <span className="text-gray-900">{selected.name}</span>
              <span className="ml-2 font-mono text-xs text-gray-400">{selected.path}</span>
            </>
          ) : (
            <span className="text-gray-900">
              {t('categories.parentSelect.root', locale === 'zh' ? '（顶级分类）' : '(Root category)')}
            </span>
          )}
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-gray-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={t('categories.parentSelect.search', locale === 'zh' ? '搜索名称或路径…' : 'Search name or path…')}
              className="w-full border-0 p-0 text-sm focus:outline-none focus:ring-0"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => commit(null)}
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-blue-50 ${!selected ? 'font-semibold text-blue-700' : 'text-gray-700'}`}
            >
              {t('categories.parentSelect.root', locale === 'zh' ? '（顶级分类）' : '(Root category)')}
            </button>

            {visible.map((option, index) => (
              <button
                key={option.id}
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(option)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  index === highlight ? 'bg-blue-50' : ''
                } ${option.id === Number(value) ? 'font-semibold text-blue-700' : 'text-gray-700'}`}
              >
                <span style={{ width: option.depth * 12 }} />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <span className="shrink-0 font-mono text-xs text-gray-400">{option.path}</span>
              </button>
            ))}

            {visible.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-gray-500">
                {t('categories.parentSelect.empty', locale === 'zh' ? '没有匹配的分类' : 'No matching categories')}
              </div>
            ) : null}

            {truncated > 0 ? (
              <div className="px-3 py-2 text-center text-xs text-gray-500">
                {locale === 'zh'
                  ? `还有 ${truncated} 个结果，请输入更精确的关键词`
                  : `${truncated} more results — refine your search`}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
