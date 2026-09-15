'use client';

import { Product, Category, CommercePolicySetting } from '@/types';
import { toProductPathId } from '@/lib/utils';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import {
  buildProductSchemaDescription,
  buildProductSeoDescription,
  buildSemanticProductName,
  inferProductTypeLabel,
} from '@/lib/product-seo';
import {
  FALLBACK_COMMERCE_POLICY,
  commercePolicyDestinationCountries,
  commercePolicyReturnShippingText,
} from '@/lib/commerce-policy';

const PUBLIC_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://vibocnc.com').replace(/\/+$/, '');

const GENERIC_BRAND_LABEL = 'industrial automation';
const GENERIC_MANUFACTURER_LABEL = 'industrial automation parts manufacturer';

type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonLdValue[]
  | { [key: string]: JsonLdValue };

interface ProductSEOProps {
  product: Product;
  category?: Category;
  categoryBreadcrumb?: Category[];
  baseUrl?: string;
  contentLocale?: string;
  /**
   * Admin-editable shipping / warranty / return promise. When omitted the
   * seeded defaults are used so the page never publishes an empty promise.
   */
  commercePolicy?: CommercePolicySetting;
}

function resolvePolicy(policy?: CommercePolicySetting): CommercePolicySetting {
  return policy ? { ...FALLBACK_COMMERCE_POLICY, ...policy } : FALLBACK_COMMERCE_POLICY;
}

/** schema.org return fee enum derived from who pays return freight. */
function mapReturnFees(policy: CommercePolicySetting): string {
  return policy.return_shipping_payer === 'merchant'
    ? 'https://schema.org/FreeReturn'
    : 'https://schema.org/ReturnShippingFees';
}

function mapConditionType(condition?: string): string {
  switch (condition) {
    case 'refurbished':
      return 'https://schema.org/RefurbishedCondition';
    case 'used':
      return 'https://schema.org/UsedCondition';
    default:
      return 'https://schema.org/NewCondition';
  }
}

function parseSpecs(raw?: string): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch { /* ignore */ }
  return null;
}

