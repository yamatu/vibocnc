export const PRODUCT_PAGE_SIZES = [12, 24, 36, 48, 96] as const;
export type ProductPageSize = (typeof PRODUCT_PAGE_SIZES)[number];
type ListingParams = Record<string, string | string[] | undefined>;

export function normalizeProductPageSize(value: unknown): ProductPageSize {
  const size = Number(Array.isArray(value) ? value[0] : value);
  return PRODUCT_PAGE_SIZES.find((option) => option === size) ?? 12;
}

export function buildProductListingPath(params: ListingParams, updates: Record<string, string | number | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) query.set(key, first);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === '') query.delete(key);
    else query.set(key, String(value));
  }
  const pageSize = normalizeProductPageSize(query.get('page_size'));
  if (pageSize === 12) query.delete('page_size');
  else query.set('page_size', String(pageSize));
  if (query.get('page') === '1') query.delete('page');
  return `/products${query.size ? `?${query.toString()}` : ''}`;
}
