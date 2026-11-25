'use client';

import { Product, Category, CommercePolicySetting } from '@/types';
import type { MerchantShippingQuoteItem } from '@/services/shipping.server';
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
import { buildProductFaqs } from '@/lib/product-content';

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
  merchantShippingQuotes?: MerchantShippingQuoteItem[];
  referenceDate?: string;
}

function resolvePolicy(policy?: CommercePolicySetting): CommercePolicySetting {
  return policy ? { ...FALLBACK_COMMERCE_POLICY, ...policy } : FALLBACK_COMMERCE_POLICY;
}

/** schema.org return fee enum derived from who pays return freight. */
function mapReturnFees(policy: CommercePolicySetting): string {
  return policy.return_shipping_payer === 'merchant'
    ? 'https://schema.org/FreeReturn'
    : 'https://schema.org/ReturnFeesCustomerResponsibility';
}

/**
 * Parse a free-form lead time string (e.g. "3-7 days", "4-5 DAYS", "1 WEEK")
 * into a bounded upper-end day count for computing a BackOrder offer's validFrom.
 */
function parseLeadTimeDays(raw?: string, fallbackDays = 7): number {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return fallbackDays;

  const weekMatch = text.match(/(\d+)\s*(?:-\s*(\d+))?\s*(?:weeks?|wks?)\b/);
  if (weekMatch) {
    const weeks = Number(weekMatch[2] || weekMatch[1]);
    if (Number.isFinite(weeks) && weeks > 0) {
      return Math.min(Math.max(weeks * 7, 1), 90);
    }
  }

  const dayMatch = text.match(/(\d+)\s*(?:-\s*(\d+))?\s*(?:days?|d)\b/);
  if (dayMatch) {
    const days = Number(dayMatch[2] || dayMatch[1]);
    if (Number.isFinite(days) && days > 0) {
      return Math.min(Math.max(days, 1), 90);
    }
  }

  return fallbackDays;
}

/**
 * Compute an ISO 8601 UTC timestamp when a BackOrder item is expected to ship.
 * Using a server-supplied referenceDate prevents SSR/client hydration mismatches
 * across UTC midnight or ISR-cached HTML responses.
 */
function computeBackOrderValidFrom(leadTime?: string, referenceDate?: string): string {
  const days = parseLeadTimeDays(leadTime, 7);
  let baseYear: number;
  let baseMonth: number;
  let baseDay: number;

  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(referenceDate || '').trim());
  if (parsed) {
    baseYear = Number(parsed[1]);
    baseMonth = Number(parsed[2]) - 1;
    baseDay = Number(parsed[3]);
  } else {
    const now = new Date();
    baseYear = now.getUTCFullYear();
    baseMonth = now.getUTCMonth();
    baseDay = now.getUTCDate();
  }

  const target = new Date(Date.UTC(baseYear, baseMonth, baseDay + days));
  return `${target.toISOString().slice(0, 10)}T00:00:00Z`;
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

  const article = /^[aeiou]/i.test(categoryName) ? 'an' : 'a';
  const subject = categoryName.toLowerCase().startsWith(brandLabel.toLowerCase()) ? categoryName : `${brandLabel} ${categoryName}`;
  return `${brandLabel} ${product.sku} is ${article} ${subject} used for CNC repair, replacement, and industrial automation maintenance. ${stockText} ${warrantyText}`;
}

