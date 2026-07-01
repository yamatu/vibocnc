'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ContactService, ContactMessage, ContactStats } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { toast } from 'react-hot-toast';
import {
  EnvelopeIcon,
  PhoneIcon,
  BuildingOfficeIcon,
  CalendarIcon,
  EyeIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import AdminLayout from '@/components/admin/AdminLayout';
import { useAdminI18n } from '@/lib/admin-i18n';

export default function ContactsPage() {
  const { locale, t } = useAdminI18n();
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedPriority, setSelectedPriority] = useState<string>('');
  const [selectedMessage, setSelectedMessage] = useState<ContactMessage | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingStatus, setEditingStatus] = useState<ContactMessage['status']>('new');
  const [editingPriority, setEditingPriority] = useState<ContactMessage['priority']>('medium');
  const [adminNotes, setAdminNotes] = useState<string>('');

  const queryClient = useQueryClient();

  // 获取联系消息统计
  const { data: stats } = useQuery<ContactStats>({
    queryKey: queryKeys.contacts.stats(),
    queryFn: () => ContactService.getContactStats(),
  });

  // 获取联系消息列表
  const { data: contactsResponse, isLoading } = useQuery({
    queryKey: queryKeys.contacts.list({ status: selectedStatus, priority: selectedPriority }),
    queryFn: () => ContactService.getContacts({
      status: selectedStatus || undefined,
      priority: selectedPriority || undefined,
    }),
  });

  const contacts = contactsResponse?.data || [];

  const updateContactMutation = useMutation({
    mutationFn: ({ id, status, priority, admin_notes }: { id: number; status: ContactMessage['status']; priority?: ContactMessage['priority']; admin_notes?: string }) =>
      ContactService.updateContact(id, { status, priority, admin_notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.stats() });
	  toast.success(t('contacts.toast.statusUpdated', locale === 'zh' ? '状态已更新' : 'Status updated successfully'));
    },
    onError: () => {
	  toast.error(t('contacts.toast.statusUpdateFailed', locale === 'zh' ? '更新状态失败' : 'Failed to update status'));
    },
  });

  // 删除消息
  const deleteMutation = useMutation({
    mutationFn: (id: number) => ContactService.deleteContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.stats() });
	  toast.success(t('contacts.toast.deleted', locale === 'zh' ? '消息已删除' : 'Message deleted successfully'));
    },
    onError: () => {
	  toast.error(t('contacts.toast.deleteFailed', locale === 'zh' ? '删除消息失败' : 'Failed to delete message'));
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-100 text-blue-800';
      case 'read': return 'bg-yellow-100 text-yellow-800';
      case 'replied': return 'bg-green-100 text-green-800';
      case 'closed': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getInquiryTypeIcon = (type: string) => {
    switch (type) {
      case 'parts': return <BuildingOfficeIcon className="h-4 w-4" />;
      case 'repair': return <CheckIcon className="h-4 w-4" />;
      case 'support': return <ChatBubbleLeftRightIcon className="h-4 w-4" />;
      case 'quote': return <EnvelopeIcon className="h-4 w-4" />;
      default: return <EnvelopeIcon className="h-4 w-4" />;
    }
  };

  const getStatusLabel = (status: string) => {
    const s = String(status || '').toLowerCase();
    const map: Record<string, string> = {
      new: t('contacts.status.new', locale === 'zh' ? '新消息' : 'New'),
      read: t('contacts.status.read', locale === 'zh' ? '已读' : 'Read'),
      replied: t('contacts.status.replied', locale === 'zh' ? '已回复' : 'Replied'),
      closed: t('contacts.status.closed', locale === 'zh' ? '已关闭' : 'Closed'),
    };
    return map[s] || status || '-';
  };

  const getPriorityLabel = (priority: string) => {
    const p = String(priority || '').toLowerCase();
    const map: Record<string, string> = {
      urgent: t('contacts.priority.urgent', locale === 'zh' ? '紧急' : 'Urgent'),
      high: t('contacts.priority.high', locale === 'zh' ? '高' : 'High'),
      medium: t('contacts.priority.medium', locale === 'zh' ? '中' : 'Medium'),
      low: t('contacts.priority.low', locale === 'zh' ? '低' : 'Low'),
    };
    return map[p] || priority || '-';
  };

  const getInquiryTypeLabel = (type: string) => {
    const x = String(type || '').toLowerCase();
    const map: Record<string, string> = {
      general: t('contacts.type.general', locale === 'zh' ? '常规' : 'General'),
      parts: t('contacts.type.parts', locale === 'zh' ? '配件' : 'Parts'),
      repair: t('contacts.type.repair', locale === 'zh' ? '维修' : 'Repair'),
      support: t('contacts.type.support', locale === 'zh' ? '技术支持' : 'Support'),
      quote: t('contacts.type.quote', locale === 'zh' ? '报价' : 'Quote'),
    };
    return map[x] || type || '-';
  };

  const formatContactTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value || '-';
    }
    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: locale === 'zh' ? zhCN : undefined,
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('nav.contacts', 'Contact Messages')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('contacts.subtitle', locale === 'zh' ? '管理客户咨询与支持请求' : 'Manage customer inquiries and support requests')}</p>
        </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-600">{t('common.total', locale === 'zh' ? '总计' : 'Total')}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-blue-600">{stats.new}</div>
            <div className="text-sm text-gray-600">{t('contacts.status.new', locale === 'zh' ? '新消息' : 'New')}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-yellow-600">{stats.read}</div>
            <div className="text-sm text-gray-600">{t('contacts.status.read', locale === 'zh' ? '已读' : 'Read')}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-green-600">{stats.replied}</div>
            <div className="text-sm text-gray-600">{t('contacts.status.replied', locale === 'zh' ? '已回复' : 'Replied')}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-gray-600">{stats.closed}</div>
            <div className="text-sm text-gray-600">{t('contacts.status.closed', locale === 'zh' ? '已关闭' : 'Closed')}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-purple-600">{stats.today}</div>
            <div className="text-sm text-gray-600">{t('common.today', locale === 'zh' ? '今天' : 'Today')}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-indigo-600">{stats.this_week}</div>
            <div className="text-sm text-gray-600">{t('common.thisWeek', locale === 'zh' ? '本周' : 'This Week')}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('contacts.field.status', locale === 'zh' ? '状态' : 'Status')}</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
			  <option value="">{t('common.all', locale === 'zh' ? '全部' : 'All Status')}</option>
			  <option value="new">{t('contacts.status.new', locale === 'zh' ? '新消息' : 'New')}</option>
			  <option value="read">{t('contacts.status.read', locale === 'zh' ? '已读' : 'Read')}</option>
			  <option value="replied">{t('contacts.status.replied', locale === 'zh' ? '已回复' : 'Replied')}</option>
			  <option value="closed">{t('contacts.status.closed', locale === 'zh' ? '已关闭' : 'Closed')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('contacts.field.priority', locale === 'zh' ? '优先级' : 'Priority')}</label>
            <select
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
			  <option value="">{t('common.all', locale === 'zh' ? '全部' : 'All Priority')}</option>
			  <option value="urgent">{t('contacts.priority.urgent', locale === 'zh' ? '紧急' : 'Urgent')}</option>
			  <option value="high">{t('contacts.priority.high', locale === 'zh' ? '高' : 'High')}</option>
			  <option value="medium">{t('contacts.priority.medium', locale === 'zh' ? '中' : 'Medium')}</option>
			  <option value="low">{t('contacts.priority.low', locale === 'zh' ? '低' : 'Low')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Messages List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">{t('contacts.loading', locale === 'zh' ? '正在加载消息...' : 'Loading messages...')}</p>
          </div>
        ) : contacts && contacts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					{t('contacts.table.contact', locale === 'zh' ? '联系人' : 'Contact')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					{t('contacts.table.subject', locale === 'zh' ? '主题' : 'Subject')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					{t('contacts.table.type', locale === 'zh' ? '类型' : 'Type')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					{t('contacts.field.status', locale === 'zh' ? '状态' : 'Status')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					{t('contacts.field.priority', locale === 'zh' ? '优先级' : 'Priority')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					{t('common.date', locale === 'zh' ? '日期' : 'Date')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					{t('common.actions', locale === 'zh' ? '操作' : 'Actions')}
                    </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{contact.name}</div>
                        <div className="text-sm text-gray-500 flex items-center">
                          <EnvelopeIcon className="h-4 w-4 mr-1" />
                          {contact.email}
                        </div>
                        {contact.phone && (
                          <div className="text-sm text-gray-500 flex items-center">
                            <PhoneIcon className="h-4 w-4 mr-1" />
                            {contact.phone}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{contact.subject}</div>
                      <div className="text-sm text-gray-500 truncate max-w-xs">
                        {contact.message}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {getInquiryTypeIcon(contact.inquiry_type)}
                        <span className="ml-2 text-sm text-gray-900 capitalize">
                          {getInquiryTypeLabel(contact.inquiry_type)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(contact.status)}`}>
                        {getStatusLabel(contact.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPriorityColor(contact.priority)}`}>
                        {getPriorityLabel(contact.priority)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center">
                        <CalendarIcon className="h-4 w-4 mr-1" />
                        {formatContactTime(contact.created_at)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => {
                            // Fetch full record and mark as read via GET /admin/contacts/:id
                            ContactService.getContact(contact.id)
                              .then((msg) => {
                                setSelectedMessage(msg);
                                setEditingStatus(msg.status);
                                setEditingPriority(msg.priority);
                                setAdminNotes(msg.admin_notes || '');
                                setShowModal(true);
                              })
                              .catch((e: any) => {
								toast.error(e?.message || t('contacts.toast.loadFailed', locale === 'zh' ? '加载消息失败' : 'Failed to load message'));
                              });
                          }}
                          className="text-yellow-600 hover:text-yellow-900"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => updateContactMutation.mutate({ id: contact.id, status: 'replied', priority: contact.priority })}
                          className="text-green-600 hover:text-green-900"
                          disabled={contact.status === 'replied'}
                        >
                          <CheckIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(contact.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <EnvelopeIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
			<p className="text-gray-600">{t('contacts.empty', locale === 'zh' ? '暂无联系消息' : 'No contact messages found')}</p>
          </div>
        )}
      </div>

      {/* Message Detail Modal */}
      {showModal && selectedMessage && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white">
            <div className="flex justify-between items-center mb-4">
			  <h3 className="text-lg font-bold text-gray-900">{t('contacts.detail.title', locale === 'zh' ? '消息详情' : 'Message Details')}</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
				  <label className="block text-sm font-medium text-gray-700">{t('contacts.field.name', locale === 'zh' ? '姓名' : 'Name')}</label>
                  <p className="text-sm text-gray-900">{selectedMessage.name}</p>
                </div>
                <div>
				  <label className="block text-sm font-medium text-gray-700">{t('contacts.field.email', locale === 'zh' ? '邮箱' : 'Email')}</label>
                  <p className="text-sm text-gray-900">{selectedMessage.email}</p>
                </div>
              </div>
              
              {selectedMessage.phone && (
                <div>
				  <label className="block text-sm font-medium text-gray-700">{t('contacts.field.phone', locale === 'zh' ? '电话' : 'Phone')}</label>
                  <p className="text-sm text-gray-900">{selectedMessage.phone}</p>
                </div>
              )}
              
              {selectedMessage.company && (
                <div>
				  <label className="block text-sm font-medium text-gray-700">{t('contacts.field.company', locale === 'zh' ? '公司' : 'Company')}</label>
                  <p className="text-sm text-gray-900">{selectedMessage.company}</p>
                </div>
              )}
              
              <div>
				<label className="block text-sm font-medium text-gray-700">{t('contacts.field.subject', locale === 'zh' ? '主题' : 'Subject')}</label>
                <p className="text-sm text-gray-900">{selectedMessage.subject}</p>
              </div>
              
              <div>
				<label className="block text-sm font-medium text-gray-700">{t('contacts.field.message', locale === 'zh' ? '内容' : 'Message')}</label>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{selectedMessage.message}</p>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('contacts.field.type', locale === 'zh' ? '类型' : 'Type')}</label>
                  <p className="text-sm text-gray-900 capitalize">{getInquiryTypeLabel(selectedMessage.inquiry_type)}</p>
                </div>
                <div>
				  <label className="block text-sm font-medium text-gray-700">{t('contacts.field.status', locale === 'zh' ? '状态' : 'Status')}</label>
                  <select
                    value={editingStatus}
                    onChange={(e) => setEditingStatus(e.target.value as any)}
                    className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="new">{t('contacts.status.new', locale === 'zh' ? '新消息' : 'New')}</option>
                    <option value="read">{t('contacts.status.read', locale === 'zh' ? '已读' : 'Read')}</option>
                    <option value="replied">{t('contacts.status.replied', locale === 'zh' ? '已回复' : 'Replied')}</option>
                    <option value="closed">{t('contacts.status.closed', locale === 'zh' ? '已关闭' : 'Closed')}</option>
                  </select>
                </div>
                <div>
				  <label className="block text-sm font-medium text-gray-700">{t('contacts.field.priority', locale === 'zh' ? '优先级' : 'Priority')}</label>
                  <select
                    value={editingPriority}
                    onChange={(e) => setEditingPriority(e.target.value as any)}
                    className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="urgent">{t('contacts.priority.urgent', locale === 'zh' ? '紧急' : 'Urgent')}</option>
                    <option value="high">{t('contacts.priority.high', locale === 'zh' ? '高' : 'High')}</option>
                    <option value="medium">{t('contacts.priority.medium', locale === 'zh' ? '中' : 'Medium')}</option>
                    <option value="low">{t('contacts.priority.low', locale === 'zh' ? '低' : 'Low')}</option>
                  </select>
                </div>
              </div>

              <div>
				<label className="block text-sm font-medium text-gray-700">{t('contacts.field.adminNotes', locale === 'zh' ? '管理员备注' : 'Admin Notes')}</label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={4}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t(
                    'contacts.field.adminNotesPh',
                    locale === 'zh' ? '内部备注（客户不可见）' : 'Internal notes (not visible to customer)'
                  )}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">{t('contacts.field.received', locale === 'zh' ? '接收时间' : 'Received')}</label>
                <p className="text-sm text-gray-900">
                  {new Date(selectedMessage.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  updateContactMutation.mutate({
                    id: selectedMessage.id,
                    status: editingStatus,
                    priority: editingPriority,
                    admin_notes: adminNotes,
                  });
                  setShowModal(false);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {t('common.save', locale === 'zh' ? '保存' : 'Save')}
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                {t('common.close', locale === 'zh' ? '关闭' : 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </AdminLayout>
  );
}
