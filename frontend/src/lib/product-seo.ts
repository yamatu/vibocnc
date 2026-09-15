import type { CommercePolicySetting, Product } from '@/types';
import { FALLBACK_COMMERCE_POLICY, resolveWarrantyPeriod } from '@/lib/commerce-policy';

const GENERIC_PART_TYPE = 'Industrial Automation Part';

/**
 * Template filler that used to be published as a product description. Shipping
 * it as meta/structured-data copy is what makes a page read as auto-generated,
 * so it is detected and replaced with real record content instead.
 */
const PLACEHOLDER_COPY_PATTERNS: RegExp[] = [
  /^professional industrial automation parts? and components?\.?$/i,
  /^industrial automation parts? and components?\.?$/i,
  /^detailed description of\b/i,
  /^product description$/i,
  /^lorem ipsum\b/i,
  /^placeholder\b/i,
  /^coming soon\.?$/i,
  /^tbd\.?$/i,
  /^n\/?a\.?$/i,
  /^[-–—.,;:\s]+$/,
];

/** True when the copy is template filler rather than real product information. */
export function isPlaceholderCopy(value?: string): boolean {
  const text = normalizeWhitespace(value);
  if (!text) return true;
  if (text.length < 24) return true;
  return PLACEHOLDER_COPY_PATTERNS.some((pattern) => pattern.test(text));
}

/** First real paragraph of a text block, used as a schema.org description. */
function firstMeaningfulParagraph(value?: string, maxLength = 500): string {
  const text = stripProductMarkup(value);
  if (!text || isPlaceholderCopy(text)) return '';
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > maxLength) break;
    out = next;
  }
  if (!out) {
    out = text.slice(0, maxLength);
    const boundary = out.lastIndexOf(' ');
    if (boundary > 80) out = out.slice(0, boundary);
  }
  return normalizeWhitespace(out);
}

function normalizeWhitespace(value?: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingBrand(value: string, brand: string): string {
  if (!brand) return normalizeWhitespace(value);
  return normalizeWhitespace(value).replace(new RegExp(`^${escapeRegExp(brand)}(?:[\\s/_-]+|$)`, 'i'), '').trim();
}

export function stripProductMarkup(value?: string): string {
  return normalizeWhitespace(String(value || '').replace(/<[^>]*>/g, ' '));
}

/**
 * Infer a customer-facing product family while legacy catalogue records still
 * carry a broad category. These rules only affect rendered SEO copy.
 */
export function inferProductTypeLabel(product: Product): string {
  const sku = normalizeWhitespace(product.sku).toUpperCase();
  const brand = normalizeWhitespace(product.brand).toLowerCase();
  const content = stripProductMarkup([
    product.name,
    product.short_description,
    product.description,
    product.meta_title,
  ].filter(Boolean).join(' '));

  if (brand === 'fanuc' && /^A06B-6092-/i.test(sku)) return 'Spindle Amplifier Module';

  if (brand === 'fanuc') {
    const explicitType = content.match(
      /(?:^|[.\n]\s*|\bType:\s*)(?:ALPHA\s+)?(Spindle Amplifier(?:\s+(?:Module|\/\s*Drive))?(?:\s*\([^)]*\))?)/i,
    );
    if (explicitType?.[1]) return normalizeWhitespace(explicitType[1]);
  }

  return normalizeWhitespace(product.category?.name) || GENERIC_PART_TYPE;
}

