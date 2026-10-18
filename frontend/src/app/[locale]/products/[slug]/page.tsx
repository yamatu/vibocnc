import { Metadata } from 'next';
import { getProductBySkuCached, searchFirstProduct } from '@/services/product.server';
import { getCommercePolicyCached } from '@/services/commerce-policy.server';
import { getSiteUrl } from '@/lib/url';
import { withSiteName, withoutSiteNameSuffix } from '@/lib/seo';
import { toProductPathId } from '@/lib/utils';
import type { Category, Product, ProductImage } from '@/types';
import { CategoryService } from '@/services/category.service';
import { ProductService } from '@/services/product.service';
import ProductDetailClient from './ProductDetailClient';
import { permanentRedirect, redirect, notFound } from 'next/navigation';
import { getLocalizedMetadataPaths, resolveRouteLocale } from '@/lib/i18n/server';
import {
  getAvailableTranslationLocales,
  hasTranslationForLocale,
  localizeProductContent,
} from '@/lib/i18n/content';
import { DEFAULT_PUBLIC_LOCALE, PUBLIC_LOCALE_SELECTION_PARAM, localizePublicPath, normalizePublicLocale, type PublicLocale } from '@/lib/i18n/config';
import { buildProductSeoDescription, buildProductSeoKeywords, inferProductTypeLabel } from '@/lib/product-seo';

const DEFAULT_SITE_NAME = 'Vibocnc';

export const revalidate = 3600; // ISR: revalidate every hour

export async function generateStaticParams() {
  return [];
}

function slugToSku(slug: string): string {
  if (!slug) return '';
  // Remove common brand prefix and sanitize
  let s = slug.trim();
  try {
    s = decodeURIComponent(s);
  } catch {}
  s = s.replace(/^fanuc[\-\s]*/i, '');
  s = s.replace(/[\\/]+/g, '-');
  s = s.replace(/\s+/g, '-');
  s = s.replace(/-+/g, '-');
  return s.toUpperCase();
}

function getProductBrand(product: Product): string {
  return normalizeWhitespace(product.brand);
}

function getCanonicalProductSlug(product: Product, fallback = ''): string {
  return toProductPathId(product.sku || fallback);
}

