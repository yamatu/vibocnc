'use client';

import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'react-hot-toast';
import { useCustomer } from '@/store/customer.store';
import { CustomerService } from '@/services/customer.service';
import type { Order } from '@/types';
import { getDefaultProductImageWithSku, getProductImageUrl } from '@/lib/utils';
import Layout from '@/components/layout/Layout';
import {
  ChevronLeftIcon,
  TruckIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

const statusConfig: Record<string, { color: string; icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }> = {
  pending: {
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    icon: ClockIcon,
    label: 'Pending',
  },
  confirmed: {
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: CheckCircleIcon,
    label: 'Confirmed',
  },
  processing: {
    color: 'bg-purple-100 text-purple-800 border-purple-200',
    icon: ClockIcon,
    label: 'Processing',
  },
  shipped: {
    color: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    icon: TruckIcon,
    label: 'Shipped',
  },
  delivered: {
    color: 'bg-green-100 text-green-800 border-green-200',
    icon: CheckCircleIcon,
    label: 'Delivered',
  },
  cancelled: {
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: XCircleIcon,
    label: 'Cancelled',
  },
};

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params?.id as string;
  const { isAuthenticated } = useCustomer();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?returnUrl=/account/orders');
      return;
    }

    if (orderId) {
      loadOrder();
    }
  }, [isAuthenticated, orderId, router]);

  const loadOrder = async () => {
    try {
      setLoading(true);
      const data = await CustomerService.getOrderDetails(parseInt(orderId));
      setOrder(data);
    } catch (error: unknown) {
      console.error('Failed to load order:', error);
      toast.error('Failed to load order details');
      router.push('/account/orders');
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return null;
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen bg-gray-50 py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
              <p className="mt-4 text-sm text-gray-500">Loading order details...</p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!order) {
    return null;
  }

  const statusInfo = statusConfig[order.status] || statusConfig.pending;
  const StatusIcon = statusInfo.icon;

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-6">
            <Link
              href="/account/orders"
              className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
            >
              <ChevronLeftIcon className="h-4 w-4 mr-1" />
              Back to Orders
            </Link>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Order Details</h1>
                <p className="mt-2 text-sm text-gray-600">
                  Order #{order.order_number}
                </p>
              </div>
              <div className={`inline-flex items-center px-4 py-2 rounded-lg border ${statusInfo.color}`}>
                <StatusIcon className="h-5 w-5 mr-2" />
                <span className="font-medium">{statusInfo.label}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Order Items */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Order Items</h3>
                  <div className="space-y-4">
                    {(order.items || []).map((item) => (
                      <div key={item.id} className="flex items-start space-x-4 py-4 border-b border-gray-200 last:border-0">
                        {(() => {
                          const sku = item.product?.sku;
                          const img = item.product
                            ? getProductImageUrl(
                                item.product.image_urls || item.product.images || [],
                                getDefaultProductImageWithSku(sku)
                              )
                            : '';
                          return (
                            <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200">
                              <Image
                                src={img}
                                alt={item.product?.name || 'Product'}
                                fill
                                sizes="80px"
                                className="object-cover"
                                unoptimized={String(img).startsWith('/uploads/')}
                              />
                            </div>
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-gray-900">
                            {item.product?.name || 'Product'}
                          </h4>
                          <p className="text-sm text-gray-500 mt-1">
                            SKU: {item.product?.sku || 'N/A'}
                          </p>
                          <p className="text-sm text-gray-500 mt-1">
                            Quantity: {item.quantity}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-gray-900">
                            ${item.total_price.toFixed(2)}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            ${item.unit_price.toFixed(2)} each
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Order Total */}
                  <div className="mt-6 space-y-2 border-t border-gray-200 pt-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Subtotal</span>
                      <span className="text-gray-900">${order.subtotal_amount.toFixed(2)}</span>
                    </div>
                    {order.discount_amount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">
                          Discount {order.coupon_code && `(${order.coupon_code})`}
                        </span>
                        <span className="text-green-600">-${order.discount_amount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-medium border-t border-gray-200 pt-2">
                      <span className="text-gray-900">Total</span>
                      <span className="text-gray-900">${order.total_amount.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Shipping Address */}
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Shipping Address</h3>
                  <div className="text-sm text-gray-600 whitespace-pre-line">
                    {order.shipping_address}
                  </div>
                </div>
              </div>

              {/* Notes */}
              {order.notes && (
                <div className="bg-white shadow sm:rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Order Notes</h3>
                    <div className="text-sm text-gray-600 whitespace-pre-line">
                      {order.notes}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Order Summary Sidebar */}
            <div className="lg:col-span-1 space-y-6">
              {/* Order Info */}
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Order Information</h3>
                  <dl className="space-y-3">
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase">Order Date</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {new Date(order.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase">Order Number</dt>
                      <dd className="mt-1 text-sm text-gray-900">{order.order_number}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase">Payment Method</dt>
                      <dd className="mt-1 text-sm text-gray-900 capitalize">
                        {order.payment_method || 'N/A'}
                      </dd>
                    </div>

                    {(order.tracking_number || order.shipping_carrier) && (
                      <div>
                        <dt className="text-xs font-medium text-gray-500 uppercase">Tracking</dt>
                        <dd className="mt-1 text-sm text-gray-900">
                          {order.shipping_carrier ? (
                            <div className="text-gray-700">Carrier: {order.shipping_carrier}</div>
                          ) : null}
                          {order.tracking_number ? (
                            <div className="font-mono break-all">{order.tracking_number}</div>
                          ) : null}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase">Payment Status</dt>
                      <dd className="mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          order.payment_status === 'paid'
                            ? 'bg-green-100 text-green-800'
                            : order.payment_status === 'failed'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {order.payment_status}
                        </span>
                      </dd>
                    </div>
                    {order.payment_id && (
                      <div>
                        <dt className="text-xs font-medium text-gray-500 uppercase">Payment ID</dt>
                        <dd className="mt-1 text-sm text-gray-900 break-all">{order.payment_id}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>

              {/* Contact Info */}
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Customer Information</h3>
                  <dl className="space-y-3">
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase">Name</dt>
                      <dd className="mt-1 text-sm text-gray-900">{order.customer_name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase">Email</dt>
                      <dd className="mt-1 text-sm text-gray-900">{order.customer_email}</dd>
                    </div>
                    {order.customer_phone && (
                      <div>
                        <dt className="text-xs font-medium text-gray-500 uppercase">Phone</dt>
                        <dd className="mt-1 text-sm text-gray-900">{order.customer_phone}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>

              {/* Help Section */}
              <div className="bg-amber-50 border border-amber-200 shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <h3 className="text-lg font-medium text-amber-900 mb-2">Need Help?</h3>
                  <p className="text-sm text-amber-700 mb-4">
                    If you have any questions about your order, please contact our support team.
                  </p>
                  <Link
                    href="/account/tickets/new"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-amber-600 hover:bg-amber-700"
                  >
                    Contact Support
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
