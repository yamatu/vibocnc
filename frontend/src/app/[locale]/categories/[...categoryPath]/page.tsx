import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import PublicLayout from '@/components/layout/PublicLayout';
import CategoryProductsClient from '@/components/categories/CategoryProductsClient';
import CategorySidebarTree from '@/components/categories/CategorySidebarTree';
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
import type { Category, CategoryNavigationNode, CommercePolicySetting, PaginationResponse, Product } from '@/types';
import { categoryFiltersFromParams } from '@/lib/category-listing';
import {
  FALLBACK_COMMERCE_POLICY,
  commercePolicyCarriers,
  commercePolicyDestinationCountries,
  commercePolicyReturnShippingText,
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
  ab: 'AB',
  huawei: 'Huawei',
  sick: 'SICK',
  tamagawa: 'Tamagawa',
};

// Listing cards only need summary fields; trimming the description keeps the
// server-rendered page payload small.
function toListingProduct(product: Product): Product {
  const description = String(product.short_description || product.description || '');
  return { ...product, description: description.length > 240 ? `${description.slice(0, 237)}...` : description, faqs: undefined, reviews: undefined, translations: undefined } as Product;
}

function toNavigationCategory(category: Category): CategoryNavigationNode {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    path: category.path,
    sort_order: category.sort_order,
    product_count: category.product_count,
    children: category.children?.map(toNavigationCategory),
  };
}

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
  if (!category?.parent_id) return `${brandName} Parts`;
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return compact(name).includes(compact(brandName)) ? name : `${brandName} ${name}`;
}

function buildCategoryTitle(displayName: string, brandName: string, isRoot: boolean): string {
  const candidates = isRoot
    ? [`${displayName} – ${brandName === 'FANUC' ? 'CNC & Robot Spares' : 'Automation Spares'} | Buy Online`, `${displayName} – Buy Online`, displayName]
    : [`${displayName} – Buy Online`, displayName];
  return candidates.find((candidate) => candidate.length <= 58) || trimMetaText(displayName, 58);
}

// Category-specific meta description templates
function getCategoryMetaDescription(
  categoryName: string,
  baseDescription: string | undefined,
  brandName: string,
  commercePolicy?: CommercePolicySetting,
): string {
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

  if (baseDescription && baseDescription.length > 50) return trimMetaDescription(baseDescription);

  return trimMetaDescription(`Browse ${categoryName} from Vibocnc. Quality ${titleSuffix}, tested with ${warranty} warranty and fast shipping ${shipScope} via ${carriers}.`);
}

/**
 * The category FAQ copy is defined once and used twice: as visible page content
 * and as FAQPage structured data. Google only grants the FAQ rich result when
 * the answers are actually visible, so the two must stay in sync.
 */
function buildCategoryFaqEntries(
  categoryName: string,
  policy: CommercePolicySetting,
): Array<{ question: string; answer: string }> {
  const warranty = resolveWarrantyPeriod(undefined, policy);
  const carriers = commercePolicyCarriers(policy).join(', ');
  const destinations = commercePolicyDestinationCountries(policy);
  const shipScope = destinations.length === 0 ? 'worldwide' : `to ${destinations.join(', ')}`;
  return [
    {
      question: `Where can I buy ${categoryName} online?`,
      answer: `You can buy quality-tested ${categoryName} online at Vibocnc (vibocnc.com). We support ${warranty} warranty terms, ${policy.return_window_text} returns and express shipping ${shipScope} via ${carriers}.`,
    },
    {
      question: `Do you offer warranty on ${categoryName}?`,
      answer: `Yes, ${categoryName} supplied by Vibocnc include ${warranty} warranty support. Every part is quality checked before shipment, and ${commercePolicyReturnShippingText(policy)} if a return is required within ${policy.return_window_text}.`,
    },
    {
      question: `How fast is shipping for ${categoryName}?`,
      answer: `We ship ${shipScope} via ${carriers}. Orders are handled in ${policy.shipping_handling_time_text} and transit time is typically ${policy.shipping_transit_time_text}, subject to customs and local service availability.`,
    },
    {
      question: `How do I confirm the right part number for my machine?`,
      answer: `Send the machine builder, controller model, amplifier or drive reference and the alarm code to flora@vibocnc.com, or use the product enquiry form. Our team verifies interchangeability before dispatch so a compatible ${categoryName} is shipped the first time.`,
    },
  ];
}

