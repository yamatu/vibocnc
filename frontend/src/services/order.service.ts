import { apiClient } from '@/lib/api';
import { 
  APIResponse, 
  PaginationResponse, 
  Order, 
  OrderItem 
} from '@/types';

export interface OrderCreateRequest {
  customer_email: string;
  customer_name: string;
  customer_phone: string;
  shipping_address: string;
  shipping_country: string;
  billing_address: string;
  notes?: string;
  coupon_code?: string; // Optional coupon code
  items: Array<{
    product_id: number;
    quantity: number;
    unit_price: number;
  }>;
}

export interface OrderFilters {
  page?: number;
  page_size?: number;
  status?: string;
  payment_status?: string;
  customer_email?: string;
  order_number?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
}

export interface PaymentRequest {
  payment_method: string;
  payment_data?: any;
}

export interface Refund {
  id: number;
  order_id: number;
  provider_refund_id?: string;
  capture_id: string;
  amount: number;
  currency: string;
  reason?: string;
  status: 'pending' | 'completed' | 'failed' | string;
  requested_by?: number;
  created_at: string;
  updated_at: string;
}

export interface RefundOrderResponse {
  order: Order;
  refund: Refund;
  refundable_amount: number;
}

export class OrderService {
  // Create order (public)
  static async createOrder(orderData: OrderCreateRequest): Promise<Order> {
    const response = await apiClient.post<APIResponse<Order>>(
      '/orders',
      orderData
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Failed to create order');
  }

  // Process payment (public)
  static async processPayment(orderId: number, paymentData: PaymentRequest): Promise<Order> {
    const response = await apiClient.post<APIResponse<Order>>(
      `/orders/${orderId}/payment`,
      paymentData
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Payment processing failed');
  }

  // Admin: Get orders
  static async getOrders(filters: OrderFilters = {}): Promise<PaginationResponse<Order>> {
    const params = new URLSearchParams();
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.append(key, value.toString());
      }
    });

    const response = await apiClient.get<APIResponse<PaginationResponse<Order>>>(
      `/admin/orders?${params.toString()}`
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Failed to fetch orders');
  }

  // Admin: Get single order
  static async getOrder(id: number): Promise<Order> {
    const response = await apiClient.get<APIResponse<Order>>(
      `/admin/orders/${id}`
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Order not found');
  }

  // Admin: Update order status
  static async updateOrderStatus(id: number, status: string): Promise<Order> {
    const response = await apiClient.put<APIResponse<Order>>(
      `/admin/orders/${id}/status`,
      { status }
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to update order status');
  }

  // Admin: Update order
  static async updateOrder(id: number, orderData: {
    customer_email?: string;
    customer_name?: string;
    customer_phone?: string;
    shipping_address?: string;
    billing_address?: string;
    tracking_number?: string;
    shipping_carrier?: string;
    notify_shipped?: boolean;
    status?: string;
    payment_status?: string;
    notes?: string;
  }): Promise<Order> {
    const response = await apiClient.put<APIResponse<Order>>(
      `/admin/orders/${id}?allow_clear=1`,
      orderData
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error(response.data.message || 'Failed to update order');
  }

  // Admin: Delete order
  static async deleteOrder(id: number): Promise<void> {
    const response = await apiClient.delete<APIResponse<void>>(
      `/admin/orders/${id}`
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to delete order');
    }
  }

  // Admin: refund a PayPal capture. Amount is optional and defaults to the remaining balance.
  static async refundOrder(id: number, payload: { amount?: number; reason?: string } = {}): Promise<RefundOrderResponse> {
    const response = await apiClient.post<APIResponse<RefundOrderResponse>>(
      `/admin/orders/${id}/refund`,
      payload
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Refund failed');
  }

  static async syncRefund(id: number, refundId: number): Promise<RefundOrderResponse> {
    const response = await apiClient.post<APIResponse<RefundOrderResponse>>(
      `/admin/orders/${id}/refund/${refundId}/sync`,
      {}
    );
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error(response.data.message || response.data.error || 'Failed to sync refund');
  }

  // Get order by order number (public - for order tracking)
  static async getOrderByNumber(orderNumber: string): Promise<Order> {
    const response = await apiClient.get<APIResponse<Order>>(
      `/orders/track/${orderNumber}`
    );
    
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error(response.data.message || 'Order not found');
  }

  // Calculate order total
  static calculateOrderTotal(items: Array<{ quantity: number; unit_price: number }>): number {
    return items.reduce((total, item) => total + (item.quantity * item.unit_price), 0);
  }

  // Get order status options
  static getOrderStatusOptions(): Array<{ value: string; label: string; color: string }> {
    return [
      { value: 'pending', label: 'Pending', color: 'yellow' },
      { value: 'confirmed', label: 'Confirmed', color: 'blue' },
      { value: 'processing', label: 'Processing', color: 'purple' },
      { value: 'shipped', label: 'Shipped', color: 'indigo' },
      { value: 'delivered', label: 'Delivered', color: 'green' },
      { value: 'cancelled', label: 'Cancelled', color: 'red' },
    ];
  }

  // Get payment status options
  static getPaymentStatusOptions(): Array<{ value: string; label: string; color: string }> {
    return [
      { value: 'pending', label: 'Pending', color: 'yellow' },
      { value: 'paid', label: 'Paid', color: 'green' },
      { value: 'failed', label: 'Failed', color: 'red' },
      { value: 'refund_pending', label: 'Refund pending', color: 'yellow' },
      { value: 'partially_refunded', label: 'Partially refunded', color: 'orange' },
      { value: 'refunded', label: 'Refunded', color: 'gray' },
    ];
  }

  // Get order status color
  static getOrderStatusColor(status: string): string {
    const statusOption = this.getOrderStatusOptions().find(option => option.value === status);
    return statusOption?.color || 'gray';
  }

  // Get payment status color
  static getPaymentStatusColor(status: string): string {
    const statusOption = this.getPaymentStatusOptions().find(option => option.value === status);
    return statusOption?.color || 'gray';
  }

  // Format order number
  static formatOrderNumber(orderNumber: string): string {
    return orderNumber.toUpperCase();
  }

  // Check if order can be cancelled
  static canCancelOrder(order: Order): boolean {
    return ['pending', 'confirmed'].includes(order.status) && 
           order.payment_status !== 'paid';
  }

  // Check if order can be refunded
  static canRefundOrder(order: Order): boolean {
    const refundedAmount = Number(order.refunded_amount || 0);
    return ['paid', 'partially_refunded'].includes(order.payment_status) &&
           Number(order.total_amount || 0) - refundedAmount > 0;
  }

  static refundableAmount(order: Order): number {
    return Math.max(0, Number((Number(order.total_amount || 0) - Number(order.refunded_amount || 0)).toFixed(2)));
  }

  // Check if order can be deleted
  static canDeleteOrder(order: Order): boolean {
    return ['pending', 'cancelled'].includes(order.status);
  }

  // Check if order can be edited
  static canEditOrder(order: Order): boolean {
    return !['delivered', 'cancelled'].includes(order.status);
  }

  // Get recent orders (admin)
  static async getRecentOrders(limit: number = 10): Promise<Order[]> {
    const response = await this.getOrders({ page: 1, page_size: limit });
    return response.data;
  }
}

export default OrderService;
