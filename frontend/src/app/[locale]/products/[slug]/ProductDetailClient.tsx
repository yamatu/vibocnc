'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import {
  ShoppingCartIcon,
  StarIcon,
  CheckIcon,
  TruckIcon,
  ShieldCheckIcon,
  ArrowLeftIcon,
  GlobeAltIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { FaPaypal } from 'react-icons/fa6';
import Layout from '@/components/layout/Layout';
import ProductImageViewer from '@/components/product/ProductImageViewer';
import ProductSEO from '@/components/seo/ProductSEO';
import { ProductService } from '@/services/product.service';
import { CategoryService } from '@/services/category.service';
import { ShippingRateService } from '@/services/shipping-rate.service';
import type { ShippingRatePublic, ShippingQuote } from '@/services/shipping-rate.service';
import type { PaginationResponse, Product, ProductImage, ProductReview, Category, CommercePolicySetting } from '@/types';
import {
  FALLBACK_COMMERCE_POLICY,
  resolveLeadTime,
  resolveWarrantyPeriod,
} from '@/lib/commerce-policy';
import { queryKeys } from '@/lib/react-query';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, hasProductPrice, toProductPathId } from '@/lib/utils';
import { useCartStore } from '@/store/cart.store';
import { useRouter } from 'next/navigation';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { hasTranslationForLocale, localizeCategoryContent, localizeProductContent } from '@/lib/i18n/content';
import { buildSemanticProductName, inferProductTypeLabel } from '@/lib/product-seo';
import { stripDuplicateGeneratedSections } from '@/lib/product-description';
import {
  buildProductFaqs,
  customCompatibilityInfo,
  customInstallationGuide,
  customMaintenanceTips,
  extraSpecRows,
} from '@/lib/product-content';

