'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import {
  ShoppingBagIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  TruckIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import { OrderService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { formatCurrency } from '@/lib/utils';
import { useAdminI18n } from '@/lib/admin-i18n';

export default function AdminOrdersPage() {
  const { locale, t } = useAdminI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [deleteConfirmOrder, setDeleteConfirmOrder] = useState<any>(null);

  const queryClient = useQueryClient();

  // Fetch orders from API
  const { data: ordersData, isLoading, error } = useQuery({
    queryKey: queryKeys.orders.list({
      search: searchQuery,
      status: statusFilter
    }),
    queryFn: () => OrderService.getOrders({
      search: searchQuery || undefined,
      status: statusFilter || undefined,
    }),
  });

  const orders = ordersData?.data || [];

  // Update order status mutation
  const updateOrderStatusMutation = useMutation({
    mutationFn: ({ orderId, status }: { orderId: number; status: string }) =>
      OrderService.updateOrderStatus(orderId, status),
    onSuccess: () => {
      toast.success(t('orders.toast.statusUpdated', locale === 'zh' ? '订单状态已更新！' : 'Order status updated successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists() });
    },
    onError: (error: any) => {
      toast.error(error.message || t('orders.toast.statusUpdateFailed', locale === 'zh' ? '更新订单状态失败' : 'Failed to update order status'));
    },
  });

  // Delete order mutation
  const deleteOrderMutation = useMutation({
    mutationFn: (orderId: number) => OrderService.deleteOrder(orderId),
    onSuccess: () => {
      toast.success(t('orders.toast.deleted', locale === 'zh' ? '订单已删除！' : 'Order deleted successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists() });
      setDeleteConfirmOrder(null);
    },
    onError: (error: any) => {
      toast.error(error.message || t('orders.toast.deleteFailed', locale === 'zh' ? '删除订单失败' : 'Failed to delete order'));
    },
  });

  const handleStatusUpdate = (orderId: number, newStatus: string) => {
    updateOrderStatusMutation.mutate({ orderId, status: newStatus });
  };

  const handleDeleteOrder = () => {
    if (deleteConfirmOrder) {
      deleteOrderMutation.mutate(deleteConfirmOrder.id);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: t('orders.status.pending', locale === 'zh' ? '待处理' : 'Pending'), color: 'bg-yellow-100 text-yellow-800', icon: ClockIcon },
      processing: { label: t('orders.status.processing', locale === 'zh' ? '处理中' : 'Processing'), color: 'bg-blue-100 text-blue-800', icon: ClockIcon },
      shipped: { label: t('orders.status.shipped', locale === 'zh' ? '已发货' : 'Shipped'), color: 'bg-purple-100 text-purple-800', icon: TruckIcon },
      delivered: { label: t('orders.status.delivered', locale === 'zh' ? '已送达' : 'Delivered'), color: 'bg-green-100 text-green-800', icon: CheckCircleIcon },
      cancelled: { label: t('orders.status.cancelled', locale === 'zh' ? '已取消' : 'Cancelled'), color: 'bg-red-100 text-red-800', icon: XCircleIcon },
    };

    const config = statusConfig[status as keyof typeof statusConfig] ||
                   { label: status, color: 'bg-gray-100 text-gray-800', icon: ClockIcon };

    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </span>
    );
  };

  const getPaymentStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: t('orders.pay.pending', locale === 'zh' ? '待支付' : 'Pending'), color: 'bg-yellow-100 text-yellow-800' },
      paid: { label: t('orders.pay.paid', locale === 'zh' ? '已支付' : 'Paid'), color: 'bg-green-100 text-green-800' },
      failed: { label: t('orders.pay.failed', locale === 'zh' ? '失败' : 'Failed'), color: 'bg-red-100 text-red-800' },
      refund_pending: { label: locale === 'zh' ? '退款处理中' : 'Refund pending', color: 'bg-yellow-100 text-yellow-800' },
      partially_refunded: { label: locale === 'zh' ? '部分退款' : 'Partially refunded', color: 'bg-orange-100 text-orange-800' },
      refunded: { label: t('orders.pay.refunded', locale === 'zh' ? '已退款' : 'Refunded'), color: 'bg-gray-100 text-gray-800' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] ||
                   { label: status, color: 'bg-gray-100 text-gray-800' };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    );
  };

  if (error) {
    return (
      <AdminLayout>
        <div className="text-center py-12">
          <div className="text-red-600 mb-4">
            <XCircleIcon className="h-12 w-12 mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t('orders.error.title', locale === 'zh' ? '订单加载失败' : 'Error Loading Orders')}</h3>
          <p className="text-gray-500">{error.message}</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
	        <div className="flex items-center justify-between">
	          <div>
	            <h1 className="text-2xl font-bold text-gray-900">{t('nav.orders', 'Orders')}</h1>
	            <p className="mt-1 text-sm text-gray-500">
					{t('orders.page.subtitle', locale === 'zh' ? '管理客户订单并跟踪履约/发货' : 'Manage customer orders and track fulfillment')}
	            </p>
	          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <FunnelIcon className="h-4 w-4 mr-2" />
			  {t('common.filters', locale === 'zh' ? '筛选' : 'Filters')}
            </button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
				  {t('common.search', locale === 'zh' ? '搜索' : 'Search')}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    id="search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
					placeholder={t('orders.searchPh', locale === 'zh' ? '订单号、客户姓名...' : 'Order number, customer name...')}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
				  {t('orders.status.title', locale === 'zh' ? '状态' : 'Status')}
                </label>
                <select
                  id="status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
				  <option value="">{t('common.all', locale === 'zh' ? '全部' : 'All Statuses')}</option>
				  <option value="pending">{t('orders.status.pending', locale === 'zh' ? '待处理' : 'Pending')}</option>
				  <option value="processing">{t('orders.status.processing', locale === 'zh' ? '处理中' : 'Processing')}</option>
				  <option value="shipped">{t('orders.status.shipped', locale === 'zh' ? '已发货' : 'Shipped')}</option>
				  <option value="delivered">{t('orders.status.delivered', locale === 'zh' ? '已送达' : 'Delivered')}</option>
				  <option value="cancelled">{t('orders.status.cancelled', locale === 'zh' ? '已取消' : 'Cancelled')}</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('');
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
				  {t('common.clearFilters', locale === 'zh' ? '清除筛选' : 'Clear Filters')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Orders Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
			  <p className="mt-2 text-gray-500">{t('orders.loading', locale === 'zh' ? '正在加载订单...' : 'Loading orders...')}</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center">
              <ShoppingBagIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
			  <h3 className="text-lg font-medium text-gray-900 mb-2">{t('orders.empty', locale === 'zh' ? '没有找到订单' : 'No orders found')}</h3>
              <p className="text-gray-500">
                {searchQuery || statusFilter
					? t('orders.empty.filtered', locale === 'zh' ? '请尝试调整筛选条件。' : 'Try adjusting your filters to see more orders.')
					: t('orders.empty.fresh', locale === 'zh' ? '客户下单后会在这里显示。' : 'Orders will appear here when customers make purchases.')}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					  {t('orders.table.order', locale === 'zh' ? '订单' : 'Order')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					  {t('orders.table.customer', locale === 'zh' ? '客户' : 'Customer')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					  {t('orders.table.status', locale === 'zh' ? '状态' : 'Status')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					  {t('orders.table.payment', locale === 'zh' ? '支付' : 'Payment')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					  {t('orders.table.total', locale === 'zh' ? '总计' : 'Total')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					  {t('orders.table.date', locale === 'zh' ? '日期' : 'Date')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
					  {t('common.actions', locale === 'zh' ? '操作' : 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {orders.map((order: any) => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            #{order.order_number}
                          </div>
                          <div className="text-sm text-gray-500">
                            {t(
                              'orders.itemsCount',
                              locale === 'zh' ? '{count} 件商品' : '{count} item(s)',
                              { count: order.items?.length || 0 }
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {order.customer_name || order.user?.name || t('common.na', locale === 'zh' ? '无' : 'N/A')}
                          </div>
                          <div className="text-sm text-gray-500">
                            {order.customer_email || order.user?.email || t('common.na', locale === 'zh' ? '无' : 'N/A')}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="space-y-1">
                          {getStatusBadge(order.status)}
                          <div>
                            <select
                              value={order.status}
                              onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                              disabled={updateOrderStatusMutation.isPending}
                              className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
							  <option value="pending">{t('orders.status.pending', locale === 'zh' ? '待处理' : 'Pending')}</option>
							  <option value="processing">{t('orders.status.processing', locale === 'zh' ? '处理中' : 'Processing')}</option>
							  <option value="shipped">{t('orders.status.shipped', locale === 'zh' ? '已发货' : 'Shipped')}</option>
							  <option value="delivered">{t('orders.status.delivered', locale === 'zh' ? '已送达' : 'Delivered')}</option>
							  <option value="cancelled">{t('orders.status.cancelled', locale === 'zh' ? '已取消' : 'Cancelled')}</option>
                            </select>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getPaymentStatusBadge(order.payment_status || 'pending')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <CurrencyDollarIcon className="h-4 w-4 text-gray-400 mr-1" />
                          <span className="text-sm font-medium text-gray-900">
                            {formatCurrency(order.total_amount || 0)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(order.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-2">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
                          >
                            <EyeIcon className="h-4 w-4 mr-1" />
							{t('common.view', locale === 'zh' ? '查看' : 'View')}
                          </Link>
                          {OrderService.canEditOrder(order) && (
                            <Link
                              href={`/admin/orders/${order.id}/edit`}
                              className="inline-flex items-center px-3 py-1 border border-blue-300 rounded-md text-sm text-blue-700 bg-blue-50 hover:bg-blue-100"
                            >
                              <PencilIcon className="h-4 w-4 mr-1" />
							{t('common.edit', locale === 'zh' ? '编辑' : 'Edit')}
                            </Link>
                          )}
                          {OrderService.canDeleteOrder(order) && (
                            <button
                              onClick={() => setDeleteConfirmOrder(order)}
                              className="inline-flex items-center px-3 py-1 border border-red-300 rounded-md text-sm text-red-700 bg-red-50 hover:bg-red-100"
                            >
                              <TrashIcon className="h-4 w-4 mr-1" />
							{t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        {deleteConfirmOrder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-center mb-4">
                <ExclamationTriangleIcon className="h-6 w-6 text-red-600 mr-3" />
                <h3 className="text-lg font-medium text-gray-900">{t('orders.delete.title', locale === 'zh' ? '删除订单' : 'Delete Order')}</h3>
              </div>
              <p className="text-gray-500 mb-6">
				{t(
					'orders.delete.confirm',
					locale === 'zh'
						? '确定要删除订单 #{orderNumber} 吗？此操作不可撤销。'
						: 'Are you sure you want to delete order #{orderNumber}? This action cannot be undone.',
					{ orderNumber: deleteConfirmOrder.order_number }
				)}
                {deleteConfirmOrder.payment_status === 'paid' && (
                  <span className="block mt-2 text-orange-600 font-medium">
					{t('orders.delete.paidNote', locale === 'zh' ? '注意：该订单已支付，删除后会恢复产品库存。' : 'Note: This order has been paid. Product stock will be restored.')}
                  </span>
                )}
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setDeleteConfirmOrder(null)}
                  disabled={deleteOrderMutation.isPending}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  {t('common.cancel', locale === 'zh' ? '取消' : 'Cancel')}
                </button>
                <button
                  onClick={handleDeleteOrder}
                  disabled={deleteOrderMutation.isPending}
                  className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 disabled:opacity-50 flex items-center"
                >
                  {deleteOrderMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
						{t('common.deleting', locale === 'zh' ? '删除中...' : 'Deleting...')}
                    </>
                  ) : (
						t('orders.delete.confirmBtn', locale === 'zh' ? '确认删除' : 'Delete Order')
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
