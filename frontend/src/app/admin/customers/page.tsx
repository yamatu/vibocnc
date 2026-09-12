'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import AdminLayout from '@/components/admin/AdminLayout';
import {
  MagnifyingGlassIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '@/lib/api';
import { useAdminI18n } from '@/lib/admin-i18n';
import type { APIResponse, PaginationResponse } from '@/types';

interface Customer {
  id: number;
  email: string;
  full_name: string;
  phone?: string;
  company?: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  last_login_at?: string;
}

export default function CustomersPage() {
  const { locale, t } = useAdminI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    loadCustomers();
  }, [page, searchTerm, statusFilter]);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const params: any = { page, page_size: 20 };
      if (searchTerm) params.search = searchTerm;
      if (statusFilter !== 'all') params.status = statusFilter;

      const response = await apiClient.get<APIResponse<PaginationResponse<Customer>>>('/admin/customers', { params });
      if (response.data.success) {
        const result = response.data.data;
        setCustomers(result?.data || []);
        setTotalPages(result?.total_pages || 1);
      }
    } catch (error: unknown) {
      console.error('Failed to load customers:', error);
	  toast.error(t('customers.toast.loadFailed', locale === 'zh' ? '加载客户失败' : 'Failed to load customers'));
    } finally {
      setLoading(false);
    }
  };

  const toggleCustomerStatus = async (customerId: number, currentStatus: boolean) => {
    try {
      const response = await apiClient.put<APIResponse<unknown>>(`/admin/customers/${customerId}/status`, {
        is_active: !currentStatus,
      });

      if (response.data.success) {
		toast.success(
			t(
				'customers.toast.statusUpdated',
				locale === 'zh'
					? `客户已${!currentStatus ? '启用' : '停用'}`
					: `Customer ${!currentStatus ? 'activated' : 'deactivated'} successfully`
			)
		);
        loadCustomers();
      }
    } catch {
	  toast.error(t('customers.toast.statusUpdateFailed', locale === 'zh' ? '更新客户状态失败' : 'Failed to update customer status'));
    }
  };

  const deleteCustomer = async (customerId: number) => {
    if (!confirm(t('customers.confirm.delete', locale === 'zh' ? '确定要删除该客户吗？此操作不可撤销。' : 'Are you sure you want to delete this customer? This action cannot be undone.'))) return;

    try {
      await apiClient.delete(`/admin/customers/${customerId}`);
	  toast.success(t('customers.toast.deleted', locale === 'zh' ? '客户已删除' : 'Customer deleted successfully'));
      loadCustomers();
    } catch {
	  toast.error(t('customers.toast.deleteFailed', locale === 'zh' ? '删除客户失败' : 'Failed to delete customer'));
    }
  };

  return (
    <AdminLayout>
      <div className="px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-2xl font-semibold text-gray-900">{t('nav.customers', 'Customers')}</h1>
            <p className="mt-2 text-sm text-gray-700">
              {t('customers.subtitle', locale === 'zh' ? '管理所有注册客户及其账号' : 'Manage all registered customers and their accounts')}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
                className="block w-full rounded-md border-gray-300 pl-10 focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
                placeholder={t('customers.searchPh', locale === 'zh' ? '按姓名、邮箱或电话搜索...' : 'Search by name, email, or phone...')}
              />
            </div>
          </div>

          {/* Status Filter */}
          <div className="w-full sm:w-48">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="block w-full rounded-md border-gray-300 focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
            >
              <option value="all">{t('common.all', locale === 'zh' ? '全部' : 'All')}</option>
              <option value="active">{t('common.active', locale === 'zh' ? '启用' : 'Active')}</option>
              <option value="inactive">{t('common.inactive', locale === 'zh' ? '停用' : 'Inactive')}</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="mt-8 flex flex-col">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                {loading ? (
                  <div className="text-center py-12 bg-white">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
                    <p className="mt-4 text-sm text-gray-500">{t('customers.loading', locale === 'zh' ? '正在加载客户...' : 'Loading customers...')}</p>
                  </div>
                ) : customers.length > 0 ? (
                  <table className="min-w-full divide-y divide-gray-300">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                          {t('customers.table.customer', locale === 'zh' ? '客户' : 'Customer')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('customers.table.contact', locale === 'zh' ? '联系方式' : 'Contact')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('common.status', locale === 'zh' ? '状态' : 'Status')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('customers.table.registered', locale === 'zh' ? '注册时间' : 'Registered')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('customers.table.lastLogin', locale === 'zh' ? '最近登录' : 'Last Login')}
                        </th>
                        <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                          <span className="sr-only">{t('common.actions', locale === 'zh' ? '操作' : 'Actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {customers.map((customer) => (
                        <tr key={customer.id}>
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6">
                            <div className="flex items-center">
                              <div className="h-10 w-10 flex-shrink-0">
                                <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                                  <UserGroupIcon className="h-6 w-6 text-amber-600" />
                                </div>
                              </div>
                              <div className="ml-4">
                                <div className="font-medium text-gray-900">{customer.full_name}</div>
                                <div className="text-gray-500">{customer.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                            <div>{customer.phone || '-'}</div>
                            <div className="text-gray-400">{customer.company || '-'}</div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm">
                            <span
                              className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                                customer.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {customer.is_active
                                ? t('common.active', locale === 'zh' ? '启用' : 'Active')
                                : t('common.inactive', locale === 'zh' ? '停用' : 'Inactive')}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                            {new Date(customer.created_at).toLocaleDateString()}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                            {customer.last_login_at
                              ? new Date(customer.last_login_at).toLocaleDateString()
                              : t('common.never', locale === 'zh' ? '从未' : 'Never')}
                          </td>
                          <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                            <button
                              onClick={() => toggleCustomerStatus(customer.id, customer.is_active)}
                              className="text-amber-600 hover:text-amber-900 mr-4"
                            >
                              {customer.is_active
                                ? t('common.deactivate', locale === 'zh' ? '停用' : 'Deactivate')
                                : t('common.activate', locale === 'zh' ? '启用' : 'Activate')}
                            </button>
                            <button
                              onClick={() => deleteCustomer(customer.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-12 bg-white">
                    <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">{t('customers.empty', locale === 'zh' ? '没有找到客户' : 'No customers found')}</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {searchTerm || statusFilter !== 'all'
                        ? t('customers.empty.filtered', locale === 'zh' ? '请尝试调整搜索或筛选条件。' : 'Try adjusting your search or filter.')
                        : t('customers.empty.fresh', locale === 'zh' ? '暂无客户注册。' : 'No customers have registered yet.')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
            <div className="flex flex-1 justify-between sm:hidden">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('common.prev', locale === 'zh' ? '上一页' : 'Previous')}
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page === totalPages}
                className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('common.next', locale === 'zh' ? '下一页' : 'Next')}
              </button>
            </div>
            <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  {t('common.page', locale === 'zh' ? '第 {page} 页 / 共 {pages} 页' : 'Page {page} / {pages}', { page, pages: totalPages })}
                </p>
              </div>
              <div>
                <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {t('common.prev', locale === 'zh' ? '上一页' : 'Previous')}
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page === totalPages}
                    className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {t('common.next', locale === 'zh' ? '下一页' : 'Next')}
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
