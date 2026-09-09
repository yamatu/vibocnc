import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product, CartItem } from '@/types';

function notifySuccess(message: string) {
  void import('react-hot-toast').then(({ toast }) => toast.success(message));
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  total: number;
  itemCount: number;
}

interface CartActions {
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  clearCart: () => void;
  toggleCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  calculateTotal: () => void;
  getItemQuantity: (productId: number) => number;
  isInCart: (productId: number) => boolean;
}

export const useCartStore = create<CartState & CartActions>()(
  persist(
    (set, get) => ({
      // State
      items: [],
      isOpen: false,
      total: 0,
      itemCount: 0,

      // Actions
      addItem: (product, quantity = 1) => {
        if (!product || Number(product.price) <= 0) {
          void import('react-hot-toast').then(({ toast }) => toast.error('Please contact us for a quote before ordering this product.'));
          return;
        }
        const { items } = get();
        const existingItem = items.find(item => item.product.id === product.id);

        if (existingItem) {
          // Update quantity if item already exists
          const newQuantity = existingItem.quantity + quantity;
          set(state => ({
            items: state.items.map(item =>
              item.product.id === product.id
                ? { ...item, quantity: newQuantity }
                : item
            )
          }));
          notifySuccess(`Updated ${product.name} quantity in cart`);
        } else {
          // Add new item
          set(state => ({
            items: [...state.items, { product, quantity }]
          }));
          notifySuccess(`Added ${product.name} to cart`);
        }

        get().calculateTotal();
      },

      removeItem: (productId) => {
        const { items } = get();
        const item = items.find(item => item.product.id === productId);
        
        set(state => ({
          items: state.items.filter(item => item.product.id !== productId)
        }));

        if (item) {
          notifySuccess(`Removed ${item.product.name} from cart`);
        }

        get().calculateTotal();
      },

      updateQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(productId);
          return;
        }

        set(state => ({
          items: state.items.map(item =>
            item.product.id === productId
              ? { ...item, quantity }
              : item
          )
        }));

        get().calculateTotal();
      },

      clearCart: () => {
        set({ 
          items: [], 
          total: 0, 
          itemCount: 0 
        });
      },

      toggleCart: () => {
        set(state => ({ isOpen: !state.isOpen }));
      },

      openCart: () => {
        set({ isOpen: true });
      },

      closeCart: () => {
        set({ isOpen: false });
      },

      calculateTotal: () => {
        const { items } = get();
        const total = items.reduce((sum, item) => {
          return sum + (item.product.price * item.quantity);
        }, 0);
        const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

        set({ total, itemCount });
      },

      getItemQuantity: (productId) => {
        const { items } = get();
        const item = items.find(item => item.product.id === productId);
        return item ? item.quantity : 0;
      },

      isInCart: (productId) => {
        const { items } = get();
        return items.some(item => item.product.id === productId);
      },
    }),
    {
      name: 'cart-storage',
      partialize: (state) => ({ 
        items: state.items,
        total: state.total,
        itemCount: state.itemCount
      }),
      onRehydrateStorage: () => (state) => {
        // Recalculate total after rehydration
        if (state) {
          state.calculateTotal();
        }
      },
    }
  )
);

// Selectors
export const useCart = () => {
  const store = useCartStore();
  return {
    items: store.items,
    isOpen: store.isOpen,
    total: store.total,
    itemCount: store.itemCount,
    addItem: store.addItem,
    removeItem: store.removeItem,
    updateQuantity: store.updateQuantity,
    clearCart: store.clearCart,
    toggleCart: store.toggleCart,
    openCart: store.openCart,
    closeCart: store.closeCart,
    getItemQuantity: store.getItemQuantity,
    isInCart: store.isInCart,
  };
};

// Helper hooks
export const useCartItems = () => useCartStore((state) => state.items);
export const useCartTotal = () => useCartStore((state) => state.total);
export const useCartItemCount = () => useCartStore((state) => state.itemCount);
export const useCartOpen = () => useCartStore((state) => state.isOpen);
