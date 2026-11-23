'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryNavigationNode } from '@/types';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { localizeCategoryContent } from '@/lib/i18n/content';
import { CategoryService } from '@/services/category.service';
import { buildFullPublicNavigationTree } from '@/lib/category-listing';
import { findCategoryTrail, prioritizeCategoryTrail } from '@/lib/category-navigation';

type Props = {
  tree: CategoryNavigationNode[];
  activeCategoryId: number;
  defaultOpenIds?: number[];
  storageKey?: string;
  totalRootCount?: number;
  allCategoriesHref?: string;
};

function nodeHref(node: CategoryNavigationNode): string {
  return `/categories/${node.path || node.slug}`;
}

function countTreeNodes(nodes: CategoryNavigationNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (Array.isArray(node.children) && node.children.length > 0) {
      count += countTreeNodes(node.children);
    }
  }
  return count;
}

function filterTreeByQuery(
  nodes: CategoryNavigationNode[],
  query: string,
): CategoryNavigationNode[] {
  const out: CategoryNavigationNode[] = [];
  for (const node of nodes) {
    const matchesSelf = node.name.toLowerCase().includes(query);
    const filteredChildren =
      Array.isArray(node.children) && node.children.length > 0
        ? filterTreeByQuery(node.children, query)
        : [];
    if (matchesSelf) {
      out.push(node);
    } else if (filteredChildren.length > 0) {
      out.push({ ...node, children: filteredChildren });
    }
  }
  return out;
}

export default function CategorySidebarTree({
  tree,
  activeCategoryId,
  defaultOpenIds = [],
  storageKey = 'category-sidebar-open-ids',
  totalRootCount,
  allCategoriesHref = '/categories',
}: Props) {
  const { href, locale, t } = usePublicI18n();
  const [fullTree, setFullTree] = useState<CategoryNavigationNode[] | null>(null);
  const [loadingFullTree, setLoadingFullTree] = useState(false);
  const [showAllRoots, setShowAllRoots] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const fetchPromiseRef = useRef<Promise<CategoryNavigationNode[] | null> | null>(null);

  const displayTree = useMemo(() => {
    if (fullTree) {
      return showAllRoots ? fullTree : fullTree.slice(0, Math.max(tree.length, 25));
    }
    return tree;
  }, [fullTree, showAllRoots, tree]);

  const trail = useMemo(() => findCategoryTrail(displayTree, activeCategoryId), [displayTree, activeCategoryId]);
  const defaultOpenSet = useMemo(() => new Set<number>([...defaultOpenIds, ...trail]), [defaultOpenIds, trail]);
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const normalizedQuery = filterQuery.trim().toLowerCase();
  const totalLoadedNodes = useMemo(() => countTreeNodes(displayTree), [displayTree]);
  const visibleTree = useMemo(() => {
    if (!normalizedQuery) return displayTree;
    return filterTreeByQuery(fullTree || displayTree, normalizedQuery);
  }, [displayTree, fullTree, normalizedQuery]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activeCategoryId]);

  const ensureFullTree = useCallback(async (): Promise<CategoryNavigationNode[] | null> => {
    if (fullTree) return fullTree;
    if (fetchPromiseRef.current) return fetchPromiseRef.current;

    setLoadingFullTree(true);
    const promise = CategoryService.getCategories()
      .then((raw) => {
        const localized = raw.map((item) => localizeCategoryContent(item, locale));
        const normalized = buildFullPublicNavigationTree(localized, activeCategoryId);
        setFullTree(normalized);
        return normalized;
      })
      .catch(() => null)
      .finally(() => {
        setLoadingFullTree(false);
        fetchPromiseRef.current = null;
      });
    fetchPromiseRef.current = promise;
    return promise;
  }, [fullTree, locale, activeCategoryId]);

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
  }, [storageKey, defaultOpenSet]);

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

  const handleToggle = async (node: CategoryNavigationNode) => {
    const hasLoadedChildren = Array.isArray(node.children) && node.children.length > 0;
    if (!hasLoadedChildren && Number(node.child_count || 0) > 0) {
      await ensureFullTree();
      setOpenIds((prev) => {
        const next = new Set(prev);
        next.add(node.id);
        return next;
      });
      return;
    }

    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const renderNode = (node: CategoryNavigationNode, depth: number) => {
    const hasLoadedChildren = Array.isArray(node.children) && node.children.length > 0;
    const hasExpandableChildren = hasLoadedChildren || Number(node.child_count || 0) > 0;
    const isOpen =
      hasLoadedChildren &&
      (Boolean(normalizedQuery) || openIds.has(node.id) || (!hydrated && trail.includes(node.id)));
    const isActive = node.id === activeCategoryId;

    return (
      <div key={node.id}>
        <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${isActive ? 'bg-blue-50 text-[var(--site-primary)] ring-1 ring-blue-100' : 'text-slate-700 hover:bg-slate-100 hover:text-[var(--site-primary)]'}`}>
          <div style={{ width: depth * 12 }} />
          {hasExpandableChildren ? (
            <button
              type="button"
              onClick={() => void handleToggle(node)}
              className="p-0.5 rounded text-slate-500 hover:bg-slate-200 hover:text-[var(--site-primary)]"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              aria-expanded={isOpen}
            >
              {isOpen ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
            </button>
          ) : (
            <div className="w-5" />
          )}

          <Link prefetch={false}
            aria-current={isActive ? 'page' : undefined}
            href={href(nodeHref(node))}
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

        {hasLoadedChildren && isOpen && (
          <div className="mt-1 space-y-1">
            {prioritizeCategoryTrail(node.children!, trail).map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const effectiveTotalRoots = fullTree?.length ?? totalRootCount ?? displayTree.length;
  const hasMoreRoots = !normalizedQuery && !showAllRoots && effectiveTotalRoots > displayTree.length;

  return (
    <div className="space-y-2">
      {totalLoadedNodes > 20 && (
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={locale === 'zh' ? '快速筛选分类...' : 'Quick filter categories...'}
            aria-label="Quick filter categories"
            className="w-full rounded-md border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[var(--site-primary)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--site-primary)]"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery('')}
              aria-label="Clear category filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="max-h-[65vh] space-y-1 overflow-y-auto overscroll-contain">
        {visibleTree.length > 0 ? (
          prioritizeCategoryTrail(visibleTree, trail).map((n) => renderNode(n, 0))
        ) : (
          <div className="px-2 py-4 text-center text-xs text-slate-500">
            {locale === 'zh' ? '未找到匹配分类。' : 'No matching categories.'}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
        {hasMoreRoots && (
          <button
            type="button"
            onClick={async () => {
              await ensureFullTree();
              setShowAllRoots(true);
            }}
            disabled={loadingFullTree}
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-center text-xs font-semibold text-slate-700 hover:border-[var(--site-primary)] hover:bg-blue-50 hover:text-[var(--site-primary)] disabled:opacity-60"
          >
            {loadingFullTree
              ? t('common.loading')
              : locale === 'zh'
                ? `展开全部 ${effectiveTotalRoots} 个品牌`
                : `Show all ${effectiveTotalRoots} brands`}
          </button>
        )}
        <Link prefetch={false}
          href={href(allCategoriesHref)}
          className="block text-center text-xs font-semibold text-[var(--site-primary)] hover:text-orange-700"
        >
          {t('products.allCategories')} →
        </Link>
      </div>
    </div>
  );
}
