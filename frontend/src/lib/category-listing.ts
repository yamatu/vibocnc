import type { ProductFilters } from '@/services/product.service';
import { normalizeProductPageSize } from '@/lib/product-listing';

export type CategoryProductFilters = Required<Pick<ProductFilters, 'page' | 'page_size' | 'category_id' | 'include_descendants' | 'sort_by' | 'sort_dir' | 'search' | 'is_active'>> & {
  min_price: string;
  max_price: string;
};

type ParamReader = (key: string) => string | null;

function readerFor(params: URLSearchParams | Record<string, string | string[] | undefined>): ParamReader {
  if (params instanceof URLSearchParams) return (key) => params.get(key);
  return (key) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? null;
  };
}

// Server render and client hydration must derive identical filters so the
// server-fetched first page can seed the client query cache.
export function categoryFiltersFromParams(
  categoryId: number | string,
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): CategoryProductFilters {
  const get = readerFor(params);
  const sortBy = get('sort_by');
  return {
    page: Math.max(1, Number.parseInt(get('page') || '1', 10) || 1),
    page_size: normalizeProductPageSize(get('page_size') ?? undefined),
    category_id: String(categoryId),
    include_descendants: 'true',
    sort_by: sortBy === 'name' || sortBy === 'price' || sortBy === 'updated_at' ? sortBy : 'created_at',
    sort_dir: get('sort_dir') === 'asc' ? 'asc' : 'desc',
    min_price: get('min_price') || '',
    max_price: get('max_price') || '',
    search: get('search') || '',
    is_active: 'true',
  };
}

export function sameCategoryFilters(a: CategoryProductFilters, b: CategoryProductFilters): boolean {
  return (Object.keys(a) as Array<keyof CategoryProductFilters>).every((key) => String(a[key]) === String(b[key]));
}
