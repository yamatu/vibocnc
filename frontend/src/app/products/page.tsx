import { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { Suspense } from 'react';
import { ProductService, CategoryService } from '@/services';
import type { Category, Product } from '@/types';
import { getSiteUrl } from '@/lib/url';
import { withSiteName } from '@/lib/seo';
import { toProductPathId } from '@/lib/utils';
import ProductsPageClient from './ProductsPageClient';
import ScrollRestorer from '@/components/common/ScrollRestorer';
import { getLocalizedMetadataPaths, getLocalizedMetadataPathsWithQuery, getRequestPublicLocale } from '@/lib/i18n/server';
import { normalizeProductPageSize } from '@/lib/product-listing';
import { translatePublicMessage } from '@/lib/i18n/messages';
import { localizeCategoryContent, localizeProductContent } from '@/lib/i18n/content';
import { localizePublicPath, type PublicLocale } from '@/lib/i18n/config';

type SearchParamValue = string | string[] | undefined;
type PageSearchParams = { [key: string]: SearchParamValue };
type CategoryNode = Category & { children?: CategoryNode[] };
type ProductsPageServerData = {
  products: Product[];
  totalPages: number;
  total: number;
  categories: Category[];
  currentPage: number;
  pageSize: number;
  selectedCategory: string;
  searchQuery: string;
  selectedBrand: string;
};

function getFirstParamValue(value: SearchParamValue): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    const firstNonEmpty = value.find((item) => typeof item === 'string' && item.trim().length > 0);
    return firstNonEmpty?.trim();
  }

  return undefined;
}

function findCategoryByParam(nodes: CategoryNode[], rawValue: string): CategoryNode | null {
  const normalized = rawValue.trim().toLowerCase();
  const exact = rawValue.trim();

  for (const node of nodes) {
    if (String(node.id) === exact) return node;
    if (typeof node.slug === 'string' && node.slug.toLowerCase() === normalized) return node;
    if (typeof node.path === 'string' && node.path.toLowerCase() === normalized) return node;

    if (Array.isArray(node.children) && node.children.length > 0) {
      const hit = findCategoryByParam(node.children, rawValue);
      if (hit) return hit;
    }
  }

  return null;
}

function getCategoryPath(category: CategoryNode | null): string | null {
  const path = category?.path || category?.slug;
  if (typeof path !== 'string' || !path.trim()) return null;
  return `/categories/${path}`;
}

function findBrandCategory(nodes: CategoryNode[], rawBrand: string): CategoryNode | null {
  const normalized = rawBrand.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!normalized) return null;
  for (const node of nodes) {
    const candidates = [node.name, node.slug, node.path]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (candidates.some((value) => value === normalized)) return node;
  }
  return null;
}

function buildCategoryRedirectPath(category: CategoryNode | null, params: PageSearchParams): string | null {
  const categoryPath = getCategoryPath(category);
  if (!categoryPath) return null;

  const redirectParams = new URLSearchParams();
  const passthroughKeys = ['page', 'page_size', 'sort_by', 'sort_dir', 'min_price', 'max_price'];

  for (const key of passthroughKeys) {
    const value = getFirstParamValue(params[key]);
    if (!value) continue;
    if (key === 'page' && value === '1') continue;
    if (key === 'page_size' && value === '12') continue;
    redirectParams.set(key, value);
  }

  const queryString = redirectParams.toString();
  return queryString ? `${categoryPath}?${queryString}` : categoryPath;
}

async function resolveCategory(rawValue?: string): Promise<CategoryNode | null> {
  if (!rawValue) return null;

  try {
    const categories = await CategoryService.getCategories();
    return findCategoryByParam(categories as CategoryNode[], rawValue);
  } catch {
    return null;
  }
}

async function resolveBrandCategory(rawBrand?: string): Promise<CategoryNode | null> {
  if (!rawBrand) return null;
  try {
    const categories = await CategoryService.getCategories();
    return findBrandCategory(categories as CategoryNode[], rawBrand);
  } catch {
    return null;
  }
}

