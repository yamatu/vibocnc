'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Category } from '@/types';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

type Props = {
  tree: Category[];
  selectedCategoryId: number | null;
  onSelectCategory: (categoryId: number | null) => void;
  storageKey?: string;
  allLabel?: string;
};

export default function CategoryFilterTree({
  tree,
  selectedCategoryId,
  onSelectCategory,
  storageKey = 'products-category-open-ids',
  allLabel = 'All Products',
}: Props) {
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);

  // Load persisted state
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      const restored = new Set<number>();
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) restored.add(n);
        }
      }
      setOpenIds(restored);
    } catch {
      setOpenIds(new Set());
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(openIds)));
    } catch {
      // ignore
    }
  }, [hydrated, openIds, storageKey]);

  const toggle = (id: number) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: Category, depth: number) => {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const isOpen = openIds.has(node.id);
    const isSelected = selectedCategoryId === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
            isSelected ? 'bg-blue-50 text-[#0b3e75] ring-1 ring-blue-100' : 'text-slate-700 hover:bg-slate-100 hover:text-[#0b3e75]'
          )}
        >
          <div style={{ width: depth * 12 }} />
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              className="p-0.5 rounded text-slate-500 hover:bg-slate-200 hover:text-[#0b3e75]"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              {isOpen ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
            </button>
          ) : (
            <div className="w-5" />
          )}

          <button
            type="button"
            onClick={() => onSelectCategory(node.id)}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium"
          >
            {node.name}
          </button>
        </div>

        {hasChildren && isOpen ? (
          <div className="mt-1 space-y-1">{node.children!.map((c) => renderNode(c, depth + 1))}</div>
        ) : null}
      </div>
    );
  };

  const hasSelection = useMemo(() => selectedCategoryId != null, [selectedCategoryId]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => onSelectCategory(null)}
        className={cn(
          'w-full rounded-md px-2 py-2 text-left text-sm font-medium',
          !hasSelection ? 'bg-blue-50 text-[#0b3e75] ring-1 ring-blue-100' : 'text-slate-700 hover:bg-slate-100 hover:text-[#0b3e75]'
        )}
      >
        {allLabel}
      </button>
      <div className="space-y-1">{tree.map((n) => renderNode(n, 0))}</div>
    </div>
  );
}