// Customer reviews are user input; escaping '<' keeps a '</script>' in review
// text from terminating the JSON-LD block.
function toJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function ProductSEO({ product, category, categoryBreadcrumb, baseUrl = PUBLIC_SITE_URL, contentLocale, commercePolicy, merchantShippingQuotes = [], referenceDate }: ProductSEOProps) {
  const { locale, t, href } = usePublicI18n();
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const policy = resolvePolicy(commercePolicy);
  const productPath = `/products/${toProductPathId(product.sku)}`;
  const productUrl = `${normalizedBaseUrl}${contentLocale === 'en' && locale !== 'en' ? productPath : href(productPath)}`;
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
  const imageUrls = (imageSources.length > 0 ? imageSources : [getProductImageFallback(product, normalizedBaseUrl)])
    .map((url) => toAbsoluteUrl(url, normalizedBaseUrl));

  // Reviews & aggregate rating
  // Reviews transcribed from other channels without an order are shown on the
  // page but kept out of rich results, which require first-party reviews.
  const approvedReviews = product.reviews?.filter(r => r.is_approved && (r.is_verified || !r.source)) || [];
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

  // Google flags any Product node lacking offers, review, or aggregateRating as
  // a critical error, and an Offer needs a price above zero. Quote-only records
  // without approved reviews omit the top-level Product node and publish rich
  // entity metadata on ItemPage.mainEntity as Thing + additionalType=Product.
  const hasValidOffer = product.price > 0;
  const hasProductRichResultData = hasValidOffer || hasReviews;

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
    "offers": hasValidOffer ? {
      "@type": "Offer",
      "url": productUrl,
      "price": product.price,
      "priceCurrency": "USD",
      "itemCondition": mapConditionType(product.condition_type),
      "availability": product.stock_quantity > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/BackOrder",
      ...(product.stock_quantity <= 0
        ? { "validFrom": computeBackOrderValidFrom(leadTime, referenceDate) }
        : {}),
      "seller": {
        "@type": "Organization",
        "@id": `${normalizedBaseUrl}/#organization`,
        "name": "Vibocnc",
        "url": normalizedBaseUrl
      },
      "priceValidUntil": "2027-12-31",
      ...(merchantShippingQuotes.length > 0 ? {
      "shippingDetails": merchantShippingQuotes.map((q) => ({
        "@type": "OfferShippingDetails",
        "shippingRate": {
          "@type": "MonetaryAmount",
          "value": Number(q.shipping_fee || 0).toFixed(2),
          "currency": q.currency || policy.shipping_currency || "USD"
        },
        "shippingDestination": {
          "@type": "DefinedRegion",
          "addressCountry": q.country_code
        },
        "deliveryTime": {
          "@type": "ShippingDeliveryTime",
          "handlingTime": {
            "@type": "QuantitativeValue",
            "minValue": q.handling_days_min || policy.shipping_handling_days_min || 1,
            "maxValue": q.handling_days_max || policy.shipping_handling_days_max || 2,
            "unitCode": "DAY"
          },
          "transitTime": {
            "@type": "QuantitativeValue",
            "minValue": q.transit_days_min || policy.shipping_transit_days_min || 4,
            "maxValue": q.transit_days_max || policy.shipping_transit_days_max || 5,
            "unitCode": "DAY"
          }
        }
      })),
      } : Number(policy.shipping_rate_amount) > 0 ? {
      "shippingDetails": {
        "@type": "OfferShippingDetails",
        "shippingRate": {
          "@type": "MonetaryAmount",
          "value": policy.shipping_rate_amount || 0,
          "currency": policy.shipping_currency || "USD"
        },
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
      } : {}),
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": merchantShippingQuotes.length > 0
          ? merchantShippingQuotes.map((q) => q.country_code)
          : [returnCountry],
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
        "merchantReturnDays": policy.return_window_days,
        "returnMethod": "https://schema.org/ReturnByMail",
        "returnFees": mapReturnFees(policy),
        "merchantReturnLink": `${normalizedBaseUrl}/returns`
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

  if (subjectOf.length > 0) {
    structuredData.subjectOf = subjectOf as JsonLdValue[];
  }

  // Speakable for AI search engines
  structuredData.speakable = {
    "@type": "SpeakableSpecification",
    "cssSelector": ["h1", ".product-description", ".product-specs"]
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
        "item": `${normalizedBaseUrl}${href('/')}`
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": t('nav.products'),
        "item": `${normalizedBaseUrl}${href('/products')}`
      },
      ...(categoryBreadcrumb?.map((cat, index) => ({
        "@type": "ListItem",
        "position": index + 3,
        "name": cat.name,
        "item": `${normalizedBaseUrl}${href(`/categories/${cat.path || cat.slug}`)}`
      })) || []),
      {
        "@type": "ListItem",
        "position": (categoryBreadcrumb?.length || 0) + 3,
        "name": semanticName,
        "item": productUrl
      }
    ]
  };

  // Same FAQ set as the visible accordion (structured data must match the page).
  const faqEntities = buildProductFaqs(product, { locale: schemaLocale, policy, warranty, leadTime }).map((faq) => ({
    "@type": "Question",
    "name": faq.question,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": faq.answer
    }
  }));

  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqEntities
  };

  const quoteOnlyEntity: { [key: string]: JsonLdValue } = {
    "@type": "Thing",
    "@id": productId,
    "additionalType": "https://schema.org/Product",
    "name": semanticName,
    "alternateName": product.part_number && product.part_number !== product.sku ? product.part_number : undefined,
    "identifier": [
      { "@type": "PropertyValue", "propertyID": "SKU", "value": product.sku },
      { "@type": "PropertyValue", "propertyID": "MPN", "value": product.part_number || product.sku },
      ...(getBrandName(product)
        ? [{ "@type": "PropertyValue", "propertyID": "Brand", "value": getBrandName(product) }]
        : []),
      { "@type": "PropertyValue", "propertyID": "Category", "value": semanticCategory },
      { "@type": "PropertyValue", "propertyID": "Condition", "value": product.condition_type || "new" },
      { "@type": "PropertyValue", "propertyID": "Warranty", "value": warranty },
      { "@type": "PropertyValue", "propertyID": "LeadTime", "value": leadTime },
      { "@type": "PropertyValue", "propertyID": "Pricing", "value": "Request for Quote (RFQ)" },
    ],
    "description": description,
    "disambiguatingDescription": answerFirstSummary,
    "image": imageUrls,
    "url": productUrl,
    ...(subjectOf.length > 0 ? { "subjectOf": subjectOf as JsonLdValue[] } : {}),
  };

  const webPageData = {
    "@context": "https://schema.org",
    "@type": "ItemPage",
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
      "@id": `${normalizedBaseUrl}/#website`
    },
    "publisher": {
      "@id": `${normalizedBaseUrl}/#organization`
    },
    "mainEntity": hasProductRichResultData
      ? { "@id": productId }
      : quoteOnlyEntity,
    "about": { "@id": productId },
    "potentialAction": !hasProductRichResultData
      ? {
          "@type": "CommunicateAction",
          "name": `Request quote for ${product.sku}`,
          "target": `${normalizedBaseUrl}${href('/contact')}?sku=${encodeURIComponent(product.sku)}&inquiry_type=quote`,
        }
      : undefined,
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": ["h1", ".product-description", ".product-specs"]
    }
  };

  return (
    <>
      {hasProductRichResultData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: toJsonLd(structuredData)
          }}
        />
      )}

      {/* Breadcrumb Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLd(breadcrumbData)
        }}
      />

      {/* FAQ Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLd(faqData)
        }}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLd(webPageData)
        }}
      />
    </>
  );
}

export default ProductSEO;
