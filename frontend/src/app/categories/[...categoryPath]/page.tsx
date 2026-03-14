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

// Category-specific meta description templates
function getCategoryMetaDescription(categoryName: string, baseDescription?: string): string {
  const name = categoryName.toLowerCase();
  const templates: Record<string, string> = {
    'servo': `Shop FANUC ${categoryName} for precise CNC motion control. Tested, 12-month warranty, fast worldwide shipping. In-stock parts ready to ship from Vcocnc.`,
    'motor': `Buy FANUC ${categoryName} for high-torque CNC performance. Quality tested with 12-month warranty. Fast DHL/FedEx shipping worldwide from Vcocnc.`,
    'pcb': `Find FANUC ${categoryName} for reliable CNC signal processing. All boards tested before shipping. 12-month warranty, worldwide delivery from Vcocnc.`,
    'board': `Browse FANUC ${categoryName} for CNC control systems. Quality-tested circuit boards with 12-month warranty. Fast global shipping from Vcocnc.`,
    'power': `Shop FANUC ${categoryName} for stable CNC power delivery. Industrial-grade units tested and ready to ship. 12-month warranty at Vcocnc.`,
    'i/o': `Buy FANUC ${categoryName} for robust automation I/O control. Tested modules with 12-month warranty. Worldwide express shipping from Vcocnc.`,
    'interface': `Find FANUC ${categoryName} for reliable CNC communication. All parts quality tested. 12-month warranty, DHL/FedEx shipping from Vcocnc.`,
    'encoder': `Shop FANUC ${categoryName} for accurate CNC position feedback. Tested encoders with 12-month warranty. Fast worldwide delivery from Vcocnc.`,
    'cable': `Buy FANUC ${categoryName} for reliable industrial connections. Quality cables with 12-month warranty. Fast express shipping worldwide at Vcocnc.`,
    'display': `Find FANUC ${categoryName} for clear CNC operator interfaces. Tested displays with 12-month warranty. Worldwide shipping from Vcocnc.`,
    'spindle': `Shop FANUC ${categoryName} for high-speed CNC spindle control. Tested drives with 12-month warranty. Express global shipping from Vcocnc.`,
    'controller': `Buy FANUC ${categoryName} for advanced CNC machine control. All controllers tested. 12-month warranty, fast worldwide delivery at Vcocnc.`,
    'robot': `Find FANUC ${categoryName} for industrial robot automation. Tested parts with 12-month warranty. Fast DHL/FedEx shipping worldwide from Vcocnc.`,
  };

  for (const [key, template] of Object.entries(templates)) {
    if (name.includes(key)) return template;
  }

  if (baseDescription && baseDescription.length > 50) return baseDescription;

  return `Browse ${categoryName} from Vcocnc. Quality FANUC CNC spare parts, tested with 12-month warranty. Fast worldwide shipping via DHL & FedEx.`;
}

export async function generateMetadata({ params }: CategoryPathPageProps): Promise<Metadata> {
  try {
    const { categoryPath } = await params;
    const path = (categoryPath || []).join('/');
    const { category } = await CategoryService.getCategoryByPath(path);
    const baseUrl = getSiteUrl();
    const urlPath = category.path ? `/categories/${category.path}` : `/categories/${path}`;
    const metaDescription = getCategoryMetaDescription(category.name, category.description);
    return {
      title: `${category.name} - FANUC CNC Parts | Buy Online | Vcocnc`,
      description: metaDescription,
      openGraph: {
        title: `${category.name} - FANUC CNC Parts | Vcocnc`,
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
      title: 'Category | Vcocnc',
      description: 'Browse FANUC automation parts by category.',
    };
  }
}

// CollectionPage + FAQ JSON-LD for category pages
function CategoryStructuredData({ category, breadcrumb, baseUrl }: { category: any; breadcrumb: any[]; baseUrl: string }) {
  const urlPath = category.path ? `/categories/${category.path}` : `/categories/${category.slug}`;
  const categoryUrl = `${baseUrl}${urlPath}`;

  const collectionData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": category.name,
    "description": getCategoryMetaDescription(category.name, category.description),
    "url": categoryUrl,
    "isPartOf": {
      "@type": "WebSite",
      "name": "Vcocnc",
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
        "name": `Where can I buy FANUC ${catName} online?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `You can buy genuine FANUC ${catName} online at Vcocnc (vcocncspare.com). We offer quality-tested parts with 12-month warranty and worldwide express shipping via DHL and FedEx.`
        }
      },
      {
        "@type": "Question",
        "name": `Do you offer warranty on FANUC ${catName}?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `Yes, all FANUC ${catName} from Vcocnc come with a 12-month warranty. Every part is quality tested before shipment to ensure reliability.`
        }
      },
      {
        "@type": "Question",
        "name": `How fast is shipping for FANUC ${catName}?`,
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
      <div className="min-h-screen bg-gray-50">
        {/* Hero */}
        <div className="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-3xl md:text-5xl font-bold mb-3">{resolved.category.name}</h1>
              {resolved.category.description && (
                <p className="text-lg md:text-xl text-yellow-100 max-w-3xl mx-auto">{resolved.category.description}</p>
              )}
              <div className="mt-5">
                <nav className="flex justify-center" aria-label="Breadcrumb">
                  <ol className="flex items-center flex-wrap gap-x-2 gap-y-1 text-yellow-100">
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
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-sm font-semibold text-gray-900 mb-3">Categories</div>
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
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600" />
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