export async function generateMetadata({ params, searchParams }: CategoryPathPageProps): Promise<Metadata> {
  try {
    const { categoryPath } = await params;
    const resolvedSearchParams = (await searchParams) || {};
    const rawPage = Array.isArray(resolvedSearchParams.page) ? resolvedSearchParams.page[0] : resolvedSearchParams.page;
    const currentPage = Math.max(1, Number.parseInt(rawPage || '1', 10) || 1);
    // Deep pages of a category repeat page 1's product copy across thousands of
    // filtered listings. They stay crawlable so crawlers can still follow the
    // product links, but they must not be indexed in their own right.
    const isDeepPage = currentPage > 1;
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
    const ogImage = category.image_url
      ? (/^https?:\/\//i.test(category.image_url) ? category.image_url : `${getSiteUrl()}${category.image_url.startsWith('/') ? '' : '/'}${category.image_url}`)
      : `${getSiteUrl()}/images/og-image.jpg`;
    return {
      title,
      description: metaDescription,
      robots: { index: hasRequestedTranslation && !isDeepPage, follow: true },
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
    };
  }
}

// CollectionPage + FAQ + ItemList JSON-LD for category pages
function CategoryStructuredData({ category, breadcrumb, baseUrl, locale, commercePolicy, items }: { category: any; breadcrumb: any[]; baseUrl: string; locale: Awaited<ReturnType<typeof resolveRouteLocale>>; commercePolicy: CommercePolicySetting; items?: Array<{ name: string; url: string }> }) {
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

  const faqEntries = buildCategoryFaqEntries(catName, commercePolicy);
  const faqData = {
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
  };

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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqData) }}
      />
      {itemListData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListData) }}
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

  const tree = (await CategoryService.getCategories())
    .map((item) => localizeCategoryContent(item, locale))
    .map(toNavigationCategory);
  const breadcrumbIds = (resolved.breadcrumb || [])
    .map((c: any) => Number(c.id))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  const baseUrl = getSiteUrl();

  // The admin-editable shipping / warranty / returns promise drives both the
  // visible copy and the structured data on this page.
  const commercePolicy = await getCommercePolicyCached();
  const categoryBrandName = getCategoryBrandName(resolved.category, resolved.breadcrumb || []);
  const categoryDisplayName = getCategoryDisplayName(resolved.category, categoryBrandName);
  const categoryFaqEntries = buildCategoryFaqEntries(categoryDisplayName, commercePolicy);

  // The first page of products is rendered on the server so crawlers that do
  // not execute JavaScript still see the catalogue; the client takes over for
  // filtering and pagination using the same filters.
  let initialPage: PaginationResponse<Product> | undefined;
  try {
    const listed = await ProductService.getProducts(categoryFiltersFromParams(resolved.category.id, searchParamsResolved));
    initialPage = { ...listed, data: (listed.data || []).map((item) => toListingProduct(localizeProductContent(item, locale))) };
  } catch {
    initialPage = undefined;
  }
  const categoryItemList = (initialPage?.data || []).map((item) => ({
    name: item.name || item.sku,
    url: `${baseUrl}${localizePublicPath(`/products/${toProductPathId(item.sku)}`, locale)}`,
  }));

  return (
    <PublicLayout>
      <CategoryStructuredData
        category={resolved.category}
        breadcrumb={resolved.breadcrumb || []}
        baseUrl={baseUrl}
        locale={locale}
        commercePolicy={commercePolicy}
        items={categoryItemList}
      />
      <ScrollRestorer storageKey="category-scroll-y" />
      <div className="site-page-shell min-h-screen">
        {/* Hero */}
        <div className="site-page-hero py-12">
          <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="site-hero-kicker mb-5">{translatePublicMessage(locale, 'categories.kicker')}</div>
              <h1 className="text-3xl md:text-5xl font-bold mb-3">{categoryDisplayName}</h1>
              {resolved.category.description && (
                <p className="text-lg md:text-xl text-blue-100 max-w-3xl mx-auto leading-relaxed">{resolved.category.description}</p>
              )}
              <div className="mt-5">
                <nav className="flex justify-center" aria-label="Breadcrumb">
                  <ol className="flex items-center flex-wrap gap-x-2 gap-y-1 text-blue-100">
                    <li>
                      <a href={localizePublicPath('/', locale)} className="hover:text-white transition-colors">
                        {translatePublicMessage(locale, 'common.home')}
                      </a>
                    </li>
                    {(resolved.breadcrumb || []).map((bc: any) => (
                      <li key={bc.id} className="flex items-center">
                        <span className="mx-2">/</span>
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
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[256px_minmax(0,1fr)]">
            {/* Left sidebar */}
            <aside className="min-w-0">
              <div className="site-panel p-4 lg:sticky lg:top-28">
                <div className="mb-3 border-b border-slate-200 pb-3 text-sm font-semibold uppercase tracking-wide text-slate-900">{translatePublicMessage(locale, 'nav.categories')}</div>
                <CategorySidebarTree
                  tree={tree}
                  activeCategoryId={resolved.category.id}
                  defaultOpenIds={breadcrumbIds}
                  storageKey="category-sidebar-open-ids"
                />
              </div>
            </aside>

            {/* Products */}
            <section className="min-w-0">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700" />
                  </div>
                }
              >
                <CategoryProductsClient category={resolved.category} initialSearchParams={searchParamsResolved} initialPage={initialPage} />
              </Suspense>

              {/* Visible FAQ: same questions and answers as the FAQPage markup
                  above. Google only shows the FAQ rich result when the content
                  is actually on the page. */}
              <section className="site-panel mt-8 p-6" aria-labelledby="category-faq-heading">
                <h2 id="category-faq-heading" className="text-xl font-semibold text-slate-900">
                  {categoryDisplayName}: frequently asked questions
                </h2>
                <div className="mt-4 divide-y divide-slate-200">
                  {categoryFaqEntries.map((entry) => (
                    <details key={entry.question} className="group py-4">
                      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 marker:hidden">
                        {entry.question}
                      </summary>
                      <p className="mt-2 text-sm leading-relaxed text-slate-700">{entry.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            </section>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
