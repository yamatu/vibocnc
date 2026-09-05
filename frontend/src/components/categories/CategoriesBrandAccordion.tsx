'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type { Category } from '@/types';

export interface CategoriesBrandAccordionCopy {
  browse: string;
  products: string;
  otherBrands: string;
  viewAll: string;
  searchPlaceholder?: string;
  noResults?: string;
}

interface CategoriesBrandAccordionProps {
  categories: Category[];
  copy: CategoriesBrandAccordionCopy;
  /** Locale-aware path builder supplied by the server component. */
  hrefs: Record<number, string>;
}

const MAJOR_SECTION_MIN_PRODUCTS = 20;

function categorySortValue(category: Category) {
  return [category.sort_order ?? 0, -(category.product_count ?? 0), category.name] as const;
}

function compareCategories(a: Category, b: Category) {
  const [aOrder, aCount, aName] = categorySortValue(a);
  const [bOrder, bCount, bName] = categorySortValue(b);
  if (aOrder !== bOrder) return aOrder - bOrder;
  if (aCount !== bCount) return aCount - bCount;
  return aName.localeCompare(bName);
}

// Brand-first category browser: the largest brands come first as collapsible
// sections (only the first is expanded), and long-tail roots collapse into a
// compact link cloud. Collapsed sections stay in the DOM (hidden) so every
// category link remains crawlable.
export default function CategoriesBrandAccordion({ categories, copy, hrefs }: CategoriesBrandAccordionProps) {
  const { sections, others } = useMemo(() => {
    const sorted = [...categories].sort(compareCategories);
    const sections = sorted.filter(
      (category) => (category.children?.length || 0) > 0 || (category.product_count ?? 0) >= MAJOR_SECTION_MIN_PRODUCTS,
    );
    const sectionIds = new Set(sections.map((category) => category.id));
    const others = sorted.filter((category) => !sectionIds.has(category.id));
    return { sections, others };
  }, [categories]);

  const [expandedId, setExpandedId] = useState<number | null>(sections[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return sections;
    return sections
      .map((category) => {
        const rootMatches = `${category.name} ${category.description || ''}`.toLocaleLowerCase().includes(normalizedQuery);
        const children = rootMatches
          ? (category.children || [])
          : (category.children || []).filter((child) =>
            `${child.name} ${child.description || ''}`.toLocaleLowerCase().includes(normalizedQuery),
          );
        return rootMatches || children.length > 0
          ? {
          ...category,
              children,
            }
          : null;
      })
      .filter((category): category is Category => category !== null);
  }, [normalizedQuery, sections]);
  const filteredOthers = useMemo(
    () => normalizedQuery
      ? others.filter((category) => `${category.name} ${category.description || ''}`.toLocaleLowerCase().includes(normalizedQuery))
      : others,
    [normalizedQuery, others],
  );

  return (
    <div className="space-y-5">
      <div className="relative max-w-xl">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder || 'Search categories'}
          aria-label={copy.searchPlaceholder || 'Search categories'}
          className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
        />
      </div>
      {filteredSections.map((category) => {
        const expanded = expandedId === category.id;
        const children = [...(category.children || [])].sort(compareCategories);
        return (
          <section key={category.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-yellow-300">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : category.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setExpandedId(expanded ? null : category.id);
                }
              }}
              className="flex w-full cursor-pointer items-center gap-4 border-l-4 border-yellow-400 px-5 py-4 transition hover:bg-yellow-50/50"
            >
              <ChevronDownIcon className={`h-5 w-5 shrink-0 text-yellow-600 transition-transform ${expanded ? '' : '-rotate-90'}`} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold text-slate-950">{category.name}</h2>
              </div>
              {typeof category.product_count === 'number' && category.product_count > 0 && (
                <span className="shrink-0 rounded-full bg-[#0b3e75]/10 px-3 py-1 text-sm font-semibold text-[#0b3e75]">
                  {category.product_count.toLocaleString()} {copy.products}
                </span>
              )}
              <Link
                href={hrefs[category.id] || '#'}
                onClick={(event) => event.stopPropagation()}
                className="shrink-0 text-sm font-bold text-[#0b3e75] hover:text-orange-700"
              >
                {copy.browse} →
              </Link>
            </div>
            <div hidden={!expanded} className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
              {children.length > 0 ? (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={hrefs[child.id] || '#'}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 transition hover:border-yellow-500 hover:bg-yellow-50 hover:text-yellow-800"
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
                <Link href={hrefs[category.id] || '#'} className="text-sm font-bold text-yellow-700 hover:text-yellow-900">
                  {copy.viewAll} →
                </Link>
              )}
            </div>
          </section>
        );
      })}

      {filteredOthers.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{copy.otherBrands}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {filteredOthers.map((category) => (
              <Link
                key={category.id}
                href={hrefs[category.id] || '#'}
                className="rounded-full border border-slate-200 px-3.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-yellow-500 hover:bg-yellow-50 hover:text-yellow-800"
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
      {normalizedQuery && filteredSections.length === 0 && filteredOthers.length === 0 && (
        <div className="rounded-xl border border-dashed border-yellow-300 bg-yellow-50 p-8 text-center text-sm text-slate-600">
          {copy.noResults || 'No matching categories found.'}
        </div>
      )}
    </div>
  );
}
