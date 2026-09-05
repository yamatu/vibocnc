'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { Category } from '@/types';

export interface CategoriesBrandAccordionCopy {
  browse: string;
  products: string;
  otherBrands: string;
  viewAll: string;
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

  return (
    <div className="space-y-3">
      {sections.map((category) => {
        const expanded = expandedId === category.id;
        const children = [...(category.children || [])].sort(compareCategories);
        return (
          <section key={category.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
              className="flex w-full cursor-pointer items-center gap-4 px-5 py-4 transition hover:bg-slate-50"
            >
              <ChevronDownIcon className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
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
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 transition hover:border-[#0b3e75] hover:text-[#0b3e75]"
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
                <Link href={hrefs[category.id] || '#'} className="text-sm font-bold text-[#0b3e75] hover:text-orange-700">
                  {copy.viewAll} →
                </Link>
              )}
            </div>
          </section>
        );
      })}

      {others.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{copy.otherBrands}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {others.map((category) => (
              <Link
                key={category.id}
                href={hrefs[category.id] || '#'}
                className="rounded-full border border-slate-200 px-3.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-[#0b3e75] hover:text-[#0b3e75]"
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
