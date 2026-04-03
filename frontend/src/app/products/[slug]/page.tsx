import { Metadata } from 'next';
import { ProductService } from '@/services';
import { getProductBySkuCached } from '@/services/product.server';
import { getSiteUrl } from '@/lib/url';
import { toProductPathId } from '@/lib/utils';
import type { Product, ProductImage } from '@/types';
import ProductDetailClient from './ProductDetailClient';
import { redirect, notFound } from 'next/navigation';

const DEFAULT_SITE_NAME = 'Vcocnc';
const GENERIC_BRAND_LABEL = 'industrial automation';
const GENERIC_SUPPLIER_LABEL = 'industrial automation parts supplier';

export const revalidate = 3600; // ISR: revalidate every hour

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

function stripHtml(text?: string): string {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getProductBrand(product: Product): string {
  return normalizeWhitespace(product.brand);
}

function getProductBrandLabel(product: Product): string {
  return getProductBrand(product) || GENERIC_BRAND_LABEL;
}

function getSupplierLabel(product: Product): string {
  return getProductBrand(product)
    ? `${getProductBrand(product)} parts supplier`
    : GENERIC_SUPPLIER_LABEL;
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

function trimMetaDescription(text: string, maxLength: number): string {
  const value = normalizeWhitespace(text);
  if (!value) return '';
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const idx = cut.lastIndexOf(' ');
  const trimmed = normalizeWhitespace(idx >= 60 ? cut.slice(0, idx) : cut);
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function toAbsoluteUrl(url: string | undefined, baseUrl: string): string {
  const value = String(url || '').trim();
  if (!value) return `${baseUrl}/images/default-product.svg`;
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

function buildMetadataTitle(product: Product): string {
  const explicit = trimMetaTitle(product.meta_title || '', 69);
  if (explicit) return explicit;

  const brand = getProductBrand(product);
  const parts = [
    brand,
    product.sku,
    product.category?.name || '',
  ].filter(Boolean);
  let title = parts.join(' ');
  if (!title) title = product.name || 'Product';
  if (title.length > 58) {
    title = [brand, product.sku].filter(Boolean).join(' ');
  }
  if (!title) {
    title = [product.sku, product.category?.name || 'industrial automation part'].filter(Boolean).join(' ');
  }
  return trimMetaTitle(`${title} | Vcocnc`, 69);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const { slug } = await params;
    const sku = slugToSku(slug);

    let product: Product | null = null;
    try {
      if (sku) product = await getProductBySkuCached(sku);
    } catch {}

    if (!product) {
      try {
        const res = await ProductService.getProducts({ search: slug, is_active: 'true', page: 1, page_size: 1 });
        product = (res.data || [])[0] || null;
      } catch {}
    }

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

    const baseUrl = getSiteUrl();
    const canonicalUrl = `${baseUrl}/products/${getCanonicalProductSlug(product, slug)}`;

    const productImages: Array<string | ProductImage> =
      product.image_urls && product.image_urls.length > 0
        ? product.image_urls
        : (product.images || []);
    const images = productImages.map((img) => ({
      url: toAbsoluteUrl(typeof img === 'string' ? img : img?.url || '/images/default-product.svg', baseUrl),
      width: 800,
      height: 600,
      alt: `${product.name} - ${product.sku} Part Image`,
    }));

    const brandLabel = getProductBrandLabel(product);
    const supplierLabel = getSupplierLabel(product);
    const baseDescription = stripHtml(product.meta_description || product.short_description || product.description)
      || `${product.name} (${product.sku}) ${brandLabel} spare part.`;
    const availabilityText = product.stock_quantity > 0
      ? 'In stock and ready for worldwide shipping.'
      : `Available to order with ${product.lead_time || '3-7 days'} lead time.`;
    const supportingText = [
      product.part_number && product.part_number !== product.sku ? `Part number ${product.part_number}.` : '',
      product.category?.name ? `${product.category.name} for CNC and industrial automation systems.` : 'Industrial automation component.',
      product.compatibility_info ? 'Compatibility guidance available on the product page.' : '',
      `Source from Vcocnc, professional ${supplierLabel} since 2005.`,
    ].filter(Boolean).join(' ');
    const enhancedDescription = trimMetaDescription(`${baseDescription} ${availabilityText} ${supportingText}`, 160);

    const metaDescription = trimMetaDescription(product.meta_description || '', 160);
    const metaKeywords = (product.meta_keywords || '').trim();
    const title = buildMetadataTitle(product);

    return {
      title,
      description: metaDescription || enhancedDescription,
      keywords: metaKeywords || [product.name, product.sku, product.brand, product.category?.name].filter(Boolean).join(', '),
      category: product.category?.name || 'Industrial Automation',
      robots: {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          'max-image-preview': 'large',
          'max-snippet': -1,
          'max-video-preview': -1,
        },
      },
      openGraph: {
        title,
        description: metaDescription || enhancedDescription,
        type: 'website',
        url: canonicalUrl,
        siteName: DEFAULT_SITE_NAME,
        images,
      },
      alternates: { canonical: canonicalUrl },
      twitter: {
        card: 'summary_large_image',
        title,
        description: metaDescription || enhancedDescription,
        images: images.map(i => i.url),
        creator: '@vcocnc',
      },
      other: {
        'product:price:amount': product.price?.toString() || '',
        'product:price:currency': 'USD',
        'product:availability': product.stock_quantity > 0 ? 'in stock' : 'available',
        'product:brand': product.brand || '',
        'product:category': product.category?.name || 'Industrial Automation',
        'product:retailer_item_id': product.sku || '',
        'product:condition': product.condition_type || 'new',
        'product:part_number': product.part_number || product.sku || '',
      },
    };
  } catch (error) {
    console.error('Error generating product metadata:', error);
    return {
      title: 'Product | Vcocnc',
      description: 'Professional industrial automation parts and components.',
    };
  }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sku = slugToSku(slug);

  let initialProduct: Product | null = null;
  try {
    if (sku) initialProduct = await getProductBySkuCached(sku);
  } catch (error) {
    console.error('Error fetching product by SKU from slug:', error);
  }

  if (!initialProduct) {
    try {
      const res = await ProductService.getProducts({ search: slug, is_active: 'true', page: 1, page_size: 1 });
      initialProduct = (res.data || [])[0] || null;
    } catch (error) {
      console.error('Error in fallback search by slug:', error);
    }
  }

  if (!initialProduct) {
    notFound();
  }

  // Canonical redirect to the normalized product slug shared with sitemap and links.
  const canonicalId = getCanonicalProductSlug(initialProduct, sku || '');
  if (canonicalId && canonicalId !== slug) {
    redirect(`/products/${canonicalId}`);
  }

  return (
    <>
      <ProductDetailClient productSku={initialProduct?.sku || sku} initialProduct={initialProduct} />
    </>
  );
}
