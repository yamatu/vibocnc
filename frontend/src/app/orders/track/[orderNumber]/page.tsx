'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { getDefaultProductImageWithSku, getProductImageUrl } from '@/lib/utils';
import Link from 'next/link';
import { toast } from 'react-hot-toast';

import Layout from '@/components/layout/Layout';
import { OrderService } from '@/services/order.service';
import { Order } from '@/types';

import {
  MagnifyingGlassIcon,
  ClockIcon,
  CheckCircleIcon,
  TruckIcon,
  ShoppingBagIcon,
  XCircleIcon,
  InformationCircleIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline';

export default function OrderTrackingPage() {
  const params = useParams();
  const orderNumber = params.orderNumber as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orderNumber) {
      fetchOrder(orderNumber);
    }
  }, [orderNumber]);

  const fetchOrder = async (orderNum: string) => {
    try {
      setLoading(true);
      setError(null);
      const orderData = await OrderService.getOrderByNumber(orderNum);
      setOrder(orderData);
    } catch (err: any) {
      setError(err.message || 'Order not found');
      toast.error('Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <ClockIcon className="h-6 w-6 text-orange-500" />;
      case 'confirmed':
        return <CheckCircleIcon className="h-6 w-6 text-blue-500" />;
      case 'processing':
        return <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500" />;
      case 'shipped':
        return <TruckIcon className="h-6 w-6 text-indigo-500" />;
      case 'delivered':
        return <CheckCircleIcon className="h-6 w-6 text-green-500" />;
      case 'cancelled':
        return <XCircleIcon className="h-6 w-6 text-red-500" />;
      default:
        return <InformationCircleIcon className="h-6 w-6 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    return OrderService.getOrderStatusColor(status);
  };

  const getPaymentStatusColor = (status: string) => {
    return OrderService.getPaymentStatusColor(status);
  };

  const getStatusSteps = (currentStatus: string) => {
    const steps = [
      { id: 'pending', label: 'Order Placed', completed: true },
      { id: 'confirmed', label: 'Confirmed', completed: false },
      { id: 'processing', label: 'Processing', completed: false },
      { id: 'shipped', label: 'Shipped', completed: false },
      { id: 'delivered', label: 'Delivered', completed: false }
    ];

    const statusOrder = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
    const currentIndex = statusOrder.indexOf(currentStatus);

    return steps.map((step, index) => ({
      ...step,
      completed: index <= currentIndex,
      current: index === currentIndex
    }));
  };

  if (loading) {
    return (
      <Layout>
        <div className="site-page-shell min-h-screen py-10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-800 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading order details...</p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !order) {
    return (
      <Layout>
        <div className="site-page-shell min-h-screen py-10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <XCircleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Not Found</h1>
              <p className="text-gray-600 mb-6">
                {error || 'The order number you entered could not be found.'}
              </p>
              <Link
                href="/"
                className="site-primary-action px-4 py-2 text-sm"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const statusSteps = getStatusSteps(order.status);

  return (
    <Layout>
      <div className="site-page-shell min-h-screen py-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/"
              className="site-link-accent mb-4 inline-flex items-center"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back to Home
            </Link>

            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Order #{order.order_number}
                </h1>
                <p className="text-gray-600">
                  Placed on {new Date(order.created_at).toLocaleDateString()}
                </p>
              </div>

              <div className="text-right">
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-${getStatusColor(order.status)}-100 text-${getStatusColor(order.status)}-800`}>
                  {getStatusIcon(order.status)}
                  <span className="ml-2 capitalize">{order.status}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Order Status Progress */}
          <div className="site-panel p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Order Progress</h2>

            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>

              <div className="space-y-6">
                {statusSteps.map((step, index) => (
                  <div key={step.id} className="relative flex items-center">
                    <div className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full ${
                      step.completed
                        ? 'bg-green-500 text-white'
                        : step.current
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }`}>
                      {step.completed ? (
                        <CheckCircleIcon className="h-5 w-5" />
                      ) : (
                        <span className="text-sm font-medium">{index + 1}</span>
                      )}
                    </div>

                    <div className="ml-4">
                      <h3 className={`text-sm font-medium ${
                        step.completed || step.current ? 'text-gray-900' : 'text-gray-500'
                      }`}>
                        {step.label}
                      </h3>
                      {step.current && (
                        <p className="text-sm font-semibold text-orange-700">Current status</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Order Details */}
            <div className="site-panel p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Details</h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Order Number:</span>
                  <span className="font-medium">{order.order_number}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">Status:</span>
                  <span className={`font-medium text-${getStatusColor(order.status)}-600 capitalize`}>
                    {order.status}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">Payment Status:</span>
                  <span className={`font-medium text-${getPaymentStatusColor(order.payment_status)}-600 capitalize`}>
                    {order.payment_status}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">Total Amount:</span>
                  <span className="font-medium text-lg">${order.total_amount.toFixed(2)}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">Payment Method:</span>
                  <span className="font-medium capitalize">{order.payment_method}</span>
                </div>

                {(order.tracking_number || order.shipping_carrier) && (
                  <div className="pt-3 mt-3 border-t border-gray-100">
                    <div className="text-gray-600">Tracking:</div>
                    {order.shipping_carrier ? (
                      <div className="mt-1 font-medium">Carrier: {order.shipping_carrier}</div>
                    ) : null}
                    {order.tracking_number ? (
                      <div className="mt-1 font-mono break-all">{order.tracking_number}</div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Customer Information */}
            <div className="site-panel p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Customer Information</h2>

              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-gray-600">Name:</span>
                  <div className="font-medium">{order.customer_name}</div>
                </div>

                <div>
                  <span className="text-gray-600">Email:</span>
                  <div className="font-medium">{order.customer_email}</div>
                </div>

                <div>
                  <span className="text-gray-600">Phone:</span>
                  <div className="font-medium">{order.customer_phone}</div>
                </div>

                <div>
                  <span className="text-gray-600">Shipping Address:</span>
                  <div className="font-medium whitespace-pre-line">{order.shipping_address}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Order Items */}
          <div className="site-panel p-6 mt-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Items</h2>

            <div className="space-y-4">
              {order.items?.map((item) => (
                <div key={item.id} className="flex items-center space-x-4 p-4 border border-gray-200 rounded-lg">
                  <div className="flex-shrink-0">
                    <div className="w-16 h-16 bg-gray-200 rounded-md overflow-hidden">
                      <Image
                        src={getProductImageUrl(
                          item.product?.image_urls || item.product?.images || [],
                          getDefaultProductImageWithSku(item.product?.sku, '/images/placeholder-image.png')
                        )}
                        alt={item.product?.name || 'Product'}
                        width={64}
                        height={64}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    </div>
                  </div>

                  <div className="flex-grow">
                    <h3 className="font-medium text-gray-900">
                      {item.product?.name || 'Product'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      SKU: {item.product?.sku}
                    </p>
                    <p className="text-sm text-gray-500">
                      Quantity: {item.quantity}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="font-medium text-gray-900">
                      ${item.total_price.toFixed(2)}
                    </div>
                    <div className="text-sm text-gray-500">
                      ${item.unit_price.toFixed(2)} each
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="site-panel p-6 mt-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Notes</h2>
              <p className="text-gray-700 whitespace-pre-line">{order.notes}</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
