import { create } from 'zustand';
import { getDefaultProductImageWithSku, getProductImageUrl, hasProductPrice, toProductPathId } from '@/lib/utils';

export interface QuoteProductContext {
  sku: string;
  name: string;
  brand?: string;
  price?: number;
  quantity?: number;
  imageUrl?: string;
  productUrl?: string;
}

interface QuoteModalState {
  isOpen: boolean;
  product: QuoteProductContext | null;
}

interface QuoteModalActions {
  openQuoteModal: (product?: QuoteProductContext | null) => void;
  closeQuoteModal: () => void;
}

export const useQuoteModalStore = create<QuoteModalState & QuoteModalActions>()((set) => ({
  isOpen: false,
  product: null,
  openQuoteModal: (product = null) => set({ isOpen: true, product }),
  closeQuoteModal: () => set({ isOpen: false }),
}));

export function buildQuoteProductContext(
  product: {
    sku?: string | null;
    part_number?: string | null;
    model?: string | null;
    name?: string | null;
    brand?: string | null;
    price?: number | null;
    image_urls?: string[] | null;
    images?: unknown[] | null;
  },
  overrides?: Partial<QuoteProductContext>
): QuoteProductContext {
  const sku = String(overrides?.sku ?? product.sku ?? product.part_number ?? product.model ?? '').trim();
  const name = String(overrides?.name ?? product.name ?? sku).trim();
  const rawImages =
    product.image_urls && product.image_urls.length > 0
      ? product.image_urls
      : product.images || [];
  const imageUrl =
    overrides?.imageUrl ??
    getProductImageUrl(
      rawImages as Parameters<typeof getProductImageUrl>[0],
      getDefaultProductImageWithSku(sku, '/images/default-product.svg')
    );
  const productUrl =
    overrides?.productUrl ??
    (sku ? `/products/${toProductPathId(sku)}` : undefined);

  return {
    sku,
    name,
    brand: (overrides?.brand ?? product.brand ?? '').trim() || undefined,
    price: overrides?.price !== undefined ? overrides.price : hasProductPrice(product) ? Number(product.price) : undefined,
    quantity: overrides?.quantity && overrides.quantity > 0 ? overrides.quantity : 1,
    imageUrl,
    productUrl,
  };
}
