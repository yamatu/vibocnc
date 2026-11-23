import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import PublicLayout from '@/components/layout/PublicLayout';
import CategoryProductsClient from '@/components/categories/CategoryProductsClient';
import CategorySidebarTree from '@/components/categories/CategorySidebarTree';
import CategorySubcategoriesBar from '@/components/categories/CategorySubcategoriesBar';
import ScrollRestorer from '@/components/common/ScrollRestorer';
import { CategoryService } from '@/services/category.service';
import { ProductService } from '@/services/product.service';
import { getSiteUrl } from '@/lib/url';
import { withSiteName } from '@/lib/seo';
import { getLocalizedMetadataPaths, resolveRouteLocale } from '@/lib/i18n/server';
import { getAvailableTranslationLocales, hasTranslationForLocale, localizeCategoryContent, localizeProductContent } from '@/lib/i18n/content';
import { toProductPathId } from '@/lib/utils';
import { localizePublicPath } from '@/lib/i18n/config';
import { translatePublicMessage } from '@/lib/i18n/messages';
import type { CommercePolicySetting, PaginationResponse, Product } from '@/types';
import {
  buildCompactSidebarTree,
  categoryFiltersFromParams,
  findCategoryNodeById,
  hasNonCanonicalCategoryQueryParams,
  isCategoryIndexable,
  isInternalCategory,
  toClientCategory,
  toSlimListingProduct,
} from '@/lib/category-listing';
import {
  buildVibocncCategoryGeoOverview,
  type VibocncFaqEntry,
} from '@/lib/category-geo';
import {
  FALLBACK_COMMERCE_POLICY,
  commercePolicyCarriers,
  commercePolicyDestinationCountries,
  resolveWarrantyPeriod,
} from '@/lib/commerce-policy';
import { getCommercePolicyCached } from '@/services/commerce-policy.server';

// Reads searchParams (pagination/filters), so it cannot be ISR-cached; the
// [locale] layout would otherwise treat it as static and fail at runtime.
export const dynamic = 'force-dynamic';

interface CategoryPathPageProps {
  params: Promise<{ locale: string; categoryPath: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const legacyCategoryRedirects: Record<string, string> = {
  'servo-drives': 'fanuc/fanuc-servo-amplifier-drive',
  'servo-motors': 'fanuc/fanuc-servo-motor',
  'pcb-boards': 'fanuc/fanuc-pcb-control-board',
  'io-modules': 'fanuc/fanuc-i-o-module',
  'control-units': 'fanuc/fanuc-cnc-system-parts',
  'power-supplies': 'fanuc/fanuc-power-supply',
  'cables-connectors': 'fanuc/fanuc-cables-connectors',
  'other-components': 'fanuc/fanuc-accessories-others',
};

const brandDisplayNames: Record<string, string> = {
  fanuc: 'FANUC',
  mitsubishi: 'Mitsubishi',
  siemens: 'Siemens',
  ab: 'AB',
  abb: 'ABB',
  omron: 'OMRON',
  yaskawa: 'Yaskawa',
  huawei: 'Huawei',
  sick: 'SICK',
  tamagawa: 'Tamagawa',
  keyence: 'KEYENCE',
  'schneider-electric': 'Schneider Electric',
  'bosch-rexroth': 'Bosch Rexroth',
};

function getCategoryBrandName(category: any, breadcrumb?: any[]): string {
  const rootCategory = breadcrumb?.[0] || category;
  const key = String(rootCategory?.slug || rootCategory?.name || '').toLowerCase();
  return brandDisplayNames[key] || rootCategory?.name || 'Industrial Automation';
}

function getCategoryTitleSuffix(brandName: string): string {
  return brandName === 'FANUC' ? 'FANUC CNC Parts' : `${brandName} Automation Parts`;
}

function trimMetaText(value: string, maxLength: number): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const cut = normalized.slice(0, maxLength);
  const boundary = cut.lastIndexOf(' ');
  // Never leave a dangling separator ("... Parts |") after the cut.
  return (boundary >= 24 ? cut.slice(0, boundary) : cut).replace(/[\s|,:;–—-]+$/, '').trim();
}

// Descriptions end on a full sentence (or a clean word boundary plus a period)
// instead of stopping mid-phrase at the character limit.
function trimMetaDescription(value: string, maxLength = 158): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  let out = '';
  for (const sentence of normalized.split(/(?<=[.!?])\s+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > maxLength) break;
    out = next;
  }
  if (out.length >= 80) return out;
  // A single long list sentence: close it at the last complete list item.
  const cut = normalized.slice(0, maxLength - 10);
  const comma = cut.lastIndexOf(', ');
  if (comma > 80) return `${cut.slice(0, comma)} and more.`;
  return `${trimMetaText(normalized, maxLength - 1).replace(/[.,;:]+$/, '')}.`;
}

