'use client';

import { useEffect, useRef, useState, ReactNode, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bars3Icon,
  XMarkIcon,
  HomeIcon,
  CubeIcon,
  TagIcon,
  ShoppingBagIcon,
  UsersIcon,
  PhotoIcon,
  DocumentTextIcon,
  ArrowRightOnRectangleIcon,
  BellIcon,
  UserCircleIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  TicketIcon,
  ChatBubbleLeftRightIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CreditCardIcon,
  TruckIcon,
  ChartBarIcon,
  NewspaperIcon
} from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { useAuth, useLogout } from '@/hooks/useAuth';
import AuthGuard from '@/components/auth/AuthGuard';
import { useAdminI18n } from '@/lib/admin-i18n';
import { queryKeys } from '@/lib/react-query';
import { Order } from '@/types';
import { OrderService } from '@/services';
import { formatCurrency } from '@/lib/utils';

const navigation = [
  { key: 'nav.dashboard', name: 'Dashboard', href: '/admin', icon: HomeIcon },
  { key: 'nav.products', name: 'Products', href: '/admin/products', icon: CubeIcon },
  { key: 'nav.categories', name: 'Categories', href: '/admin/categories', icon: TagIcon },
  { key: 'nav.orders', name: 'Orders', href: '/admin/orders', icon: ShoppingBagIcon },
  { key: 'nav.customers', name: 'Customers', href: '/admin/customers', icon: UserCircleIcon },
  { key: 'nav.tickets', name: 'Support Tickets', href: '/admin/tickets', icon: ChatBubbleLeftRightIcon },
  { key: 'nav.coupons', name: 'Coupon Management', href: '/admin/coupons', icon: TicketIcon },
  { key: 'nav.users', name: 'All Users', href: '/admin/users', icon: UsersIcon },
  { key: 'nav.contacts', name: 'Contact Messages', href: '/admin/contacts', icon: EnvelopeIcon },
  { key: 'nav.email', name: 'Email', href: '/admin/email', icon: PaperAirplaneIcon },
  { key: 'nav.media', name: 'Media Library', href: '/admin/media', icon: PhotoIcon },
  { key: 'nav.shipping', name: 'Shipping Rates', href: '/admin/shipping-rates', icon: TruckIcon },
  { key: 'nav.backup', name: 'Backup & Restore', href: '/admin/backup', icon: ArrowDownTrayIcon },
  { key: 'nav.cache', name: 'Cache & CDN', href: '/admin/cache', icon: ArrowPathIcon },
  { key: 'nav.paypal', name: 'PayPal', href: '/admin/paypal', icon: CreditCardIcon },
  { key: 'nav.indexnow', name: 'IndexNow / Bing', href: '/admin/indexnow', icon: BellIcon },
  { key: 'nav.analytics', name: 'Visitor Analytics', href: '/admin/analytics', icon: ChartBarIcon },
  { key: 'nav.homepage', name: 'Homepage Content', href: '/admin/homepage', icon: DocumentTextIcon },
  { key: 'nav.news', name: 'News & Articles', href: '/admin/news', icon: NewspaperIcon },
];

interface AdminLayoutProps {
  children: ReactNode;
}

const LAST_SEEN_ORDER_ID_KEY = 'fanuc_admin_last_seen_order_id';

