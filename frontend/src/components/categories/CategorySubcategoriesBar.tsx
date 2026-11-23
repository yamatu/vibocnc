'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

export interface SubcategoryBarItem {
  id: number;
  name: string;
  href: string;
  count: number;
}

interface CategorySubcategoriesBarProps {
  displayName: string;
  subcategories: SubcategoryBarItem[];
  locale?: string;
  initialLimit?: number;
}

export default function CategorySubcategoriesBar({
  displayName,
  subcategories,
  locale = 'en',
  initialLimit = 8,
}: CategorySubcategoriesBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  const total = subcategories.length;
  const hasOverflow = total > initialLimit;
  const normalizedQuery = query.trim().toLowerCase();
  const isZh = locale === 'zh';

  const visibleItems = useMemo(() => {
    if (!expanded) {
      return subcategories.slice(0, initialLimit);
    }
    if (!normalizedQuery) {
      return subcategories;
    }
    return subcategories.filter((item) =>
      item.name.toLowerCase().includes(normalizedQuery),
    );
  }, [expanded, initialLimit, normalizedQuery, subcategories]);

  if (total === 0) return null;

  const remainingCount = Math.max(0, total - initialLimit);

  return (
    <div className="site-panel mb-4 p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {hasOverflow && !expanded
              ? isZh
                ? `热门 ${displayName} 子分类`
                : `Popular ${displayName} Subcategories`
              : isZh
                ? `${displayName} 子分类`
                : `${displayName} Subcategories`}
          </h2>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {total}
          </span>
        </div>

        {hasOverflow && (
          <button
            type="button"
            onClick={() => {
              setExpanded((prev) => {
                if (prev) setQuery('');
                return !prev;
              });
            }}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-800 transition-colors"
          >
            {expanded ? (
              <>
                <span>{isZh ? '收起' : 'Show less'}</span>
                <ChevronUpIcon className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <span>{isZh ? `展开全部 ${total}` : `Show all ${total}`}</span>
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        )}
      </div>

      {expanded && hasOverflow && (
        <div className="relative mb-2.5">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isZh
                ? `筛选 ${total} 个子分类（如 PLC、伺服、线缆）...`
                : `Filter ${total} subcategories (e.g. PLC, servo, cable)...`
            }
            aria-label={`Filter ${displayName} subcategories`}
            className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[var(--site-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--site-primary)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear subcategory filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {visibleItems.length > 0 ? (
        <div
          className={
            expanded
              ? 'max-h-60 overflow-y-auto overscroll-contain pr-1 flex flex-wrap gap-1.5'
              : 'flex flex-wrap gap-1.5'
          }
        >
          {visibleItems.map((child) => (
            <Link prefetch={false}
              key={child.id}
              href={child.href}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-900 transition-colors"
            >
              <span>{child.name}</span>
              <span className="text-[11px] text-slate-500">({child.count})</span>
            </Link>
          ))}

          {!expanded && remainingCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-blue-400 bg-blue-50/70 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100 transition-colors"
            >
              {isZh ? `还有 ${remainingCount} 个` : `+${remainingCount} more`}
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span>
            {isZh
              ? `未找到匹配 "${query}" 的子分类。`
              : `No subcategories match "${query}".`}
          </span>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="font-semibold text-[var(--site-primary)] hover:underline"
          >
            {isZh ? '重置' : 'Reset'}
          </button>
        </div>
      )}
    </div>
  );
}
