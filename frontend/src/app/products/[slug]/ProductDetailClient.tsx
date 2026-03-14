'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import {
  ShoppingCartIcon,
  HeartIcon,
  ShareIcon,
  StarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  TruckIcon,
  ShieldCheckIcon,
  ArrowLeftIcon,
  TagIcon,
  BuildingOfficeIcon,
  GlobeAltIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { HeartIcon as HeartIconSolid, StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import Layout from '@/components/layout/Layout';
import ProductImageViewer from '@/components/product/ProductImageViewer';
import ProductSEO from '@/components/seo/ProductSEO';
import { ProductService, CategoryService, ShippingRateService } from '@/services';
import type { ShippingRatePublic, ShippingQuote } from '@/services/shipping-rate.service';
import type { ProductFAQ, ProductReview } from '@/types';
import { queryKeys } from '@/lib/react-query';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, getProductImageUrlByIndex, toProductPathId } from '@/lib/utils';
import { useCartStore } from '@/store/cart.store';
import { useRouter } from 'next/navigation';

interface ProductDetailClientProps {
  productSku: string;
  initialProduct?: any;
}

function parseTechnicalSpecs(raw?: string): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
      return parsed as Record<string, string>;
    }
  } catch { /* ignore */ }
  return null;
}

function FAQAccordionItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-4 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
      >
        <span>{question}</span>
        <ChevronDownIcon
          className={`h-5 w-5 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-6 pb-4 text-sm text-gray-700 leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}

export default function ProductDetailClient({ productSku, initialProduct }: ProductDetailClientProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [isFavorite, setIsFavorite] = useState(false);

  const [shippingCountry, setShippingCountry] = useState('');
  const [shippingCountries, setShippingCountries] = useState<ShippingRatePublic[]>([]);
  const [freeShippingCodes, setFreeShippingCodes] = useState<Set<string>>(new Set());
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingError, setShippingError] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const countryInputRef = useRef<HTMLInputElement>(null);
  const countryDropdownRef = useRef<HTMLDivElement>(null);

  const { addItem } = useCartStore();
  const router = useRouter();

  // Fetch product details by SKU
  const { data: product, isLoading, error } = useQuery({
    queryKey: queryKeys.products.detailBySku(productSku),
    queryFn: () => ProductService.getProductBySku(productSku),
    enabled: !!productSku && !initialProduct,
    initialData: initialProduct,
    staleTime: 120000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
  });

  // Fetch product category details
  const { data: category } = useQuery({
    queryKey: ['category', product?.category_id],
    queryFn: () => CategoryService.getCategory(product!.category_id),
    enabled: !!product?.category_id,
    staleTime: 300000,
  });

  // Fetch category breadcrumb
  const { data: categoryBreadcrumb } = useQuery({
    queryKey: ['categoryBreadcrumb', product?.category_id],
    queryFn: () => CategoryService.getCategoryBreadcrumb(product!.category_id),
    enabled: !!product?.category_id,
    staleTime: 300000,
  });

  // Fetch related products
  const { data: relatedProducts = { data: [] } as any } = useQuery({
    queryKey: queryKeys.products.list({ category: product?.category_id }),
    queryFn: () => ProductService.getProducts({
      category_id: product?.category_id,
      page_size: 4
    }),
    enabled: !!product?.category_id,
  });

  // Fetch all categories for internal linking
  const { data: allCategories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => CategoryService.getCategories(),
    staleTime: 600000,
  });

  const resolveCategoryHref = () => {
    const tree: any[] = Array.isArray(allCategories) ? (allCategories as any) : [];
    const targetId = product?.category_id;
    if (!targetId) return null;
    const findById = (nodes: any[]): any => {
      for (const n of nodes) {
        if (Number(n.id) === Number(targetId)) return n;
        if (Array.isArray(n.children) && n.children.length > 0) {
          const hit = findById(n.children);
          if (hit) return hit;
        }
      }
      return null;
    };
    const node = findById(tree);
    if (node?.path) return `/categories/${node.path}`;
    if (product?.category?.slug) return `/categories/${product.category.slug}`;
    return null;
  };

  // Fetch shipping countries + free shipping list on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [countries, freeCountries] = await Promise.all([
          ShippingRateService.publicCountries(),
          ShippingRateService.publicFreeShippingCountries(),
        ]);
        if (cancelled) return;
        setShippingCountries(countries);
        setFreeShippingCodes(new Set(freeCountries.map(c => c.country_code)));
      } catch {
        // silently fail — calculator just won't show countries
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-calculate shipping when country changes
  useEffect(() => {
    if (!shippingCountry || !product) return;
    if (freeShippingCodes.has(shippingCountry)) {
      setShippingQuote(null);
      setShippingError('');
      return;
    }
    let cancelled = false;
    setShippingLoading(true);
    setShippingError('');
    (async () => {
      try {
        const weight = product.weight || 0.5;
        const quote = await ShippingRateService.quote(shippingCountry, weight);
        if (!cancelled) setShippingQuote(quote);
      } catch {
        if (!cancelled) setShippingError('Unable to calculate shipping for this destination');
      } finally {
        if (!cancelled) setShippingLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shippingCountry, product, freeShippingCodes]);

  // Fuzzy-filtered countries for searchable dropdown
  const filteredCountries = useMemo(() => {
    if (!countrySearch.trim()) return shippingCountries;
    const q = countrySearch.toLowerCase();
    return shippingCountries.filter(c =>
      c.country_name.toLowerCase().includes(q) ||
      c.country_code.toLowerCase().includes(q)
    );
  }, [shippingCountries, countrySearch]);

  // Close country dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        countryDropdownRef.current &&
        !countryDropdownRef.current.contains(e.target as Node)
      ) {
        setCountryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectCountry = useCallback((code: string, name: string) => {
    setShippingCountry(code);
    setCountrySearch(name);
    setCountryDropdownOpen(false);
  }, []);

  const handleWhatsAppInquiry = () => {
    if (!product) return;
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const text = [
      `Hi, I'd like to inquire about this product:`,
      ``,
      `Product: ${computedHeading}`,
      `SKU: ${product.sku}`,
      `Price: ${formatCurrency(product.price)}`,
      ``,
      `Link: ${url}`,
      ``,
      `Please send me a quote. Thank you!`,
    ].join('\n');
    window.open(`https://wa.me/8613348028050?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleBuyNow = () => {
    if (!product) return;
    addItem(product, quantity);
    router.push('/checkout/guest');
  };

  const handleAddToCart = () => {
    if (product) {
      addItem(product, quantity);
    }
  };

  const handleImageIndexChange = (index: number) => {
    setSelectedImageIndex(index);
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600"></div>
        </div>
      </Layout>
    );
  }

  // Show Not Found when we have no product
  if (!product) {
    if (error || !isLoading) {
      return (
        <Layout>
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900 mb-4">Product Not Found</h1>
              <p className="text-gray-600 mb-8">The product you're looking for doesn't exist.</p>
              <Link
                href="/products"
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                Back to Products
              </Link>
            </div>
          </div>
        </Layout>
      );
    }
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600"></div>
        </div>
      </Layout>
    );
  }

  // Below is identical rendering from original client component
  // ... to keep patch minimal, we re-use exactly the same JSX

  // Normalize image arrays
  const rawImages: any = (product as any).image_urls && (product as any).image_urls.length > 0
    ? (product as any).image_urls
    : (product as any).images || [];

  const images: any[] = Array.isArray(rawImages)
    ? rawImages
    : (typeof rawImages === 'string'
        ? ((): any[] => {
            try {
              const parsed = JSON.parse(rawImages);
              if (Array.isArray(parsed)) return parsed;
            } catch {}
            return rawImages ? [rawImages] : [];
          })()
        : (rawImages && typeof rawImages === 'object'
            ? [rawImages]
            : []));
  const currentImage = images.length > 0
    ? getProductImageUrlByIndex(images, selectedImageIndex)
    : getDefaultProductImageWithSku(product.sku, '/images/default-product.jpg');

  const categoryName = product.category?.name || 'Part';
  const brandName = product.brand || '';
  const computedHeading = product.name || `${brandName} ${product.sku || ''} ${categoryName}`.trim();

  const getFallbackDescription = () => {
    const sku = product.sku || '';
    const price = product.price ? formatCurrency(product.price) : '';
    const stockText = product.stock_quantity && product.stock_quantity > 0 ? 'In stock and ready to ship.' : 'Available for order with fast handling.';
    const templates: Record<string, string> = {
      'Power Supply': `${brandName ? brandName + ' ' : ''}${sku} Power Supply Unit delivers reliable power for CNC systems. Industrial-grade design with short-circuit protection and status indicators. ${stockText} ${price ? `Priced at ${price}.` : ''}`,
      'Servo': `${brandName ? brandName + ' ' : ''}${sku} Servo component provides precise motion control with advanced feedback and fault diagnostics. Ideal for high-precision CNC applications. ${stockText} ${price ? `Current price: ${price}.` : ''}`,
      'Motor': `${brandName ? brandName + ' ' : ''}${sku} Motor ensures high-efficiency performance and stable torque for continuous operation in demanding environments. ${stockText}`,
      'Interface': `${brandName ? brandName + ' ' : ''}${sku} Interface Board ensures robust signal processing and EMI protection, enabling reliable communication in automation systems. ${stockText}`,
      'PCB': `${brandName ? brandName + ' ' : ''}${sku} Control PCB for CNC systems, engineered for reliability and long service life. ${stockText}`,
    };
    const key = Object.keys(templates).find(k => categoryName.toLowerCase().includes(k.toLowerCase()));
    return key ? templates[key] : `${brandName ? brandName + ' ' : ''}${sku} ${categoryName} for CNC and industrial automation. ${stockText}`;
  };

  const descriptionToShow = product.description && product.description.trim().length > 0
    ? product.description
    : getFallbackDescription();

  return (
    <Layout>
      {/* Enhanced SEO with structured data */}
      <ProductSEO
        product={product}
        category={category}
        categoryBreadcrumb={categoryBreadcrumb}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Breadcrumb */}
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center space-x-2 text-sm text-gray-500">
              <Link href="/" className="hover:text-yellow-600">Home</Link>
              <span>/</span>
              <Link href="/products" className="hover:text-yellow-600">Products</Link>
              <span>/</span>
              {product.category && (
                <>
                  {(() => {
                    const href = resolveCategoryHref();
                    if (!href) return <span>{product.category.name}</span>;
                    return (
                      <Link href={href} className="hover:text-yellow-600">
                        {product.category.name}
                      </Link>
                    );
                  })()}
                  <span>/</span>
                </>
              )}
              <span className="text-gray-900 font-medium">{product.name}</span>
            </nav>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-x-8 lg:items-start">
            {/* Product Images */}
            <ProductImageViewer
              images={images}
              productName={product.name}
              selectedImageIndex={selectedImageIndex}
              onImageChange={handleImageIndexChange}
				  fallbackImage={getDefaultProductImageWithSku(product.sku, '/images/default-product.jpg')}
              productSku={product.sku}
              categoryName={categoryName}
            />

            {/* Product Info */}
            <div className="mt-10 px-4 sm:px-0 sm:mt-16 lg:mt-0">
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">{computedHeading}</h1>
              
              <div className="mt-3">
                <h2 className="sr-only">Product information</h2>
                <p className="text-3xl tracking-tight text-gray-900">{formatCurrency(product.price)}</p>
              </div>

              {/* SKU */}
              <div className="mt-4 space-y-1">
                <p className="text-sm text-gray-500">SKU: <span className="font-medium text-gray-900">{product.sku}</span></p>
                {product.sku && (
                  <p className="text-xs text-gray-500">Alternate: <span className="font-mono">{String(product.sku).replace(/-/g, '')}</span></p>
                )}
              </div>

              {/* Actions — moved above specs */}
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={handleAddToCart}
                  className="inline-flex items-center px-5 py-3 border border-transparent text-sm font-medium rounded-md text-black bg-yellow-500 hover:bg-yellow-600"
                >
                  <ShoppingCartIcon className="h-5 w-5 mr-2" />
                  Add to Cart
                </button>
                <button
                  onClick={handleWhatsAppInquiry}
                  className="inline-flex items-center px-5 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-green-500 hover:bg-green-600"
                >
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  WhatsApp Us
                </button>
                <button
                  onClick={handleBuyNow}
                  className="inline-flex items-center px-5 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  Buy Now
                </button>
              </div>

              {/* Key specs */}
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-sm">
                  <div className="text-xs text-gray-500">Brand</div>
                  <div className="font-medium text-gray-900">{product.brand || brandName || '-'}</div>
                </div>
                <div className="text-sm">
                  <div className="text-xs text-gray-500">Part No.</div>
                  <div className="font-mono text-gray-900">{product.part_number || product.model || product.sku}</div>
                </div>
                <div className="text-sm">
                  <div className="text-xs text-gray-500">Warranty</div>
                  <div className="font-medium text-gray-900">{product.warranty_period || '12 months'}</div>
                </div>
                <div className="text-sm">
                  <div className="text-xs text-gray-500">Lead time</div>
                  <div className="font-medium text-gray-900">{product.lead_time || '3-7 days'}</div>
                </div>
              </div>

              {/* Shipping Calculator */}
              {shippingCountries.length > 0 && (
                <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center mb-3">
                    <TruckIcon className="h-4 w-4 mr-2 text-yellow-600" />
                    Shipping Estimate
                  </h3>
                  <div className="relative" ref={countryDropdownRef}>
                    <div className="relative">
                      <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                      <input
                        ref={countryInputRef}
                        type="text"
                        placeholder="Search or select country..."
                        value={countrySearch}
                        onChange={(e) => {
                          setCountrySearch(e.target.value);
                          setCountryDropdownOpen(true);
                          if (!e.target.value) {
                            setShippingCountry('');
                            setShippingQuote(null);
                          }
                        }}
                        onFocus={() => setCountryDropdownOpen(true)}
                        className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-8 text-sm text-gray-900 focus:border-yellow-500 focus:ring-yellow-500"
                      />
                      {countrySearch && (
                        <button
                          type="button"
                          onClick={() => {
                            setCountrySearch('');
                            setShippingCountry('');
                            setShippingQuote(null);
                            setCountryDropdownOpen(false);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
                        </button>
                      )}
                    </div>
                    {countryDropdownOpen && (
                      <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                        {filteredCountries.length === 0 ? (
                          <li className="px-3 py-2 text-sm text-gray-500">No countries found</li>
                        ) : (
                          filteredCountries.map((c) => (
                            <li
                              key={c.country_code}
                              onClick={() => selectCountry(c.country_code, c.country_name)}
                              className={`cursor-pointer px-3 py-2 text-sm hover:bg-yellow-50 flex items-center justify-between ${
                                shippingCountry === c.country_code ? 'bg-yellow-50 text-yellow-900 font-medium' : 'text-gray-900'
                              }`}
                            >
                              <span>{c.country_name}</span>
                              {freeShippingCodes.has(c.country_code) && (
                                <span className="text-xs text-green-600 font-medium">Free</span>
                              )}
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                  {shippingCountry && (
                    <div className="mt-3">
                      {shippingLoading ? (
                        <div className="flex items-center text-sm text-gray-500">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600 mr-2" />
                          Calculating...
                        </div>
                      ) : shippingError ? (
                        <p className="text-sm text-red-600">{shippingError}</p>
                      ) : freeShippingCodes.has(shippingCountry) ? (
                        <div className="flex items-center text-sm font-medium text-green-700">
                          <CheckIcon className="h-4 w-4 mr-1" />
                          Free Shipping
                        </div>
                      ) : shippingQuote ? (
                        <div className="text-sm text-gray-900">
                          <span className="font-medium">
                            {shippingQuote.currency === 'USD' ? '$' : shippingQuote.currency + ' '}
                            {shippingQuote.shipping_fee.toFixed(2)}
                          </span>
                          <span className="text-gray-500 ml-1">
                            (weight: {shippingQuote.weight_kg}kg)
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {/* Stock & Availability */}
              <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                <div className="flex items-center text-sm">
                  {product.stock_quantity && product.stock_quantity > 0 ? (
                    <>
                      <CheckIcon className="h-4 w-4 text-green-600 mr-2 flex-shrink-0" />
                      <span className="text-green-700 font-medium">In Stock</span>
                      <span className="text-gray-500 ml-1">— Ready to ship</span>
                    </>
                  ) : (
                    <>
                      <ClockIcon className="h-4 w-4 text-yellow-600 mr-2 flex-shrink-0" />
                      <span className="text-yellow-700 font-medium">Available to Order</span>
                      <span className="text-gray-500 ml-1">— {product.lead_time || '3-7 days'} lead time</span>
                    </>
                  )}
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <TruckIcon className="h-4 w-4 mr-2 flex-shrink-0" />
                  Worldwide shipping available
                </div>
              </div>

              {/* Trust Badges */}
              <div className="mt-6 grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center text-center p-3 rounded-lg bg-gray-50">
                  <ShieldCheckIcon className="h-6 w-6 text-yellow-600 mb-1" />
                  <span className="text-xs font-medium text-gray-700">{product.warranty_period || '12 Month'} Warranty</span>
                </div>
                <div className="flex flex-col items-center text-center p-3 rounded-lg bg-gray-50">
                  <GlobeAltIcon className="h-6 w-6 text-yellow-600 mb-1" />
                  <span className="text-xs font-medium text-gray-700">Worldwide Shipping</span>
                </div>
                <div className="flex flex-col items-center text-center p-3 rounded-lg bg-gray-50">
                  <CheckIcon className="h-6 w-6 text-yellow-600 mb-1" />
                  <span className="text-xs font-medium text-gray-700">Quality Tested</span>
                </div>
              </div>
            </div>
          </div>

          {/* Product Description — full width below the grid */}
          <div className="mt-12 space-y-8">
            {/* Main Description */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Product Description</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="product-description text-base text-gray-700 whitespace-pre-line leading-relaxed max-w-none">
                  {descriptionToShow}
                </div>
              </div>
            </section>

            {/* Technical Specifications */}
            {(() => {
              const specs = parseTechnicalSpecs(product.technical_specs);
              if (!specs) return null;
              return (
                <section>
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">Technical Specifications</h2>
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden product-specs">
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(specs).map(([key, value], idx) => (
                          <tr key={key} className={idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                            <td className="px-6 py-3 font-medium text-gray-900 w-1/3">{key}</td>
                            <td className="px-6 py-3 text-gray-700">{String(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })()}

            {/* Compatibility Info */}
            {product.compatibility_info && (
              <section>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Compatibility Information</h2>
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <p className="text-base text-gray-700 whitespace-pre-line leading-relaxed">{product.compatibility_info}</p>
                </div>
              </section>
            )}

            {/* Installation Guide */}
            {product.installation_guide && (
              <section>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Installation Guide</h2>
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <p className="text-base text-gray-700 whitespace-pre-line leading-relaxed">{product.installation_guide}</p>
                </div>
              </section>
            )}

            {/* Maintenance Tips */}
            {product.maintenance_tips && (
              <section>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Maintenance Tips</h2>
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <p className="text-base text-gray-700 whitespace-pre-line leading-relaxed">{product.maintenance_tips}</p>
                </div>
              </section>
            )}

            {/* Product FAQ */}
            {product.faqs && product.faqs.filter((f: ProductFAQ) => f.is_active).length > 0 && (
              <section>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Frequently Asked Questions</h2>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                  {product.faqs.filter((f: ProductFAQ) => f.is_active).map((faq: ProductFAQ) => (
                    <FAQAccordionItem key={faq.id} question={faq.question} answer={faq.answer} />
                  ))}
                </div>
              </section>
            )}

            {/* Customer Reviews */}
            {product.reviews && product.reviews.filter((r: ProductReview) => r.is_approved).length > 0 && (
              <section>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Customer Reviews</h2>
                <div className="space-y-4">
                  {product.reviews.filter((r: ProductReview) => r.is_approved).map((review: ProductReview) => (
                    <div key={review.id} className="bg-white rounded-lg border border-gray-200 p-6">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{review.customer_name}</span>
                          {review.is_verified && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              <CheckIcon className="h-3 w-3 mr-0.5" />
                              Verified
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">{new Date(review.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center mb-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          star <= review.rating
                            ? <StarIconSolid key={star} className="h-4 w-4 text-yellow-400" />
                            : <StarIcon key={star} className="h-4 w-4 text-gray-300" />
                        ))}
                      </div>
                      {review.review_title && (
                        <h3 className="font-medium text-gray-900 mb-1">{review.review_title}</h3>
                      )}
                      <p className="text-sm text-gray-700">{review.review_content}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Related Products */}
          {relatedProducts?.data?.length > 0 && (
            <div className="mt-12">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Related Products</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {relatedProducts.data.map((relatedProduct: any) => (
                  <div key={relatedProduct.id} className="bg-white rounded-lg shadow p-4">
                    <div className="aspect-w-1 aspect-h-1 w-full overflow-hidden rounded-md bg-gray-200">
                      <Image
                        src={getProductImageUrl(
                          (relatedProduct.image_urls && relatedProduct.image_urls.length > 0) ? relatedProduct.image_urls : (relatedProduct.images || []),
                          getDefaultProductImageWithSku(relatedProduct.sku)
                        )}
                        alt={relatedProduct.name}
                        width={200}
                        height={200}
                        className="h-40 w-full object-cover object-center"
                        unoptimized
                      />
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/products/${toProductPathId(relatedProduct.sku)}`}
                        className="text-sm font-medium text-gray-900 hover:text-yellow-600"
                      >
                        {relatedProduct.name}
                      </Link>
                      <p className="text-sm text-gray-500">SKU: {relatedProduct.sku}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