// Root categories are brands ("FANUC Parts"); child names get the brand prefix
// unless they already carry it, so the H1 and title name the full product family.
function getCategoryDisplayName(category: any, brandName: string): string {
  const name = String(category?.name || '').trim();
  if (!category?.parent_id) {
    if (isInternalCategory(category)) return name || 'Category';
    return /\bparts\b/i.test(name) ? name : `${brandName} Parts`;
  }
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const compactBrand = compact(brandName);
  return compactBrand && compact(name).includes(compactBrand) ? name : `${brandName} ${name}`;
}

function buildCategoryTitle(displayName: string, brandName: string, isRoot: boolean): string {
  const candidates = isRoot
    ? [`${displayName} – ${brandName === 'FANUC' ? 'CNC & Robot Spares' : 'Automation Spares'} | Buy Online`, `${displayName} – Buy Online`, displayName]
    : [`${displayName} – Buy Online`, displayName];
  return candidates.find((candidate) => candidate.length <= 58) || trimMetaText(displayName, 58);
}

function hasRichCategoryDescription(
  description: string | undefined,
  displayName: string,
  brandName: string,
): boolean {
  const cleaned = String(description || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 70) return false;
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const compactDesc = compact(cleaned);
  if (compactDesc === compact(displayName)) return false;
  if (compactDesc === compact(`${brandName} industrial automation parts`)) return false;
  return true;
}

// Prefer rich category descriptions from the database; only fall back to
// keyword templates when stored copy is empty or short boilerplate.
function getCategoryMetaDescription(
  categoryName: string,
  baseDescription: string | undefined,
  brandName: string,
  commercePolicy?: CommercePolicySetting,
): string {
  if (hasRichCategoryDescription(baseDescription, categoryName, brandName)) {
    return trimMetaDescription(baseDescription!);
  }

  const name = categoryName.toLowerCase();
  const titleSuffix = getCategoryTitleSuffix(brandName);
  // The warranty / delivery promise is admin-editable, never hard-coded here.
  const policy = commercePolicy ? { ...FALLBACK_COMMERCE_POLICY, ...commercePolicy } : FALLBACK_COMMERCE_POLICY;
  const warranty = resolveWarrantyPeriod(undefined, policy);
  const transit = policy.shipping_transit_time_text;
  const carriers = commercePolicyCarriers(policy).slice(0, 2).join('/');
  // Destination scope also comes from the policy: an empty list means worldwide.
  const destinations = commercePolicyDestinationCountries(policy);
  const shipScope = destinations.length === 0 ? 'worldwide' : `to ${destinations.join(', ')}`;
  const templates: Record<string, string> = {
    'servo': `Shop ${categoryName} for precise motion control. Tested parts, ${warranty} warranty, and ${transit} ${shipScope} shipping from Vibocnc.`,
    'motor': `Buy ${categoryName} for industrial automation and CNC maintenance. Quality tested with ${warranty} warranty and ${shipScope} shipping from Vibocnc.`,
    'pcb': `Find ${categoryName} for reliable CNC signal processing. Quality-tested boards with ${warranty} warranty and ${shipScope} delivery from Vibocnc.`,
    'board': `Browse ${categoryName} for CNC and automation control systems. Quality-tested circuit boards with ${warranty} warranty from Vibocnc.`,
    'power': `Shop ${categoryName} for stable industrial power delivery. Tested units with ${warranty} warranty and ${shipScope} shipping from Vibocnc.`,
    'i/o': `Buy ${categoryName} for robust automation I/O control. Tested modules with ${warranty} warranty and ${transit} express shipping ${shipScope} from Vibocnc.`,
    'interface': `Find ${categoryName} for reliable industrial communication. Quality-tested parts with ${warranty} warranty from Vibocnc.`,
    'encoder': `Shop ${categoryName} for accurate position feedback. Tested encoders with ${warranty} warranty and ${transit} delivery ${shipScope} from Vibocnc.`,
    'cable': `Buy ${categoryName} for reliable industrial connections. Quality cables with ${warranty} warranty and fast express shipping from Vibocnc.`,
    'display': `Find ${categoryName} for clear machine operator interfaces. Tested displays with ${warranty} warranty and ${shipScope} shipping from Vibocnc.`,
    'spindle': `Shop ${categoryName} for high-speed CNC spindle control. Tested drives with ${warranty} warranty and express shipping ${shipScope} from Vibocnc.`,
    'controller': `Buy ${categoryName} for advanced machine control. Tested controllers with ${warranty} warranty and ${transit} delivery ${shipScope} from Vibocnc.`,
    'robot': `Find ${categoryName} for industrial robot automation. Tested parts with ${warranty} warranty and fast ${carriers} shipping ${shipScope} from Vibocnc.`,
  };

  for (const [key, template] of Object.entries(templates)) {
    if (name.includes(key)) return trimMetaDescription(template);
  }

  return trimMetaDescription(`Browse ${categoryName} from Vibocnc. Quality ${titleSuffix}, tested with ${warranty} warranty and fast shipping ${shipScope} via ${carriers}.`);
}

