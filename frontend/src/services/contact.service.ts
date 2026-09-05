import api from '@/lib/api';

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  subject: string;
  message: string;
  inquiry_type: 'general' | 'parts' | 'repair' | 'support' | 'quote';
  status: 'new' | 'read' | 'replied' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  ip_address?: string;
  user_agent?: string;
  replied_at?: string;
  replied_by?: number;
  admin_notes?: string;
  created_at: string;
  updated_at: string;
  notification_status?: 'queued' | 'sent' | 'failed';
  notification_error?: string;
  notification_sent_at?: string;
}

export interface ContactCreateRequest {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  subject: string;
  message: string;
  inquiry_type?: 'general' | 'parts' | 'repair' | 'support' | 'quote';
}

export interface ContactUpdateRequest {
  status?: 'new' | 'read' | 'replied' | 'closed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  admin_notes?: string;
}

export interface ContactFilters {
  status?: string;
  priority?: string;
  inquiry_type?: string;
  page?: number;
  page_size?: number;
}

export interface ContactStats {
  total: number;
  new: number;
  read: number;
  replied: number;
  closed: number;
  today: number;
  this_week: number;
}

export interface ContactListResponse {
  data: ContactMessage[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

class ContactService {
  // Public API - Submit contact form
  async submitContact(data: ContactCreateRequest): Promise<{ message: string; id: number }> {
    try {
      const response = await api.post('/public/contact', data);
      return response.data;
    } catch (error: any) {
      // 如果 axios 失败，使用 fetch 作为备选（浏览器端使用相对路径，通过 Nginx 代理）
      const fetchResponse = await fetch(`/api/v1/public/contact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!fetchResponse.ok) {
        const errorData = await fetchResponse.json();
        throw new Error(errorData.error || 'Failed to submit contact form');
      }

      return await fetchResponse.json();
    }
  }

  // Admin API - Get contact messages
  async getContacts(filters?: ContactFilters): Promise<ContactListResponse> {
    const params = new URLSearchParams();
    
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.inquiry_type) params.append('inquiry_type', filters.inquiry_type);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.page_size) params.append('page_size', filters.page_size.toString());

    const response = await api.get(`/admin/contacts?${params.toString()}`);
    return response.data;
  }

  // Admin API - Get contact message by ID
  async getContact(id: number): Promise<ContactMessage> {
    const response = await api.get(`/admin/contacts/${id}`);
    return response.data.data;
  }

  // Admin API - Update contact message
  async updateContact(id: number, data: ContactUpdateRequest): Promise<{ message: string }> {
    const response = await api.put(`/admin/contacts/${id}`, data);
    return response.data;
  }

  // Admin API - Delete contact message
  async deleteContact(id: number): Promise<{ message: string }> {
    const response = await api.delete(`/admin/contacts/${id}`);
    return response.data;
  }

  // Admin API - Get contact statistics
  async getContactStats(): Promise<ContactStats> {
    const response = await api.get('/admin/contacts/stats');
    return response.data.data;
  }

  async retryNotification(id: number): Promise<{ message: string; notification_status: string }> {
    const response = await api.post(`/admin/contacts/${id}/notify`);
    return response.data;
  }
}

export default new ContactService();
