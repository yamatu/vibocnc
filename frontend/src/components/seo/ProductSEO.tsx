'use client';

import { Product, Category } from '@/types';
import { toProductPathId } from '@/lib/utils';

interface ProductSEOProps {
  product: Product;
  category?: Category;
  categoryBreadcrumb?: Category[];
  baseUrl?: string;
}

export function ProductSEO({ product, category, categoryBreadcrumb, baseUrl = 'https://www.vcocncspare.com' }: ProductSEOProps) {
  // Generate rich structured data for the product
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.name,
    "sku": product.sku,
    "description": product.meta_description || product.description || product.short_description,
    "brand": {
      "@type": "Brand",
      "name": product.brand || "FANUC"
    },
    "manufacturer": {
      "@type": "Organization",
      "name": product.brand || "FANUC"
    },
    "category": category?.name || "Industrial Automation",
    "image": product.images?.map(img => typeof img === 'string' ? img : img.url) ||
             product.image_urls ||
             [`${baseUrl}/images/default-product.jpg`],
    "url": `${baseUrl}/products/${toProductPathId(product.sku)}`,
    "offers": {
      "@type": "Offer",
      "price": product.price,
      "priceCurrency": "USD",
      "availability": product.stock_quantity > 0 ?
        "https://schema.org/InStock" :
        "https://schema.org/OutOfStock",
      "seller": {
        "@type": "Organization",
        "name": "Vcocnc",
        "url": baseUrl
      },
      "priceValidUntil": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      "itemCondition": "https://schema.org/NewCondition",
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
         "item": `${baseUrl}/${(cat as any).path || cat.slug}`
      })) || []),
      {
        "@type": "ListItem",
        "position": (categoryBreadcrumb?.length || 0) + 3,
        "name": product.name,
        "item": `${baseUrl}/products/${toProductPathId(product.sku)}`
      }
    ]
  };

  // Generate FAQ structured data for common product questions
  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": `What is the ${product.sku} used for?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `The ${product.name} (${product.sku}) is a ${product.brand || 'FANUC'} industrial automation component used in CNC machines and robotic systems for precise control and operation.`
        }
      },
      {
        "@type": "Question",
        "name": `Is the ${product.sku} compatible with my CNC system?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `The ${product.name} is designed to be compatible with major ${product.brand || 'FANUC'} CNC systems and industrial automation equipment. Contact our technical team at sales@vcocncspare.com for compatibility verification.`
        }
      },
      {
        "@type": "Question",
        "name": `What is the warranty for ${product.sku}?`,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": `We provide a 12-month warranty for the ${product.name}. All products are quality tested before shipment. Genuine parts include manufacturer warranty.`
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
    ]
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
    </>
  );
}

export default ProductSEO;
