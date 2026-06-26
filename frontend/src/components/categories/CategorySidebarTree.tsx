'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Category } from '@/types';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

type Props = {
  tree: Category[];
  activeCategoryId: number;
  defaultOpenIds?: number[];
  storageKey?: string;
};

function nodeHref(node: Category): string {
  return `/categories/${node.path || node.slug}`;
}

export default function CategorySidebarTree({
  tree,
  activeCategoryId,
  defaultOpenIds = [],
  storageKey = 'category-sidebar-open-ids',
}: Props) {
  const defaultOpenSet = useMemo(() => new Set<number>(defaultOpenIds), [defaultOpenIds]);
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);

  // Load persisted state on mount
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
      for (const id of defaultOpenSet) restored.add(id);
      setOpenIds(restored);
    } catch {
      setOpenIds(new Set(defaultOpenSet));
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  // Ensure the current breadcrumb is open (without wiping user's state)
  useEffect(() => {
    if (!hydrated) return;
    if (defaultOpenSet.size === 0) return;
    setOpenIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of defaultOpenSet) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [hydrated, defaultOpenSet]);

  // Persist on change
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
    const isActive = node.id === activeCategoryId;

    return (
      <div key={node.id}>
        <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${isActive ? 'bg-blue-50 text-[#0b3e75] ring-1 ring-blue-100' : 'text-slate-700 hover:bg-slate-100 hover:text-[#0b3e75]'}`}>
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

          <Link
            href={nodeHref(node)}
            scroll={false}
            onClick={() => {
              try {
                window.sessionStorage.setItem('category-scroll-y', String(window.scrollY || 0));
              } catch {
                // ignore
              }
            }}
            className="truncate text-sm font-medium"
          >
            {node.name}
          </Link>
        </div>

        {hasChildren && isOpen && (
          <div className="mt-1 space-y-1">
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return <div className="space-y-1">{tree.map((n) => renderNode(n, 0))}</div>;
}
