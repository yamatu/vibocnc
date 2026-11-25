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
    "foundingLocation": {
      "@type": "Place",
      "name": "Kunshan, Jiangsu, China"
    },
    "numberOfEmployees": {
      "@type": "QuantitativeValue",
      "value": 37
    },
    "slogan": "Your Industrial Automation Parts Partner Since 2007",
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "opens": "08:00",
        "closes": "18:00"
      },
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": "Saturday",
        "opens": "09:00",
        "closes": "17:00"
      }
    ],
    "areaServed": "Worldwide",
    "knowsAbout": [
      "Industrial automation parts",
      "CNC spare parts",
      "PLC and I/O modules",
      "HMI panels",
      "Servo drives and motors",
      "Industrial electronics inspection",
      "Obsolete automation parts sourcing",
      "Industrial electronics repair evaluation",
      "FANUC spare parts",
      "Siemens automation parts",
      "Mitsubishi automation parts",
      "ABB and Allen-Bradley components",
      "Servo motors and encoders",
      "Inverters and power supplies"
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
      "telephone": "+86-13301553506",
      "email": "flora@vibocnc.com",
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
      // Pure node reference: the full Organization is emitted once in the
      // locale layout. Repeating name/url here produced a second, thinner
      // Organization with the same @id on every page that uses this schema.
      "@id": `${baseUrl}/#organization`
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
