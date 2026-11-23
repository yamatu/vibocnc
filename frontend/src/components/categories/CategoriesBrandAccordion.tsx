'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { CategoryNavigationNode } from '@/types';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { localizeCategoryContent } from '@/lib/i18n/content';
import { CategoryService } from '@/services/category.service';
import { compareCategoriesByPopularity, isInternalCategory, toCompactNavigationNode } from '@/lib/category-listing';

export interface CategoriesBrandAccordionCopy {
  browse: string;
  products: string;
  otherBrands: string;
  viewAll: string;
}

interface CategoriesBrandAccordionProps {
  categories: CategoryNavigationNode[];
  copy: CategoriesBrandAccordionCopy;
}

const MAJOR_SECTION_MIN_PRODUCTS = 20;

// Brand-first category browser: the largest brands appear as collapsible
// sections (first expanded by default with SSR subcategories), while other
// brands lazily load their subcategories on click instead of dumping 2,000+
// hidden links into the initial DOM. Every active brand root stays a direct
// crawlable link in SSR HTML, and each brand page links to all its subcategories.
export default function CategoriesBrandAccordion({ categories, copy }: CategoriesBrandAccordionProps) {
  const { href, locale, t } = usePublicI18n();
  const [loadedChildrenByRoot, setLoadedChildrenByRoot] = useState<Record<number, CategoryNavigationNode[]>>({});
  const [loadingChildren, setLoadingChildren] = useState(false);
  const fullTreeLoadedRef = useRef(false);
  const fetchPromiseRef = useRef<Promise<Record<number, CategoryNavigationNode[]> | null> | null>(null);

  const { sections, others } = useMemo(() => {
    const sorted = [...categories]
      .filter((category) => !isInternalCategory(category) && Number(category.product_count || 0) > 0)
      .sort(compareCategoriesByPopularity);
    const major = sorted.filter((category) => Number(category.product_count || 0) >= MAJOR_SECTION_MIN_PRODUCTS);
    const sections = major.length > 0 ? major : sorted.slice(0, 24);
    const sectionIds = new Set(sections.map((category) => category.id));
    const others = sorted.filter((category) => !sectionIds.has(category.id));
    return { sections, others };
  }, [categories]);

  const [expandedId, setExpandedId] = useState<number | null>(sections[0]?.id ?? null);

  const ensureAllSubcategoriesLoaded = useCallback(async () => {
    if (fullTreeLoadedRef.current) return loadedChildrenByRoot;
    if (fetchPromiseRef.current) return fetchPromiseRef.current;

    setLoadingChildren(true);
    const promise = CategoryService.getCategories()
      .then((raw) => {
        const map: Record<number, CategoryNavigationNode[]> = {};
        for (const root of raw) {
          if (isInternalCategory(root)) continue;
          const localized = localizeCategoryContent(root, locale);
          const compact = toCompactNavigationNode(localized, { includeChildren: true });
          map[root.id] = compact.children || [];
        }
        fullTreeLoadedRef.current = true;
        setLoadedChildrenByRoot(map);
        return map;
      })
      .catch(() => null)
      .finally(() => {
        setLoadingChildren(false);
        fetchPromiseRef.current = null;
      });

    fetchPromiseRef.current = promise;
    return promise;
  }, [loadedChildrenByRoot, locale]);

  const handleToggleSection = (category: CategoryNavigationNode) => {
    if (expandedId === category.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(category.id);
    const hasPreloadedChildren = Array.isArray(category.children);
    const hasLazyChildren = !hasPreloadedChildren && Number(category.child_count || 0) > 0 && !(category.id in loadedChildrenByRoot);
    if (hasLazyChildren) {
      void ensureAllSubcategoriesLoaded();
    }
  };

  return (
    <div className="space-y-3">
      {sections.map((category) => {
        const expanded = expandedId === category.id;
        const resolvedChildren =
          category.children ??
          loadedChildrenByRoot[category.id] ??
          null;
        const children = resolvedChildren
          ? [...resolvedChildren].sort(compareCategoriesByPopularity)
          : [];
        const isWaitingForChildren =
          expanded && resolvedChildren === null && Number(category.child_count || 0) > 0 && loadingChildren;

        return (
          <section key={category.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={() => handleToggleSection(category)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleToggleSection(category);
                }
              }}
              className="flex w-full cursor-pointer items-center gap-4 px-5 py-4 transition hover:bg-slate-50"
            >
              <ChevronDownIcon className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold text-slate-950">{category.name}</h2>
              </div>
              {typeof category.product_count === 'number' && category.product_count > 0 && (
                <span className="shrink-0 rounded-full bg-[var(--site-primary)]/10 px-3 py-1 text-sm font-semibold text-[var(--site-primary)]">
                  {category.product_count.toLocaleString()} {copy.products}
                </span>
              )}
              <Link prefetch={false}
                href={href(`/categories/${category.path || category.slug}`)}
                onClick={(event) => event.stopPropagation()}
                className="shrink-0 text-sm font-bold text-[var(--site-primary)] hover:text-orange-700"
              >
                {copy.browse} →
              </Link>
            </div>
            {expanded && (
              <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                {isWaitingForChildren ? (
                  <p className="text-sm text-slate-500">{t('common.loading')}</p>
                ) : children.length > 0 ? (
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {children.map((child) => (
                      <li key={child.id}>
                        <Link prefetch={false}
                          href={href(`/categories/${child.path || child.slug}`)}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 transition hover:border-[var(--site-primary)] hover:text-[var(--site-primary)]"
                        >
                          <span className="min-w-0 truncate">{child.name}</span>
                          {typeof child.product_count === 'number' && child.product_count > 0 && (
                            <span className="shrink-0 text-xs text-slate-400">{child.product_count.toLocaleString()}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Link prefetch={false} href={href(`/categories/${category.path || category.slug}`)} className="text-sm font-bold text-[var(--site-primary)] hover:text-orange-700">
                    {copy.viewAll} →
                  </Link>
                )}
              </div>
            )}
          </section>
        );
      })}

      {others.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{copy.otherBrands}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {others.map((category) => (
              <Link prefetch={false}
                key={category.id}
                href={href(`/categories/${category.path || category.slug}`)}
                className="rounded-full border border-slate-200 px-3.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-[var(--site-primary)] hover:text-[var(--site-primary)]"
              >
                {category.name}
                {typeof category.product_count === 'number' && category.product_count > 0 && (
                  <span className="ml-1.5 text-xs text-slate-400">{category.product_count.toLocaleString()}</span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
