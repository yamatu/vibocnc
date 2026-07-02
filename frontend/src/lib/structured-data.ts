import { getSiteUrl } from '@/lib/url';

export function generateOrganizationSchema() {
  const baseUrl = getSiteUrl();

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    "name": "VIBO CNC",
    "alternateName": "VIBO CNC Industrial Automation",
    "description": "Professional FANUC CNC parts supplier since 2005. Leading provider of industrial automation components with over 100,000 items in stock.",
    "url": baseUrl,
    "logo": {
      "@type": "ImageObject",
      "url": `${baseUrl}/android-chrome-512x512.png`,
      "width": 512,
      "height": 512
    },
    "image": [
      {
        "@type": "ImageObject",
        "url": `${baseUrl}/images/company-banner.jpg`,
        "width": 1200,
        "height": 630
      }
    ],
    "foundingDate": "2005",
    "founder": {
      "@type": "Person",
      "name": "VIBO CNC Founder"
    },
    "numberOfEmployees": {
      "@type": "QuantitativeValue",
      "value": 50
    },
    "address": {
      "@type": "PostalAddress",
      "streetAddress": process.env.NEXT_PUBLIC_COMPANY_STREET || "Industrial Park Road",
      "addressLocality": process.env.NEXT_PUBLIC_COMPANY_CITY || "Kunshan",
      "addressRegion": process.env.NEXT_PUBLIC_COMPANY_REGION || "Jiangsu",
      "postalCode": process.env.NEXT_PUBLIC_COMPANY_POSTAL_CODE || "215300",
      "addressCountry": process.env.NEXT_PUBLIC_COMPANY_COUNTRY_CODE || "CN"
    },
    "contactPoint": [
      {
        "@type": "ContactPoint",
        "contactType": "sales",
        "telephone": "+86-13348028050",
        "email": "sales@vibocnc.com",

        "availableLanguage": ["en", "zh"],
        "areaServed": "Worldwide"
      },
      {
        "@type": "ContactPoint",
        "contactType": "technical support",
        "telephone": "+86-13348028050",
        "email": "sales@vibocnc.com",

        "availableLanguage": ["en", "zh"],
        "areaServed": "Worldwide"
      }
    ],
    "sameAs": [
      "https://www.linkedin.com/company/vibocnc",
      "https://twitter.com/vibocnc"
    ],
    "slogan": "Your Trusted FANUC Parts Partner Since 2005",
    "knowsAbout": [
      "FANUC CNC parts",
      "Industrial automation",
      "Servo motors",
      "PCB boards",
      "I/O modules",
      "Control units",
      "Power supplies",
      "CNC machine maintenance",
      "Factory automation"
    ],
    "makesOffer": {
      "@type": "Offer",
      "itemOffered": {
        "@type": "Service",
        "name": "FANUC Parts Supply and Technical Support",
        "description": "Comprehensive FANUC parts supply with worldwide shipping and technical support"
      },
      "areaServed": "Worldwide",
      "eligibleCustomerType": [
        "Business",
        "Industrial"
      ]
    },
    "award": [
      "Top 3 FANUC Supplier in China",
      "ISO 9001:2015 Certified",
      "Authorized FANUC Distributor"
    ],
    "hasCredential": [
      "ISO 9001:2015 Quality Management System",
      "CE Certification",
      "FANUC Authorized Distributor Certificate"
    ]
  };
}

