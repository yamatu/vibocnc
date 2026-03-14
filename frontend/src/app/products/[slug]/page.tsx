import { Metadata } from 'next';
import { ProductService } from '@/services';
import { getProductBySkuCached } from '@/services/product.server';
import { getSiteUrl } from '@/lib/url';
import { toProductPathId } from '@/lib/utils';
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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const { slug } = await params;
    const sku = slugToSku(slug);

    let product: any = null;
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
        title: 'Product Not Found | Vcocnc',
        description: 'The requested product could not be found.',
      };
    }

    const baseUrl = getSiteUrl();
    const canonicalUrl = `${baseUrl}/products/${toProductPathId(product.sku || slug)}`;

    const productImages = (product.image_urls && product.image_urls.length > 0) ? product.image_urls : (product.images || []);
    const images = (Array.isArray(productImages) ? productImages : []).map((img: any) => ({
      url: typeof img === 'string' ? img : img?.url || '/images/default-product.svg',
      width: 800,
      height: 600,
      alt: `${product.name} - ${product.sku} Part Image`,
    }));

    const baseDescription = product.description || `${product.name} (${product.sku}) - Professional industrial part available at Vcocnc.`;
    const enhancedDescription = `${baseDescription} ${product.stock_quantity > 0 ? 'In stock' : 'Available'} and ready to ship worldwide. ${product.category?.name || 'Industrial automation'} component with ${product.price ? `competitive pricing at ${product.price}` : 'competitive pricing'}. Professional parts supplier since 2005.`;

    const metaTitle = (product.meta_title || '').trim();
    const metaDescription = (product.meta_description || '').trim();
    const metaKeywords = (product.meta_keywords || '').trim();

    return {
      title: metaTitle || `${product.name} - ${product.sku} | Vcocnc`,
      description: metaDescription || enhancedDescription,
      keywords: metaKeywords || [product.name, product.sku, product.brand, product.category?.name].filter(Boolean).join(', '),
      openGraph: {
        title: metaTitle || `${product.name} - ${product.sku}`,
        description: metaDescription || enhancedDescription,
        type: 'website',
        url: canonicalUrl,
        images: images.map(i => i.url),
      },
      alternates: { canonical: canonicalUrl },
      twitter: {
        card: 'summary_large_image',
        title: metaTitle || `${product.name} - ${product.sku}`,
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

  let initialProduct: any = null;
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
