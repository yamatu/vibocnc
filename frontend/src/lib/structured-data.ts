import { getSiteUrl } from '@/lib/url';
import { buildHomeFaqEntries } from '@/lib/faq-content';
import type { CommercePolicySetting } from '@/types';
import { SITE_NAME } from '@/lib/seo';

export function generateOrganizationSchema(sameAs: string[] = []) {
  const baseUrl = getSiteUrl();
  const socialProfiles = [...new Set(sameAs.filter((url) => {
    if (!/^https?:\/\//i.test(url)) return false;
    // A personal LinkedIn profile should not be asserted as the company's
    // sameAs entity. Keep official company profiles and other configured URLs.
    return !/^https?:\/\/(?:www\.)?linkedin\.com\/in\//i.test(url);
  }))];

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    "name": SITE_NAME,
    "alternateName": ["VIBOCNC", "Vibo CNC", "Vibocnc Industrial Automation Parts"],
    "description": "Vibocnc is an industrial automation parts and CNC spares supplier across 20+ brands, with model verification, inspection, repair support and worldwide shipping.",
    "url": baseUrl,
    "foundingDate": "2007",
    "areaServed": "Worldwide",
    "knowsAbout": [
      "Industrial automation parts",
      "CNC spare parts",
      "PLC and I/O modules",
      "HMI panels",
      "Servo drives and motors",
      "Industrial electronics inspection",
      "Obsolete automation parts sourcing",
      "Industrial electronics repair evaluation"
    ],
    "logo": {
      "@type": "ImageObject",
      "url": `${baseUrl}/android-chrome-512x512.png`,
      "width": 512,
      "height": 512
    },
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Kunshan",
      "addressRegion": "Jiangsu",
      "addressCountry": "CN"
    },
    "contactPoint": {
      "@type": "ContactPoint",
      "contactType": "sales",
      "telephone": "+86-13348028050",
      "email": "sales@vibocnc.com",
      "availableLanguage": ["en", "zh", "es", "de", "fr", "it", "pt", "ja", "ko", "ru", "ar"]
    },
    ...(socialProfiles.length > 0 ? { "sameAs": socialProfiles } : {})
  };
}

export function generateWebsiteSchema() {
  const baseUrl = getSiteUrl();

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${baseUrl}/#website`,
    "name": SITE_NAME,
    "alternateName": ["VIBOCNC", "Vibo CNC", "vibocnc.com"],
    "url": baseUrl,
    "description": "Vibocnc is an industrial automation parts and CNC spares supplier across 20+ brands, with model verification, inspection, repair support and worldwide shipping.",
    "publisher": {
      "@type": "Organization",
      "@id": `${baseUrl}/#organization`,
      "name": SITE_NAME,
      "url": baseUrl
    },
    // Sitelinks search box: lets Google (and AI answer engines) query the
    // catalogue directly from the brand result instead of guessing a URL.
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `${baseUrl}/products?search={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    },
    "mainEntity": {
      "@type": "ItemList",
      "name": "Industrial Automation Resources",
      "description": "Main product, service and technical content hubs available at Vibocnc",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Industrial Automation Parts",
          "url": `${baseUrl}/products`
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Product Categories",
          "url": `${baseUrl}/categories`
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "Repair Evaluation",
          "url": `${baseUrl}/repair-request`
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Industrial Automation Blog",
          "url": `${baseUrl}/blog`
        },
        {
          "@type": "ListItem",
          "position": 5,
          "name": "Company News",
          "url": `${baseUrl}/news`
        },
        {
          "@type": "ListItem",
          "position": 6,
          "name": "Contact Vibocnc",
          "url": `${baseUrl}/contact`
        }
      ]
    },
    "speakable": {
      "@type": "SpeakableSpecification",
      "cssSelector": ["h1", ".product-name", ".category-title"]
    }
  };
}

export function generateBreadcrumbSchema(items: Array<{name: string, url: string}>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      "item": item.url
    }))
  };
}

export function generateFAQSchema(locale = 'en', commercePolicy?: CommercePolicySetting) {
  // Delegates to the same list the FAQ page renders, so the markup can never
  // claim an answer that is not visible on the page.
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": buildHomeFaqEntries(locale, commercePolicy).map((entry) => ({
      "@type": "Question",
      "name": entry.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": entry.answer,
      },
    })),
  };
}
