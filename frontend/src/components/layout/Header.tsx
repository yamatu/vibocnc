'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Bars3Icon,
  XMarkIcon,
  ShoppingCartIcon,
  MagnifyingGlassIcon,
  PhoneIcon,
  EnvelopeIcon,
  UserCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';
import { useCart } from '@/store/cart.store';
import { useCustomer } from '@/store/customer.store';
import { cn, formatCurrency, getProductImageUrl, getDefaultProductImageWithSku, toProductPathId } from '@/lib/utils';
import { CartSidebar } from '@/components/cart/CartSidebar';
import { Category } from '@/types';
import { CategoryService, ProductService } from '@/services';
import { queryKeys } from '@/lib/react-query';

const navigation = [
  { name: 'Home', href: '/' },
  { name: 'Products', href: '/products' },
  { name: 'Categories', href: '/categories' },
  { name: 'News', href: '/news' },
  { name: 'About', href: '/about' },
  { name: 'Contact', href: '/contact' },
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const mobileSearchDropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { itemCount, toggleCart } = useCart();
  const { isAuthenticated, customer, logout } = useCustomer();

  const handleLogout = () => {
    logout();
    setUserMenuOpen(false);
    router.push('/');
  };

  const fetchSuggestions = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setSuggestionsLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await ProductService.searchProducts(query.trim(), { page_size: 3 });
        setSuggestions(res.data || []);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    fetchSuggestions(value);
  };

  // Close desktop search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchOpen(false);
      setSearchQuery('');
      setSuggestions([]);
      setMobileMenuOpen(false);
    }
  };

  const handleSuggestionClick = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSuggestions([]);
    setMobileMenuOpen(false);
  };

  const renderSuggestions = () => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return null;
    return (
      <div className="border-t border-gray-100 mt-2 pt-2">
        {suggestionsLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-700" />
          </div>
        ) : suggestions.length > 0 ? (
          <div className="space-y-1">
            {suggestions.map((p: any) => {
              const imgSrc = getProductImageUrl(
                (p.image_urls && p.image_urls.length > 0) ? p.image_urls : (p.images || []),
                getDefaultProductImageWithSku(p.sku)
              );
              return (
                <Link
                  key={p.id}
                  href={`/products/${toProductPathId(p.sku)}`}
                  onClick={handleSuggestionClick}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <div className="h-12 w-12 flex-shrink-0 rounded-md bg-gray-100 overflow-hidden">
                    <Image
                      src={imgSrc}
                      alt={p.name}
                      width={48}
                      height={48}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-500">SKU: {p.sku}</p>
                  </div>
                  <div className="text-sm font-semibold text-[#0b3e75] whitespace-nowrap">
                    {formatCurrency(p.price)}
                  </div>
                </Link>
              );
            })}
            <Link
              href={`/products?search=${encodeURIComponent(searchQuery.trim())}`}
              onClick={handleSuggestionClick}
              className="site-link-accent block text-center text-sm py-2"
            >
              View all results
            </Link>
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-3">No products found</p>
        )}
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
      {/* Top Bar */}
      <div className="bg-slate-950 text-slate-100 py-2">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="flex items-center space-x-2">
                <PhoneIcon className="h-4 w-4 text-orange-300" />
                <span suppressHydrationWarning>+86 13348028050</span>

              </div>
              <div className="hidden sm:flex items-center space-x-2">
                <EnvelopeIcon className="h-4 w-4 text-orange-300" />
                <span suppressHydrationWarning>sales@vibocnc.com</span>

              </div>
            </div>
            <div className="hidden md:flex items-center space-x-4">
              <span suppressHydrationWarning>Industrial automation parts supply | VIBO CNC Since 2005</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-3">
              <div className="bg-white px-4 py-2 rounded-md text-lg font-black tracking-wide ring-2 ring-orange-400/30">
                <span className="text-[#003a78]">Vibo</span><span className="text-orange-500">cnc</span>
              </div>
              <div className="hidden sm:block">
                <div className="text-xl font-bold text-slate-950">CNC Parts Hub</div>
                <div className="text-sm text-slate-500">Automation Supply</div>
              </div>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center space-x-8">
            {navigation.map((item) => {
              if (item.name === 'Categories') {
                return (
                  <CategoriesDropdown key={item.name} />
                );
              }
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className="text-sm font-semibold uppercase tracking-wide text-slate-700 transition-colors duration-200 hover:text-orange-600"
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Right Side Actions */}
          <div className="flex items-center space-x-4">
            {/* Search */}
            <div className="relative" ref={searchDropdownRef}>
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className="p-2 text-slate-600 hover:text-orange-600 transition-colors"
              >
                <MagnifyingGlassIcon className="h-6 w-6" />
              </button>

              {searchOpen && (
                <div className="absolute right-0 top-full mt-2 w-96 bg-white border border-slate-200 rounded-lg shadow-xl p-4 z-50">
                  <form onSubmit={handleSearch}>
                    <div className="flex">
                      <input
                        type="text"
                        placeholder="Search products..."
                        value={searchQuery}
                        onChange={(e) => handleSearchInput(e.target.value)}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-[#003a78]"
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 bg-[#003a78] text-white rounded-r-md hover:bg-orange-600 transition-colors font-semibold"
                      >
                        Search
                      </button>
                    </div>
                  </form>
                  {renderSuggestions()}
                </div>
              )}
            </div>

            {/* Cart */}
            <button
              onClick={toggleCart}
              className="relative p-2 text-slate-600 hover:text-orange-600 transition-colors"
            >
              <ShoppingCartIcon className="h-6 w-6" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-semibold">
                  {itemCount}
                </span>
              )}
            </button>

            {/* User Menu */}
            {isAuthenticated && customer ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center space-x-2 p-2 text-slate-600 hover:text-orange-600 transition-colors"
                >
                  <UserCircleIcon className="h-6 w-6" />
                  <span className="hidden md:inline text-sm font-medium">{customer.full_name}</span>
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                    <Link
                      href="/account"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      My Account
                    </Link>
                    <Link
                      href="/account/orders"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      My Orders
                    </Link>
                    <Link
                      href="/account/tickets"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Support Tickets
                    </Link>
                    <Link
                      href="/track-order"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Track Order
                    </Link>
                    <hr className="my-1" />
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden md:flex items-center space-x-2">
                <Link
                  href="/login"
                  className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-orange-600 transition-colors"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="px-3 py-2 text-sm font-semibold text-white bg-[#003a78] rounded-md hover:bg-orange-600 transition-colors"
                >
                  Register
                </Link>
                <Link
                  href="/track-order"
                  className="px-3 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                >
                  Track Order
                </Link>
              </div>
            )}

            {/* Mobile menu button */}
            <button
              type="button"
              className="lg:hidden p-2 text-slate-600 hover:text-orange-600"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <XMarkIcon className="h-6 w-6" />
              ) : (
                <Bars3Icon className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-200 bg-white">
          <div className="px-4 py-4 space-y-4">
            {navigation.map((item) => {
              if (item.name === 'Categories') {
                return <MobileCategoriesMenu key={item.name} onNavigate={() => setMobileMenuOpen(false)} />;
              }
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className="block text-slate-700 hover:text-orange-600 font-medium py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.name}
                </Link>
              );
            })}

            {/* Mobile Search */}
            <div className="pt-4 border-t border-gray-200" ref={mobileSearchDropdownRef}>
              <form onSubmit={handleSearch} className="flex">
                <input
                  type="text"
                  placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-[#003a78]"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#003a78] text-white rounded-r-md hover:bg-orange-600 transition-colors font-semibold"
                >
                  Search
                </button>
              </form>
              {renderSuggestions()}
            </div>

            {/* Mobile Track Order */}
            <div className="pt-4 border-t border-gray-200">
              <Link
                href="/track-order"
                className="block w-full text-center px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                onClick={() => setMobileMenuOpen(false)}
              >
                Track Order
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Search Overlay for mobile */}
      {searchOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSearchOpen(false)}
        />
      )}

      {/* Cart Sidebar */}
      <CartSidebar />
    </header>
  );
}