function normalizeWhitespace(text?: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimMetaTitle(text: string, maxLength: number): string {
  const value = normalizeWhitespace(text);
  if (!value) return '';
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const idx = cut.lastIndexOf(' ');
  return normalizeWhitespace(idx >= 24 ? cut.slice(0, idx) : cut);
}

function toAbsoluteUrl(url: string | undefined, baseUrl: string): string {
  const value = String(url || '').trim();
  if (!value) return `${baseUrl}/images/default-product.svg`;
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

function buildMetadataTitle(product: Product): string {
  const explicit = trimMetaTitle(withoutSiteNameSuffix(product.meta_title || ''), 58);
  const semanticCategory = inferProductTypeLabel(product);
  const explicitHasWrongFanucType = getProductBrand(product).toLowerCase() === 'fanuc'
    && /^A06B-6092-/i.test(product.sku)
    && /servo amplifier/i.test(explicit)
    && /spindle amplifier/i.test(semanticCategory);
  if (explicit && !hasRepeatedBrand(explicit, getProductBrand(product)) && !explicitHasWrongFanucType) return explicit;

  const brand = getProductBrand(product);
  const parts = [
    brand,
    product.sku,
    semanticCategory,
  ].filter(Boolean);
  let title = parts.join(' ');
  if (!title) title = product.name || 'Product';
  if (title.length > 58) {
    const shortType = semanticCategory.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    title = [brand, product.sku, shortType].filter(Boolean).join(' ');
    if (title.length > 58) title = [brand, product.sku].filter(Boolean).join(' ');
  }
  if (!title) {
    title = [product.sku, semanticCategory || 'industrial automation part'].filter(Boolean).join(' ');
  }
  return trimMetaTitle(title, 58);
}

function hasRepeatedBrand(value: string, brand: string): boolean {
  const normalizedBrand = normalizeWhitespace(brand).toLowerCase();
  if (!normalizedBrand) return false;
  const escapedBrand = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escapedBrand}(?:\\s+[^|]{0,80})?\\s+${escapedBrand}(?:\\s|$)`, 'i').test(value);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  try {
    const { slug } = await params;
    const locale = await resolveRouteLocale(params);
    const sku = slugToSku(slug);

    let product: Product | null = null;
    try {
      product = (sku ? await getProductBySkuCached(sku) : null) || await searchFirstProduct(slug);
    } catch {}

    if (!product) {
      return {
        title: 'Product Not Found',
        description: 'The requested product could not be found.',
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const availableLocales = getAvailableTranslationLocales(product.translations);
    const hasRequestedTranslation = hasTranslationForLocale(product.translations, locale);
    const metadataLocale = hasRequestedTranslation ? locale : 'en';
    product = localizeProductContent(product, locale);

    const baseUrl = getSiteUrl();
    const productPath = `/products/${getCanonicalProductSlug(product, slug)}`;
    const localizedMetadata = await getLocalizedMetadataPaths(locale, productPath, availableLocales);
    const canonicalUrl = hasRequestedTranslation
      ? localizedMetadata.canonical
      : `${baseUrl}${localizePublicPath(productPath, 'en')}`;
    const languages = localizedMetadata.languages;

    const productImages: Array<string | ProductImage> =
      product.image_urls && product.image_urls.length > 0
        ? product.image_urls
        : (product.images || []);
    const semanticImageAlt = `${[product.brand, product.sku, inferProductTypeLabel(product)].filter(Boolean).join(' ')} product image`;
    const images = productImages.map((img) => ({
      url: toAbsoluteUrl(typeof img === 'string' ? img : img?.url || '/images/default-product.svg', baseUrl),
      width: 800,
      height: 600,
      alt: semanticImageAlt,
    }));

    // Placeholder/template meta copy is rejected in favour of the real record
    // copy, and the warranty/shipping promise comes from the commerce policy.
    const metaDescription = buildProductSeoDescription(product, 160, await getCommercePolicyCached());
    const metaKeywords = (product.meta_keywords || '').trim();
    const title = buildMetadataTitle(product);
    const socialTitle = withSiteName(title);
    const semanticCategory = inferProductTypeLabel(product);
    const semanticKeywords = buildProductSeoKeywords(product);

    return {
      title,
      description: metaDescription,
      keywords: hasRepeatedBrand(metaKeywords, getProductBrand(product)) || /\bservo amplifier\b/i.test(metaKeywords) && /spindle amplifier/i.test(semanticCategory)
        ? semanticKeywords
        : (metaKeywords || semanticKeywords),
      category: semanticCategory,
      robots: {
        index: hasRequestedTranslation,
        follow: true,
        googleBot: {
          index: hasRequestedTranslation,
          follow: true,
          'max-image-preview': 'large',
          'max-snippet': -1,
          'max-video-preview': -1,
        },
      },
      openGraph: {
        title: socialTitle,
        description: metaDescription,
        type: 'website',
        url: canonicalUrl,
        siteName: DEFAULT_SITE_NAME,
        images,
      },
      alternates: { canonical: canonicalUrl, languages },
      twitter: {
        card: 'summary_large_image',
        title: socialTitle,
        description: metaDescription,
        images: images.map(i => i.url),
        creator: '@vibocnc',
      },
      other: {
        ...(product.price > 0 ? {
          'product:price:amount': product.price.toString(),
          'product:price:currency': 'USD',
        } : {}),
        'product:availability': product.stock_quantity > 0 ? 'in stock' : 'available',
        'product:brand': product.brand || '',
        'product:category': semanticCategory,
        'product:retailer_item_id': product.sku || '',
        'product:condition': product.condition_type || 'new',
        'product:part_number': product.part_number || product.sku || '',
        'content-language': metadataLocale === 'zh' ? 'zh-CN' : metadataLocale,
      },
    };
  } catch (error) {
    console.error('Error generating product metadata:', error);
    return {
      title: 'Product',
      description: 'Professional industrial automation parts and components.',
    };
  }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { slug } = await params;
  const locale = await resolveRouteLocale(params);
  const sku = slugToSku(slug);

  // Backend errors propagate so ISR keeps serving the last good page instead
  // of caching a 404.
  let initialProduct: Product | null =
    (sku ? await getProductBySkuCached(sku) : null) || await searchFirstProduct(slug);

  if (!initialProduct) {
    notFound();
  }

  const hasRequestedTranslation = hasTranslationForLocale(initialProduct.translations, locale);
  initialProduct = localizeProductContent(initialProduct, locale);

  // The shipping / warranty / returns promise shown on the page and published in
  // structured data is admin-editable, not hard-coded.
  const commercePolicy = await getCommercePolicyCached();

  // Canonical redirect to the normalized product slug shared with sitemap and links.
  const canonicalId = getCanonicalProductSlug(initialProduct, sku || '');
  if (canonicalId && locale !== DEFAULT_PUBLIC_LOCALE && !hasRequestedTranslation) {
    const canonicalPath = localizePublicPath(`/products/${canonicalId}`, DEFAULT_PUBLIC_LOCALE);
    // Reset a saved locale on the intermediate request so browsers do not get
    // redirected back to the untranslated URL by locale middleware.
    permanentRedirect(`${canonicalPath}?${PUBLIC_LOCALE_SELECTION_PARAM}=${DEFAULT_PUBLIC_LOCALE}`);
  }
  if (canonicalId && canonicalId !== slug) {
    redirect(localizePublicPath(`/products/${canonicalId}`, hasRequestedTranslation ? locale : 'en'));
  }

  const context = await loadProductPageContext(initialProduct, locale);

  return (
    <>
      <ProductDetailClient
        productSku={initialProduct?.sku || sku}
        initialProduct={initialProduct}
        contentLocale={hasRequestedTranslation ? locale : 'en'}
        commercePolicy={commercePolicy}
        initialCategory={context.category}
        initialCategoryBreadcrumb={context.breadcrumb}
        initialRelatedProducts={context.related}
        initialCategoryPath={context.categoryPath}
      />
    </>
  );
}

// Only what the breadcrumb, category link and structured data render. The
// backend category payloads can be megabytes (children, translations), and
// every byte here is serialized into each cached product page.
function compactCategory(category: Category, locale: PublicLocale): Category {
  const translation = locale === DEFAULT_PUBLIC_LOCALE
    ? undefined
    : (category.translations || []).find((item) => normalizePublicLocale(item.language_code) === locale);
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    path: category.path,
    parent_id: category.parent_id,
    translations: translation ? [{ ...translation, description: '' }] : [],
  } as Category;
}

// Related-product cards only need identity, name and images; dropping the long
// descriptions keeps four products from bloating every product page payload.
function compactRelatedProduct(product: Product, locale: PublicLocale): Product {
  const translation = locale === DEFAULT_PUBLIC_LOCALE || !hasTranslationForLocale(product.translations, locale)
    ? undefined
    : (product.translations || []).find((item) => normalizePublicLocale(item.language_code) === locale);
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    image_urls: product.image_urls,
    images: product.images,
    translations: translation
      ? [{ ...translation, short_description: '', description: '.', meta_title: '', meta_description: '', meta_keywords: '' }]
      : [],
  } as Product;
}

// Category trail and related products are cached server reads (small,
// bounded payloads); on failure the client fetches them after hydration.
async function loadProductPageContext(product: Product, locale: PublicLocale) {
  const categoryId = product.category_id;
  if (!categoryId) return {};
  const [trail, related] = await Promise.all([
    CategoryService.getCategoryTrail(categoryId).catch(() => undefined),
    ProductService.getProducts({ category_id: String(categoryId), page_size: 4 }).catch(() => undefined),
  ]);
  return {
    category: trail ? compactCategory(trail.category, locale) : undefined,
    breadcrumb: trail ? trail.breadcrumb.map((item) => compactCategory(item, locale)) : undefined,
    related: related ? { ...related, data: (related.data || []).map((item) => compactRelatedProduct(item, locale)) } : undefined,
    categoryPath: trail ? trail.category.path || null : undefined,
  };
}
