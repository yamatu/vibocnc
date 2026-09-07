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
import { cn, formatCurrency, hasProductPrice, getProductImageUrl, getDefaultProductImageWithSku, toProductPathId } from '@/lib/utils';
import type { Category, Product } from '@/types';
import { CategoryService, ProductService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import LanguageSelector from './LanguageSelector';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { localizeCategoryContent, localizeProductContent } from '@/lib/i18n/content';

const navigation = [
  { key: 'nav.home', href: '/' },
  { key: 'nav.products', href: '/products' },
  { key: 'nav.categories', href: '/categories' },
  { key: 'nav.repair', href: '/repair-request' },
  { key: 'nav.news', href: '/news' },
  { key: 'nav.blog', href: '/blog' },
  { key: 'nav.about', href: '/about' },
  { key: 'nav.contact', href: '/contact' },
];

export function Header() {
  const { locale, t, href } = usePublicI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Product[]>([]);
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
    router.push(href('/'));
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
        setSuggestions((res.data || []).map((product) => localizeProductContent(product, locale)));
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);
  }, [locale]);

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
      router.push(href(`/products?search=${encodeURIComponent(searchQuery.trim())}`));
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
            {suggestions.map((p) => {
              const imgSrc = getProductImageUrl(
                (p.image_urls && p.image_urls.length > 0) ? p.image_urls : (p.images || []),
                getDefaultProductImageWithSku(p.sku)
              );
              return (
                <Link
                  key={p.id}
              href={href(`/products/${toProductPathId(p.sku)}`)}
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
                  <div className="max-w-28 shrink-0 text-right text-sm font-semibold text-[#0b3e75]">
                    {hasProductPrice(p) ? formatCurrency(p.price) : t('products.contactForQuote')}
                  </div>
                </Link>
              );
            })}
            <Link
              href={href(`/products?search=${encodeURIComponent(searchQuery.trim())}`)}
              onClick={handleSuggestionClick}
              className="site-link-accent block text-center text-sm py-2"
            >
              {t('header.viewResults')}
            </Link>
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-3">{t('header.noProducts')}</p>
        )}
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
      {/* Top Bar */}
      <div className="bg-slate-950 text-slate-100 py-2">
        <div className="max-w-7xl mx-auto px-2.5 min-[360px]:px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center text-xs sm:text-sm">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5 min-[360px]:gap-2.5 sm:justify-start sm:gap-6">
              <a href="tel:+8613348028050" className="flex min-w-0 items-center gap-1.5 hover:text-orange-200 sm:gap-2">
                <PhoneIcon className="h-3.5 w-3.5 shrink-0 text-orange-300 sm:h-4 sm:w-4" />
                <span className="whitespace-nowrap text-[10px] min-[360px]:text-xs sm:text-sm" suppressHydrationWarning>+86 13348028050</span>
              </a>
              <a href="mailto:sales@vibocnc.com" className="flex min-w-0 items-center gap-1.5 hover:text-orange-200 sm:gap-2">
                <EnvelopeIcon className="h-3.5 w-3.5 shrink-0 text-orange-300 sm:h-4 sm:w-4" />
                <span className="whitespace-nowrap text-[10px] min-[360px]:text-xs sm:text-sm" suppressHydrationWarning>sales@vibocnc.com</span>
              </a>
            </div>
            <div className="hidden min-w-0 items-center gap-3 md:flex">
              <span className="hidden max-w-[38rem] truncate xl:block" suppressHydrationWarning>
                {t('header.supply')}
              </span>
              <LanguageSelector />
            </div>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <div className="mx-auto max-w-[90rem] px-2.5 min-[360px]:px-4 sm:px-6 lg:px-8 min-[1900px]:max-w-[112rem]">
        <div className="flex items-center justify-between gap-2 py-3 min-[360px]:gap-3 sm:gap-4 sm:py-4">
          {/* Logo */}
          <div className="flex flex-shrink-0 items-center">
            <Link href={href('/')} className="flex items-center space-x-3">
              {/* Keep the only high-priority image on the homepage reserved for the Hero LCP. */}
              <Image
                src="/images/vibocnc-logo.png"
                alt="Vibocnc"
                width={186}
                height={50}
                loading="eager"
                fetchPriority="low"
                className="h-8 w-auto object-contain min-[360px]:h-10 sm:h-12"
              />
              <div className="hidden min-[1900px]:block">
                <div className="text-xl font-bold text-slate-950">{t('header.hub')}</div>
                <div className="text-sm text-slate-500">{t('header.automationSupply')}</div>
              </div>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-2 xl:flex min-[1800px]:gap-6" aria-label={t('header.primaryNavigation')}>
            {navigation.map((item) => {
              if (item.key === 'nav.categories') {
                return (
                  <CategoriesDropdown key={item.key} />
                );
              }
              return (
                <Link
                  key={item.key}
                  href={href(item.href)}
                  className={cn(
                    'shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-wide transition-colors duration-200 min-[1800px]:text-sm',
                    item.key === 'nav.repair'
                      ? 'rounded-md bg-orange-700 px-3 py-2 text-white hover:bg-[#003a78]'
                      : 'text-slate-700 hover:text-orange-600',
                  )}
                >
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>

          {/* Right Side Actions */}
          <div className="flex flex-shrink-0 items-center gap-1 min-[360px]:gap-2 sm:gap-3 sm:pl-4 2xl:gap-4 2xl:pl-6">
            {/* Search */}
            <div className="relative hidden sm:block" ref={searchDropdownRef}>
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                aria-label={t('header.search')}
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
                        aria-label={t('header.searchProducts')}
                        placeholder={t('header.searchProducts')}
                        value={searchQuery}
                        onChange={(e) => handleSearchInput(e.target.value)}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-[#003a78]"
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 bg-[#003a78] text-white rounded-r-md hover:bg-orange-600 transition-colors font-semibold"
                      >
                        {t('header.search')}
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
              aria-label={t('header.cart')}
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
                  <span className="hidden whitespace-nowrap text-sm font-medium min-[1720px]:inline">{customer.full_name}</span>
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                    <Link
                      href="/account"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {t('header.myAccount')}
                    </Link>
                    <Link
                      href="/account/orders"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {t('header.myOrders')}
                    </Link>
                    <Link
                      href="/account/tickets"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {t('header.supportTickets')}
                    </Link>
                    <Link
                      href={href('/track-order')}
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {t('header.trackOrder')}
                    </Link>
                    <hr className="my-1" />
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                    >
                      {t('header.logout')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden items-center space-x-2 min-[1720px]:flex">
                <Link
                  href="/login"
                  className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-orange-600 transition-colors"
                >
                  {t('header.login')}
                </Link>
                <Link
                  href="/register"
                  className="px-3 py-2 text-sm font-semibold text-white bg-[#003a78] rounded-md hover:bg-orange-600 transition-colors"
                >
                  {t('header.register')}
                </Link>
                <Link
                  href={href('/track-order')}
                  className="px-3 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                >
                  {t('header.trackOrder')}
                </Link>
              </div>
            )}

            {/* Mobile menu button */}
            <button
              type="button"
              aria-label={mobileMenuOpen ? t('header.closeMenu') : t('header.openMenu')}
              aria-controls="responsive-navigation"
              aria-expanded={mobileMenuOpen}
              className="p-2 text-slate-600 hover:text-orange-600 min-[1720px]:hidden"
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
        <nav id="responsive-navigation" className="border-t border-slate-200 bg-white min-[1720px]:hidden" aria-label={t('header.mobileNavigation')}>
          <div className="px-4 py-4 space-y-4">
            {navigation.map((item) => {
              if (item.key === 'nav.categories') {
                return <MobileCategoriesMenu key={item.key} onNavigate={() => setMobileMenuOpen(false)} />;
              }
              return (
                <Link
                  key={item.key}
                  href={href(item.href)}
                  className="block text-slate-700 hover:text-orange-600 font-medium py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t(item.key)}
                </Link>
              );
            })}

            {/* Mobile Search */}
            <div className="pt-4 border-t border-gray-200" ref={mobileSearchDropdownRef}>
              <form onSubmit={handleSearch} className="flex">
                <input
                  type="text"
                  aria-label={t('header.searchProducts')}
                  placeholder={t('header.searchProducts')}
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-[#003a78]"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#003a78] text-white rounded-r-md hover:bg-orange-600 transition-colors font-semibold"
                >
                  {t('header.search')}
                </button>
              </form>
              {renderSuggestions()}
            </div>

            {/* Mobile Track Order */}
            <div className="pt-4 border-t border-gray-200">
              <Link
                href={href('/track-order')}
                className="block w-full text-center px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t('header.trackOrder')}
              </Link>
            </div>

            {!isAuthenticated && (
              <div className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-4">
                <Link
                  href="/login"
                  className="px-4 py-2 text-center text-sm font-medium text-slate-700 transition-colors hover:text-orange-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('header.login')}
                </Link>
                <Link
                  href="/register"
                  className="rounded-md bg-[#003a78] px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-orange-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('header.register')}
                </Link>
              </div>
            )}
          </div>
        </nav>
      )}

      {/* Search Overlay for mobile */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 xl:hidden"
          onClick={() => setSearchOpen(false)}
        />
      )}

    </header>
  );
}

export default Header;

// --- Categories Dropdown (desktop) ---
function CategoriesDropdown() {
  const { locale, t, href } = usePublicI18n();
  const [shouldLoad, setShouldLoad] = useState(false);
  const { data: fetchedCategories = [] } = useQuery<Category[]>({
    queryKey: queryKeys.categories.tree(),
    queryFn: () => CategoryService.getCategories(),
    enabled: shouldLoad,
    staleTime: 5 * 60 * 1000,
  });
  const categories = useMemo(
    () => fetchedCategories.map((item) => localizeCategoryContent(item, locale)),
    [fetchedCategories, locale],
  );

  const [hoverPath, setHoverPath] = useState<number[]>([]);
  const [categorySearch, setCategorySearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const columnContainer = useRef<HTMLDivElement>(null);

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

  const matches = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    return query ? [...byId.values()].filter((category) => `${category.name} ${category.path || ''}`.toLowerCase().includes(query)) : [];
  }, [byId, categorySearch]);

  useEffect(() => {
    const panel = columnContainer.current;
    if (panel) panel.scrollLeft = panel.scrollWidth;
  }, [hoverPath.length]);

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
    <div
      className="relative group"
      onMouseEnter={() => { setShouldLoad(true); setMenuOpen(true); }}
      onMouseLeave={() => setMenuOpen(false)}
      onFocusCapture={() => { setShouldLoad(true); setMenuOpen(true); }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { setMenuOpen(false); event.stopPropagation(); } }}
    >
      <Link
        href={href('/categories')}
        aria-expanded={menuOpen}
        aria-controls="desktop-category-menu"
        className="block shrink-0 whitespace-nowrap px-1 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 transition-colors duration-200 hover:text-orange-600 min-[1800px]:text-sm"
      >
        {t('nav.categories')}
      </Link>
      {/* Invisible bridge to prevent hover gap */}
      <div className="absolute top-full left-0 w-full h-2 bg-transparent"></div>
      {/* Dropdown Panel */}
      {Array.isArray(categories) && categories.length > 0 && (
        <div
          id="desktop-category-menu"
          hidden={!menuOpen}
          className="absolute left-0 top-full z-50 mt-1 w-[min(760px,65vw)] overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">{t('header.productCategories')}</h3>
            <input type="search" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} aria-label={t('header.searchCategories')} placeholder={t('header.searchCategories')} className="site-input min-w-0 w-48 px-3 py-2 text-sm" />
          </div>
          {categorySearch.trim() ? (
            <ul className="h-[min(480px,60vh)] space-y-1 overflow-y-auto overscroll-contain">
              {matches.map((category) => <li key={category.id}><Link prefetch={false} href={href(`/categories/${category.path || category.slug}`)} onClick={() => setMenuOpen(false)} className="block rounded-md px-3 py-2 text-sm text-slate-800 hover:bg-blue-50"><span className="block font-medium">{category.name}</span><span className="block break-words text-xs text-slate-500">{category.path}</span></Link></li>)}
              {matches.length === 0 && <li className="p-3 text-sm text-slate-500">{t('header.noCategories')}</li>}
            </ul>
          ) : <div ref={columnContainer} className="flex gap-3 overflow-x-auto overscroll-contain">
            {columns.map((col, level) => (
              <div key={`${level}-${hoverPath[level - 1] || 'root'}`} data-category-level={level} className="h-[min(480px,60vh)] w-60 shrink-0 overflow-y-auto overscroll-contain border-r border-slate-100 pr-2 last:border-0">
                <ul className="space-y-0.5">
                  {col.map((cat) => {
                    const hasChildren = Array.isArray(cat.children) && cat.children.length > 0;
                    const isActive = hoverPath[level] === cat.id;
                    return (
                      <li key={cat.id}>
                        <Link
                          href={href(`/categories/${cat.path || cat.slug}`)}
                          onMouseEnter={() => setHoverAtLevel(level, cat.id)}
                          onFocus={() => setHoverAtLevel(level, cat.id)}
                          onClick={() => setMenuOpen(false)}
                          prefetch={false}
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
          </div>}
        </div>
      )}
    </div>
  );
}

function MobileCategoriesMenu({ onNavigate }: { onNavigate: () => void }) {
  const { locale, t } = usePublicI18n();
  const [open, setOpen] = useState(false);
  const { data: fetchedCategories = [] } = useQuery<Category[]>({
    queryKey: queryKeys.categories.tree(),
    queryFn: () => CategoryService.getCategories(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const categories = useMemo(
    () => fetchedCategories.map((item) => localizeCategoryContent(item, locale)),
    [fetchedCategories, locale],
  );

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
        <span>{t('nav.categories')}</span>
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
  const { href } = usePublicI18n();
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
              href={href(`/categories/${cat.path || cat.slug}`)}
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
