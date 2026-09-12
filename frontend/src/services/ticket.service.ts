import { apiClient } from '@/lib/api';
import { APIResponse } from '@/types';

export interface Ticket {
  id: number;
  ticket_number: string;
  customer_id: number;
  subject: string;
  message: string;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
  order_id?: number;
  order_number?: string;
  assigned_to_id?: number;
  resolved_at?: string;
  closed_at?: string;
  created_at: string;
  updated_at: string;
  replies?: TicketReply[];
  customer?: Record<string, unknown>;
  assigned_to?: Record<string, unknown>;
}

export interface TicketReply {
  id: number;
  ticket_id: number;
  customer_id?: number;
  admin_user_id?: number;
  message: string;
  is_internal: boolean;
  created_at: string;
  updated_at: string;
  customer?: Record<string, unknown>;
  admin_user?: Record<string, unknown>;
}

export interface CreateTicketRequest {
  subject: string;
  message: string;
  category?: string;
  priority?: string;
  order_number?: string;
}

export interface ReplyTicketRequest {
  message: string;
}

export class TicketService {
  // 创建工单
  static async createTicket(data: CreateTicketRequest): Promise<Ticket> {
    const response = await apiClient.post<APIResponse<Ticket>>(
      '/customer/tickets',
      data
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to create ticket');
  }

  // 获取我的工单列表
  static async getMyTickets(params?: { status?: string }): Promise<Ticket[]> {
    const response = await apiClient.get<APIResponse<Ticket[]>>(
      '/customer/tickets',
      { params }
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    return [];
  }

  // 获取工单详情
  static async getTicketDetails(ticketId: number): Promise<Ticket> {
    const response = await apiClient.get<APIResponse<Ticket>>(
      `/customer/tickets/${ticketId}`
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error('Ticket not found');
  }

  // 回复工单
  static async replyToTicket(ticketId: number, data: ReplyTicketRequest): Promise<TicketReply> {
    const response = await apiClient.post<APIResponse<TicketReply>>(
      `/customer/tickets/${ticketId}/reply`,
      data
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error('Failed to reply to ticket');
  }
}