function toAbsoluteUrl(url: string | undefined, baseUrl: string): string {
  const value = String(url || '').trim();
  if (!value) return `${baseUrl}/images/default-product.svg`;
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

/**
 * The backend renders a public JPEG placeholder with the SKU overlaid. It is
 * preferable to the old default-product.jpg path, which is not deployed and
 * returned 404 to crawlers (making Product image markup invalid).
 */
function getProductImageFallback(product: Product, baseUrl: string): string {
  const sku = normalizeText(product.sku);
  if (!sku) return `${baseUrl}/images/default-product.svg`;
  const safeSku = sku.replace(/[\\/]+/g, '-').replace(/\s+/g, '-');
  return `${baseUrl}/api/v1/public/products/default-image/${encodeURIComponent(safeSku)}?sku=${encodeURIComponent(sku)}`;
}

function normalizeText(value?: string): string {
  return String(value || '').trim();
}

function stripHtml(value?: string): string {
  return normalizeText(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getBrandName(product: Product): string {
  return normalizeText(product.brand);
}

function getBrandLabel(product: Product): string {
  return getBrandName(product) || GENERIC_BRAND_LABEL;
}

function getManufacturerName(product: Product): string {
  return normalizeText(product.manufacturer) || getBrandName(product) || GENERIC_MANUFACTURER_LABEL;
}

function buildAnswerFirstSummary(product: Product, policy: CommercePolicySetting, category?: Category): string {
  const brandLabel = getBrandLabel(product);
  const categoryName = inferProductTypeLabel(category ? { ...product, category } : product);
  const leadTime = normalizeText(product.lead_time) || policy.default_lead_time;
  const warranty = normalizeText(product.warranty_period) || policy.default_warranty_period;
  const stockText = product.stock_quantity > 0
    ? `The item is in stock and ready for shipment with ${policy.shipping_transit_time_text} transit time.`
    : `The item is available to order with ${leadTime} lead time.`;
  const warrantyText = `Standard supply includes a ${warranty} warranty, ${policy.return_window_text} returns and ${commercePolicyReturnShippingText(policy)}.`;

  return `${brandLabel} ${product.sku} is a ${categoryName.toLowerCase()} used for CNC repair, replacement, and industrial automation maintenance. ${stockText} ${warrantyText}`;
}

export function ProductSEO({ product, category, categoryBreadcrumb, baseUrl = PUBLIC_SITE_URL, contentLocale, commercePolicy }: ProductSEOProps) {
  const { locale, t, href } = usePublicI18n();
  const policy = resolvePolicy(commercePolicy);
  const productPath = `/products/${toProductPathId(product.sku)}`;
  const productUrl = `${baseUrl}${contentLocale === 'en' && locale !== 'en' ? productPath : href(productPath)}`;
  const productId = `${productUrl}#product`;
  const brandLabel = getBrandLabel(product);
  const manufacturerName = getManufacturerName(product);
  const semanticProduct = category ? { ...product, category } : product;
  const semanticName = buildSemanticProductName(semanticProduct);
  const semanticCategory = inferProductTypeLabel(semanticProduct);
  const answerFirstSummary = buildAnswerFirstSummary(product, policy, category);
  const description = buildProductSchemaDescription(semanticProduct);
  const metaDescription = buildProductSeoDescription(semanticProduct, 160, policy);
  const leadTime = normalizeText(product.lead_time) || policy.default_lead_time;
  const warranty = normalizeText(product.warranty_period) || policy.default_warranty_period;
  const destinationCountries = commercePolicyDestinationCountries(policy);
  const returnCountry = normalizeText(policy.return_policy_country) || 'US';
  const schemaLocale = contentLocale || locale;
  const localeConfig = typeof Intl !== 'undefined'
    ? new Intl.Locale(schemaLocale === 'zh' ? 'zh-CN' : schemaLocale).toString()
    : schemaLocale;

  // Build image array
  const imageSources = product.images?.map(img => typeof img === 'string' ? img : img.url) ||
    product.image_urls ||
    [];
  const imageUrls = (imageSources.length > 0 ? imageSources : [getProductImageFallback(product, baseUrl)])
    .map((url) => toAbsoluteUrl(url, baseUrl));

  // Reviews & aggregate rating
  const approvedReviews = product.reviews?.filter(r => r.is_approved) || [];
  const hasReviews = approvedReviews.length > 0;
  const avgRating = hasReviews
    ? approvedReviews.reduce((sum, r) => sum + r.rating, 0) / approvedReviews.length
    : undefined;

  // Technical specs as additionalProperty
  const specs = parseSpecs(product.technical_specs);
  const specProperties = specs
    ? Object.entries(specs).map(([name, value]) => ({
        "@type": "PropertyValue",
        "name": name,
        "value": String(value),
      }))
    : [];
  const attributeProperties = product.attributes?.map((attribute) => ({
    "@type": "PropertyValue",
    "name": attribute.attribute_name,
    "value": String(attribute.attribute_value),
  })) || [];
  const additionalProperties = [...specProperties, ...attributeProperties];

  // Google requires Product markup to contain a real offer, review, or rating.
  // Quote-only records without approved reviews remain valid WebPage content,
  // but are not eligible for a Product rich result.
  const hasProductRichResultData = product.price > 0 || hasReviews;

  // Generate rich structured data for the product when the record supports it.
  const structuredData: { [key: string]: JsonLdValue } = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": productId,
    "name": semanticName,
    "sku": product.sku,
    "mpn": product.part_number || product.sku,
    "productID": product.sku,
    "description": description,
    "inLanguage": localeConfig,
    "disambiguatingDescription": answerFirstSummary,
    "brand": {
      "@type": "Brand",
      "name": brandLabel
    },
    "manufacturer": {
      "@type": "Organization",
      "name": manufacturerName
    },
    "category": semanticCategory,
    "image": imageUrls,
    "url": productUrl,
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": productUrl
    },
    "itemCondition": mapConditionType(product.condition_type),
    "countryOfOrigin": product.origin_country || undefined,
    "datePublished": product.created_at || undefined,
    "dateModified": product.updated_at || undefined,
    "keywords": [product.sku, product.part_number, product.brand, semanticCategory].filter(Boolean).join(', '),
    "audience": {
      "@type": "Audience",
      "audienceType": "CNC maintenance buyers and industrial automation service teams"
    },
    "offers": product.price > 0 ? {
      "@type": "Offer",
      "url": productUrl,
      "price": product.price,
      "priceCurrency": "USD",
      "itemCondition": mapConditionType(product.condition_type),
      "availability": product.stock_quantity > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/BackOrder",
      "seller": {
        "@type": "Organization",
        "@id": `${baseUrl}/#organization`,
        "name": "Vibocnc",
        "url": baseUrl
      },
      // Shipping and return promises come from the admin-editable commerce
      // policy instead of hard-coded copy, so editing them once updates every
      // product page and its structured data.
      "shippingDetails": {
        "@type": "OfferShippingDetails",
        "shippingRate": {
          "@type": "MonetaryAmount",
          "value": policy.shipping_rate_amount || 0,
          "currency": policy.shipping_currency || "USD"
        },
        // An empty destination list means worldwide coverage; schema.org treats
        // an omitted shippingDestination as unconstrained rather than wrong.
        ...(destinationCountries.length > 0 ? {
          "shippingDestination": destinationCountries.map((country) => ({
            "@type": "DefinedRegion",
            "addressCountry": country
          }))
        } : {}),
        "deliveryTime": {
          "@type": "ShippingDeliveryTime",
          "handlingTime": {
            "@type": "QuantitativeValue",
            "minValue": policy.shipping_handling_days_min,
            "maxValue": policy.shipping_handling_days_max,
            "unitCode": "DAY"
          },
          "transitTime": {
            "@type": "QuantitativeValue",
            "minValue": policy.shipping_transit_days_min,
            "maxValue": policy.shipping_transit_days_max,
            "unitCode": "DAY"
          }
        }
      },
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": returnCountry,
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
        "merchantReturnDays": policy.return_window_days,
        "returnMethod": "https://schema.org/ReturnByMail",
        "returnFees": mapReturnFees(policy),
        "merchantReturnLink": `${baseUrl}/returns`
      }
    } : undefined
  };

  // Add aggregate rating if reviews exist
  if (hasReviews && avgRating !== undefined) {
    structuredData.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": Math.round(avgRating * 10) / 10,
      "bestRating": 5,
      "worstRating": 1,
      "reviewCount": approvedReviews.length
    };

    structuredData.review = approvedReviews.slice(0, 5).map(r => ({
      "@type": "Review",
      "author": {
        "@type": "Person",
        "name": r.customer_name
      },
      "datePublished": r.created_at?.split('T')[0],
      "reviewRating": {
        "@type": "Rating",
        "ratingValue": r.rating,
        "bestRating": 5
      },
      "name": r.review_title || `Review of ${product.sku}`,
      "reviewBody": r.review_content
    }));
  }

  // Add technical specs as additional properties
  if (additionalProperties && additionalProperties.length > 0) {
    structuredData.additionalProperty = additionalProperties;
  }

  const subjectOf = [
    product.datasheet_url ? {
      "@type": "DigitalDocument",
      "name": `${product.sku} datasheet`,
      "url": product.datasheet_url,
    } : null,
    product.manual_url ? {
      "@type": "DigitalDocument",
      "name": `${product.sku} manual`,
      "url": product.manual_url,
    } : null,
  ].filter(Boolean);

  if (subjectOf.length > 0) {
    structuredData.subjectOf = subjectOf as JsonLdValue[];
  }

  // Speakable for AI search engines
  structuredData.speakable = {
    "@type": "SpeakableSpecification",
    "cssSelector": ["h1", ".product-summary", ".product-description", ".product-specs"]
  };

  // Generate breadcrumb structured data
  const breadcrumbData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": t('common.home'),
        "item": `${baseUrl}${href('/')}`
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": t('nav.products'),
        "item": `${baseUrl}${href('/products')}`
      },
      ...(categoryBreadcrumb?.map((cat, index) => ({
        "@type": "ListItem",
        "position": index + 3,
        "name": cat.name,
         "item": `${baseUrl}${href(`/categories/${cat.path || cat.slug}`)}`
      })) || []),
      {
        "@type": "ListItem",
        "position": (categoryBreadcrumb?.length || 0) + 3,
        "name": semanticName,
        "item": productUrl
      }
    ]
  };

  // Generate FAQ structured data - prefer database FAQs, fall back to generic
  const dbFaqs = product.faqs?.filter(f => f.is_active) || [];
  const faqEntities = dbFaqs.length > 0
    ? dbFaqs.map(f => ({
        "@type": "Question",
        "name": f.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": f.answer
        }
      }))
    : schemaLocale === 'zh'
      ? [
        {
          "@type": "Question",
          "name": `${product.sku} 主要用于什么场景？`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `${semanticName} 用于数控机床和工业自动化系统，可满足稳定控制、备件更换或设备维护需求。`
          }
        },
        {
          "@type": "Question",
          "name": `${product.sku} 目前有库存吗？`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": product.stock_quantity > 0
              ? `${product.sku} 目前有库存，可安排发货。`
              : `${product.sku} 可订购，预计交货期为 ${leadTime}。`
          }
        },
        {
          "@type": "Question",
          "name": `如何确认 ${product.sku} 是否兼容？`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": product.compatibility_info
              ? `${stripHtml(product.compatibility_info)} 下单前请联系 sales@vibocnc.com 进行最终兼容性确认。`
              : `请将设备型号或原零件号发送至 sales@vibocnc.com，我们会在发货前协助确认兼容性。`
          }
        }
      ]
      : [
        {
          "@type": "Question",
          "name": `What is ${product.sku} used for?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `${semanticName} is used in CNC and industrial automation systems for stable control, replacement, or maintenance needs.`
          }
        },
        {
          "@type": "Question",
          "name": `Is ${product.sku} in stock?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": product.stock_quantity > 0
              ? `${product.sku} is currently in stock and ready for shipment.`
              : `${product.sku} is available to order with ${leadTime} lead time.`
          }
        },
        {
          "@type": "Question",
          "name": `What warranty and return terms apply to ${product.sku}?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `${warranty} warranty, ${policy.return_window_text} return window, and ${commercePolicyReturnShippingText(policy)}.`
          }
        },
        {
          "@type": "Question",
          "name": `How can I confirm compatibility for ${product.sku}?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": product.compatibility_info
              ? `${stripHtml(product.compatibility_info)} Contact sales@vibocnc.com for final compatibility confirmation before ordering.`
              : `Share your machine model or original part number with sales@vibocnc.com and we will verify compatibility before shipment.`
          }
        }
      ];

  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqEntities
  };

  const webPageData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${productUrl}#webpage`,
    "url": productUrl,
    "name": semanticName,
    "description": metaDescription,
    "datePublished": product.created_at || undefined,
    "dateModified": product.updated_at || undefined,
    "inLanguage": localeConfig,
    "isPartOf": {
      // Reference the site-wide WebSite node instead of an anonymous copy so
      // search engines merge the graph into one entity.
      "@id": `${baseUrl}/#website`
    },
    "about": hasProductRichResultData
      ? { "@id": productId }
      : {
          "@type": "Thing",
          "name": semanticName,
          "identifier": product.sku,
        },
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": ["h1", ".product-summary", ".product-description", ".product-specs"]
    }
  };

  return (
    <>
      {/* Product Structured Data is only emitted when Google has a real
          offer, review, or aggregate rating to validate. */}
      {hasProductRichResultData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData)
          }}
        />
      )}

      {/* Breadcrumb Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbData)
        }}
      />

      {/* FAQ Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqData)
        }}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(webPageData)
        }}
      />
    </>
  );
}

export default ProductSEO;
