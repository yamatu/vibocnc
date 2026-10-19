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

  // Google requires Product markup to contain a real offer, review, or rating,
  // and an Offer is only valid with a price greater than zero. Quote-only
  // records therefore stay ineligible for a Product rich result. They still
  // publish a Product entity without the offers block: entity recognition for
  // the part number does not depend on price, and omitting offers is what
  // keeps the markup valid instead of triggering a missing-price error.
  const hasValidOffer = product.price > 0;

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
    "about": { "@id": productId },
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": ["h1", ".product-description", ".product-specs"]
    }
  };

  return (
    <>
      {/* The Product entity is always published so the part number, brand and
          model stay machine-readable. The offers block inside it is only
          present when a real price exists. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData)
        }}
      />

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
