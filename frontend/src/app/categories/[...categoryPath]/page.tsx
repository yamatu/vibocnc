import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import PublicLayout from '@/components/layout/PublicLayout';
import CategoryProductsClient from '@/components/categories/CategoryProductsClient';
import CategorySidebarTree from '@/components/categories/CategorySidebarTree';
import ScrollRestorer from '@/components/common/ScrollRestorer';
import { CategoryService } from '@/services';
import { getSiteUrl } from '@/lib/url';

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
    'servo': `Shop ${brandName} ${categoryName} for precise motion control. Tested parts, 12-month warranty, and fast worldwide shipping from VIBO CNC.`,
    'motor': `Buy ${brandName} ${categoryName} for industrial automation and CNC maintenance. Quality tested with 12-month warranty and worldwide shipping from VIBO CNC.`,
    'pcb': `Find ${brandName} ${categoryName} for reliable CNC signal processing. Quality-tested boards with 12-month warranty and worldwide delivery from VIBO CNC.`,
    'board': `Browse ${brandName} ${categoryName} for CNC and automation control systems. Quality-tested circuit boards with 12-month warranty from VIBO CNC.`,
    'power': `Shop ${brandName} ${categoryName} for stable industrial power delivery. Tested units with 12-month warranty and worldwide shipping from VIBO CNC.`,
    'i/o': `Buy ${brandName} ${categoryName} for robust automation I/O control. Tested modules with 12-month warranty and worldwide express shipping from VIBO CNC.`,
    'interface': `Find ${brandName} ${categoryName} for reliable industrial communication. Quality-tested parts with 12-month warranty from VIBO CNC.`,
    'encoder': `Shop ${brandName} ${categoryName} for accurate position feedback. Tested encoders with 12-month warranty and fast worldwide delivery from VIBO CNC.`,
    'cable': `Buy ${brandName} ${categoryName} for reliable industrial connections. Quality cables with 12-month warranty and fast express shipping from VIBO CNC.`,
    'display': `Find ${brandName} ${categoryName} for clear machine operator interfaces. Tested displays with 12-month warranty and worldwide shipping from VIBO CNC.`,
    'spindle': `Shop ${brandName} ${categoryName} for high-speed CNC spindle control. Tested drives with 12-month warranty and express global shipping from VIBO CNC.`,
    'controller': `Buy ${brandName} ${categoryName} for advanced machine control. Tested controllers with 12-month warranty and fast worldwide delivery from VIBO CNC.`,
    'robot': `Find ${brandName} ${categoryName} for industrial robot automation. Tested parts with 12-month warranty and fast DHL/FedEx shipping worldwide from VIBO CNC.`,
  };

  for (const [key, template] of Object.entries(templates)) {
    if (name.includes(key)) return template;
  }

  if (baseDescription && baseDescription.length > 50) return baseDescription;

  return `Browse ${categoryName} from VIBO CNC. Quality ${titleSuffix}, tested with 12-month warranty and fast worldwide shipping via DHL and FedEx.`;
}

export async function generateMetadata({ params }: CategoryPathPageProps): Promise<Metadata> {
  try {
    const { categoryPath } = await params;
    const path = (categoryPath || []).join('/');
    const { category, breadcrumb } = await CategoryService.getCategoryByPath(path);
    const baseUrl = getSiteUrl();
    const urlPath = category.path ? `/categories/${category.path}` : `/categories/${path}`;
    const brandName = getCategoryBrandName(category, breadcrumb);
    const titleSuffix = getCategoryTitleSuffix(brandName);
    const metaDescription = getCategoryMetaDescription(category.name, category.description, brandName);
    return {
      title: `${category.name} - ${titleSuffix} | Buy Online | VIBO CNC`,
      description: metaDescription,
      openGraph: {
        title: `${category.name} - ${titleSuffix} | VIBO CNC`,
        description: metaDescription,
        type: 'website',
        url: `${baseUrl}${urlPath}`,
      },
      alternates: {
        canonical: `${baseUrl}${urlPath}`,
      },
    };
  } catch {
    return {
      title: 'Category | VIBO CNC',
      description: 'Browse industrial automation parts by category.',
    };
  }
}

// CollectionPage + FAQ JSON-LD for category pages
function CategoryStructuredData({ category, breadcrumb, baseUrl }: { category: any; breadcrumb: any[]; baseUrl: string }) {
  const urlPath = category.path ? `/categories/${category.path}` : `/categories/${category.slug}`;
  const categoryUrl = `${baseUrl}${urlPath}`;
  const brandName = getCategoryBrandName(category, breadcrumb);

  const collectionData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": category.name,
    "description": getCategoryMetaDescription(category.name, category.description, brandName),
    "url": categoryUrl,
    "isPartOf": {
      "@type": "WebSite",
      "name": "VIBO CNC",
      "url": baseUrl
    },
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": baseUrl
        },
        ...breadcrumb.map((bc: any, idx: number) => ({
          "@type": "ListItem",
          "position": idx + 2,
          "name": bc.name,
          "item": `${baseUrl}/categories/${bc.path || bc.slug}`
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
          "text": `You can buy quality-tested ${brandName} ${catName} online at VIBO CNC (vibocnc.com). We offer 12-month warranty support and worldwide express shipping via DHL and FedEx.`
        }
      },
      {
        "@type": "Question",
        "name": `Do you offer warranty on ${brandName} ${catName}?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `Yes, ${brandName} ${catName} supplied by VIBO CNC include 12-month warranty support. Every part is quality checked before shipment.`
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
      permanentRedirect(`/categories/${redirectPath}`);
    }
    notFound();
  }

  // Canonical redirect to computed path if the request path differs.
  if (resolved.category.path && resolved.category.path !== path) {
    permanentRedirect(`/categories/${resolved.category.path}`);
  }

  const tree = await CategoryService.getCategories();
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
      />
      <ScrollRestorer storageKey="category-scroll-y" />
      <div className="site-page-shell min-h-screen">
        {/* Hero */}
        <div className="site-page-hero py-12">
          <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="site-hero-kicker mb-5">Category Supply</div>
              <h1 className="text-3xl md:text-5xl font-bold mb-3">{resolved.category.name}</h1>
              {resolved.category.description && (
                <p className="text-lg md:text-xl text-blue-100 max-w-3xl mx-auto leading-relaxed">{resolved.category.description}</p>
              )}
              <div className="mt-5">
                <nav className="flex justify-center" aria-label="Breadcrumb">
                  <ol className="flex items-center flex-wrap gap-x-2 gap-y-1 text-blue-100">
                    <li>
                      <a href="/" className="hover:text-white transition-colors">
                        Home
                      </a>
                    </li>
                    {(resolved.breadcrumb || []).map((bc: any) => (
                      <li key={bc.id} className="flex items-center">
                        <span className="mx-2">/</span>
                        <a
                          href={bc.path ? `/categories/${bc.path}` : `/categories/${bc.slug}`}
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
                <div className="mb-3 border-b border-slate-200 pb-3 text-sm font-semibold uppercase tracking-wide text-slate-900">Categories</div>
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
