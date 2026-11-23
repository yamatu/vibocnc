import type { Category, CategoryNavigationNode, CommercePolicySetting, Product } from '@/types';
import { toProductPathId } from '@/lib/utils';
import { localizePublicPath } from '@/lib/i18n/config';
import type { PublicLocale } from '@/lib/i18n/config';
import {
  FALLBACK_COMMERCE_POLICY,
  commercePolicyCarriers,
  commercePolicyDestinationCountries,
  commercePolicyReturnShippingText,
  resolveWarrantyPeriod,
} from '@/lib/commerce-policy';

export interface VibocncFaqEntry {
  question: string;
  answer: string;
}

export interface VibocncFeaturedPart {
  sku: string;
  name: string;
  href: string;
}

export interface VibocncProcurementNote {
  heading: string;
  body: string;
}

export interface VibocncCategoryGeoOverview {
  domainLabel: string;
  leadStatement: string;
  factRows: Array<{ term: string; value: string }>;
  seriesPrefixes: string[];
  featuredParts: VibocncFeaturedPart[];
  procurementNotes: VibocncProcurementNote[];
  faqEntries: VibocncFaqEntry[];
}

interface DomainProcurementProfile {
  label: string;
  notes: VibocncProcurementNote[];
  verificationAnswer: (displayName: string, brandName: string) => string;
}