// Generate dynamic metadata for products page
export async function generateMetadata({ searchParams }: {
  searchParams: Promise<PageSearchParams>
}): Promise<Metadata> {
  const params = await searchParams;
  const categoryParam = getFirstParamValue(params.category_id) || getFirstParamValue(params.category);
  const searchQuery = getFirstParamValue(params.search);
  const brand = getFirstParamValue(params.brand);
  const hasSearch = !!searchQuery;
  const pageSize = normalizeProductPageSize(params.page_size);
  const page = Math.max(1, Number.parseInt(getFirstParamValue(params.page) || '1', 10) || 1);
  const paginationQuery = new URLSearchParams();
  if (page > 1) paginationQuery.set('page', String(page));
  if (pageSize !== 12) paginationQuery.set('page_size', String(pageSize));

  let title = 'Industrial Automation Parts & Components';
  let description = 'Industrial automation and CNC parts supplier since 2007. Browse current, legacy and obsolete components across 20+ brands with worldwide shipping.';
  const requestLocale = await getRequestPublicLocale();
  const defaultMetadataPaths = await getLocalizedMetadataPathsWithQuery('/products', paginationQuery.toString());

  if (requestLocale !== 'en') {
    title = translatePublicMessage(requestLocale, 'products.title');
    description = translatePublicMessage(requestLocale, 'products.description');
  }

  if (categoryParam && !hasSearch) {
    const category = await resolveCategory(categoryParam);
    const categoryPath = getCategoryPath(category);

    if (category && categoryPath) {
      title = `${category.name} - Parts`;
      description = `Professional ${category.name} for CNC systems. High-quality industrial automation components with worldwide shipping.`;
      const localizedCategory = localizeCategoryContent(category, requestLocale);
      title = `${localizedCategory.name} - ${translatePublicMessage(requestLocale, 'nav.products')}`;
      const categoryMetadataPaths = await getLocalizedMetadataPaths(categoryPath);
      const catUrl = categoryMetadataPaths.canonical;

      return {
        title,
        description,
        robots: { index: true, follow: true },
        keywords: [
          'CNC parts', 'industrial automation', 'servo motors', 'PCB boards',
          'I/O modules', 'control units', category.name,
        ].filter(Boolean).join(', '),
        openGraph: {
          title: withSiteName(title),
          description,
          type: 'website',
          url: catUrl,
        },
        alternates: {
          canonical: catUrl,
          languages: categoryMetadataPaths.languages,
        },
      };
    }
  }

  if (brand && !hasSearch) {
    const brandCategory = await resolveBrandCategory(brand);
    const brandPath = getCategoryPath(brandCategory);
    if (brandCategory && brandPath) {
      const brandMetadataPaths = await getLocalizedMetadataPaths(brandPath);
      title = `${brandCategory.name} Industrial Automation Parts`;
      description = `Browse ${brandCategory.name} industrial automation parts, current and obsolete models, compatibility support, repair evaluation, and worldwide shipping from Vibocnc.`;
      return {
        title,
        description,
        robots: { index: true, follow: true },
        keywords: `${brandCategory.name} parts, ${brandCategory.name} automation, industrial automation parts, CNC parts, Vibocnc`,
        openGraph: { title: withSiteName(title), description, type: 'website', url: brandMetadataPaths.canonical },
        alternates: { canonical: brandMetadataPaths.canonical, languages: brandMetadataPaths.languages },
      };
    }
  }

  if (hasSearch) {
    title = `Search: ${searchQuery} - Parts`;
    description = `Search results for "${searchQuery}" in CNC and industrial automation parts from a multi-brand supplier established in 2007.`;
  }

  if (page > 1) title = `${title} - Page ${page}`;

  return {
    title,
    description,
    robots: hasSearch || !!brand || pageSize !== 12 ? { index: false, follow: true } : { index: true, follow: true },
    keywords: [
      'CNC parts', 'industrial automation', 'servo motors', 'PCB boards',
      'I/O modules', 'control units', searchQuery,
    ].filter(Boolean).join(', '),
    openGraph: {
      title: withSiteName(title),
      description,
      type: 'website',
      url: defaultMetadataPaths.canonical,
    },
    alternates: {
      canonical: defaultMetadataPaths.canonical,
      languages: defaultMetadataPaths.languages,
    },
  };
}