interface ProductDetailClientProps {
  productSku: string;
  initialProduct?: Product;
  contentLocale?: string;
  /** Admin-editable shipping / warranty / returns promise (server supplied). */
  commercePolicy?: CommercePolicySetting;
  // Server-rendered context; when absent the client fetches it after hydration.
  initialCategory?: Category;
  initialCategoryBreadcrumb?: Category[];
  initialRelatedProducts?: PaginationResponse<Product>;
  // null = the server looked the category up and it has no nested path.
  initialCategoryPath?: string | null;
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

function stripHtml(text?: string): string {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparisonText(text?: string): string {
  return stripHtml(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function FAQAccordionItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const answerId = useId();
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={answerId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-950 hover:bg-slate-50 sm:px-6 sm:py-4"
      >
        <span>{question}</span>
        <ChevronDownIcon
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {/*
        The answer stays in the DOM when collapsed (hidden, not unmounted) so
        crawlers and AI answer engines can read it. Unmounting on toggle was the
        reason FAQ text never reached the index while the FAQPage markup claimed
        it existed.
      */}
      <div
        id={answerId}
        hidden={!open}
        className="px-4 pb-4 text-sm leading-relaxed text-slate-700 sm:px-6"
      >
        {answer}
      </div>
    </div>
  );
}

export default function ProductDetailClient({
  productSku,
  initialProduct,
  contentLocale,
  commercePolicy,
  initialCategory,
  initialCategoryBreadcrumb,
  initialRelatedProducts,
  initialCategoryPath,
}: ProductDetailClientProps) {
  const { locale, t, href: localizedHref } = usePublicI18n();
  // Every commercial promise shown on the page comes from the admin-editable
  // commerce policy, so nothing here has to be edited in code.
  const policy = commercePolicy ? { ...FALLBACK_COMMERCE_POLICY, ...commercePolicy } : FALLBACK_COMMERCE_POLICY;
  const shownLeadTime = resolveLeadTime(initialProduct?.lead_time, policy);
  const shownWarranty = resolveWarrantyPeriod(initialProduct?.warranty_period, policy);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [quantity] = useState(1);

  const [shippingCountry, setShippingCountry] = useState('');
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

  // Category + breadcrumb normally come from the server; the trail endpoint is
  // a small fallback (never the full category tree or the category's products).
  const { data: fetchedTrail } = useQuery({
    queryKey: ['categoryTrail', product?.category_id],
    queryFn: () => CategoryService.getCategoryTrail(product!.category_id),
    enabled: !!product?.category_id && !initialCategory,
    staleTime: 300000,
  });
  const fetchedCategory = initialCategory ?? fetchedTrail?.category;
  const fetchedCategoryBreadcrumb = initialCategoryBreadcrumb ?? fetchedTrail?.breadcrumb;
  const categoryPath = initialCategoryPath !== undefined ? initialCategoryPath : fetchedTrail?.category.path;
  const category = useMemo(
    () => fetchedCategory ? localizeCategoryContent(fetchedCategory, locale) : product?.category,
    [fetchedCategory, locale, product?.category],
  );
  const categoryBreadcrumb = useMemo(
    () => fetchedCategoryBreadcrumb?.map((item) => localizeCategoryContent(item, locale)),
    [fetchedCategoryBreadcrumb, locale],
  );

  // Fetch related products
  const { data: fetchedRelatedProducts } = useQuery<PaginationResponse<Product>>({
    queryKey: queryKeys.products.list({ category: product?.category_id }),
    queryFn: () => ProductService.getProducts({
      category_id: product?.category_id ? String(product.category_id) : undefined,
      page_size: 4
    }),
    enabled: !!product?.category_id && !initialRelatedProducts,
    initialData: initialRelatedProducts,
  });
  const relatedProducts = useMemo<PaginationResponse<Product>>(
    () => fetchedRelatedProducts
      ? {
          ...fetchedRelatedProducts,
          data: (fetchedRelatedProducts.data || [])
            .map((item) => hasTranslationForLocale(item.translations, locale)
              ? localizeProductContent(item, locale)
              : item),
        }
      : { data: [], page: 1, page_size: 4, total: 0, total_pages: 1 },
    [fetchedRelatedProducts, locale],
  );

  const resolveCategoryHref = () => {
    if (!product?.category_id) return null;
    if (categoryPath) return `/categories/${categoryPath}`;
    if (product?.category?.slug) return `/categories/${product.category.slug}`;
    return null;
  };

  // Shipping countries are identical for every product: load them once the
  // browser is idle (off the hydration/LCP path) and reuse them across product
  // views. On failure the calculator just stays hidden.
  const [shippingDataEnabled, setShippingDataEnabled] = useState(false);
  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setShippingDataEnabled(true), { timeout: 2000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => setShippingDataEnabled(true), 800);
    return () => window.clearTimeout(timer);
  }, []);
  const { data: shippingData } = useQuery({
    queryKey: ['shipping-rates', 'public-countries'],
    queryFn: async () => {
      const [countries, freeCountries] = await Promise.all([
        ShippingRateService.publicCountries(),
        ShippingRateService.publicFreeShippingCountries(),
      ]);
      return { countries, freeCodes: freeCountries.map((c) => c.country_code) };
    },
    enabled: shippingDataEnabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const shippingCountries = useMemo<ShippingRatePublic[]>(() => shippingData?.countries ?? [], [shippingData]);
  const freeShippingCodes = useMemo(() => new Set(shippingData?.freeCodes ?? []), [shippingData]);

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
      hasProductPrice(product) ? `Price: ${formatCurrency(product.price)}` : `Price: Please quote`,
      ``,
      `Link: ${url}`,
      ``,
      `Please send me a quote. Thank you!`,
    ].join('\n');
    window.open(`https://wa.me/8613301553506?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleBuyNow = () => {
    if (!product || !hasProductPrice(product)) return;
    addItem(product, quantity);
    router.push('/checkout/guest');
  };

  const handleAddToCart = () => {
    if (product && hasProductPrice(product)) {
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700"></div>
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
              <h1 className="text-2xl font-bold text-slate-950 mb-4">{t('product.notFound')}</h1>
              <p className="text-slate-600 mb-8">{t('product.notFoundDescription')}</p>
              <Link
                href={localizedHref('/products')}
                className="site-primary-action px-4 py-2 text-sm"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                {t('product.back')}
              </Link>
            </div>
          </div>
        </Layout>
      );
    }
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700"></div>
        </div>
      </Layout>
    );
  }

  // Below is identical rendering from original client component
  // ... to keep patch minimal, we re-use exactly the same JSX

  // Normalize image arrays
  const rawImages: string[] | ProductImage[] | string | ProductImage | null =
    product.image_urls && product.image_urls.length > 0
      ? product.image_urls
      : (product.images || []);

  const images: Array<string | ProductImage> = Array.isArray(rawImages)
    ? rawImages
    : (typeof rawImages === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(rawImages);
              if (Array.isArray(parsed)) return parsed as Array<string | ProductImage>;
            } catch {}
            return rawImages ? [rawImages] : [];
          })()
        : (rawImages && typeof rawImages === 'object'
            ? [rawImages]
            : []));

  const semanticProduct = category ? { ...product, category } : product;
  const categoryName = inferProductTypeLabel(semanticProduct);
  const brandName = (product.brand || '').trim();
  const normalizedName = String(product.name || '').trim();
  const skuOnlyName = normalizeComparisonText(normalizedName) === normalizeComparisonText(product.sku);
  const nameAlreadyHasBrand = brandName && normalizeComparisonText(normalizedName).includes(normalizeComparisonText(brandName));
  const headingParts = [
    !nameAlreadyHasBrand ? brandName : '',
    normalizedName || product.sku,
    skuOnlyName ? categoryName : '',
  ].filter(Boolean);
  const computedHeading = buildSemanticProductName(semanticProduct) || headingParts.join(' ').replace(/\s+/g, ' ').trim();
  const canPurchase = hasProductPrice(product);
  // Keep this href identical during SSR and hydration. The SKU/model is enough
  // for the sales team to identify the quote request without leaking a runtime URL.
  const quoteEmailHref = `mailto:flora@vibocnc.com?subject=${encodeURIComponent(`Quote request: ${product.sku}`)}&body=${encodeURIComponent(`Hello, please provide price and lead time for ${computedHeading} (${product.sku}).`)}`;

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

  const specs = parseTechnicalSpecs(product.technical_specs);
  const rawDescription = product.description && product.description.trim().length > 0
    ? product.description
    : getFallbackDescription();
  // Legacy generated copy repeated facts that already have their own sections.
  // Strip those blocks here so an old product stops showing them twice; the
  // stored description is never modified.
  // Generated spec/compatibility blocks inside old descriptions are always
  // template copy: the details table covers the specs, the FAQ covers fitment.
  const descriptionToShow = stripDuplicateGeneratedSections(rawDescription, {
    hasSpecifications: true,
    hasCompatibility: true,
  });
  const categoryHref = resolveCategoryHref();
  const activeFaqs = buildProductFaqs(product, {
    locale,
    policy,
    warranty: shownWarranty,
    leadTime: shownLeadTime,
  });
  const compatibilityText = customCompatibilityInfo(product);
  const installationText = customInstallationGuide(product);
  const maintenanceText = customMaintenanceTips(product);
  const extraSpecs = extraSpecRows(specs, product);
  const resourceLinks = [
    product.datasheet_url ? { href: product.datasheet_url, label: 'Datasheet' } : null,
    product.manual_url ? { href: product.manual_url, label: 'Manual' } : null,
  ].filter(Boolean) as Array<{ href: string; label: string }>;
  return (
    <Layout>
      {/* Enhanced SEO with structured data */}
      <ProductSEO
        product={product}
        category={category}
        categoryBreadcrumb={categoryBreadcrumb}
        contentLocale={contentLocale}
        commercePolicy={commercePolicy}
      />

      <div className="site-page-shell min-h-screen">
        {/* Breadcrumb */}
        <div className="site-breadcrumb-bar">
          <div className="max-w-7xl mx-auto px-3 py-2.5 sm:px-6 sm:py-4 lg:px-8">
            {/* One line on phones: links keep their width, the product name truncates. */}
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-slate-500 sm:gap-2 sm:text-sm">
              <Link href={localizedHref('/')} className="site-link-accent shrink-0">{t('common.home')}</Link>
              <span aria-hidden="true" className="shrink-0 text-slate-300">/</span>
              <Link href={localizedHref('/products')} className="site-link-accent shrink-0">{t('nav.products')}</Link>
              <span aria-hidden="true" className="shrink-0 text-slate-300">/</span>
              {product.category && (
                <>
                  {categoryHref ? (
                    <Link href={localizedHref(categoryHref)} className="site-link-accent max-w-[40vw] shrink-0 truncate sm:max-w-none">
                      {product.category.name}
                    </Link>
                  ) : (
                    <span className="max-w-[40vw] shrink-0 truncate sm:max-w-none">{product.category.name}</span>
                  )}
                  <span aria-hidden="true" className="shrink-0 text-slate-300">/</span>
                </>
              )}
              <span aria-current="page" className="min-w-0 truncate font-medium text-slate-900">{product.sku || product.name}</span>
            </nav>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-x-8 lg:items-start">
            {/* Product Images */}
            <ProductImageViewer
              images={images}
              productName={product.name}
              selectedImageIndex={selectedImageIndex}
              onImageChange={handleImageIndexChange}
				  fallbackImage={getDefaultProductImageWithSku(product.sku, '/images/default-product.svg')}
              productSku={product.sku}
              categoryName={categoryName}
            />

            {/* Product Info */}
            <div className="site-detail-panel mt-4 px-4 py-5 sm:mt-8 sm:px-6 sm:py-6 lg:mt-0">
              <div className="mb-2.5 inline-flex max-w-full items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#0b3e75] sm:mb-3 sm:px-3 sm:py-1 sm:text-xs">
                <span className="truncate">{categoryName}</span>
              </div>
              <h1 className="break-words text-xl font-bold leading-snug tracking-tight text-slate-950 sm:text-2xl lg:text-3xl">{computedHeading}</h1>

              <div className="mt-3">
                <h2 className="sr-only">{t('product.information')}</h2>
                {canPurchase ? (
                  <p className="text-2xl font-bold tracking-tight text-[#0b3e75] sm:text-3xl">{formatCurrency(product.price)}</p>
                ) : (
                  <div>
                    <p className="text-xl font-bold text-[#0b3e75]">{t('product.contactForQuote')}</p>
                    <p className="mt-1 text-sm text-slate-600">{t('product.quotePriceHint')}</p>
                  </div>
                )}
              </div>

              {/* SKU */}
              <div className="mt-4 space-y-1">
                <p className="text-sm text-slate-500">SKU: <span className="font-semibold text-slate-900">{product.sku}</span></p>
                {product.sku && (
                  <p className="text-xs text-slate-500">{t('product.alternate')}: <span className="font-mono">{String(product.sku).replace(/-/g, '')}</span></p>
                )}
              </div>

              {/* Actions: stacked full-width on phones, PayPal first. */}
              <div className="mt-5 grid grid-cols-1 gap-2.5 sm:mt-6 sm:flex sm:flex-wrap sm:gap-3">
                {canPurchase && (
                  <button
                    type="button"
                    onClick={handleBuyNow}
                    aria-label={t('product.payWithPayPal')}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#FFC439] px-5 py-3 text-sm font-bold text-[#003087] shadow-sm transition-colors hover:bg-[#F2BA36] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003087] focus-visible:ring-offset-2 sm:w-auto"
                  >
                    <FaPaypal className="h-5 w-5" aria-hidden="true" />
                    <span>{t('product.payWithPayPal')}</span>
                  </button>
                )}
                {canPurchase && (
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="site-primary-action w-full justify-center px-5 py-3 text-sm sm:w-auto"
                  >
                    <ShoppingCartIcon className="h-5 w-5 mr-2" />
                    {t('common.addToCart')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleWhatsAppInquiry}
                  className="inline-flex w-full items-center justify-center rounded-md border border-green-600 bg-green-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 sm:w-auto"
                >
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  {t('product.whatsApp')}
                </button>
                {!canPurchase && (
                  <a
                    href={quoteEmailHref}
                    className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 sm:w-auto"
                  >
                    <EnvelopeIcon className="mr-2 h-5 w-5" />
                    {t('product.emailForQuote')}
                  </a>
                )}
              </div>

              {/* Key specs */}
              <div className="site-subtle-card mt-5 grid grid-cols-2 gap-x-3 gap-y-3 p-3.5 sm:mt-6 sm:p-4">
                <div className="text-sm">
                  <div className="text-xs text-slate-500">{t('product.brand')}</div>
                  <div className="font-semibold text-slate-900">{brandName || '-'}</div>
                </div>
                <div className="text-sm">
                  <div className="text-xs text-slate-500">{t('product.partNumber')}</div>
                  <div className="break-words font-mono text-[13px] text-slate-900 sm:text-sm">{product.part_number || product.model || product.sku}</div>
                </div>
                <div className="text-sm">
                  <div className="text-xs text-slate-500">{t('product.warranty')}</div>
                  <div className="font-semibold text-slate-900">{shownWarranty}</div>
                </div>
                <div className="text-sm">
                  <div className="text-xs text-slate-500">{t('product.leadTime')}</div>
                  <div className="font-semibold text-slate-900">{shownLeadTime}</div>
                </div>
              </div>

              {/* Shipping Calculator */}
              {shippingCountries.length > 0 && (
                <div className="mt-5 rounded-lg border border-slate-200 bg-white p-3.5 sm:mt-6 sm:p-4">
                  <h3 className="text-sm font-semibold text-slate-950 flex items-center mb-3">
                    <TruckIcon className="h-4 w-4 mr-2 text-[#0b3e75]" />
                    {t('product.worldwideShipping')}
                  </h3>
                  <div className="relative" ref={countryDropdownRef}>
                    <div className="relative">
                      <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                      <input
                        ref={countryInputRef}
                        type="text"
                        placeholder={t('product.searchCountry')}
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
                        className="site-input w-full py-2 pl-9 pr-8 text-sm"
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
                          <li className="px-3 py-2 text-sm text-slate-500">{t('product.noCountries')}</li>
                        ) : (
                          filteredCountries.map((c) => (
                            <li
                              key={c.country_code}
                              onClick={() => selectCountry(c.country_code, c.country_name)}
                              className={`cursor-pointer px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between ${
                                shippingCountry === c.country_code ? 'bg-blue-50 text-[#0b3e75] font-medium' : 'text-slate-900'
                              }`}
                            >
                              <span>{c.country_name}</span>
                              {freeShippingCodes.has(c.country_code) && (
                                <span className="text-xs text-green-600 font-medium">{t('product.free')}</span>
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
                        <div className="flex items-center text-sm text-slate-500">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-700 mr-2" />
                          {t('contact.loading')}
                        </div>
                      ) : shippingError ? (
                        <p className="text-sm text-red-600">{shippingError}</p>
                      ) : freeShippingCodes.has(shippingCountry) ? (
                        <div className="inline-flex items-center rounded-md bg-green-50 px-2.5 py-1 text-sm font-semibold text-green-700">
                          <CheckIcon className="h-4 w-4 mr-1" />
                          <TruckIcon className="h-4 w-4 mr-1" />
                          {t('product.free')}
                        </div>
                      ) : shippingQuote ? (
                        <div className="flex items-baseline gap-2 text-sm text-slate-900">
                          <span className="text-base font-semibold">
                            {shippingQuote.currency === 'USD' ? '$' : shippingQuote.currency + ' '}
                            {shippingQuote.shipping_fee.toFixed(2)}
                          </span>
                          <span className="text-slate-500">
                            · {shippingQuote.billing_weight_kg ?? shippingQuote.weight_kg} kg
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {/* Stock & Availability */}
              <div className="mt-5 space-y-2.5 rounded-lg border border-slate-200 bg-white p-3.5 sm:mt-6 sm:space-y-3 sm:p-4">
                <div className="flex flex-wrap items-center text-sm">
                  {product.stock_quantity && product.stock_quantity > 0 ? (
                    <>
                      <CheckIcon className="h-4 w-4 text-green-600 mr-2 flex-shrink-0" />
                      <span className="text-green-700 font-medium">{t('product.inStock')}</span>
                      <span className="text-slate-500 ml-1">- {t('product.readyToShip')}</span>
                    </>
                  ) : (
                    <>
                      <ClockIcon className="h-4 w-4 text-[#c46a2d] mr-2 flex-shrink-0" />
                      <span className="font-medium text-[#8a421d]">{t('product.availableToOrder')}</span>
                      <span className="text-slate-500 ml-1">- {shownLeadTime} lead time</span>
                    </>
                  )}
                </div>
                <div className="flex items-center text-sm text-slate-600">
                  <TruckIcon className="h-4 w-4 mr-2 flex-shrink-0" />
                  {t('product.worldwideShipping')}
                </div>
              </div>

              {/* Trust Badges */}
              <div className="mt-5 grid grid-cols-3 gap-2 sm:mt-6 sm:gap-3">
                <div className="site-subtle-card flex flex-col items-center p-2 text-center sm:p-3">
                  <ShieldCheckIcon className="mb-1 h-5 w-5 text-[#0b3e75] sm:h-6 sm:w-6" />
                  <span className="text-[11px] font-medium leading-tight text-slate-700 sm:text-xs">{shownWarranty} Warranty</span>
                </div>
                <div className="site-subtle-card flex flex-col items-center p-2 text-center sm:p-3">
                  <GlobeAltIcon className="mb-1 h-5 w-5 text-[#0b3e75] sm:h-6 sm:w-6" />
                  <span className="text-[11px] font-medium leading-tight text-slate-700 sm:text-xs">{t('product.worldwideShipping')}</span>
                </div>
                <div className="site-subtle-card flex flex-col items-center p-2 text-center sm:p-3">
                  <CheckIcon className="mb-1 h-5 w-5 text-[#0b3e75] sm:h-6 sm:w-6" />
                  <span className="text-[11px] font-medium leading-tight text-slate-700 sm:text-xs">{t('product.qualityTested')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Product Description — full width below the grid */}
          <div className="mt-6 space-y-6 sm:mt-12 sm:space-y-8">
            {/* Main Description */}
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.description')}</h2>
              <div className="site-detail-panel p-4 sm:p-6">
                <div className="product-description max-w-none whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-700 sm:text-base">
                  {descriptionToShow}
                </div>
              </div>
            </section>

            {/* Part details + any specification rows they don't already cover */}
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.specifications')}</h2>
              <div className="site-detail-panel product-specs p-6">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:gap-4">
                  <div>
                    <dt className="text-xs text-slate-500 sm:text-sm">SKU</dt>
                    <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950 sm:mt-1">{product.sku}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 sm:text-sm">{t('product.brand')}</dt>
                    <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950 sm:mt-1">{brandName || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 sm:text-sm">{t('product.partNumber')}</dt>
                    <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950 sm:mt-1">{product.part_number || product.sku}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 sm:text-sm">{t('product.category')}</dt>
                    <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950 sm:mt-1">{categoryName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 sm:text-sm">{t('product.condition')}</dt>
                    <dd className="mt-0.5 break-words text-sm font-semibold capitalize text-slate-950 sm:mt-1">{product.condition_type || 'new'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 sm:text-sm">{t('product.warranty')}</dt>
                    <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950 sm:mt-1">{shownWarranty}</dd>
                  </div>
                  {product.origin_country && (
                    <div>
                      <dt className="text-xs text-slate-500 sm:text-sm">{t('product.origin')}</dt>
                      <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950 sm:mt-1">{product.origin_country}</dd>
                    </div>
                  )}
                  {product.certifications && (
                    <div>
                      <dt className="text-xs text-slate-500 sm:text-sm">{t('product.certifications')}</dt>
                      <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950 sm:mt-1">{product.certifications}</dd>
                    </div>
                  )}
                  {extraSpecs.map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs text-slate-500 sm:text-sm">{key}</dt>
                      <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950 sm:mt-1">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>

            {/* Only operator-written guidance; generated template text is hidden. */}
            {compatibilityText && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.compatibility')}</h2>
                <div className="site-detail-panel p-4 sm:p-6">
                  <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-700 sm:text-base">{compatibilityText}</p>
                </div>
              </section>
            )}

            {installationText && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.installation')}</h2>
                <div className="site-detail-panel p-4 sm:p-6">
                  <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-700 sm:text-base">{installationText}</p>
                </div>
              </section>
            )}

            {maintenanceText && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.maintenance')}</h2>
                <div className="site-detail-panel p-4 sm:p-6">
                  <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-700 sm:text-base">{maintenanceText}</p>
                </div>
              </section>
            )}

            {resourceLinks.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.downloads')}</h2>
                <div className="site-detail-panel p-4 sm:p-6">
                  <div className="flex flex-wrap gap-3">
                    {resourceLinks.map((resource) => (
                      <a
                        key={resource.label}
                        href={resource.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="site-secondary-action px-4 py-2 text-sm"
                      >
                        {resource.label}
                      </a>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Product FAQ */}
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.faq')}</h2>
              <div className="site-detail-panel divide-y divide-slate-200">
                {activeFaqs.map((faq) => (
                  <FAQAccordionItem key={faq.id || faq.question} question={faq.question} answer={faq.answer} />
                ))}
              </div>
            </section>

            {/* Customer Reviews */}
            {product.reviews && product.reviews.filter((r: ProductReview) => r.is_approved).length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.reviews')}</h2>
                <div className="space-y-4">
                  {product.reviews.filter((r: ProductReview) => r.is_approved).map((review: ProductReview) => (
                    <div key={review.id} className="site-detail-panel p-4 sm:p-6">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-950">{review.customer_name}</span>
                          {review.is_verified && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              <CheckIcon className="h-3 w-3 mr-0.5" />
                              Verified
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-500">{new Date(review.created_at).toLocaleDateString(locale === 'zh' ? 'zh-CN' : locale)}</span>
                      </div>
                      <div className="flex items-center mb-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          star <= review.rating
                            ? <StarIconSolid key={star} className="h-4 w-4 text-[#c46a2d]" />
                            : <StarIcon key={star} className="h-4 w-4 text-slate-300" />
                        ))}
                      </div>
                      {review.review_title && (
                        <h3 className="font-semibold text-slate-950 mb-1">{review.review_title}</h3>
                      )}
                      <p className="text-sm text-slate-700">{review.review_content}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.explore')}</h2>
              <div className="site-detail-panel p-4 sm:p-6 flex flex-wrap gap-2 text-[13px] sm:gap-3 sm:text-sm">
                <Link
                  href={localizedHref('/products')}
                  className="site-secondary-action px-3 py-1.5 sm:px-4 sm:py-2"
                >
                  {t('product.browseAll')}
                </Link>
                {categoryHref && (
                  <Link
                    href={localizedHref(categoryHref)}
                    className="site-secondary-action px-3 py-1.5 sm:px-4 sm:py-2"
                  >
                    {t('product.moreCategory', { category: categoryName })}
                  </Link>
                )}
                {product.brand && (
                  <Link
                    href={localizedHref(`/products?brand=${encodeURIComponent(product.brand)}`)}
                    className="site-secondary-action px-3 py-1.5 sm:px-4 sm:py-2"
                  >
                    {t('product.moreBrand', { brand: product.brand })}
                  </Link>
                )}
                <Link href={localizedHref('/repair-request')} className="site-secondary-action px-3 py-1.5 sm:px-4 sm:py-2">
                  {t('nav.repair')}
                </Link>
                <Link href={localizedHref('/blog')} className="site-secondary-action px-3 py-1.5 sm:px-4 sm:py-2">
                  {t('nav.blog')}
                </Link>
              </div>
            </section>
          </div>

          {/* Related Products */}
          {relatedProducts?.data?.length > 0 && (
            <div className="mt-8 sm:mt-12">
              <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.related')}</h2>
              <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
                {relatedProducts.data.map((relatedProduct) => (
                  <div key={relatedProduct.id} className="site-product-card min-w-0 p-3 sm:p-4">
                    <div className="site-product-media aspect-[4/3] w-full overflow-hidden rounded-md">
                      <Image
                        src={getProductImageUrl(
                          (relatedProduct.image_urls && relatedProduct.image_urls.length > 0) ? relatedProduct.image_urls : (relatedProduct.images || []),
                          getDefaultProductImageWithSku(relatedProduct.sku)
                        )}
                        alt={relatedProduct.name}
                        width={200}
                        height={200}
                        className="h-full w-full object-contain object-center p-2"
                      />
                    </div>
                    <div className="mt-2">
                      <Link
                        href={hasTranslationForLocale(relatedProduct.translations, locale)
                          ? localizedHref(`/products/${toProductPathId(relatedProduct.sku)}`)
                          : `/products/${toProductPathId(relatedProduct.sku)}`}
                        className="site-product-title line-clamp-2 break-words text-[13px] font-semibold sm:text-sm"
                      >
                        {relatedProduct.name}
                      </Link>
                      <p className="truncate text-xs text-slate-500 sm:text-sm">SKU: {relatedProduct.sku}</p>
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