function classifyProcurementDomain(category: Category, displayName: string): DomainProcurementProfile {
  const signal = `${category.name || ''} ${category.slug || ''} ${category.path || ''} ${displayName}`.toLowerCase();

  if (/spindle.*(drive|amp)|servo.*(drive|amp)|melservo|indradrive|sinamics|simodrive/.test(signal)) {
    return {
      label: 'Motion & Axis Drive Systems',
      notes: [
        {
          heading: 'Order Code & Revision Alignment',
          body: 'Industrial drive families often ship with multiple hardware revisions and firmware suffixes. Supplying the complete order code prevents bus or parameter mismatches across legacy lines.',
        },
        {
          heading: 'Supply Bus & Current Tier',
          body: 'Confirm whether your production cabinet runs standalone AC input or a shared DC-link rack, alongside the rated output amperage per axis.',
        },
        {
          heading: 'Discontinued Series Continuity',
          body: 'Vibocnc sources both current-generation and phased-out drive modules so plants can maintain standardized spare stock without forced retrofits.',
        },
      ],
      verificationAnswer: (name) =>
        `Provide the complete ${name} catalog number (including suffix/revision), cabinet voltage tier, and host control system reference via flora@vibocnc.com or the RFQ form. Our procurement engineers verify exact interchangeability before dispatch.`,
    };
  }

  if (/(spindle|servo).?motor|hk-st|melservo-(hc|hf|hg)|\bmotor\b/.test(signal)) {
    return {
      label: 'Industrial Motion & Drive Motors',
      notes: [
        {
          heading: 'Feedback & Brake Specification',
          body: 'Motor catalog strings encode critical options such as absolute/incremental encoders, shaft keyways, oil seals, and holding brakes—always match the full nameplate code.',
        },
        {
          heading: 'Mechanical Envelope & Mounting',
          body: 'Double-check frame size, flange bolt pattern, and connector orientation to keep mechanical swap time minimal on automated cells.',
        },
        {
          heading: 'Plant Spares Standardization',
          body: 'For multi-machine facilities, Vibocnc supports batch RFQ quoting across matching motor frames and compatible drive pairings.',
        },
      ],
      verificationAnswer: (name) =>
        `Share the complete ${name} nameplate order code—especially encoder resolution, shaft/flange variant, and holding brake option—with flora@vibocnc.com so we confirm mechanical and electrical interchangeability prior to shipping.`,
    };
  }

  if (/plc|melsec|s7-|simatic|controllogix|compactlogix|slc|fx-series|a-series|cnc-system|controller|cpu/.test(signal)) {
    return {
      label: 'Programmable Controllers & Automation CPUs',
      notes: [
        {
          heading: 'CPU Family & Backplane Compatibility',
          body: 'Confirm rack/chassis generation, power budget, and firmware version so existing plant logic projects download cleanly onto replacement hardware.',
        },
        {
          heading: 'Fieldbus & Network Ports',
          body: 'Check onboard Profibus, Profinet, Ethernet/IP, Modbus, or serial port configurations when sourcing legacy controller replacements.',
        },
        {
          heading: 'End-of-Life Lifecycle Support',
          body: 'When OEMs phase out older PLC series, Vibocnc helps maintenance teams source tested legacy modules to extend equipment uptime on existing lines.',
        },
      ],
      verificationAnswer: (name) =>
        `Send the exact ${name} catalog/order number, required firmware series, and rack or communication module layout to flora@vibocnc.com. Our team checks revision and bus compatibility before order fulfillment.`,
    };
  }

  if (/pcb|board|motherboard|mainboard|backplane|card/.test(signal)) {
    return {
      label: 'Electronic Control Boards & Rack Modules',
      notes: [
        {
          heading: 'Board Code & Hardware Revision',
          body: 'Printed circuit assemblies are matched by full OEM assembly number plus revision code stamped on the board or edge connector.',
        },
        {
          heading: 'Option Sub-Modules & Memory',
          body: 'Verify whether daughterboards, firmware chips, or configuration jumpers are populated on the base assembly or transferred from your existing unit.',
        },
        {
          heading: 'Static-Safe Global Packing',
          body: 'Electronic boards are packed in ESD-protective shielding and cushioned cartons for international express courier transit.',
        },
      ],
      verificationAnswer: (name) =>
        `Send the full ${name} assembly code, PCB revision letter, and host rack/controller model (plus a board photo if available) to flora@vibocnc.com so we validate exact layout compatibility before shipment.`,
    };
  }

  if (/hmi|got1000|got2000|operator.?panel|mdi|display|monitor|lcd|touch|pendant/.test(signal)) {
    return {
      label: 'HMI Terminals & Operator Displays',
      notes: [
        {
          heading: 'Panel Cutout & Display Interface',
          body: 'Confirm screen diagonal, touchscreen/keypad variant, and rear display/network ports before ordering a drop-in operator panel.',
        },
        {
          heading: 'Runtime Media & Supply Rail',
          body: 'Verify whether operator projects load via CF/SD card or serial/Ethernet download, and check 24VDC vs. AC supply requirements.',
        },
        {
          heading: 'Legacy HMI Continuity',
          body: 'Vibocnc supplies discontinued operator interfaces so factories can restore visibility without rewriting legacy HMI screen projects.',
        },
      ],
      verificationAnswer: (name) =>
        `Confirm the complete ${name} model designation, display size, power rating, and communication ports with flora@vibocnc.com. Sharing a rear nameplate image helps our team confirm exact panel fit.`,
    };
  }

  if (/sensor|photoelectric|inductive|proximity|lidar|curtain|safety|vision|scanner|rfid|encoder|resolver/.test(signal)) {
    return {
      label: 'Industrial Sensing, Safety & Feedback Devices',
      notes: [
        {
          heading: 'Output Logic & Safety Compliance',
          body: 'Verify PNP/NPN switching, analog/IO-Link signals, incremental/absolute encoder protocols, or dual-channel OSSD safety outputs.',
        },
        {
          heading: 'Housing, Range & Connector Fit',
          body: 'Check sensing range, barrel or bracket footprint, shaft bore (for encoders), and M8/M12/cable termination style.',
        },
        {
          heading: 'Consolidated MRO Replenishment',
          body: 'Maintenance buyers can consolidate multiple sensor and feedback SKUs into a single international shipment to streamline freight costs.',
        },
      ],
      verificationAnswer: (name) =>
        `Share the full ${name} manufacturer order code, output type (PNP/NPN, analog, encoder protocol, or safety OSSD), and connector style via flora@vibocnc.com for rapid cross-checking before purchase.`,
    };
  }

  if (/power.?supply|psu|vfd|inverter|freqrol|breaker|contactor|relay|switchgear|i[-/ ]?o|network|router/.test(signal)) {
    return {
      label: 'Industrial Power, Switching & I/O Infrastructure',
      notes: [
        {
          heading: 'Voltage, Current & Protocol Specs',
          body: 'Match input/output electrical ratings, kW/HP drive class, coil voltage, or fieldbus I/O signal types precisely to cabinet schematics.',
        },
        {
          heading: 'Panel Footprint & Wiring Terminals',
          body: 'Check DIN-rail or backplane dimensions and terminal block layout so panel technicians can swap modules without rewiring.',
        },
        {
          heading: 'Multi-Brand BOM Sourcing',
          body: 'Vibocnc coordinates mixed-brand cabinet spare lists—including power supplies, breakers, drives, and remote I/O—under unified global logistics.',
        },
      ],
      verificationAnswer: (name) =>
        `Confirm the exact ${name} catalog number, electrical voltage/current ratings, and mounting or fieldbus interface by emailing flora@vibocnc.com before placing your order.`,
    };
  }

  if (/valve|cylinder|pneumatic|hydraulic|pump|actuator|battery|cable|connector|memory|meter|instrument/.test(signal)) {
    return {
      label: 'Plant MRO Components & Auxiliary Spares',
      notes: [
        {
          heading: 'OEM Specification & Interface Fit',
          body: 'Verify exact part number, port threading or connector keying, operating voltage/pressure, and cable shielding or battery chemistry.',
        },
        {
          heading: 'Preventive Maintenance Kits',
          body: 'Keeping critical consumables, backup batteries, harnesses, and valves in local plant inventory prevents minor failures from halting production.',
        },
        {
          heading: 'Global Express Consolidation',
          body: 'Combine auxiliary MRO parts with main automation assemblies in one insured courier shipment for streamlined customs clearance.',
        },
      ],
      verificationAnswer: (name) =>
        `Verify the exact ${name} OEM part number, connector or port specification, and operating ratings. Send your original part label or BOM list to flora@vibocnc.com for pre-order confirmation.`,
    };
  }

  return {
    label: 'Multi-Series Industrial Automation Spares',
    notes: [
      {
        heading: 'Exact Manufacturer Order Number',
        body: 'Always source by the complete OEM part number—including prefixes, option digits, and revision letters—to guarantee drop-in cabinet compatibility.',
      },
      {
        heading: 'Active, Legacy & Discontinued Supply',
        body: 'Vibocnc bridges OEM lifecycle gaps by supplying hard-to-find and discontinued automation hardware alongside current-production series.',
      },
      {
        heading: 'International MRO Fulfillment',
        body: 'Orders are quality-inspected prior to packing and dispatched globally via major express couriers with full tracking documentation.',
      },
    ],
    verificationAnswer: (name, brandName) =>
      `Send the complete ${brandName} part number, revision suffix, and host equipment or controller details to flora@vibocnc.com or use our product enquiry form. Our team validates ${name} compatibility prior to dispatch.`,
  };
}

