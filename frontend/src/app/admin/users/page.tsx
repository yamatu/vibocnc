'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  UserIcon,
  ShieldCheckIcon,
  XCircleIcon,
  CheckCircleIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import { apiClient } from '@/lib/api';
import Link from 'next/link';
import { useAdminI18n } from '@/lib/admin-i18n';
import type { APIResponse, PaginationResponse } from '@/types';

interface User {
  id: number;
  username?: string;
  email: string;
  full_name: string;
  role?: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
  user_type: 'admin' | 'customer';
}

export default function AdminUsersPage() {
  const { locale, t } = useAdminI18n();
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [userTypeFilter, setUserTypeFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    loadAllUsers();
  }, []);

  const loadAllUsers = async () => {
    try {
      setIsLoading(true);

      // Fetch both admin users and customers in parallel
      const [adminResponse, customerResponse] = await Promise.all([
        apiClient.get<APIResponse<User[]>>('/admin/users'),
        apiClient.get<APIResponse<PaginationResponse<Omit<User, 'user_type'>>>>('/admin/customers'),
      ]);

      // Process admin users
      const adminUsers = (adminResponse.data.data || []).map((user) => ({
        ...user,
        user_type: 'admin' as const,
      }));

      // Process customers
      const customers = (customerResponse.data.data?.data || []).map((customer) => ({
        ...customer,
        user_type: 'customer' as const,
        role: 'customer', // Add role for consistency
      }));

      // Combine and sort by creation date
      const combined = [...adminUsers, ...customers].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setAllUsers(combined);
    } catch (error: unknown) {
      console.error('Failed to load users:', error);
	  toast.error(t('users.toast.loadFailed', locale === 'zh' ? '加载用户失败' : 'Failed to load users'));
    } finally {
      setIsLoading(false);
    }
  };

  const deleteUser = async (userId: number, userType: 'admin' | 'customer', username: string) => {
    if (
      !confirm(
        t(
          'users.confirm.delete',
          locale === 'zh' ? '确定要删除用户“{name}”吗？此操作不可撤销。' : 'Are you sure you want to delete user "{name}"? This action cannot be undone.',
          { name: username }
        )
      )
    )
      return;

    try {
      if (userType === 'admin') {
        await apiClient.delete(`/admin/users/${userId}`);
      } else {
        await apiClient.delete(`/admin/customers/${userId}`);
      }
	  toast.success(t('users.toast.deleted', locale === 'zh' ? '用户已删除' : 'User deleted successfully'));
      loadAllUsers();
    } catch {
	  toast.error(t('users.toast.deleteFailed', locale === 'zh' ? '删除用户失败' : 'Failed to delete user'));
    }
  };

  const toggleUserStatus = async (userId: number, userType: 'admin' | 'customer', currentStatus: boolean, user: User) => {
    try {
      if (userType === 'admin') {
        await apiClient.put(`/admin/users/${userId}`, {
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          is_active: !currentStatus,
        });
      } else {
        await apiClient.put(`/admin/customers/${userId}/status`, {
          is_active: !currentStatus,
        });
      }
	  toast.success(t('users.toast.statusUpdated', locale === 'zh' ? '用户状态已更新' : 'User status updated successfully'));
      loadAllUsers();
    } catch {
	  toast.error(t('users.toast.statusUpdateFailed', locale === 'zh' ? '更新用户状态失败' : 'Failed to update user status'));
    }
  };

  // Filter users
  const filteredUsers = allUsers.filter((user) => {
    const matchesSearch =
      !searchQuery ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.username && user.username.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesUserType = !userTypeFilter || user.user_type === userTypeFilter;
    const matchesRole = !roleFilter || user.role === roleFilter;
    const matchesStatus =
      !statusFilter ||
      (statusFilter === 'true' && user.is_active) ||
      (statusFilter === 'false' && !user.is_active);

    return matchesSearch && matchesUserType && matchesRole && matchesStatus;
  });

  const getRoleBadge = (role: string | undefined, userType: string) => {
    if (userType === 'customer') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
          {t('users.role.customer', locale === 'zh' ? '客户' : 'Customer')}
        </span>
      );
    }

    const roleConfig: Record<string, { label: string; color: string }> = {
      admin: { label: t('users.role.admin', locale === 'zh' ? '管理员' : 'Admin'), color: 'bg-red-100 text-red-800' },
      manager: { label: t('users.role.manager', locale === 'zh' ? '经理' : 'Manager'), color: 'bg-blue-100 text-blue-800' },
      editor: { label: t('users.role.editor', locale === 'zh' ? '编辑' : 'Editor'), color: 'bg-green-100 text-green-800' },
      viewer: { label: t('users.role.viewer', locale === 'zh' ? '只读' : 'Viewer'), color: 'bg-gray-100 text-gray-800' },
    };

    const config = roleConfig[role || 'viewer'] || roleConfig.viewer;

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    );
  };

  const getStatusBadge = (isActive: boolean) => {
    return isActive ? (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <CheckCircleIcon className="h-3 w-3 mr-1" />
        {t('common.active', locale === 'zh' ? '启用' : 'Active')}
      </span>
    ) : (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        <XCircleIcon className="h-3 w-3 mr-1" />
        {t('common.inactive', locale === 'zh' ? '停用' : 'Inactive')}
      </span>
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('nav.users', 'All Users')}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {t('users.subtitle', locale === 'zh' ? '管理后台用户与注册客户' : 'Manage admin users and registered customers')}
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
            <Link
              href="/admin/users/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              {t('users.addAdmin', locale === 'zh' ? '新增管理员' : 'Add Admin')}
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ShieldCheckIcon className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      {t('users.stats.admin', locale === 'zh' ? '后台用户' : 'Admin Users')}
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {allUsers.filter((u) => u.user_type === 'admin').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <UserGroupIcon className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      {t('users.stats.customers', locale === 'zh' ? '客户' : 'Customers')}
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {allUsers.filter((u) => u.user_type === 'customer').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <CheckCircleIcon className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      {t('users.stats.active', locale === 'zh' ? '活跃用户' : 'Active Users')}
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {allUsers.filter((u) => u.is_active).length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="bg-white p-4 rounded-lg shadow border">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder={t('users.searchPh', locale === 'zh' ? '邮箱或姓名...' : 'Email or name...')}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="userType" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('users.filter.type', locale === 'zh' ? '用户类型' : 'User Type')}
                </label>
                <select
                  id="userType"
                  value={userTypeFilter}
                  onChange={(e) => setUserTypeFilter(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">{t('common.all', locale === 'zh' ? '全部' : 'All')}</option>
                  <option value="admin">{t('users.type.admin', locale === 'zh' ? '后台用户' : 'Admin Users')}</option>
                  <option value="customer">{t('users.type.customer', locale === 'zh' ? '客户' : 'Customers')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('users.filter.role', locale === 'zh' ? '角色' : 'Role')}
                </label>
                <select
                  id="role"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">{t('common.all', locale === 'zh' ? '全部' : 'All')}</option>
                  <option value="admin">{t('users.role.admin', locale === 'zh' ? '管理员' : 'Admin')}</option>
                  <option value="editor">{t('users.role.editor', locale === 'zh' ? '编辑' : 'Editor')}</option>
                  <option value="viewer">{t('users.role.viewer', locale === 'zh' ? '只读' : 'Viewer')}</option>
                  <option value="customer">{t('users.role.customer', locale === 'zh' ? '客户' : 'Customer')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.status', locale === 'zh' ? '状态' : 'Status')}
                </label>
                <select
                  id="status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">{t('common.all', locale === 'zh' ? '全部' : 'All')}</option>
                  <option value="true">{t('common.active', locale === 'zh' ? '启用' : 'Active')}</option>
                  <option value="false">{t('common.inactive', locale === 'zh' ? '停用' : 'Inactive')}</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setUserTypeFilter('');
                    setRoleFilter('');
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

        {/* Users Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-500">{t('users.loading', locale === 'zh' ? '正在加载用户...' : 'Loading users...')}</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center">
              <UserIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t('users.empty', locale === 'zh' ? '没有找到用户' : 'No users found')}</h3>
              <p className="text-gray-500">
                {searchQuery || userTypeFilter || roleFilter || statusFilter
                  ? t('users.empty.filtered', locale === 'zh' ? '请尝试调整筛选条件。' : 'Try adjusting your filters to see more users.')
                  : t('users.empty.fresh', locale === 'zh' ? '暂无用户注册。' : 'No users registered yet.')}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('users.table.user', locale === 'zh' ? '用户' : 'User')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('users.table.typeRole', locale === 'zh' ? '类型 / 角色' : 'Type / Role')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.status', locale === 'zh' ? '状态' : 'Status')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('users.table.lastLogin', locale === 'zh' ? '最近登录' : 'Last Login')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.created', locale === 'zh' ? '创建时间' : 'Created')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.actions', locale === 'zh' ? '操作' : 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredUsers.map((user) => (
                    <tr key={`${user.user_type}-${user.id}`} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                              user.user_type === 'admin' ? 'bg-blue-100' : 'bg-purple-100'
                            }`}>
                              {user.user_type === 'admin' ? (
                                <ShieldCheckIcon className="h-6 w-6 text-blue-600" />
                              ) : (
                                <UserIcon className="h-6 w-6 text-purple-600" />
                              )}
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {user.full_name}
                            </div>
                            <div className="text-sm text-gray-500">{user.email}</div>
                            {user.username && (
                              <div className="text-xs text-gray-400">@{user.username}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getRoleBadge(user.role, user.user_type)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(user.is_active)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {user.last_login_at
                          ? new Date(user.last_login_at).toLocaleDateString()
                          : t('common.never', locale === 'zh' ? '从未' : 'Never')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => toggleUserStatus(user.id, user.user_type, user.is_active, user)}
                            className={`inline-flex items-center px-2 py-1 border border-gray-300 rounded text-xs font-medium ${
                              user.is_active
                                ? 'text-red-700 bg-red-50 hover:bg-red-100'
                                : 'text-green-700 bg-green-50 hover:bg-green-100'
                            }`}
                          >
                            {user.is_active
                              ? t('common.deactivate', locale === 'zh' ? '停用' : 'Deactivate')
                              : t('common.activate', locale === 'zh' ? '启用' : 'Activate')}
                          </button>
                          {user.user_type === 'admin' && (
                            <Link
                              href={`/admin/users/${user.id}/edit`}
                              className="inline-flex items-center px-2 py-1 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                            >
                              <PencilIcon className="h-3 w-3 mr-1" />
                              {t('common.edit', locale === 'zh' ? '编辑' : 'Edit')}
                            </Link>
                          )}
                          <button
                            onClick={() => deleteUser(user.id, user.user_type, user.full_name || user.email)}
                            className="inline-flex items-center px-2 py-1 border border-red-300 rounded text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100"
                          >
                            <TrashIcon className="h-3 w-3 mr-1" />
                            {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
