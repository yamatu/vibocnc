import { Metadata } from 'next';
import { ProductService } from '@/services';
import { getProductBySkuCached } from '@/services/product.server';
import { getSiteUrl } from '@/lib/url';
import { toProductPathId } from '@/lib/utils';
import type { Product, ProductImage } from '@/types';
import ProductDetailClient from './ProductDetailClient';
import { redirect, notFound } from 'next/navigation';

export const revalidate = 3600; // ISR: revalidate every hour

function slugToSku(slug: string): string {
  if (!slug) return '';
  // Remove common brand prefix and sanitize
  let s = slug.trim();
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

function trimToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function toAbsoluteUrl(url: string | undefined, baseUrl: string): string {
  const value = String(url || '').trim();
  if (!value) return `${baseUrl}/images/default-product.svg`;
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
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
    const canonicalUrl = `${baseUrl}/products/${toProductPathId(product.sku || slug)}`;

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

    const baseDescription = stripHtml(product.meta_description || product.short_description || product.description)
      || `${product.name} (${product.sku}) industrial automation spare part.`;
    const availabilityText = product.stock_quantity > 0
      ? 'In stock and ready for worldwide shipping.'
      : `Available to order with ${product.lead_time || '3-7 days'} lead time.`;
    const supportingText = [
      product.part_number && product.part_number !== product.sku ? `Part number ${product.part_number}.` : '',
      product.category?.name ? `${product.category.name} for CNC and industrial automation systems.` : 'Industrial automation component.',
      product.compatibility_info ? 'Compatibility guidance available on the product page.' : '',
      'Source from Vcocnc, professional FANUC parts supplier since 2005.',
    ].filter(Boolean).join(' ');
    const enhancedDescription = trimToLength(`${baseDescription} ${availabilityText} ${supportingText}`.replace(/\s+/g, ' ').trim(), 165);

    const metaTitle = (product.meta_title || '').trim();
    const metaDescription = (product.meta_description || '').trim();
    const metaKeywords = (product.meta_keywords || '').trim();
    const title = metaTitle || `${product.sku} ${product.name}`.trim();

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
        siteName: 'Vcocnc FANUC Parts',
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

  // Canonical redirect to SKU-only URL (keep product URLs short)
  const canonicalId = toProductPathId(initialProduct?.sku || sku || '');
  if (canonicalId && canonicalId !== slug) {
    redirect(`/products/${canonicalId}`);
  }

  return (
    <>
      <ProductDetailClient productSku={initialProduct?.sku || sku} initialProduct={initialProduct} />
    </>
  );
}
