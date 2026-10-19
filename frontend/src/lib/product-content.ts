import type { CommercePolicySetting, Product, ProductFAQ } from '@/types';
import { commercePolicyReturnShippingText } from '@/lib/commerce-policy';

// The catalogue's bulk/auto optimisation fills compatibility, installation,
// maintenance and FAQ fields with the same template text on every product.
// Rendering that boilerplate on 100k+ pages adds no unique content and repeats
// facts that already have their own section, so it is hidden at render time.
// Operator-written text never matches these signatures and is always shown.
const GENERATED_COMPATIBILITY = [
  /must be checked against the original part label/i,
  /confirm compatibility for .+ against your original part label/i,
];
const GENERATED_INSTALLATION = [
  /confirm the exact part number on the original unit/i,
  /according to your machine maintenance procedure after isolating power/i,
];
const GENERATED_MAINTENANCE = [
  /from conductive dust, oil mist,? and unstable (supply )?voltage/i,
  /clean, dry, and properly stored to support reliable industrial operation/i,
];
const GENERATED_FAQ_ANSWERS = [
  ...GENERATED_COMPATIBILITY,
  /buyers usually match it by original part number/i,
  /is used (for|in) CNC (repair|and industrial automation)/i,
  /is currently in stock and ready for .*shipment\.?$/i,
  /is available to order with .+ lead time\.?$/i,
];

const matchesAny = (text: string | undefined, patterns: RegExp[]) =>
  Boolean(text && patterns.some((pattern) => pattern.test(text)));

function ownText(text: string | undefined, generated: RegExp[]): string | null {
  const value = String(text || '').trim();
  return value && !matchesAny(value, generated) ? value : null;
}

export const customCompatibilityInfo = (product: Product) => ownText(product.compatibility_info, GENERATED_COMPATIBILITY);
export const customInstallationGuide = (product: Product) => ownText(product.installation_guide, GENERATED_INSTALLATION);
export const customMaintenanceTips = (product: Product) => ownText(product.maintenance_tips, GENERATED_MAINTENANCE);

const isGeneratedFaq = (faq: ProductFAQ) => matchesAny(faq.answer, GENERATED_FAQ_ANSWERS);

// Drops template fields before the product is serialized into the page, so the
// hidden boilerplate is not shipped in the hydration payload either.
export function withoutGeneratedContent(product: Product): Product {
  return {
    ...product,
    compatibility_info: customCompatibilityInfo(product) || '',
    installation_guide: customInstallationGuide(product) || '',
    maintenance_tips: customMaintenanceTips(product) || '',
    faqs: product.faqs?.filter((faq) => !isGeneratedFaq(faq)),
  };
}

export interface ProductFaqItem {
  id?: number;
  question: string;
  answer: string;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// One FAQ set for both the visible accordion and the FAQPage JSON-LD (Google
// requires them to match). Each answer states a fact once instead of
// restating the compatibility block or the summary panel.
export function buildProductFaqs(
  product: Product,
  options: { locale: string; policy: CommercePolicySetting; warranty: string; leadTime: string },
): ProductFaqItem[] {
  const custom = (product.faqs || [])
    .filter((faq: ProductFAQ) => faq.is_active && faq.question?.trim() && faq.answer?.trim())
    .filter((faq) => !isGeneratedFaq(faq))
    .map((faq) => ({ id: faq.id, question: faq.question, answer: faq.answer }));
  if (custom.length > 0) return custom;

  const { locale, policy, warranty, leadTime } = options;
  const sku = product.sku;
  const inStock = product.stock_quantity > 0;
  const compatibility = customCompatibilityInfo(product);
  const handling = policy.shipping_handling_time_text;
  const transit = policy.shipping_transit_time_text;

  if (locale === 'zh') {
    return [
      {
        question: `${sku} 有现货吗？多久可以发货？`,
        answer: inStock
          ? `${sku} 目前有现货，${handling} 内处理发货，国际运输约 ${transit}。`
          : `${sku} 可订购，预计交货期 ${leadTime}。`,
      },
      {
        question: `${sku} 的保修和退换政策是什么？`,
        answer: `提供 ${warranty} 保修，${policy.return_window_text} 内可退换（${commercePolicyReturnShippingText(policy, 'zh')}）。`,
      },
      {
        question: `如何确认 ${sku} 适用于我的设备？`,
        answer: compatibility
          ? stripHtml(compatibility)
          : '请将原件铭牌照片或设备型号发送至 sales@vibocnc.com，我们会在发货前确认兼容性。',
      },
    ];
  }

  return [
    {
      question: `Is ${sku} in stock and when does it ship?`,
      answer: inStock
        ? `Yes. ${sku} is in stock, handled within ${handling} and delivered in about ${transit} with tracking.`
        : `${sku} is available to order with ${leadTime} lead time.`,
    },
    {
      question: `What warranty and return terms apply to ${sku}?`,
      answer: `${warranty} warranty and ${policy.return_window_text} returns (${commercePolicyReturnShippingText(policy)}).`,
    },
    {
      question: `How do I confirm ${sku} fits my machine?`,
      answer: compatibility
        ? stripHtml(compatibility)
        : 'Send a photo of the original part label or your machine model to sales@vibocnc.com and we will confirm compatibility before shipment.',
    },
  ];
}

// Spec rows that repeat a fact the details table already shows (generated
// spec tables copy brand, SKU, warranty, condition, origin, etc.).
const DETAIL_SPEC_KEYS = new Set([
  'sku', 'brand', 'manufacturer', 'warranty', 'condition', 'lead time', 'country of origin', 'origin',
  'component type', 'category', 'certifications', 'part number', 'manufacturer part number',
]);

export function extraSpecRows(
  specs: Record<string, string> | null,
  product: Product,
): Array<[string, string]> {
  if (!specs) return [];
  const known = [product.sku, product.part_number].map((value) => String(value || '').trim().toLowerCase());
  return Object.entries(specs)
    .map(([key, value]) => [key.trim(), String(value ?? '').trim()] as [string, string])
    .filter(([key, value]) => {
      if (!key || !value) return false;
      const normalizedKey = key.toLowerCase();
      if (DETAIL_SPEC_KEYS.has(normalizedKey)) return false;
      if (normalizedKey === 'minimum order quantity' && value === '1') return false;
      // "Model / part number" is only useful when it adds something (series, revision).
      if (normalizedKey.startsWith('model') && known.includes(value.toLowerCase())) return false;
      return true;
    });
}
