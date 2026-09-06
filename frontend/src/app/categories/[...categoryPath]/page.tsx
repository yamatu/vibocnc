import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import PublicLayout from '@/components/layout/PublicLayout';
import CategoryProductsClient from '@/components/categories/CategoryProductsClient';
import CategorySidebarTree from '@/components/categories/CategorySidebarTree';
import ScrollRestorer from '@/components/common/ScrollRestorer';
import { CategoryService } from '@/services';
import { getSiteUrl } from '@/lib/url';
import { withSiteName } from '@/lib/seo';
import { getLocalizedMetadataPaths, getRequestPublicLocale } from '@/lib/i18n/server';
import { getAvailableTranslationLocales, hasTranslationForLocale, localizeCategoryContent } from '@/lib/i18n/content';
import { localizePublicPath } from '@/lib/i18n/config';
import { translatePublicMessage } from '@/lib/i18n/messages';
import type { Category, CategoryNavigationNode } from '@/types';

interface CategoryPathPageProps {
  params: Promise<{ categoryPath: string[] }>;
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

// Category-specific meta description templates
function getCategoryMetaDescription(categoryName: string, baseDescription?: string, brandName = 'Industrial Automation'): string {
  const name = categoryName.toLowerCase();
  const titleSuffix = getCategoryTitleSuffix(brandName);
  const templates: Record<string, string> = {
    'servo': `Shop ${brandName} ${categoryName} for precise motion control. Tested parts, 12-month warranty, and fast worldwide shipping from Vibocnc.`,
    'motor': `Buy ${brandName} ${categoryName} for industrial automation and CNC maintenance. Quality tested with 12-month warranty and worldwide shipping from Vibocnc.`,
    'pcb': `Find ${brandName} ${categoryName} for reliable CNC signal processing. Quality-tested boards with 12-month warranty and worldwide delivery from Vibocnc.`,
    'board': `Browse ${brandName} ${categoryName} for CNC and automation control systems. Quality-tested circuit boards with 12-month warranty from Vibocnc.`,
    'power': `Shop ${brandName} ${categoryName} for stable industrial power delivery. Tested units with 12-month warranty and worldwide shipping from Vibocnc.`,
    'i/o': `Buy ${brandName} ${categoryName} for robust automation I/O control. Tested modules with 12-month warranty and worldwide express shipping from Vibocnc.`,
    'interface': `Find ${brandName} ${categoryName} for reliable industrial communication. Quality-tested parts with 12-month warranty from Vibocnc.`,
    'encoder': `Shop ${brandName} ${categoryName} for accurate position feedback. Tested encoders with 12-month warranty and fast worldwide delivery from Vibocnc.`,
    'cable': `Buy ${brandName} ${categoryName} for reliable industrial connections. Quality cables with 12-month warranty and fast express shipping from Vibocnc.`,
    'display': `Find ${brandName} ${categoryName} for clear machine operator interfaces. Tested displays with 12-month warranty and worldwide shipping from Vibocnc.`,
    'spindle': `Shop ${brandName} ${categoryName} for high-speed CNC spindle control. Tested drives with 12-month warranty and express global shipping from Vibocnc.`,
    'controller': `Buy ${brandName} ${categoryName} for advanced machine control. Tested controllers with 12-month warranty and fast worldwide delivery from Vibocnc.`,
    'robot': `Find ${brandName} ${categoryName} for industrial robot automation. Tested parts with 12-month warranty and fast DHL/FedEx shipping worldwide from Vibocnc.`,
  };

  for (const [key, template] of Object.entries(templates)) {
    if (name.includes(key)) return template;
  }

  if (baseDescription && baseDescription.length > 50) return baseDescription;

  return `Browse ${categoryName} from Vibocnc. Quality ${titleSuffix}, tested with 12-month warranty and fast worldwide shipping via DHL and FedEx.`;
}

export async function generateMetadata({ params }: CategoryPathPageProps): Promise<Metadata> {
  try {
    const { categoryPath } = await params;
    const locale = await getRequestPublicLocale();
    const path = (categoryPath || []).join('/');
    const resolved = await CategoryService.getCategoryByPath(path);
    const hasRequestedTranslation = hasTranslationForLocale(resolved.category.translations, locale);
    const contentLocale = hasRequestedTranslation ? locale : 'en';
    const category = localizeCategoryContent(resolved.category, contentLocale);
    const breadcrumb = (resolved.breadcrumb || []).map((item: any) => localizeCategoryContent(item, contentLocale));
    const urlPath = category.path ? `/categories/${category.path}` : `/categories/${path}`;
    const { canonical: localizedCanonical, languages } = await getLocalizedMetadataPaths(
      urlPath,
      getAvailableTranslationLocales(resolved.category.translations),
    );
    const canonical = hasRequestedTranslation
      ? localizedCanonical
      : `${getSiteUrl()}${localizePublicPath(urlPath, 'en')}`;
    const brandName = getCategoryBrandName(category, breadcrumb);
    const titleSuffix = getCategoryTitleSuffix(brandName);
    const metaDescription = getCategoryMetaDescription(category.name, category.description, brandName);
    return {
      title: `${category.name} - ${titleSuffix} | Buy Online`,
      description: metaDescription,
      robots: { index: hasRequestedTranslation, follow: true },
      openGraph: {
        title: withSiteName(`${category.name} - ${titleSuffix} | Buy Online`),
        description: metaDescription,
        type: 'website',
        url: canonical,
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

// CollectionPage + FAQ JSON-LD for category pages
function CategoryStructuredData({ category, breadcrumb, baseUrl, locale }: { category: any; breadcrumb: any[]; baseUrl: string; locale: Awaited<ReturnType<typeof getRequestPublicLocale>> }) {
  const urlPath = category.path ? `/categories/${category.path}` : `/categories/${category.slug}`;
  const categoryUrl = `${baseUrl}${localizePublicPath(urlPath, locale)}`;
  const brandName = getCategoryBrandName(category, breadcrumb);

  const collectionData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": category.name,
    "description": getCategoryMetaDescription(category.name, category.description, brandName),
    "url": categoryUrl,
    "isPartOf": {
      "@type": "WebSite",
      "name": "Vibocnc",
      "url": baseUrl
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

  const catName = category.name;
  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": `Where can I buy ${brandName} ${catName} online?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `You can buy quality-tested ${brandName} ${catName} online at Vibocnc (vibocnc.com). We offer 12-month warranty support and worldwide express shipping via DHL and FedEx.`
        }
      },
      {
        "@type": "Question",
        "name": `Do you offer warranty on ${brandName} ${catName}?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `Yes, ${brandName} ${catName} supplied by Vibocnc include 12-month warranty support. Every part is quality checked before shipment.`
        }
      },
      {
        "@type": "Question",
        "name": `How fast is shipping for ${brandName} ${catName}?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `We offer worldwide express shipping via DHL, FedEx, and UPS. Most in-stock ${catName} ship within 1-3 business days with delivery in 3-7 business days.`
        }
      }
    ]
  };

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
    </>
  );
}

export default async function CategoryPathPage({ params, searchParams }: CategoryPathPageProps) {
  const { categoryPath } = await params;
  const locale = await getRequestPublicLocale();
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

  return (
    <PublicLayout>
      <CategoryStructuredData
        category={resolved.category}
        breadcrumb={resolved.breadcrumb || []}
        baseUrl={baseUrl}
        locale={locale}
      />
      <ScrollRestorer storageKey="category-scroll-y" />
      <div className="site-page-shell min-h-screen">
        {/* Hero */}
        <div className="site-page-hero py-12">
          <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="site-hero-kicker mb-5">{translatePublicMessage(locale, 'categories.kicker')}</div>
              <h1 className="text-3xl md:text-5xl font-bold mb-3">{resolved.category.name}</h1>
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

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left sidebar */}
            <aside className="lg:col-span-3">
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
            <section className="lg:col-span-9">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700" />
                  </div>
                }
              >
                <CategoryProductsClient category={resolved.category} initialSearchParams={searchParamsResolved} />
              </Suspense>
            </section>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