export function generateWebsiteSchema() {
  const baseUrl = getSiteUrl();

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${baseUrl}/#website`,
    "name": "VIBO CNC FANUC Parts",
    "alternateName": "FANUC Parts & Industrial Automation Components",
    "url": baseUrl,
    "description": "Professional FANUC CNC parts supplier since 2005. 100,000+ items in stock, worldwide shipping. Servo motors, PCB boards, I/O modules, control units.",
    "publisher": {
      "@type": "Organization",
      "@id": `${baseUrl}/#organization`,
      "name": "VIBO CNC",
      "url": baseUrl
    },
    "mainEntity": {
      "@type": "ItemList",
      "name": "FANUC Parts Categories",
      "description": "Main product categories available at VIBO CNC",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "FANUC PCB / Control Board",
          "url": `${baseUrl}/categories/fanuc/fanuc-pcb-control-board`
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "FANUC I/O Module",
          "url": `${baseUrl}/categories/fanuc/fanuc-i-o-module`
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "FANUC Servo Amplifier / Drive",
          "url": `${baseUrl}/categories/fanuc/fanuc-servo-amplifier-drive`
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "FANUC Servo Motor",
          "url": `${baseUrl}/categories/fanuc/fanuc-servo-motor`
        },
        {
          "@type": "ListItem",
          "position": 5,
          "name": "FANUC Power Supply",
          "url": `${baseUrl}/categories/fanuc/fanuc-power-supply`
        },
        {
          "@type": "ListItem",
          "position": 6,
          "name": "FANUC Accessories & Others",
          "url": `${baseUrl}/categories/fanuc/fanuc-accessories-others`
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

export function generateFAQSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What FANUC parts do you stock?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "We stock over 100,000 FANUC parts including PCB boards, I/O modules, servo motors, control units, power supplies, and other automation components. All parts are genuine FANUC or compatible alternatives clearly marked for your convenience."
        }
      },
      {
        "@type": "Question",
        "name": "Do you ship worldwide?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes, we ship FANUC parts worldwide. We offer express shipping options via DHL, FedEx, and UPS, and can deliver to most countries within 3-10 business days."
        }
      },
      {
        "@type": "Question",
        "name": "Are your FANUC parts genuine?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "We supply both genuine FANUC parts and high-quality compatible alternatives. All parts are clearly marked and come with our quality guarantee. Genuine parts include manufacturer documentation and certificates."
        }
      },
      {
        "@type": "Question",
        "name": "What is your warranty policy?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "We offer a comprehensive warranty on all FANUC parts. Genuine parts come with manufacturer warranty (typically 12-24 months), while compatible parts include our 12-month guarantee covering defects and performance issues."
        }
      },
      {
        "@type": "Question",
        "name": "How can I get technical support?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Our technical support team is available via email at sales@vibocnc.com or phone at +86-13348028050. We provide installation guidance, troubleshooting, compatibility assistance, and replacement recommendations."
        }
      },
      {
        "@type": "Question",
        "name": "How do I place an order?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "You can place orders directly on our website, via email, or by phone. We accept PayPal, bank transfers, and major credit cards. For large orders, we offer flexible payment terms for established customers."
        }
      },
      {
        "@type": "Question",
        "name": "Do you offer quantity discounts?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes, we offer competitive quantity discounts for bulk orders. Contact our sales team for custom pricing on large quantities or long-term supply agreements."
        }
      },
      {
        "@type": "Question",
        "name": "How do I know if a part is compatible with my system?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Our technical team can help verify compatibility. Provide your system model, current part number, and application details. We maintain extensive compatibility databases and can suggest alternatives if needed."
        }
      },
      {
        "@type": "Question",
        "name": "What payment methods do you accept?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "We accept PayPal, wire transfers, major credit cards (Visa, MasterCard, American Express), and for established customers, we offer terms payments and purchase orders."
        }
      },
      {
        "@type": "Question",
        "name": "How do I track my order?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Once your order ships, you'll receive tracking information via email. You can also log into your account on our website to view order status and tracking details in real-time."
        }
      }
    ]
  };
}

export function generateLocalBusinessSchema() {
  const baseUrl = getSiteUrl();

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${baseUrl}/#organization`,
    "name": "VIBO CNC",
    "image": [
      `${baseUrl}/images/company-banner.jpg`,
      `${baseUrl}/android-chrome-512x512.png`
    ],
    "telephone": "+86-13348028050",
    "email": "sales@vibocnc.com",

    "address": {
      "@type": "PostalAddress",
      "streetAddress": process.env.NEXT_PUBLIC_COMPANY_STREET || "Industrial Park Road",
      "addressLocality": process.env.NEXT_PUBLIC_COMPANY_CITY || "Kunshan",
      "addressRegion": process.env.NEXT_PUBLIC_COMPANY_REGION || "Jiangsu",
      "postalCode": process.env.NEXT_PUBLIC_COMPANY_POSTAL_CODE || "215300",
      "addressCountry": process.env.NEXT_PUBLIC_COMPANY_COUNTRY_CODE || "CN"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": 31.3888,
      "longitude": 120.9625
    },
    "url": baseUrl,
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday"
        ],
        "opens": "08:00",
        "closes": "18:00"
      }
    ],
    "priceRange": "$$",
    "currenciesAccepted": "USD,EUR,CNY",
    "paymentAccepted": "PayPal,Bank Transfer,Credit Card",
    "areaServed": {
      "@type": "Place",
      "name": "Worldwide"
    },
    "serviceArea": {
      "@type": "Place",
      "name": "Worldwide"
    }
  };
}