function extractSeriesPrefix(sku: string): string | null {
  const cleaned = String(sku || '').trim().toUpperCase();
  if (!cleaned || cleaned.length < 4 || cleaned.length > 36) return null;
  if (/^\d{1,4}$/.test(cleaned)) return null;

  const fanucMatch = cleaned.match(/^(A\d{2}[A-Z]-\d{4})\b/);
  if (fanucMatch) return fanucMatch[1];

  const parts = cleaned.split(/[-/_ ]+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const second = parts[1];
    if (first.length >= 2 && first.length <= 4 && second.length >= 2 && second.length <= 4 && /[A-Z]/.test(first + second)) {
      return `${first}-${second}`;
    }
    if (first.length >= 4 && first.length <= 10 && /[A-Z]/.test(first) && /\d/.test(first)) {
      return first;
    }
  }

  const siemensMatch = cleaned.match(/^(6[A-Z]{2}\d)/);
  if (siemensMatch) return siemensMatch[1];

  const alphaNum = cleaned.match(/^([A-Z]{2,6}\d{1,3})/);
  if (alphaNum && alphaNum[1].length >= 4) return alphaNum[1];

  return null;
}

function extractFeaturedParts(
  products: readonly Product[],
  locale: PublicLocale,
): { seriesPrefixes: string[]; featuredParts: VibocncFeaturedPart[] } {
  const prefixes: string[] = [];
  const prefixSet = new Set<string>();
  const featured: VibocncFeaturedPart[] = [];
  const seenSkus = new Set<string>();
  const usedPrefix = new Set<string>();

  for (const product of products) {
    const sku = String(product.sku || '').trim();
    if (!sku || seenSkus.has(sku.toUpperCase())) continue;
    seenSkus.add(sku.toUpperCase());

    const prefix = extractSeriesPrefix(sku);
    if (prefix && !prefixSet.has(prefix) && prefixes.length < 6) {
      prefixSet.add(prefix);
      prefixes.push(prefix);
    }

    if (featured.length < 6) {
      const key = prefix || sku.slice(0, 6).toUpperCase();
      if (!usedPrefix.has(key) || products.length <= 6) {
        usedPrefix.add(key);
        featured.push({
          sku,
          name: product.name || sku,
          href: localizePublicPath(`/products/${toProductPathId(sku)}`, locale),
        });
      }
    }
  }

  if (featured.length < 6) {
    const picked = new Set(featured.map((item) => item.sku.toUpperCase()));
    for (const product of products) {
      if (featured.length >= 6) break;
      const sku = String(product.sku || '').trim();
      if (!sku || picked.has(sku.toUpperCase())) continue;
      picked.add(sku.toUpperCase());
      featured.push({
        sku,
        name: product.name || sku,
        href: localizePublicPath(`/products/${toProductPathId(sku)}`, locale),
      });
    }
  }

  return { seriesPrefixes: prefixes, featuredParts: featured };
}