export function buildSemanticProductName(product: Product): string {
  const brand = normalizeWhitespace(product.brand);
  const sku = normalizeWhitespace(product.sku);
  const storedName = normalizeWhitespace(product.name);
  const rawType = inferProductTypeLabel(product);
  const type = stripLeadingBrand(rawType, brand) || rawType;
  const normalizedStored = storedName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedSku = sku.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const storedIsSkuOnly = !storedName || normalizedStored === normalizedSku;
  const hasBrand = Boolean(brand && new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(brand)}(?:[^a-z0-9]|$)`, 'i').test(storedName));

  return [
    hasBrand ? '' : brand,
    storedName || sku,
    storedIsSkuOnly ? type : '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function buildProductSeoDescription(
  product: Product,
  maxLength = 160,
  commercePolicy?: CommercePolicySetting,
): string {
  const explicit = stripProductMarkup(product.meta_description);
  const brand = normalizeWhitespace(product.brand);
  const brandPattern = brand ? escapeRegExp(brand) : '';
  const brokenEnding = /(?:\band\s+(?:fast|global|worldwide)|[,;:]|\bwith)[.!?]?$/i.test(explicit);
  const repeatedBrand = brand
    ? new RegExp(`(?:^|[^a-z0-9])${brandPattern}(?:[^a-z0-9]|$)[^.]{0,90}(?:^|[^a-z0-9])${brandPattern}(?:[^a-z0-9]|$)`, 'i').test(explicit)
    : false;
  if (explicit && explicit.length <= maxLength && !brokenEnding && !repeatedBrand && !isPlaceholderCopy(explicit)) {
    return explicit;
  }

  // Fall back to the authored record copy before generating anything, so a page
  // with a real short description publishes it instead of a template sentence.
  const fromRecord = firstMeaningfulParagraph(product.short_description, maxLength)
    || firstMeaningfulParagraph(product.description, maxLength);
  if (fromRecord) {
    if (fromRecord.length <= maxLength) return fromRecord;
    const cut = fromRecord.slice(0, maxLength);
    const boundary = cut.lastIndexOf(' ');
    return `${cut.slice(0, boundary > 80 ? boundary : maxLength).replace(/[,.;\s]+$/, '')}.`;
  }

  const subject = [brand || 'Industrial automation', normalizeWhitespace(product.sku)].filter(Boolean).join(' ');
  const type = stripLeadingBrand(inferProductTypeLabel(product), brand) || inferProductTypeLabel(product);
  const availability = product.stock_quantity > 0 ? 'in stock' : 'available to order';
  // Warranty / shipping wording comes from the admin-editable commerce policy
  // so the storefront promise never has to be edited in code.
  const policy = commercePolicy ? { ...FALLBACK_COMMERCE_POLICY, ...commercePolicy } : FALLBACK_COMMERCE_POLICY;
  const rawWarranty = normalizeWhitespace(product.warranty_period) || resolveWarrantyPeriod(undefined, policy);
  const warranty = rawWarranty
    .replace(/\bmonths?\b/i, 'month')
    .replace(/\s+/g, '-');
  const candidates = [
    `${subject} ${type}, ${availability} for CNC repair and replacement. ${warranty} warranty and worldwide shipping.`,
    `${subject} ${type}, ${availability}. Compatibility support, ${warranty} warranty and worldwide shipping.`,
    `${subject} ${type} for CNC repair and replacement, with compatibility support and worldwide shipping.`,
  ];
  const chosen = candidates.find((candidate) => candidate.length <= maxLength) || candidates[candidates.length - 1];
  if (chosen.length <= maxLength) return chosen;
  const cut = chosen.slice(0, maxLength);
  const boundary = cut.lastIndexOf(' ');
  return `${cut.slice(0, boundary > 80 ? boundary : maxLength).replace(/[,.\s]+$/, '')}.`;
}

/**
 * Description used inside schema.org Product markup. The richer record copy is
 * preferred over the 160 character meta description because Google and AI
 * answer engines both consume this field.
 */
export function buildProductSchemaDescription(
  product: Product,
  maxLength = 500,
  commercePolicy?: CommercePolicySetting,
): string {
  const fromDescription = firstMeaningfulParagraph(product.description, maxLength);
  if (fromDescription.length >= 120) return fromDescription;
  const fromShort = firstMeaningfulParagraph(product.short_description, maxLength);
  if (fromShort.length >= 80) return fromShort;
  return fromDescription || fromShort || buildProductSeoDescription(product, maxLength, commercePolicy);
}

export function buildProductSeoKeywords(product: Product): string {
  const brand = normalizeWhitespace(product.brand);
  const sku = normalizeWhitespace(product.sku);
  const rawType = inferProductTypeLabel(product);
  const type = stripLeadingBrand(rawType, brand) || rawType;
  const candidates = [
    [brand, sku].filter(Boolean).join(' '),
    sku,
    [brand, type].filter(Boolean).join(' '),
    type,
    [type, 'replacement'].filter(Boolean).join(' '),
    'industrial automation parts',
    'Vibocnc',
  ];
  return [...new Set(candidates.map(normalizeWhitespace).filter(Boolean))].join(', ');
}
