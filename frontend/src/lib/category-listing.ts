import type { ProductFilters } from '@/services/product.service';
import type { Category, CategoryNavigationNode, Product } from '@/types';
import { normalizeProductPageSize } from '@/lib/product-listing';

export type CategoryProductFilters = Required<Pick<ProductFilters, 'page' | 'page_size' | 'category_id' | 'include_descendants' | 'sort_by' | 'sort_dir' | 'search' | 'is_active'>> & {
  min_price: string;
  max_price: string;
};

type ParamReader = (key: string) => string | null;
type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

function readerFor(params: SearchParamsInput): ParamReader {
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
  params: SearchParamsInput,
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

// Query variants (page > 1, sorting, filtering, search, custom page_size)
// duplicate page 1's listing and waste crawl budget if indexed separately.
const NON_CANONICAL_QUERY_KEYS = [
  'sort_by',
  'sort_dir',
  'search',
  'min_price',
  'max_price',
  'page_size',
  'brand',
  'in_stock',
  'price_status',
] as const;

export function hasNonCanonicalCategoryQueryParams(params: SearchParamsInput | undefined): boolean {
  if (!params) return false;
  const get = readerFor(params);
  const page = Number.parseInt(get('page') || '1', 10);
  if (Number.isFinite(page) && page > 1) return true;
  return NON_CANONICAL_QUERY_KEYS.some((key) => {
    const val = get(key);
    return typeof val === 'string' && val.trim() !== '';
  });
}

const INTERNAL_CATEGORY_SLUGS = new Set([
  'imported-products-review',
  'uncategorized',
  'unassigned',
]);

export function isInternalCategory(category: Pick<Category, 'slug' | 'path'> | null | undefined): boolean {
  if (!category) return false;
  const slug = String(category.slug || '').trim().toLowerCase();
  const path = String(category.path || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  if (INTERNAL_CATEGORY_SLUGS.has(slug)) return true;
  if (!path) return false;
  return path.split('/').some((segment) => INTERNAL_CATEGORY_SLUGS.has(segment));
}

const MIN_THIN_SUBCATEGORY_DESCRIPTION_LENGTH = 120;

// Shared indexability policy used by both page robots metadata and
// sitemap-categories.xml so the sitemap never submits noindex URLs.
export function isCategoryIndexable(
  category: Pick<Category, 'slug' | 'path' | 'parent_id' | 'description'> | null | undefined,
  productCount: number,
): boolean {
  if (!category) return false;
  if (isInternalCategory(category)) return false;
  if (!Number.isFinite(productCount) || productCount <= 0) return false;
  if (!category.parent_id) return true;
  if (productCount >= 2) return true;
  const descriptionLen = String(category.description || '').replace(/\s+/g, ' ').trim().length;
  return descriptionLen >= MIN_THIN_SUBCATEGORY_DESCRIPTION_LENGTH;
}

export function findCategoryNodeById<T extends { id: number; children?: T[] }>(
  nodes: readonly T[] | undefined,
  id: number,
): T | null {
  if (!nodes || !Number.isFinite(id)) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findCategoryNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

export function findCategoryTrailIds<T extends { id: number; children?: T[] }>(
  nodes: readonly T[] | undefined,
  id: number | null,
): number[] {
  if (!nodes || id == null || !Number.isFinite(id)) return [];
  for (const node of nodes) {
    if (node.id === id) return [node.id];
    const childTrail = findCategoryTrailIds(node.children, id);
    if (childTrail.length > 0) return [node.id, ...childTrail];
  }
  return [];
}

export function compareCategoriesByPopularity(
  a: Pick<CategoryNavigationNode, 'product_count' | 'sort_order' | 'name'>,
  b: Pick<CategoryNavigationNode, 'product_count' | 'sort_order' | 'name'>,
): number {
  const countDiff = Number(b.product_count || 0) - Number(a.product_count || 0);
  if (countDiff !== 0) return countDiff;
  const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
  if (orderDiff !== 0) return orderDiff;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

export function toCompactNavigationNode(
  category: Category | CategoryNavigationNode,
  options: {
    includeChildren?: boolean;
    activeTrail?: ReadonlySet<number>;
    includeEmpty?: boolean;
  } = {},
): CategoryNavigationNode {
  const { includeChildren = true, activeTrail, includeEmpty = false } = options;
  const filteredChildren = (category.children || [])
    .filter((child) => {
      if (isInternalCategory(child)) return false;
      if (includeEmpty) return true;
      return Number(child.product_count || 0) > 0 || Boolean(activeTrail?.has(child.id));
    })
    .sort(compareCategoriesByPopularity);

  const node: CategoryNavigationNode = {
    id: category.id,
    name: category.name,
    slug: category.slug,
    path: category.path,
    product_count: category.product_count,
  };

  if (filteredChildren.length > 0) {
    node.child_count = filteredChildren.length;
    if (includeChildren) {
      node.children = filteredChildren.map((child) =>
        toCompactNavigationNode(child, { includeChildren: true, activeTrail, includeEmpty }),
      );
    }
  }

  return node;
}

// Keep SSR HTML compact by serializing only the active brand branch (with its
// full non-empty subcategory tree) plus the top N popular root brands as stubs.
// Users can still expand any brand or load the full directory on demand.
export function buildCompactSidebarTree(
  rawTree: readonly (Category | CategoryNavigationNode)[],
  activeCategoryId: number | null,
  options: { topRootLimit?: number } = {},
): { tree: CategoryNavigationNode[]; totalRootCount: number } {
  const { topRootLimit = 24 } = options;
  const activeTrail = new Set<number>(findCategoryTrailIds(rawTree, activeCategoryId));

  const eligibleRoots = rawTree
    .filter((root) => {
      if (isInternalCategory(root)) return false;
      return Number(root.product_count || 0) > 0 || activeTrail.has(root.id);
    })
    .sort(compareCategoriesByPopularity);

  const activeRoot = eligibleRoots.find((root) => activeTrail.has(root.id));
  const tree: CategoryNavigationNode[] = [];

  if (activeRoot) {
    tree.push(toCompactNavigationNode(activeRoot, { includeChildren: true, activeTrail }));
  }

  let addedOthers = 0;
  for (const root of eligibleRoots) {
    if (activeRoot && root.id === activeRoot.id) continue;
    if (addedOthers >= topRootLimit) break;
    tree.push(toCompactNavigationNode(root, { includeChildren: false, activeTrail }));
    addedOthers += 1;
  }

  return { tree, totalRootCount: eligibleRoots.length };
}

export function buildFullPublicNavigationTree(
  rawTree: readonly (Category | CategoryNavigationNode)[],
  activeCategoryId: number | null = null,
): CategoryNavigationNode[] {
  const activeTrail = new Set<number>(findCategoryTrailIds(rawTree, activeCategoryId));
  const roots = rawTree
    .filter((root) => !isInternalCategory(root) && (Number(root.product_count || 0) > 0 || activeTrail.has(root.id)))
    .sort(compareCategoriesByPopularity);

  const activeRoot = roots.find((root) => activeTrail.has(root.id));
  const ordered = activeRoot
    ? [activeRoot, ...roots.filter((root) => root.id !== activeRoot.id)]
    : roots;

  return ordered.map((root) => toCompactNavigationNode(root, { includeChildren: true, activeTrail }));
}

// Strip heavy nested children/parent arrays before passing the current category
// to client listing components that only need routing and identity fields.
export function toClientCategory(category: Category): Category {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    path: category.path,
    parent_id: category.parent_id,
    sort_order: category.sort_order,
    is_active: category.is_active,
    product_count: category.product_count,
  } as Category;
}

function extractPrimaryImageUrls(product: Product): string[] {
  const rawUrls: unknown = product.image_urls;
  if (Array.isArray(rawUrls) && rawUrls.length > 0) {
    const first = rawUrls.find((url) => typeof url === 'string' && url.trim() !== '');
    if (typeof first === 'string') return [first];
  } else if (typeof rawUrls === 'string' && rawUrls.trim() !== '') {
    const trimmed = rawUrls.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown[];
        const first = parsed.find((item) => typeof item === 'string' && item.trim() !== '');
        if (typeof first === 'string') return [first];
      } catch {
        // fall through
      }
    } else {
      return [trimmed];
    }
  }
  if (Array.isArray(product.images) && product.images.length > 0) {
    const primary = product.images.find((img) => img && img.is_primary && img.url) || product.images[0];
    if (primary?.url) return [primary.url];
  }
  return [];
}

// Listing cards, client sorting and cart/checkout only need summary product
// fields. Dropping detail-only copy (specs, manuals, compatibility essays, SEO
// metadata and nested category descriptions) trims ~85% off RSC product payloads.
export function toSlimListingProduct(product: Product): Product {
  const rawDesc = String(product.short_description || product.description || '').replace(/\s+/g, ' ').trim();
  const description = rawDesc.length > 220 ? `${rawDesc.slice(0, 217)}...` : rawDesc;
  const slimCategory = product.category
    ? ({
        id: product.category.id,
        name: product.category.name,
        slug: product.category.slug,
      } as Category)
    : undefined;

  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    slug: product.slug,
    description,
    price: product.price,
    compare_price: product.compare_price,
    stock_quantity: product.stock_quantity,
    brand: product.brand,
    model: product.model,
    part_number: product.part_number,
    category_id: product.category_id,
    category: slimCategory,
    is_active: product.is_active,
    is_featured: product.is_featured,
    image_urls: extractPrimaryImageUrls(product),
    created_at: product.created_at,
    updated_at: product.updated_at,
  } as Product;
}