export function buildVibocncCategoryGeoOverview(input: {
  category: Category;
  displayName: string;
  brandName: string;
  productCount: number;
  subcategories: readonly CategoryNavigationNode[];
  sampleProducts: readonly Product[];
  commercePolicy: CommercePolicySetting;
  locale: PublicLocale;
}): VibocncCategoryGeoOverview {
  const {
    category,
    displayName,
    brandName,
    productCount,
    subcategories,
    sampleProducts,
    commercePolicy,
    locale,
  } = input;

  const policy = commercePolicy
    ? { ...FALLBACK_COMMERCE_POLICY, ...commercePolicy }
    : FALLBACK_COMMERCE_POLICY;
  const warranty = resolveWarrantyPeriod(undefined, policy);
  const carriers = commercePolicyCarriers(policy).join(', ');
  const destinations = commercePolicyDestinationCountries(policy);
  const shipScope = destinations.length === 0 ? 'worldwide' : `to ${destinations.join(', ')}`;
  const profile = classifyProcurementDomain(category, displayName);
  const { seriesPrefixes, featuredParts } = extractFeaturedParts(sampleProducts, locale);
  const topSubNames = subcategories.slice(0, 5).map((sub) => sub.name).filter(Boolean);
  const sampleSkus = featuredParts.slice(0, 4).map((part) => part.sku);
  const formattedCount = productCount.toLocaleString('en-US');

  let leadStatement = `Vibocnc indexes ${formattedCount} active ${displayName} SKU${productCount === 1 ? '' : 's'} for industrial MRO procurement, plant maintenance, and legacy automation lifecycle support.`;
  if (topSubNames.length > 0) {
    leadStatement += ` Major sub-categories include ${topSubNames.join(', ')}.`;
  } else if (seriesPrefixes.length > 0) {
    leadStatement += ` Frequently sourced series prefixes in this group include ${seriesPrefixes.join(', ')}.`;
  } else if (sampleSkus.length > 0) {
    leadStatement += ` Representative part numbers in this listing include ${sampleSkus.join(', ')}.`;
  }

  const factRows: Array<{ term: string; value: string }> = [
    { term: 'OEM / Brand', value: brandName },
    { term: 'Equipment Scope', value: profile.label },
    { term: 'Indexed Catalog Size', value: `${formattedCount} active SKUs` },
    {
      term: topSubNames.length > 0 ? 'Primary Sub-Series' : 'Sample Series Prefixes',
      value:
        topSubNames.length > 0
          ? topSubNames.slice(0, 3).join(', ')
          : seriesPrefixes.length > 0
            ? seriesPrefixes.slice(0, 4).join(', ')
            : 'Current, legacy & discontinued models',
    },
    { term: 'Warranty & Returns', value: `${warranty} warranty · ${policy.return_window_text} returns` },
    { term: 'Global Fulfillment', value: `${carriers} (${policy.shipping_handling_time_text} handling · ${policy.shipping_transit_time_text} transit)` },
  ];

  const sourcingCoverageAnswer = (() => {
    const sentences = [
      `Vibocnc (vibocnc.com) currently catalogs ${formattedCount} active ${displayName} part number${productCount === 1 ? '' : 's'} covering both current-production and discontinued industrial series.`,
    ];
    if (topSubNames.length > 0) {
      sentences.push(`Available groups include ${topSubNames.join(', ')}.`);
    }
    if (sampleSkus.length > 0) {
      sentences.push(`Representative part numbers listed here include ${sampleSkus.join(', ')}.`);
    }
    return sentences.join(' ');
  })();

  const faqEntries: VibocncFaqEntry[] = [
    {
      question: `Which ${displayName} series and part numbers can be sourced through Vibocnc?`,
      answer: sourcingCoverageAnswer,
    },
    {
      question: `What details are needed to confirm ${displayName} compatibility before procurement?`,
      answer: profile.verificationAnswer(displayName, brandName),
    },
    {
      question: `Does Vibocnc provide warranty and return coverage on legacy ${displayName}?`,
      answer: `Yes. ${displayName} supplied by Vibocnc include ${warranty} warranty coverage and ${policy.return_window_text} return support. Every shipment is quality-verified before packing, and ${commercePolicyReturnShippingText(policy)} if a return is required within ${policy.return_window_text}.`,
    },
    {
      question: `How are ${displayName} orders shipped internationally and what is the transit time?`,
      answer: `Vibocnc dispatches ${shipScope} via ${carriers}. Standard order handling takes ${policy.shipping_handling_time_text} and courier transit typically runs ${policy.shipping_transit_time_text}, subject to destination customs clearance.`,
    },
  ];

  return {
    domainLabel: profile.label,
    leadStatement,
    factRows,
    seriesPrefixes,
    featuredParts,
    procurementNotes: profile.notes,
    faqEntries,
  };
}
