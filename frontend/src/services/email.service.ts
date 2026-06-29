import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';

export interface EmailPublicConfig {
  enabled: boolean;
  provider: string;
  verification_enabled: boolean;
  marketing_enabled: boolean;
  code_expiry_minutes: number;
  code_resend_seconds: number;
}

export interface EmailSettings {
  id: number;
  enabled: boolean;
  provider: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_tls_mode: string;

  resend_api_key?: string;
  resend_webhook_secret?: string;
  alimail_endpoint?: string;
  alimail_client_id?: string;
  alimail_client_secret?: string;
  alimail_account_email?: string;
  verification_enabled: boolean;
  marketing_enabled: boolean;
  shipping_notifications_enabled?: boolean;
  // Legacy: kept for compatibility.
  order_notifications_enabled?: boolean;
  order_created_notifications_enabled?: boolean;
  order_paid_notifications_enabled?: boolean;
  order_notification_emails?: string;
  code_expiry_minutes: number;
  code_resend_seconds: number;
  has_smtp_password?: boolean;
  has_resend_api_key?: boolean;
  has_alimail_client_secret?: boolean;
}

export interface MailboxFolder {
  id: string;
  key: string;
  name: string;
  label: string;
}

export interface MailboxConfig {
  enabled: boolean;
  provider: string;
  account_email: string;
  from_email: string;
  from_name: string;
  reply_to: string;
  folders: MailboxFolder[];
  can_read: boolean;
}

export class EmailService {
  static async getPublicConfig(): Promise<EmailPublicConfig> {
    const res = await apiClient.get<APIResponse<EmailPublicConfig>>('/public/email/config');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load email config');
  }

  static async sendCode(payload: { email: string; purpose: 'register' | 'reset' }): Promise<void> {
    const res = await apiClient.post<APIResponse<void>>('/public/email/send-code', payload);
    if (!res.data.success) throw new Error(res.data.message || res.data.error || 'Failed to send code');
  }

  static async requestPasswordReset(email: string): Promise<void> {
    const res = await apiClient.post<APIResponse<void>>('/customer/password-reset/request', { email });
    if (!res.data.success) throw new Error(res.data.message || res.data.error || 'Failed to request reset');
  }

  static async confirmPasswordReset(payload: { email: string; code: string; new_password: string; confirm_password: string }): Promise<void> {
    const res = await apiClient.post<APIResponse<void>>('/customer/password-reset/confirm', payload);
    if (!res.data.success) throw new Error(res.data.message || res.data.error || 'Failed to reset password');
  }

  // Admin
  static async getSettings(): Promise<EmailSettings> {
    const res = await apiClient.get<APIResponse<EmailSettings>>('/admin/email/settings');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load email settings');
  }

  static async updateSettings(payload: Partial<EmailSettings>): Promise<EmailSettings> {
    const res = await apiClient.put<APIResponse<EmailSettings>>('/admin/email/settings?allow_clear=1', payload);
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to save email settings');
  }

  static async sendTest(to: string): Promise<void> {
    const res = await apiClient.post<APIResponse<void>>('/admin/email/test', { to });
    if (!res.data.success) throw new Error(res.data.message || res.data.error || 'Failed to send test');
  }

  static async send(payload: { to: string; subject: string; html?: string; text?: string }): Promise<void> {
    const res = await apiClient.post<APIResponse<void>>('/admin/email/send', payload);
    if (!res.data.success) throw new Error(res.data.message || res.data.error || 'Failed to send');
  }

  static async mailboxConfig(): Promise<MailboxConfig> {
    const res = await apiClient.get<APIResponse<MailboxConfig>>('/admin/email/mailbox/config');
    if (res.data.success && res.data.data) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to load mailbox config');
  }

  static async mailboxMessages(folderId: string, params?: { cursor?: string; size?: number }): Promise<any> {
    const res = await apiClient.get<APIResponse<any>>(`/admin/email/mailbox/folders/${encodeURIComponent(folderId)}/messages`, { params });
    if (res.data.success) return res.data.data || {};
    throw new Error(res.data.message || res.data.error || 'Failed to load messages');
  }

  static async mailboxMessage(messageId: string): Promise<any> {
    const res = await apiClient.get<APIResponse<any>>(`/admin/email/mailbox/messages/${encodeURIComponent(messageId)}`);
    if (res.data.success) return res.data.data || {};
    throw new Error(res.data.message || res.data.error || 'Failed to load message');
  }

  static async mailboxAttachments(messageId: string): Promise<any> {
    const res = await apiClient.get<APIResponse<any>>(`/admin/email/mailbox/messages/${encodeURIComponent(messageId)}/attachments`);
    if (res.data.success) return res.data.data || {};
    throw new Error(res.data.message || res.data.error || 'Failed to load attachments');
  }

  static async downloadAttachment(messageId: string, attachmentId: string): Promise<{ blob: Blob; filename: string }> {
    const res = await apiClient.get(`/admin/email/mailbox/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/download`, {
      responseType: 'blob',
    });
    const disposition = String(res.headers?.['content-disposition'] || '');
    const match = disposition.match(/filename="?([^"]+)"?/i);
    return { blob: res.data, filename: match?.[1] || 'attachment' };
  }

  static async resendWebhooksList(): Promise<any> {
    const res = await apiClient.get<APIResponse<any>>('/admin/email/resend/webhooks');
    if (res.data.success) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to list webhooks');
  }

  static async resendWebhooksCreate(payload: { endpoint: string; events: string[] }): Promise<any> {
    const res = await apiClient.post<APIResponse<any>>('/admin/email/resend/webhooks', payload);
    if (res.data.success) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to create webhook');
  }

  static async resendWebhooksUpdate(id: string, payload: { endpoint?: string; events?: string[]; status?: string }): Promise<any> {
    const res = await apiClient.put<APIResponse<any>>(`/admin/email/resend/webhooks/${id}`, payload);
    if (res.data.success) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to update webhook');
  }

  static async resendWebhooksRemove(id: string): Promise<any> {
    const res = await apiClient.delete<APIResponse<any>>(`/admin/email/resend/webhooks/${id}`);
    if (res.data.success) return res.data.data;
    throw new Error(res.data.message || res.data.error || 'Failed to delete webhook');
  }

  static async broadcast(payload: {
    subject: string;
    html: string;
    text?: string;
    test_to?: string;
    limit?: number;
  }): Promise<{ sent?: number; failed?: number; total?: number }> {
    const res = await apiClient.post<APIResponse<any>>('/admin/email/broadcast', payload);
    if (res.data.success) return res.data.data || {};
    throw new Error(res.data.message || res.data.error || 'Failed to send broadcast');
  }
}
