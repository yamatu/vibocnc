'use client';

import { Product, Category } from '@/types';
import { toProductPathId } from '@/lib/utils';

const DEFAULT_SITE_NAME = 'Vcocnc';
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

function stripHtml(text?: string): string {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAbsoluteUrl(url: string | undefined, baseUrl: string): string {
  const value = String(url || '').trim();
  if (!value) return `${baseUrl}/images/default-product.svg`;
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
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

function buildAnswerFirstSummary(product: Product, category?: Category): string {
  const brandLabel = getBrandLabel(product);
  const categoryName = category?.name || product.category?.name || 'industrial automation part';
  const stockText = product.stock_quantity > 0
    ? 'The item is in stock and ready for shipment.'
    : `The item is available to order with ${product.lead_time || '3-7 days'} lead time.`;
  const warrantyText = product.warranty_period
    ? `Standard supply includes a ${product.warranty_period} warranty.`
    : 'Standard supply includes a 12-month warranty.';

  return `${brandLabel} ${product.sku} is a ${categoryName.toLowerCase()} used for CNC repair, replacement, and industrial automation maintenance. ${stockText} ${warrantyText}`;
}

export function ProductSEO({ product, category, categoryBreadcrumb, baseUrl = 'https://www.vcocncspare.com' }: ProductSEOProps) {
  const productUrl = `${baseUrl}/products/${toProductPathId(product.sku)}`;
  const productId = `${productUrl}#product`;
  const brandLabel = getBrandLabel(product);
  const manufacturerName = getManufacturerName(product);
  const description = stripHtml(product.meta_description || product.short_description || product.description)
    || `${product.name} industrial automation spare part from ${brandLabel}.`;
  const answerFirstSummary = buildAnswerFirstSummary(product, category);

  // Build image array
  const imageUrls = (product.images?.map(img => typeof img === 'string' ? img : img.url) ||
    product.image_urls ||
    [`${baseUrl}/images/default-product.jpg`]).map((url) => toAbsoluteUrl(url, baseUrl));

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

  // Generate rich structured data for the product
  const structuredData: { [key: string]: JsonLdValue } = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": productId,
    "name": product.name,
    "sku": product.sku,
    "mpn": product.part_number || product.sku,
    "productID": product.sku,
    "description": description,
    "disambiguatingDescription": answerFirstSummary,
    "brand": {
      "@type": "Brand",
      "name": brandLabel
    },
    "manufacturer": {
      "@type": "Organization",
      "name": manufacturerName
    },
    "category": category?.name || "Industrial Automation",
    "image": imageUrls,
    "url": productUrl,
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": productUrl
    },
    "itemCondition": mapConditionType(product.condition_type),
    "countryOfOrigin": product.origin_country || undefined,
    "keywords": [product.sku, product.part_number, product.brand, category?.name].filter(Boolean).join(', '),
    "audience": {
      "@type": "Audience",
      "audienceType": "CNC maintenance buyers and industrial automation service teams"
    },
    "offers": {
      "@type": "Offer",
      "url": productUrl,
      "price": product.price,
      "priceCurrency": "USD",
      "availability": product.stock_quantity > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      "seller": {
        "@type": "Organization",
        "name": "Vcocnc",
        "url": baseUrl
      },
      "eligibleQuantity": product.minimum_order_quantity ? {
        "@type": "QuantitativeValue",
        "minValue": product.minimum_order_quantity
      } : undefined,
      "priceValidUntil": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      "itemCondition": mapConditionType(product.condition_type),
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": "US",
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
        "merchantReturnDays": 30,
        "returnMethod": "https://schema.org/ReturnByMail",
        "returnFees": "https://schema.org/FreeReturn"
      },
      "shippingDetails": {
        "@type": "OfferShippingDetails",
        "shippingDestination": {
          "@type": "DefinedRegion",
          "name": "Worldwide"
        },
        "deliveryTime": {
          "@type": "ShippingDeliveryTime",
          "handlingTime": {
            "@type": "QuantitativeValue",
            "minValue": 1,
            "maxValue": 3,
            "unitCode": "d"
          },
          "transitTime": {
            "@type": "QuantitativeValue",
            "minValue": 3,
            "maxValue": 10,
            "unitCode": "d"
          }
        }
      }
    }
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
        "name": "Home",
        "item": baseUrl
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Products",
        "item": `${baseUrl}/products`
      },
      ...(categoryBreadcrumb?.map((cat, index) => ({
        "@type": "ListItem",
        "position": index + 3,
        "name": cat.name,
         "item": `${baseUrl}/categories/${cat.path || cat.slug}`
      })) || []),
      {
        "@type": "ListItem",
        "position": (categoryBreadcrumb?.length || 0) + 3,
        "name": product.name,
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
    : [
        {
          "@type": "Question",
          "name": `What is the ${product.sku} used for?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `The ${product.name} (${product.sku}) is a ${brandLabel} industrial automation component used in CNC machines, control cabinets, and related automation systems.`
          }
        },
        {
          "@type": "Question",
          "name": `Is the ${product.sku} compatible with my CNC system?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": product.compatibility_info
              ? `${product.compatibility_info} Contact our technical team at sales@vcocncspare.com for further compatibility verification.`
              : `The ${product.name} should be matched against the original machine, controller, and option configuration before ordering. Contact our technical team at sales@vcocncspare.com for compatibility verification.`
          }
        },
        {
          "@type": "Question",
          "name": `What is the warranty for ${product.sku}?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `We provide a ${product.warranty_period || '12-month'} warranty for the ${product.name}. All products are quality tested before shipment.`
          }
        },
        {
          "@type": "Question",
          "name": `How long does shipping take for ${product.sku}?`,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": `We offer worldwide shipping for the ${product.name} via DHL, FedEx, and UPS. Delivery typically takes 3-7 business days for express shipping. ${product.stock_quantity > 0 ? 'This item is currently in stock and ready to ship.' : 'Contact us for availability and estimated delivery time.'}`
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
    "name": product.name,
    "description": description,
    "dateModified": product.updated_at,
    "inLanguage": "en",
    "isPartOf": {
      "@type": "WebSite",
      "name": DEFAULT_SITE_NAME,
      "url": baseUrl,
    },
    "about": {
      "@id": productId,
    },
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": ["h1", ".product-summary", ".product-description", ".product-specs"]
    }
  };

  return (
    <>
      {/* Product Structured Data */}
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
