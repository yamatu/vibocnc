'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { apiClient } from '@/lib/api';
import AdminLayout from '@/components/admin/AdminLayout';
import Link from 'next/link';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  TicketIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { useAdminI18n } from '@/lib/admin-i18n';
import type { APIResponse } from '@/types';

interface Ticket {
  id: number;
  ticket_number: string;
  subject: string;
  message: string;
  category: string;
  priority: string;
  status: string;
  order_number?: string;
  created_at: string;
  updated_at: string;
  customer: {
    id: number;
    full_name: string;
    email: string;
  };
}

// statusConfig is built inside component so it can be localized.

const priorityColors: Record<string, string> = {
  low: 'text-gray-600',
  normal: 'text-blue-600',
  high: 'text-orange-600',
  urgent: 'text-red-600 font-semibold',
};

export default function AdminTicketsPage() {
  const { locale, t } = useAdminI18n();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
    open: { label: t('tickets.status.open', locale === 'zh' ? '未处理' : 'Open'), color: 'bg-blue-100 text-blue-800', icon: ClockIcon },
    'in-progress': {
      label: t('tickets.status.inProgress', locale === 'zh' ? '处理中' : 'In Progress'),
      color: 'bg-yellow-100 text-yellow-800',
      icon: ClockIcon,
    },
    resolved: { label: t('tickets.status.resolved', locale === 'zh' ? '已解决' : 'Resolved'), color: 'bg-green-100 text-green-800', icon: CheckCircleIcon },
    closed: { label: t('tickets.status.closed', locale === 'zh' ? '已关闭' : 'Closed'), color: 'bg-gray-100 text-gray-800', icon: XCircleIcon },
  };

  const getPriorityLabel = (priority: string) => {
    const p = String(priority || '').toLowerCase();
    const map: Record<string, string> = {
      low: t('tickets.priority.low', locale === 'zh' ? '低' : 'Low'),
      normal: t('tickets.priority.normal', locale === 'zh' ? '普通' : 'Normal'),
      high: t('tickets.priority.high', locale === 'zh' ? '高' : 'High'),
      urgent: t('tickets.priority.urgent', locale === 'zh' ? '紧急' : 'Urgent'),
    };
    return map[p] || priority.toUpperCase();
  };

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<APIResponse<Ticket[]>>('/admin/tickets');
      if (response.data.success) {
        setTickets(response.data.data || []);
      }
    } catch (error: unknown) {
      console.error('Failed to load tickets:', error);
	  toast.error(t('tickets.toast.loadFailed', locale === 'zh' ? '加载工单失败' : 'Failed to load support tickets'));
    } finally {
      setLoading(false);
    }
  };

  const updateTicketStatus = async (ticketId: number, newStatus: string) => {
    try {
      const response = await apiClient.put<APIResponse<unknown>>(`/admin/tickets/${ticketId}`, {
        status: newStatus,
      });

      if (response.data.success) {
		toast.success(t('tickets.toast.statusUpdated', locale === 'zh' ? '工单状态已更新' : 'Ticket status updated'));
        loadTickets();
      }
    } catch {
	  toast.error(t('tickets.toast.statusUpdateFailed', locale === 'zh' ? '更新工单状态失败' : 'Failed to update ticket status'));
    }
  };

  const filteredTickets = tickets.filter((ticket) => {
    const matchesSearch =
      !searchTerm ||
      ticket.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.ticket_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.customer.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.customer.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = !statusFilter || ticket.status === statusFilter;
    const matchesPriority = !priorityFilter || ticket.priority === priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  // Group tickets by status
  const ticketsByStatus = {
    open: filteredTickets.filter((t) => t.status === 'open').length,
    'in-progress': filteredTickets.filter((t) => t.status === 'in-progress').length,
    resolved: filteredTickets.filter((t) => t.status === 'resolved').length,
    closed: filteredTickets.filter((t) => t.status === 'closed').length,
  };

  return (
    <AdminLayout>
      <div className="px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-2xl font-semibold text-gray-900">{t('nav.tickets', 'Support Tickets')}</h1>
            <p className="mt-2 text-sm text-gray-700">
              {t('tickets.subtitle', locale === 'zh' ? '管理客户支持工单与咨询' : 'Manage customer support tickets and inquiries')}
            </p>
          </div>
          <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <FunnelIcon className="h-4 w-4 mr-2" />
              {t('common.filters', locale === 'zh' ? '筛选' : 'Filters')}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-4">
          {Object.entries(ticketsByStatus).map(([status, count]) => {
            const config = statusConfig[status];
            const Icon = config.icon;
            return (
              <div key={status} className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <Icon className="h-6 w-6 text-gray-400" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate capitalize">
                          {statusConfig[status]?.label || status.replace('-', ' ')}
                        </dt>
                        <dd className="text-lg font-medium text-gray-900">{count}</dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-6 bg-white p-4 rounded-lg shadow border">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.search', locale === 'zh' ? '搜索' : 'Search')}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    id="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder={t('tickets.searchPh', locale === 'zh' ? '搜索工单...' : 'Search tickets...')}
                  />
                </div>
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
                  <option value="open">{statusConfig.open.label}</option>
                  <option value="in-progress">{statusConfig['in-progress'].label}</option>
                  <option value="resolved">{statusConfig.resolved.label}</option>
                  <option value="closed">{statusConfig.closed.label}</option>
                </select>
              </div>

              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('tickets.field.priority', locale === 'zh' ? '优先级' : 'Priority')}
                </label>
                <select
                  id="priority"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">{t('common.all', locale === 'zh' ? '全部' : 'All')}</option>
                  <option value="low">{t('tickets.priority.low', locale === 'zh' ? '低' : 'Low')}</option>
                  <option value="normal">{t('tickets.priority.normal', locale === 'zh' ? '普通' : 'Normal')}</option>
                  <option value="high">{t('tickets.priority.high', locale === 'zh' ? '高' : 'High')}</option>
                  <option value="urgent">{t('tickets.priority.urgent', locale === 'zh' ? '紧急' : 'Urgent')}</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Tickets Table */}
        <div className="mt-8 flex flex-col">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                {loading ? (
                  <div className="text-center py-12 bg-white">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-sm text-gray-500">{t('tickets.loading', locale === 'zh' ? '正在加载工单...' : 'Loading tickets...')}</p>
                  </div>
                ) : filteredTickets.length > 0 ? (
                  <table className="min-w-full divide-y divide-gray-300">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                          {t('tickets.table.ticket', locale === 'zh' ? '工单' : 'Ticket')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('tickets.table.customer', locale === 'zh' ? '客户' : 'Customer')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('tickets.table.category', locale === 'zh' ? '分类' : 'Category')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('tickets.field.priority', locale === 'zh' ? '优先级' : 'Priority')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('common.status', locale === 'zh' ? '状态' : 'Status')}
                        </th>
                        <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                          {t('common.created', locale === 'zh' ? '创建时间' : 'Created')}
                        </th>
                        <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                          <span className="sr-only">{t('common.actions', locale === 'zh' ? '操作' : 'Actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {filteredTickets.map((ticket) => {
                        const statusInfo = statusConfig[ticket.status];
                        const StatusIcon = statusInfo.icon;

                        return (
                          <tr key={ticket.id} className="hover:bg-gray-50">
                            <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6">
                              <div>
                                <div className="font-medium text-gray-900">{ticket.subject}</div>
                                <div className="text-gray-500">#{ticket.ticket_number}</div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                              <div>
                                <div className="font-medium text-gray-900">
                                  {ticket.customer.full_name}
                                </div>
                                <div className="text-gray-500">{ticket.customer.email}</div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 capitalize">
                              {ticket.category.replace('-', ' ')}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm">
                              <span className={priorityColors[ticket.priority]}>
                                {getPriorityLabel(ticket.priority)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm">
                              <span
                                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}
                              >
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {statusInfo.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                              {new Date(ticket.created_at).toLocaleDateString()}
                            </td>
                            <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                              <select
                                value={ticket.status}
                                onChange={(e) => updateTicketStatus(ticket.id, e.target.value)}
                                className="mr-2 text-xs rounded-md border-gray-300"
                              >
                                <option value="open">{statusConfig.open.label}</option>
                                <option value="in-progress">{statusConfig['in-progress'].label}</option>
                                <option value="resolved">{statusConfig.resolved.label}</option>
                                <option value="closed">{statusConfig.closed.label}</option>
                              </select>
                              <Link
                                href={`/admin/tickets/${ticket.id}`}
                                className="text-blue-600 hover:text-blue-900"
                              >
                                {t('common.view', locale === 'zh' ? '查看' : 'View')}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-12 bg-white">
                    <TicketIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">{t('tickets.empty', locale === 'zh' ? '没有找到工单' : 'No tickets found')}</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {searchTerm || statusFilter || priorityFilter
                        ? t('tickets.empty.filtered', locale === 'zh' ? '请尝试调整搜索或筛选条件。' : 'Try adjusting your search or filter.')
                        : t('tickets.empty.fresh', locale === 'zh' ? '暂无提交的支持工单。' : 'No support tickets have been submitted yet.')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