function isOtherBucketSubcategory(category: { slug?: string; name?: string }): boolean {
  const slug = String(category.slug || '').toLowerCase();
  const name = String(category.name || '').toLowerCase();
  return slug.endsWith('-other-parts') || slug === 'other-parts' || /\bother parts\b/.test(name);
}

async function resolveCategoryProductCount(categoryId: number): Promise<number> {
  try {
    const tree = await CategoryService.getCategories();
    const matched = findCategoryNodeById(tree, categoryId);
    if (matched && typeof matched.product_count === 'number') {
      return matched.product_count;
    }
  } catch {
    // Fall through to product count lookup
  }
  try {
    const page = await ProductService.getProducts({
      category_id: String(categoryId),
      include_descendants: 'true',
      is_active: 'true',
      page: 1,
      page_size: 1,
    });
    return Number(page.total || 0);
  } catch {
    return 0;
  }
}

export async function generateMetadata({ params, searchParams }: CategoryPathPageProps): Promise<Metadata> {
  try {
    const { categoryPath } = await params;
    const resolvedSearchParams = (await searchParams) || {};
    // Deep pages and filtered/sorted query variants repeat page 1's copy across
    // thousands of combinations. They stay crawlable (follow) so bots can still
    // reach product links, but must not be indexed in their own right.
    const hasQueryVariant = hasNonCanonicalCategoryQueryParams(resolvedSearchParams);
    const locale = await resolveRouteLocale(params);
    const path = (categoryPath || []).join('/');
    const resolved = await CategoryService.getCategoryByPath(path);
    const hasRequestedTranslation = hasTranslationForLocale(resolved.category.translations, locale);
    const contentLocale = hasRequestedTranslation ? locale : 'en';
    const category = localizeCategoryContent(resolved.category, contentLocale);
    const breadcrumb = (resolved.breadcrumb || []).map((item: any) => localizeCategoryContent(item, contentLocale));
    const urlPath = category.path ? `/categories/${category.path}` : `/categories/${path}`;
    const { canonical: localizedCanonical, languages } = await getLocalizedMetadataPaths(
      locale,
      urlPath,
      getAvailableTranslationLocales(resolved.category.translations),
    );
    const canonical = hasRequestedTranslation
      ? localizedCanonical
      : `${getSiteUrl()}${localizePublicPath(urlPath, 'en')}`;
    const brandName = getCategoryBrandName(category, breadcrumb);
    const displayName = getCategoryDisplayName(category, brandName);
    const commercePolicy = await getCommercePolicyCached();
    const metaDescription = getCategoryMetaDescription(displayName, category.description, brandName, commercePolicy);
    // The root layout appends "| Vibocnc"; buildCategoryTitle keeps room for it.
    const title = buildCategoryTitle(displayName, brandName, !category.parent_id);
    const productCount = await resolveCategoryProductCount(resolved.category.id);
    const isIndexableCategory = isCategoryIndexable(resolved.category, productCount);
    const ogImage = category.image_url
      ? (/^https?:\/\//i.test(category.image_url) ? category.image_url : `${getSiteUrl()}${category.image_url.startsWith('/') ? '' : '/'}${category.image_url}`)
      : `${getSiteUrl()}/images/og-image.jpg`;
    return {
      title,
      description: metaDescription,
      robots: { index: hasRequestedTranslation && isIndexableCategory && !hasQueryVariant, follow: true },
      openGraph: {
        title: withSiteName(title),
        description: metaDescription,
        type: 'website',
        url: canonical,
        images: [{ url: ogImage, alt: displayName }],
      },
      alternates: {
        canonical,
        languages,
      },
    };
  } catch {
    return {
      title: 'Category',
      description: 'Browse industrial automation parts by category.',
      robots: { index: false, follow: false },
    };
  }
}

// CollectionPage + FAQ + ItemList JSON-LD for category pages
function CategoryStructuredData({
  category,
  breadcrumb,
  baseUrl,
  locale,
  commercePolicy,
  faqEntries,
  items,
}: {
  category: any;
  breadcrumb: any[];
  baseUrl: string;
  locale: Awaited<ReturnType<typeof resolveRouteLocale>>;
  commercePolicy: CommercePolicySetting;
  faqEntries: VibocncFaqEntry[];
  items?: Array<{ name: string; url: string }>;
}) {
  const urlPath = category.path ? `/categories/${category.path}` : `/categories/${category.slug}`;
  const categoryUrl = `${baseUrl}${localizePublicPath(urlPath, locale)}`;
  const brandName = getCategoryBrandName(category, breadcrumb);
  const catName = getCategoryDisplayName(category, brandName);

  const collectionData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": catName,
    "description": getCategoryMetaDescription(catName, category.description, brandName, commercePolicy),
    "url": categoryUrl,
    "isPartOf": {
      "@id": `${baseUrl}/#website`
    },
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": translatePublicMessage(locale, 'common.home'),
          "item": `${baseUrl}${localizePublicPath('/', locale)}`
        },
        ...breadcrumb.map((bc: any, idx: number) => ({
          "@type": "ListItem",
          "position": idx + 2,
          "name": bc.name,
          "item": `${baseUrl}${localizePublicPath(`/categories/${bc.path || bc.slug}`, locale)}`
        }))
      ]
    }
  };

  const faqData = faqEntries.length > 0
    ? {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqEntries.map((entry) => ({
        "@type": "Question",
        "name": entry.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": entry.answer
        }
      }))
    }
    : null;

  // ItemList of the products rendered in the grid on this page.
  const itemListData = items && items.length > 0
    ? {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": catName,
      "url": categoryUrl,
      "numberOfItems": items.length,
      "itemListElement": items.map((item, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": item.name,
        "url": item.url
      }))
    }
    : null;

  const serialize = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serialize(collectionData) }}
      />
      {faqData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serialize(faqData) }}
        />
      )}
      {itemListData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serialize(itemListData) }}
        />
      )}
    </>
  );
}