export default Header;

// --- Categories Dropdown (desktop) ---
function CategoriesDropdown() {
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: queryKeys.categories.tree(),
    queryFn: () => CategoryService.getCategories(),
  });

  const [hoverPath, setHoverPath] = useState<number[]>([]);

  const byId = useMemo(() => {
    const m = new Map<number, Category>();
    const walk = (nodes: Category[]) => {
      for (const n of nodes) {
        m.set(n.id, n);
        if (Array.isArray(n.children) && n.children.length > 0) walk(n.children);
      }
    };
    walk(categories);
    return m;
  }, [categories]);

  const columns = useMemo(() => {
    const out: Category[][] = [];
    if (Array.isArray(categories) && categories.length > 0) out.push(categories);
    for (const id of hoverPath) {
      const node = byId.get(id);
      if (!node || !Array.isArray(node.children) || node.children.length === 0) break;
      out.push(node.children);
    }
    return out;
  }, [categories, byId, hoverPath]);

  const setHoverAtLevel = (level: number, id: number) => {
    setHoverPath((prev) => [...prev.slice(0, level), id]);
  };

  return (
    <div className="relative group">
      <Link
        href="/categories"
        className="text-sm font-semibold uppercase tracking-wide text-slate-700 hover:text-orange-600 transition-colors duration-200 py-2 px-1 block"
      >
        Categories
      </Link>
      {/* Invisible bridge to prevent hover gap */}
      <div className="absolute top-full left-0 w-full h-2 bg-transparent"></div>
      {/* Dropdown Panel */}
      {Array.isArray(categories) && categories.length > 0 && (
        <div
          className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-200 ease-in-out transform group-hover:translate-y-0 translate-y-1 absolute left-0 top-full mt-1 w-[720px] max-h-[80vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl z-50 p-4 backdrop-blur-sm"
          onMouseLeave={() => setHoverPath([])}
        >
          <div className="mb-3 pb-2 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Product Categories</h3>
          </div>
          <div className="flex gap-3">
            {columns.map((col, level) => (
              <div key={level} className="min-w-[220px]">
                <ul className="space-y-0.5">
                  {col.map((cat) => {
                    const hasChildren = Array.isArray(cat.children) && cat.children.length > 0;
                    const isActive = hoverPath[level] === cat.id;
                    return (
                      <li key={cat.id}>
                        <Link
                          href={`/categories/${cat.path || cat.slug}`}
                          onMouseEnter={() => setHoverAtLevel(level, cat.id)}
                          scroll={false}
                          className={cn(
                            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            isActive ? 'bg-blue-50 text-[#003a78]' : 'text-slate-800 hover:bg-slate-50 hover:text-orange-600'
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                          {hasChildren ? <ChevronRightIcon className="h-4 w-4 text-gray-400" /> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileCategoriesMenu({ onNavigate }: { onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: queryKeys.categories.tree(),
    queryFn: () => CategoryService.getCategories(),
  });

  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const toggle = (id: number) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center justify-between text-slate-700 hover:text-orange-600 font-medium py-2"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Categories</span>
        <span className="text-slate-400">{open ? '-' : '+'}</span>
      </button>
      {open && Array.isArray(categories) && categories.length > 0 && (
        <div className="mt-2 pl-2 border-l border-slate-200 space-y-1">
          <MobileCategoryTree categories={categories} level={0} onNavigate={onNavigate} openIds={openIds} onToggle={toggle} />
        </div>
      )}
    </div>
  );
}

function MobileCategoryTree({
  categories,
  level,
  onNavigate,
  openIds,
  onToggle,
}: {
  categories: Category[];
  level: number;
  onNavigate: () => void;
  openIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="space-y-1">
      {categories.map((cat) => (
        <div key={cat.id}>
          <div className="flex items-center gap-2 py-1" style={{ paddingLeft: level * 12 }}>
            {Array.isArray(cat.children) && cat.children.length > 0 ? (
              <button
                type="button"
                onClick={() => onToggle(cat.id)}
                className="p-0.5 rounded hover:bg-gray-100 text-gray-500"
                aria-label={openIds.has(cat.id) ? 'Collapse' : 'Expand'}
              >
                {openIds.has(cat.id) ? (
                  <ChevronDownIcon className="h-4 w-4" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4" />
                )}
              </button>
            ) : (
              <span className="w-5" />
            )}

            <Link
              href={`/categories/${cat.path || cat.slug}`}
              className="block text-sm text-slate-700 hover:text-orange-600 py-0.5"
              onClick={onNavigate}
              scroll={false}
            >
              {cat.name}
            </Link>
          </div>

          {Array.isArray(cat.children) && cat.children.length > 0 && openIds.has(cat.id) && (
            <MobileCategoryTree
              categories={cat.children}
              level={level + 1}
              onNavigate={onNavigate}
              openIds={openIds}
              onToggle={onToggle}
            />
          )}
        </div>
      ))}
    </div>
  );
}
