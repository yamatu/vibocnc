import { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { Suspense } from 'react';
import { ProductService, CategoryService } from '@/services';
import type { Category, Product } from '@/types';
import { getSiteUrl } from '@/lib/url';
import { toProductPathId } from '@/lib/utils';
import ProductsPageClient from './ProductsPageClient';
import ScrollRestorer from '@/components/common/ScrollRestorer';

type SearchParamValue = string | string[] | undefined;
type PageSearchParams = { [key: string]: SearchParamValue };
type CategoryNode = Category & { children?: CategoryNode[] };
type ProductsPageServerData = {
  products: Product[];
  totalPages: number;
  total: number;
  categories: Category[];
  currentPage: number;
  selectedCategory: string;
  searchQuery: string;
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

function buildCategoryRedirectPath(category: CategoryNode | null, params: PageSearchParams): string | null {
  const categoryPath = getCategoryPath(category);
  if (!categoryPath) return null;

  const redirectParams = new URLSearchParams();
  const passthroughKeys = ['page', 'page_size', 'sort_by', 'sort_order', 'min_price', 'max_price'];

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

// Generate dynamic metadata for products page
export async function generateMetadata({ searchParams }: {
  searchParams: Promise<PageSearchParams>
}): Promise<Metadata> {
  const params = await searchParams;
  const categoryParam = getFirstParamValue(params.category_id) || getFirstParamValue(params.category);
  const searchQuery = getFirstParamValue(params.search);
  const hasSearch = !!searchQuery;

  let title = 'Industrial Automation Parts & Components | Vcocnc';
  let description = 'Professional CNC parts supplier since 2005. 100,000+ items in stock, worldwide shipping. Servo motors, PCB boards, I/O modules, control units.';
  const baseUrl = getSiteUrl();

  if (categoryParam && !hasSearch) {
    const category = await resolveCategory(categoryParam);
    const categoryPath = getCategoryPath(category);

    if (category && categoryPath) {
      title = `${category.name} - Parts | Vcocnc`;
      description = `Professional ${category.name} for CNC systems. High-quality industrial automation components with worldwide shipping.`;
      const catUrl = `${baseUrl}${categoryPath}`;

      return {
        title,
        description,
        robots: { index: true, follow: true },
        keywords: [
          'CNC parts', 'industrial automation', 'servo motors', 'PCB boards',
          'I/O modules', 'control units', category.name,
        ].filter(Boolean).join(', '),
        openGraph: {
          title,
          description,
          type: 'website',
          url: catUrl,
        },
        alternates: {
          canonical: catUrl,
        },
      };
    }
  }

  if (hasSearch) {
    title = `Search: ${searchQuery} - Parts | Vcocnc`;
    description = `Search results for "${searchQuery}" in industrial automation parts and components. Professional supplier since 2005.`;
  }

  return {
    title,
    description,
    robots: hasSearch ? { index: false, follow: true } : { index: true, follow: true },
    keywords: [
      'CNC parts', 'industrial automation', 'servo motors', 'PCB boards',
      'I/O modules', 'control units', searchQuery,
    ].filter(Boolean).join(', '),
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${baseUrl}/products`,
    },
    alternates: {
      canonical: `${baseUrl}/products`,
    },
  };
}

// Server-side data fetching for SEO
async function getServerSideData(searchParams: PageSearchParams): Promise<ProductsPageServerData> {
  const categoryId = getFirstParamValue(searchParams.category_id) || getFirstParamValue(searchParams.category);
  const search = getFirstParamValue(searchParams.search);
  const page = parseInt(getFirstParamValue(searchParams.page) || '1', 10);

  try {
    // Fetch products and categories in parallel to reduce TTFB
    const [productsData, categories] = await Promise.all([
      ProductService.getProducts({
        search,
        category_id: categoryId,
        include_descendants: categoryId ? 'true' : undefined,
        is_active: 'true',
        page,
        page_size: 12,
      }),
      CategoryService.getCategories(),
    ]);

    return {
      products: productsData.data || [],
      totalPages: Math.ceil((productsData.total || 0) / 12),
      total: productsData.total || 0,
      categories: categories || [],
      currentPage: page,
      selectedCategory: categoryId || '',
      searchQuery: search || '',
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
      selectedCategory: '',
      searchQuery: '',
    };
  }
}

// Force no cache for this page to ensure fresh data for crawlers
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Main server component
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const params = await searchParams;
  const categoryParam = getFirstParamValue(params.category_id) || getFirstParamValue(params.category);
  const hasSearch = !!getFirstParamValue(params.search);

  if (categoryParam && !hasSearch) {
    const category = await resolveCategory(categoryParam);
    const redirectPath = buildCategoryRedirectPath(category, params);

    if (redirectPath) {
      permanentRedirect(redirectPath);
    }
  }

  const serverData = await getServerSideData(params);

  // Generate structured data for product listing page
  const generateListingStructuredData = (data: ProductsPageServerData) => {
    const baseUrl = getSiteUrl();

    return {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      'name': 'Industrial Automation Parts & Components',
      'description': 'Professional CNC parts supplier since 2005. Browse our extensive catalog of servo motors, PCB boards, I/O modules, and control units.',
      'url': `${baseUrl}/products`,
      'mainEntity': {
        '@type': 'ItemList',
        'numberOfItems': data.total,
        'itemListElement': data.products.slice(0, 10).map((product, index: number) => ({
          '@type': 'ListItem',
          'position': index + 1,
          'item': {
            '@type': 'Product',
            'name': product.name,
            'description': product.description || `${product.name} - Professional industrial part`,
            'sku': product.sku,
            'brand': {
              '@type': 'Brand',
              'name': product.brand || 'Vcocnc',
            },
            'image': product.image_urls && product.image_urls.length > 0
              ? product.image_urls[0]
              : `${baseUrl}/images/default-product.svg`,
            'url': `${baseUrl}/products/${toProductPathId(product.sku)}`,
            'offers': {
              '@type': 'Offer',
              'price': product.price || 0,
              'priceCurrency': 'USD',
              'availability': product.stock_quantity > 0
                ? 'https://schema.org/InStock'
                : 'https://schema.org/PreOrder',
              'seller': {
                '@type': 'Organization',
                'name': 'Vcocnc',
              },
            },
          },
        })),
      },
      'breadcrumb': {
        '@type': 'BreadcrumbList',
        'itemListElement': [
          {
            '@type': 'ListItem',
            'position': 1,
            'name': 'Home',
            'item': baseUrl,
          },
          {
            '@type': 'ListItem',
            'position': 2,
            'name': 'Products',
            'item': `${baseUrl}/products`,
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600"></div>
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