export default async function CategoryPathPage({ params, searchParams }: CategoryPathPageProps) {
  const { categoryPath } = await params;
  const locale = await resolveRouteLocale(params);
  const searchParamsResolved = await searchParams;
  const path = (categoryPath || []).join('/');

  let resolved: { category: any; breadcrumb: any[] } | null = null;
  try {
    resolved = await CategoryService.getCategoryByPath(path);
  } catch {
    resolved = null;
  }

  if (!resolved?.category) {
    const redirectPath = legacyCategoryRedirects[path];
    if (redirectPath) {
      permanentRedirect(localizePublicPath(`/categories/${redirectPath}`, locale));
    }
    notFound();
  }

  // Canonical redirect to computed path if the request path differs.
  if (resolved.category.path && resolved.category.path !== path) {
    permanentRedirect(localizePublicPath(`/categories/${resolved.category.path}`, locale));
  }

  const categoryContentLocale = hasTranslationForLocale(resolved.category.translations, locale) ? locale : 'en';
  resolved = {
    category: localizeCategoryContent(resolved.category, categoryContentLocale),
    breadcrumb: (resolved.breadcrumb || []).map((item: any) => localizeCategoryContent(item, categoryContentLocale)),
  };

  const rawTree = await CategoryService.getCategories();
  const matchedTreeNode = findCategoryNodeById(rawTree, resolved.category.id);
  const localizedRawTree = rawTree.map((item) => localizeCategoryContent(item, locale));
  const { tree, totalRootCount } = buildCompactSidebarTree(localizedRawTree, resolved.category.id, {
    topRootLimit: 24,
  });
  const breadcrumbIds = (resolved.breadcrumb || [])
    .map((c: any) => Number(c.id))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  const baseUrl = getSiteUrl();

  // The admin-editable shipping / warranty / returns promise drives both the
  // visible copy and the structured data on this page.
  const commercePolicy = await getCommercePolicyCached();
  const categoryBrandName = getCategoryBrandName(resolved.category, resolved.breadcrumb || []);
  const categoryDisplayName = getCategoryDisplayName(resolved.category, categoryBrandName);

  // The first page of products is rendered on the server so crawlers that do
  // not execute JavaScript still see the catalogue; the client takes over for
  // filtering and pagination using the same filters.
  let initialPage: PaginationResponse<Product> | undefined;
  try {
    const listed = await ProductService.getProducts(categoryFiltersFromParams(resolved.category.id, searchParamsResolved));
    initialPage = { ...listed, data: (listed.data || []).map((item) => toSlimListingProduct(localizeProductContent(item, locale))) };
  } catch {
    initialPage = undefined;
  }
  const productCount =
    typeof matchedTreeNode?.product_count === 'number'
      ? matchedTreeNode.product_count
      : Number(initialPage?.total || 0);
  const visibleSubcategories = (matchedTreeNode?.children || [])
    .filter((child) => !isInternalCategory(child) && Number(child.product_count || 0) > 0)
    .map((child) => localizeCategoryContent(child, locale))
    .sort((a, b) => {
      const aOther = isOtherBucketSubcategory(a);
      const bOther = isOtherBucketSubcategory(b);
      const aCount = Number(a.product_count || 0);
      const bCount = Number(b.product_count || 0);
      if (aOther !== bOther) {
        if (aOther && bCount >= 10) return 1;
        if (bOther && aCount >= 10) return -1;
      }
      return bCount - aCount;
    });
  const subcategoryBarItems = visibleSubcategories.map((child) => ({
    id: child.id,
    name: child.name,
    href: localizePublicPath(`/categories/${child.path || child.slug}`, locale),
    count: Number(child.product_count || 0),
  }));
  const categoryItemList = (initialPage?.data || []).map((item) => ({
    name: item.name || item.sku,
    url: `${baseUrl}${localizePublicPath(`/products/${toProductPathId(item.sku)}`, locale)}`,
  }));

  const isCanonicalPage = !hasNonCanonicalCategoryQueryParams(searchParamsResolved);
  const geoOverview =
    !isInternalCategory(resolved.category) && productCount > 0 && isCanonicalPage
      ? buildVibocncCategoryGeoOverview({
          category: resolved.category,
          displayName: categoryDisplayName,
          brandName: categoryBrandName,
          productCount,
          subcategories: visibleSubcategories,
          sampleProducts: initialPage?.data || [],
          commercePolicy,
          locale,
        })
      : null;
  const categoryFaqEntries = geoOverview?.faqEntries || [];

  return (
    <PublicLayout>
      <CategoryStructuredData
        category={resolved.category}
        breadcrumb={resolved.breadcrumb || []}
        baseUrl={baseUrl}
        locale={locale}
        commercePolicy={commercePolicy}
        faqEntries={categoryFaqEntries}
        items={categoryItemList}
      />
      <ScrollRestorer storageKey="category-scroll-y" />
      <div className="site-page-shell min-h-screen">
        {/* Compact Hero */}
        <div className="site-page-hero py-6 md:py-8">
          <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <nav className="mb-2 flex justify-center" aria-label="Breadcrumb">
                <ol className="flex items-center flex-wrap gap-x-1.5 gap-y-1 text-xs sm:text-sm text-blue-100">
                  <li>
                    <a href={localizePublicPath('/', locale)} className="hover:text-white transition-colors">
                      {translatePublicMessage(locale, 'common.home')}
                    </a>
                  </li>
                  {(resolved.breadcrumb || []).map((bc: any) => (
                    <li key={bc.id} className="flex items-center">
                      <span className="mx-1.5">/</span>
                      <a
                        href={localizePublicPath(bc.path ? `/categories/${bc.path}` : `/categories/${bc.slug}`, locale)}
                        className={
                          bc.id === resolved!.category.id
                            ? 'text-white font-medium'
                            : 'hover:text-white transition-colors'
                        }
                      >
                        {bc.name}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
              <h1 className="text-2xl md:text-4xl font-bold mb-2">{categoryDisplayName}</h1>
              {resolved.category.description && (
                <p className="text-sm md:text-base text-blue-100 max-w-4xl mx-auto leading-relaxed">{resolved.category.description}</p>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[256px_minmax(0,1fr)]">
            {/* Left sidebar (rendered below products on mobile so listings stay above the fold) */}
            <aside className="min-w-0 order-2 lg:order-1">
              <div className="site-panel p-4 lg:sticky lg:top-28">
                <div className="mb-2.5 border-b border-slate-200 pb-2.5 text-sm font-semibold uppercase tracking-wide text-slate-900">{translatePublicMessage(locale, 'nav.categories')}</div>
                <CategorySidebarTree
                  tree={tree}
                  activeCategoryId={resolved.category.id}
                  defaultOpenIds={breadcrumbIds}
                  totalRootCount={totalRootCount}
                  storageKey="category-sidebar-open-ids"
                />
              </div>
            </aside>

            {/* Products & structured sourcing overview */}
            <section className="min-w-0 order-1 lg:order-2">
              {subcategoryBarItems.length > 0 && (
                <CategorySubcategoriesBar
                  displayName={categoryDisplayName}
                  subcategories={subcategoryBarItems}
                  locale={locale}
                  initialLimit={8}
                />
              )}

              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700" />
                  </div>
                }
              >
                <CategoryProductsClient category={toClientCategory(resolved.category)} initialSearchParams={searchParamsResolved} initialPage={initialPage} />
              </Suspense>

              {/* Structured Sourcing & Lifecycle Overview (SEO + GEO) */}
              {geoOverview && (
                <article
                  id="category-sourcing-overview"
                  className="site-panel mt-8 p-6 space-y-6"
                  aria-labelledby="category-sourcing-heading"
                >
                  <div>
                    <h2 id="category-sourcing-heading" className="text-xl font-semibold text-slate-900">
                      {categoryDisplayName}: Sourcing &amp; Lifecycle Overview
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">
                      {geoOverview.leadStatement}
                    </p>
                  </div>

                  {/* Quick-reference catalog specification grid */}
                  <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {geoOverview.factRows.map((row) => (
                      <div key={row.term}>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {row.term}
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-slate-900">{row.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {/* MRO procurement & interchangeability guidance */}
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      MRO Procurement &amp; Interchangeability Notes
                    </h3>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                      {geoOverview.procurementNotes.map((note) => (
                        <div
                          key={note.heading}
                          className="rounded-lg border border-slate-200 bg-white p-4"
                        >
                          <h4 className="text-sm font-semibold text-slate-900">{note.heading}</h4>
                          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{note.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Featured part numbers */}
                  {geoOverview.featuredParts.length > 0 && (
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Featured {categoryDisplayName} Part Numbers
                      </h3>
                      {geoOverview.seriesPrefixes.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500">
                          Indexed series prefixes: {geoOverview.seriesPrefixes.join(' · ')}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {geoOverview.featuredParts.map((part) => (
                          <Link
                            key={part.sku}
                            href={part.href}
                            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-900 transition-colors"
                          >
                            {part.sku}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4 text-sm text-slate-700">
                    Sourcing a multi-line plant BOM or discontinued {categoryBrandName} assembly? Email your part list to{' '}
                    <a href="mailto:flora@vibocnc.com" className="font-semibold text-[var(--site-primary)] underline">
                      flora@vibocnc.com
                    </a>{' '}
                    or submit an inquiry via{' '}
                    <Link href={localizePublicPath('/contact', locale)} className="font-semibold text-[var(--site-primary)] underline">
                      Vibocnc RFQ Support
                    </Link>
                    .
                  </div>
                </article>
              )}

              {/* Visible FAQ: same questions and answers as the FAQPage markup
                  above. Google only shows the FAQ rich result when the content
                  is actually on the page. */}
              {categoryFaqEntries.length > 0 && (
                <section className="site-panel mt-8 p-6" aria-labelledby="category-faq-heading">
                  <h2 id="category-faq-heading" className="text-xl font-semibold text-slate-900">
                    {categoryDisplayName}: Procurement &amp; Compatibility FAQ
                  </h2>
                  <div className="mt-4 divide-y divide-slate-200">
                    {categoryFaqEntries.map((entry) => (
                      <details key={entry.question} className="group py-4" open>
                        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 marker:hidden">
                          {entry.question}
                        </summary>
                        <p className="mt-2 text-sm leading-relaxed text-slate-700">{entry.answer}</p>
                      </details>
                    ))}
                  </div>
                </section>
              )}
            </section>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