function AdminLayoutInner({ children }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [lastSeenOrderId, setLastSeenOrderId] = useState<number | null>(null);
  const [notificationStateReady, setNotificationStateReady] = useState(false);
  const pathname = usePathname();
  const { user } = useAuth();
  const logoutMutation = useLogout();
  const { locale, setLocale, t } = useAdminI18n();

  const mainRef = useRef<HTMLElement | null>(null);
  const notificationPanelRef = useRef<HTMLDivElement | null>(null);

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  // Make nested routes (e.g. /admin/products/new, /admin/products/[id]/edit) still show the parent title.
  const activeNav = navigation.find(item => pathname === item.href || pathname.startsWith(item.href + '/'));

  const { data: recentOrdersData, isFetching: isRecentOrdersFetching } = useQuery({
    queryKey: queryKeys.orders.recent(),
    queryFn: () => OrderService.getOrders({ page: 1, page_size: 20 }),
    enabled: !!user,
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
    staleTime: 5000,
  });

  const recentOrders = useMemo<Order[]>(() => recentOrdersData?.data ?? [], [recentOrdersData]);

  const persistLastSeenOrderId = useCallback((orderId: number) => {
    setLastSeenOrderId(orderId);
    try {
      window.localStorage.setItem(LAST_SEEN_ORDER_ID_KEY, String(orderId));
    } catch {
      // ignore
    }
  }, []);

  const markOrderNotificationsAsRead = useCallback(() => {
    if (!notificationStateReady || recentOrders.length === 0) {
      return;
    }

    const newestOrderId = recentOrders[0].id;
    if (!Number.isFinite(newestOrderId) || newestOrderId <= 0) {
      return;
    }
    if (lastSeenOrderId !== null && newestOrderId <= lastSeenOrderId) {
      return;
    }

    persistLastSeenOrderId(newestOrderId);
  }, [notificationStateReady, recentOrders, lastSeenOrderId, persistLastSeenOrderId]);

  const closeNotificationPanel = useCallback(() => {
    setIsNotificationOpen(false);
    markOrderNotificationsAsRead();
  }, [markOrderNotificationsAsRead]);

  const handleNotificationToggle = useCallback(() => {
    setIsNotificationOpen((prev) => {
      if (prev) {
        markOrderNotificationsAsRead();
        return false;
      }
      return true;
    });
  }, [markOrderNotificationsAsRead]);

  const newOrders = useMemo<Order[]>(() => {
    if (!notificationStateReady || lastSeenOrderId === null) {
      return [];
    }
    return recentOrders.filter((order) => order.id > lastSeenOrderId);
  }, [notificationStateReady, lastSeenOrderId, recentOrders]);

  const unreadOrderCount = newOrders.length;

  const formatNotificationTime = useCallback((createdAt: string) => {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
      return createdAt;
    }
    return date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [locale]);

  // Persist and restore scroll position for admin pages.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const key = `admin-scroll:${pathname}`;

    // Restore
    try {
      const raw = window.sessionStorage.getItem(key);
      const y = raw ? Number(raw) : 0;
      if (Number.isFinite(y) && y > 0) {
        requestAnimationFrame(() => {
          el.scrollTop = y;
        });
      }
    } catch {
      // ignore
    }

    // Persist
    const onScroll = () => {
      try {
        window.sessionStorage.setItem(key, String(el.scrollTop || 0));
      } catch {
        // ignore
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      try {
        window.sessionStorage.setItem(key, String(el.scrollTop || 0));
      } catch {
        // ignore
      }
    };
  }, [pathname]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_SEEN_ORDER_ID_KEY);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
          setLastSeenOrderId(parsed);
        }
      }
    } catch {
      // ignore
    } finally {
      setNotificationStateReady(true);
    }
  }, []);

  useEffect(() => {
    if (!notificationStateReady || lastSeenOrderId !== null || recentOrders.length === 0) {
      return;
    }

    const newestOrderId = recentOrders[0].id;
    if (!Number.isFinite(newestOrderId) || newestOrderId <= 0) {
      return;
    }

    persistLastSeenOrderId(newestOrderId);
  }, [notificationStateReady, lastSeenOrderId, recentOrders, persistLastSeenOrderId]);

  useEffect(() => {
    if (!isNotificationOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!notificationPanelRef.current) {
        return;
      }
      if (notificationPanelRef.current.contains(event.target as Node)) {
        return;
      }
      closeNotificationPanel();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeNotificationPanel();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isNotificationOpen, closeNotificationPanel]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75" />
          </div>
        )}

        {/* Sidebar */}
        <div className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col bg-white shadow-lg transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}>
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 px-6">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 text-white px-3 py-1 rounded font-bold text-lg">
                FANUC
              </div>
              <span className="text-gray-900 font-semibold">{t('admin.panel', '管理后台')}</span>
            </div>
            <button
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <XMarkIcon className="h-6 w-6 text-gray-400" />
            </button>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-6 admin-sidebar-scroll">
            <div className="space-y-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    className={`group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <item.icon
                      className={`mr-3 h-5 w-5 ${
                        isActive ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500'
                      }`}
                    />
                    {t(item.key, item.name)}
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* User info at bottom */}
          <div className="shrink-0 border-t border-gray-200 p-4 bg-white">
            <div className="flex items-center space-x-3 mb-3">
              <UserCircleIcon className="h-8 w-8 text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user?.full_name || user?.username}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {user?.role}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              <ArrowRightOnRectangleIcon className="mr-3 h-4 w-4" />
              {t('action.signOut', 'Sign out')}
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col lg:ml-0">
          {/* Top navigation */}
          <header className="bg-white shadow-sm border-b border-gray-200">
            <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
              <div className="flex items-center">
                <button
                  className="lg:hidden"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Bars3Icon className="h-6 w-6 text-gray-500" />
                </button>
                
                <h1 className="ml-4 lg:ml-0 text-xl font-semibold text-gray-900">
                  {activeNav ? t(activeNav.key, activeNav.name) : t('admin.panel', 'Admin Panel')}
                </h1>
              </div>

              <div className="flex items-center space-x-4">
                {/* Notifications */}
                <div className="relative" ref={notificationPanelRef}>
                  <button
                    onClick={handleNotificationToggle}
                    className="relative p-2 text-gray-400 hover:text-gray-500"
                    aria-haspopup="menu"
                    aria-expanded={isNotificationOpen}
                    aria-label={t('orders.notice.button', locale === 'zh' ? '订单提醒' : 'Order notifications')}
                    title={t('orders.notice.button', locale === 'zh' ? '订单提醒' : 'Order notifications')}
                  >
                    <BellIcon className="h-6 w-6" />
                    {unreadOrderCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 font-semibold text-center">
                        {unreadOrderCount > 99 ? '99+' : unreadOrderCount}
                      </span>
                    )}
                  </button>

                  {isNotificationOpen && (
                    <div className="absolute right-0 z-50 mt-2 w-80 sm:w-96 rounded-lg border border-gray-200 bg-white shadow-xl">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <h3 className="text-sm font-semibold text-gray-900">
                          {t('orders.notice.title', locale === 'zh' ? '新订单提醒' : 'New Order Alerts')}
                        </h3>
                        {isRecentOrdersFetching && (
                          <span className="text-xs text-gray-400">{t('orders.notice.refreshing', locale === 'zh' ? '刷新中...' : 'Refreshing...')}</span>
                        )}
                      </div>

                      <div className="max-h-80 overflow-y-auto">
                        {newOrders.length > 0 ? (
                          <ul className="divide-y divide-gray-100">
                            {newOrders.slice(0, 10).map((order) => (
                              <li key={order.id}>
                                <Link
                                  href={`/admin/orders/${order.id}`}
                                  prefetch={false}
                                  onClick={closeNotificationPanel}
                                  className="block px-4 py-3 hover:bg-gray-50"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-gray-900 truncate">
                                        #{order.order_number || order.id}
                                      </p>
                                      <p className="text-xs text-gray-500 truncate">{order.customer_name || order.customer_email}</p>
                                    </div>
                                    <p className="text-xs font-medium text-green-600 whitespace-nowrap">
                                      {formatCurrency(order.total_amount || 0, order.currency || 'USD')}
                                    </p>
                                  </div>
                                  <p className="mt-1 text-xs text-gray-400">
                                    {formatNotificationTime(order.created_at)}
                                  </p>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="px-4 py-8 text-sm text-center text-gray-500">
                            {t('orders.notice.empty', locale === 'zh' ? '没有新的内容' : 'No new content')}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
                        <Link
                          href="/admin/orders"
                          prefetch={false}
                          onClick={closeNotificationPanel}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          {t('orders.notice.viewAll', locale === 'zh' ? '查看全部订单' : 'View all orders')}
                        </Link>
                        {newOrders.length > 0 && (
                          <button
                            onClick={closeNotificationPanel}
                            className="text-xs font-medium text-gray-500 hover:text-gray-700"
                          >
                            {t('orders.notice.markRead', locale === 'zh' ? '标记为已读' : 'Mark as read')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Language */}
                <div className="flex items-center space-x-2">
                  <span className="hidden md:block text-sm text-gray-500">{t('action.language', 'Language')}</span>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as 'en' | 'zh')}
                    className="block px-2 py-1 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="Language"
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </div>

                {/* User menu */}
                <div className="flex items-center space-x-3">
                  <UserCircleIcon className="h-8 w-8 text-gray-400" />
                  <div className="hidden md:block">
                    <p className="text-sm font-medium text-gray-900">
                      {user?.full_name || user?.username}
                    </p>
                    <p className="text-xs text-gray-500">
                      {user?.role}
                    </p>
                  </div>

                  {/* Logout button */}
                  <button
                    onClick={handleLogout}
                    className="flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    title={t('action.signOut', 'Sign out')}
                  >
                    <ArrowRightOnRectangleIcon className="h-5 w-5" />
                    <span className="ml-2 hidden sm:block">{t('action.signOut', 'Sign out')}</span>
                  </button>
                </div>
              </div>
            </div>
          </header>

	        {/* Page content */}
	        <main ref={mainRef} className="flex-1 overflow-y-auto">
	            <div className="p-4 sm:p-6 lg:p-8">
	              {children}
	            </div>
	        </main>
	        </div>
	      </div>
	  );
}

export function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <AuthGuard>
      <AdminLayoutInner>{children}</AdminLayoutInner>
    </AuthGuard>
  );
}

export default AdminLayout;
