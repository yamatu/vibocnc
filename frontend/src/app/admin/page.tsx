'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  CubeIcon,
  ShoppingBagIcon,
  UsersIcon,
  CurrencyDollarIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  EyeIcon,
  PhotoIcon
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import { DashboardService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { formatCurrency } from '@/lib/utils';
import { useAdminI18n } from '@/lib/admin-i18n';

const emptyStats = {
  total_products: 0,
  active_products: 0,
  featured_products: 0,
  total_categories: 0,
  total_orders: 0,
  pending_orders: 0,
  completed_orders: 0,
  monthly_orders: 0,
  total_revenue: 0,
  monthly_revenue: 0,
  total_users: 0,
  active_users: 0,
  total_banners: 0,
  total_purchase_links: 0,
};

function StatCard({ title, value, change, changeType, icon: Icon, color }: any) {
  const { locale, t } = useAdminI18n();
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center">
        <div className={`flex-shrink-0 p-3 rounded-md ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div className="ml-5 w-0 flex-1">
          <dl>
            <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
            <dd className="flex items-baseline">
              <div className="text-2xl font-semibold text-gray-900">{value}</div>
              {change && (
                <div className={`ml-2 flex items-baseline text-sm font-semibold ${
                  changeType === 'increase' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {changeType === 'increase' ? (
                    <ArrowUpIcon className="self-center flex-shrink-0 h-4 w-4" />
                  ) : (
                    <ArrowDownIcon className="self-center flex-shrink-0 h-4 w-4" />
                  )}
                  <span className="sr-only">
                    {changeType === 'increase'
                      ? t('dashboard.change.increase', locale === 'zh' ? '增加' : 'Increased')
                      : t('dashboard.change.decrease', locale === 'zh' ? '减少' : 'Decreased')}{' '}
                    {t('dashboard.change.by', locale === 'zh' ? '幅度' : 'by')}
                  </span>
                  {change}%
                </div>
              )}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { locale, t } = useAdminI18n();
  // Fetch dashboard stats from API
  const {
    data: dashboardData,
    isLoading: isStatsLoading,
  } = useQuery({
    queryKey: queryKeys.dashboard.stats(),
    queryFn: DashboardService.getDashboardStats,
  });

  // Fetch recent orders
  const {
    data: ordersData,
    isLoading: isRecentOrdersLoading,
    error: recentOrdersError,
  } = useQuery({
    queryKey: ['dashboard', 'recent-orders', { includePending: false }],
    queryFn: () => DashboardService.getRecentOrders(5, false),
  });

  // Fetch top products
  const {
    data: productsData,
    isLoading: isTopProductsLoading,
    error: topProductsError,
  } = useQuery({
    queryKey: ['dashboard', 'top-products', 30],
    queryFn: () => DashboardService.getTopProducts(5, 30),
  });

  const stats = dashboardData ?? emptyStats;
  const recentOrders = ordersData ?? [];
  const topProducts = productsData ?? [];

  const getOrderStatusLabel = (status: string) => {
    const s = String(status || '').toLowerCase();
    if (s === 'pending') return t('orders.status.pending', locale === 'zh' ? '待处理' : 'Pending');
    if (s === 'processing') return t('orders.status.processing', locale === 'zh' ? '处理中' : 'Processing');
    if (s === 'shipped') return t('orders.status.shipped', locale === 'zh' ? '已发货' : 'Shipped');
    if (s === 'delivered' || s === 'completed') return t('orders.status.delivered', locale === 'zh' ? '已送达' : 'Delivered');
    if (s === 'cancelled') return t('orders.status.cancelled', locale === 'zh' ? '已取消' : 'Cancelled');
    return status;
  };

  if (isStatsLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-gray-200 h-24 rounded-lg"></div>
              ))}
            </div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('nav.dashboard', 'Dashboard')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t(
              'dashboard.welcome',
              locale === 'zh' ? '欢迎回来！这里是今天店铺的最新情况。' : "Welcome back! Here's what's happening with your FANUC store today."
            )}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t('dashboard.card.totalProducts', locale === 'zh' ? '产品总数' : 'Total Products')}
            value={stats.total_products.toLocaleString()}
            change={5.2}
            changeType="increase"
            icon={CubeIcon}
            color="bg-blue-500"
          />
          <StatCard
            title={t('dashboard.card.activeProducts', locale === 'zh' ? '启用产品' : 'Active Products')}
            value={stats.active_products.toLocaleString()}
            change={3.1}
            changeType="increase"
            icon={CubeIcon}
            color="bg-green-500"
          />
          <StatCard
            title={t('dashboard.card.totalOrders', locale === 'zh' ? '订单总数' : 'Total Orders')}
            value={stats.total_orders.toLocaleString()}
            change={12.5}
            changeType="increase"
            icon={ShoppingBagIcon}
            color="bg-purple-500"
          />
          <StatCard
            title={t('dashboard.card.pendingOrders', locale === 'zh' ? '待处理订单' : 'Pending Orders')}
            value={stats.pending_orders.toLocaleString()}
            change={-2.3}
            changeType="decrease"
            icon={ShoppingBagIcon}
            color="bg-yellow-500"
          />
        </div>

        {/* Secondary Stats Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t('dashboard.card.totalRevenue', locale === 'zh' ? '累计营收' : 'Total Revenue')}
            value={formatCurrency(stats.total_revenue)}
            change={8.1}
            changeType="increase"
            icon={CurrencyDollarIcon}
            color="bg-emerald-500"
          />
          <StatCard
            title={t('dashboard.card.monthlyRevenue', locale === 'zh' ? '本月营收' : 'Monthly Revenue')}
            value={formatCurrency(stats.monthly_revenue)}
            change={15.2}
            changeType="increase"
            icon={CurrencyDollarIcon}
            color="bg-indigo-500"
          />
          <StatCard
            title={t('dashboard.card.totalCategories', locale === 'zh' ? '分类总数' : 'Total Categories')}
            value={stats.total_categories.toLocaleString()}
            change={1.0}
            changeType="increase"
            icon={CubeIcon}
            color="bg-pink-500"
          />
          <StatCard
            title={t('dashboard.card.activeUsers', locale === 'zh' ? '活跃用户' : 'Active Users')}
            value={stats.active_users}
            change={2.3}
            changeType="increase"
            icon={UsersIcon}
            color="bg-orange-500"
          />
        </div>

        {/* Charts and Tables */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Recent Orders */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">{t('dashboard.recentOrders', locale === 'zh' ? '最近订单' : 'Recent Orders')}</h3>
            </div>
              <div className="overflow-hidden">
              {isRecentOrdersLoading ? (
                <div className="p-6 text-sm text-gray-500">{t('common.loading', locale === 'zh' ? '加载中...' : 'Loading...')}</div>
              ) : recentOrdersError ? (
                <div className="p-6 text-sm text-red-600">
                  {t('dashboard.recentOrdersFailed', locale === 'zh' ? '加载最近订单失败。' : 'Failed to load recent orders.')}
                </div>
              ) : recentOrders.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">
                  {t('dashboard.recentOrdersEmpty', locale === 'zh' ? '暂无最近订单。' : 'No recent orders yet.')}
                </div>
              ) : (
              <ul className="divide-y divide-gray-200">
                {recentOrders.map((order) => (
                  <li key={order.id} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {order.order_number}
                        </p>
                        <p className="text-sm text-gray-500 truncate">
                          {order.customer_name} • {order.customer_email}
                        </p>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="text-right">
                          <p className="text-sm font-medium text-gray-900">
                            {formatCurrency(order.total_amount)}
                          </p>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            order.status === 'delivered' || order.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : order.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {getOrderStatusLabel(order.status)}
                          </span>
                        </div>
                        <a
                          href={`/admin/orders/${order.id}`}
                          className="text-gray-400 hover:text-gray-500"
                          aria-label={t('common.view', locale === 'zh' ? '查看' : 'View')}
                        >
                          <EyeIcon className="h-5 w-5" />
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              )}
            </div>
            <div className="px-6 py-3 border-t border-gray-200">
              <Link href="/admin/orders" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                {t('dashboard.viewAllOrders', locale === 'zh' ? '查看全部订单 →' : 'View all orders →')}
              </Link>
            </div>
          </div>

          {/* Top Products */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">{t('dashboard.topProducts', locale === 'zh' ? '热销产品' : 'Top Products')}</h3>
            </div>
              <div className="overflow-hidden">
              {isTopProductsLoading ? (
                <div className="p-6 text-sm text-gray-500">{t('common.loading', locale === 'zh' ? '加载中...' : 'Loading...')}</div>
              ) : topProductsError ? (
                <div className="p-6 text-sm text-red-600">
                  {t('dashboard.topProductsFailed', locale === 'zh' ? '加载热销产品失败。' : 'Failed to load top products.')}
                </div>
              ) : topProducts.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">{t('dashboard.topProductsEmpty', locale === 'zh' ? '暂无销量数据。' : 'No sales data yet.')}</div>
              ) : (
              <ul className="divide-y divide-gray-200">
                {topProducts.map((item, index) => (
                  <li key={item.id || index} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                            <span className="text-sm font-medium text-gray-600">
                              #{index + 1}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {item.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {t('products.field.skuLabel', locale === 'zh' ? 'SKU：' : 'SKU:')} {item.sku}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">
                          {t('dashboard.soldCount', locale === 'zh' ? '已售 {count}' : '{count} sold', { count: item.total_sold || 0 })}
                        </p>
                        <p className="text-sm text-gray-500">
                          {formatCurrency(item.revenue || 0)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              )}
            </div>
            <div className="px-6 py-3 border-t border-gray-200">
              <Link href="/admin/products" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                {t('dashboard.viewAllProducts', locale === 'zh' ? '查看全部产品 →' : 'View all products →')}
              </Link>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">{t('dashboard.quickActions', locale === 'zh' ? '快捷操作' : 'Quick Actions')}</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Link
                href="/admin/products/new"
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 border border-gray-200 rounded-lg hover:border-gray-300"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-blue-50 text-blue-700 ring-4 ring-white">
                    <CubeIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-medium">
                    <span className="absolute inset-0" />
                    {t('nav.products', 'Products')}
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {t('dashboard.quick.addProduct', locale === 'zh' ? '新增一个 FANUC 产品到库存' : 'Add a new FANUC product to your inventory')}
                  </p>
                </div>
              </Link>

              <Link
                href="/admin/orders"
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 border border-gray-200 rounded-lg hover:border-gray-300"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-green-50 text-green-700 ring-4 ring-white">
                    <ShoppingBagIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-medium">
                    <span className="absolute inset-0" />
                    {t('nav.orders', 'Orders')}
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {t('dashboard.quick.manageOrders', locale === 'zh' ? '查看并管理客户订单' : 'View and manage customer orders')}
                  </p>
                </div>
              </Link>

              <Link
                href="/admin/media"
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 border border-gray-200 rounded-lg hover:border-gray-300"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-purple-50 text-purple-700 ring-4 ring-white">
                    <PhotoIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-medium">
                    <span className="absolute inset-0" />
                    {t('nav.media', 'Media Library')}
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {t(
                      'dashboard.quick.media',
                      locale === 'zh' ? '上传并管理站点图片（按哈希去重）' : 'Upload and manage site images (deduplicated by hash)'
                    )}
                  </p>
                </div>
              </Link>

              <Link
                href="/admin/users"
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 border border-gray-200 rounded-lg hover:border-gray-300"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-orange-50 text-orange-700 ring-4 ring-white">
                    <UsersIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-medium">
                    <span className="absolute inset-0" />
                    {t('nav.users', 'All Users')}
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {t('dashboard.quick.users', locale === 'zh' ? '管理后台用户与权限' : 'Manage admin users and permissions')}
                  </p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