// Server-side data fetching for SEO
async function getServerSideData(searchParams: PageSearchParams, locale: PublicLocale): Promise<ProductsPageServerData> {
  const categoryId = getFirstParamValue(searchParams.category_id) || getFirstParamValue(searchParams.category);
  const search = getFirstParamValue(searchParams.search);
  const brand = getFirstParamValue(searchParams.brand);
  const page = Math.max(1, Number.parseInt(getFirstParamValue(searchParams.page) || '1', 10) || 1);
  const pageSize = normalizeProductPageSize(searchParams.page_size);

  try {
    // Fetch products and categories in parallel to reduce TTFB
    const [productsData, categories] = await Promise.all([
      ProductService.getProducts({
        search,
        brand,
        category_id: categoryId,
        include_descendants: categoryId ? 'true' : undefined,
        is_active: 'true',
        page,
        page_size: pageSize,
      }),
      CategoryService.getCategories(),
    ]);

    return {
      // The catalogue must keep every active product visible in every
      // language. Translated fields override the English record when they
      // exist; missing translations fall back to the canonical product data.
      products: (productsData.data || []).map((product) => localizeProductContent(product, locale)),
      totalPages: Math.max(1, Math.ceil((productsData.total || 0) / pageSize)),
      total: productsData.total || 0,
      categories: (categories || []).map((category) => localizeCategoryContent(category, locale)),
      currentPage: page,
      pageSize,
      selectedCategory: categoryId || '',
      searchQuery: search || '',
      selectedBrand: brand || '',
    };
  } catch (error) {
    console.error('Failed to fetch server-side data:', error);
    // Return mock data as fallback
    return {
      products: [],
      totalPages: 1,
      total: 0,
      categories: [],
      currentPage: 1,
      pageSize,
      selectedCategory: '',
      searchQuery: '',
      selectedBrand: '',
    };
  }
}

// Keep catalogue HTML fresh while allowing crawlers and the CDN to reuse the
// same server-rendered response instead of rebuilding it on every request.
export const revalidate = 300;

// Main server component
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const params = await searchParams;
  const locale = await getRequestPublicLocale();
  const categoryParam = getFirstParamValue(params.category_id) || getFirstParamValue(params.category);
  const brandParam = getFirstParamValue(params.brand);
  const hasSearch = !!getFirstParamValue(params.search);

  if (categoryParam && !hasSearch) {
    const category = await resolveCategory(categoryParam);
    const redirectPath = buildCategoryRedirectPath(category, params);

    if (redirectPath) {
      permanentRedirect(localizePublicPath(redirectPath, locale));
    }
  }


  if (brandParam && !hasSearch) {
    const brandCategory = await resolveBrandCategory(brandParam);
    const redirectPath = buildCategoryRedirectPath(brandCategory, params);
    if (redirectPath) {
      permanentRedirect(localizePublicPath(redirectPath, locale));
    }
  }

  const serverData = await getServerSideData(params, locale);

  // Generate structured data for product listing page
  const generateListingStructuredData = (data: ProductsPageServerData) => {
    const baseUrl = getSiteUrl();

    return {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      'name': translatePublicMessage(locale, 'products.title'),
      'description': translatePublicMessage(locale, 'products.description'),
      'url': `${baseUrl}${localizePublicPath('/products', locale)}`,
      'mainEntity': {
        '@type': 'ItemList',
        'numberOfItems': data.total,
        'itemListElement': data.products.slice(0, 10).map((product, index: number) => ({
          '@type': 'ListItem',
          'position': index + 1,
          // Product rich results belong on individual product pages. The
          // catalogue contains quote-only items without a public price, so
          // represent each visible entry as a crawlable WebPage instead of
          // emitting incomplete Product entities.
          'item': {
            '@type': 'WebPage',
            'name': product.name,
            'description': product.description || `${product.name} - Professional industrial part`,
            'url': `${baseUrl}${localizePublicPath(`/products/${toProductPathId(product.sku)}`, locale)}`,
          },
        })),
      },
      'breadcrumb': {
        '@type': 'BreadcrumbList',
        'itemListElement': [
          {
            '@type': 'ListItem',
            'position': 1,
            'name': translatePublicMessage(locale, 'common.home'),
            'item': `${baseUrl}${localizePublicPath('/', locale)}`,
          },
          {
            '@type': 'ListItem',
            'position': 2,
            'name': translatePublicMessage(locale, 'nav.products'),
            'item': `${baseUrl}${localizePublicPath('/products', locale)}`,
          },
        ],
      },
    };
  };

  const structuredData = generateListingStructuredData(serverData);

  return (
    <>
      <ScrollRestorer storageKey="products-scroll-y" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData),
        }}
      />
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700"></div>
        </div>
      }>
        <ProductsPageClient
          initialData={serverData}
          searchParams={params}
        />
      </Suspense>
    </>
  );
}
