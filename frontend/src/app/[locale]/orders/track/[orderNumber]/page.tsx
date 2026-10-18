'use client';

import { useCallback, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { getDefaultProductImageWithSku, getProductImageUrl } from '@/lib/utils';
import Link from 'next/link';
import { toast } from 'react-hot-toast';

import Layout from '@/components/layout/Layout';
import { OrderService } from '@/services/order.service';
import { Order } from '@/types';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { getLocaleConfig } from '@/lib/i18n/config';

import {
  ClockIcon,
  CheckCircleIcon,
  TruckIcon,
  XCircleIcon,
  InformationCircleIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline';

export default function OrderTrackingPage() {
  const params = useParams();
  const orderNumber = params.orderNumber as string;
  const { locale, t, href } = usePublicI18n();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = useCallback(async (orderNum: string) => {
    try {
      setLoading(true);
      setError(null);
      const orderData = await OrderService.getOrderByNumber(orderNum);
      setOrder(orderData);
    } catch {
      setError(t('order.notFoundDescription'));
      toast.error(t('order.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (orderNumber) fetchOrder(orderNumber);
  }, [fetchOrder, orderNumber]);

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
      { id: 'pending', label: t('status.pending'), completed: true },
      { id: 'confirmed', label: t('status.confirmed'), completed: false },
      { id: 'processing', label: t('status.processing'), completed: false },
      { id: 'shipped', label: t('status.shipped'), completed: false },
      { id: 'delivered', label: t('status.delivered'), completed: false }
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
              <p className="mt-2 text-gray-600">{t('order.loadingDetails')}</p>
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
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('order.notFound')}</h1>
              <p className="text-gray-600 mb-6">
                {error || t('order.notFoundDescription')}
              </p>
              <Link
                href={href('/')}
                className="site-primary-action px-4 py-2 text-sm"
              >
                <ArrowLeftIcon className="h-4 w-4 mr-2" />
                {t('order.backHome')}
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
              href={href('/')}
              className="site-link-accent mb-4 inline-flex items-center"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              {t('order.backHome')}
            </Link>

            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {t('order.number')} #{order.order_number}
                </h1>
                <p className="text-gray-600">
                  {t('order.placedOn', { date: new Date(order.created_at).toLocaleDateString(getLocaleConfig(locale).hreflang) })}
                </p>
              </div>

              <div className="text-right">
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-${getStatusColor(order.status)}-100 text-${getStatusColor(order.status)}-800`}>
                  {getStatusIcon(order.status)}
                  <span className="ml-2">{t(`status.${order.status}`)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Order Status Progress */}
          <div className="site-panel p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('order.progress')}</h2>

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
                        <p className="text-sm font-semibold text-orange-700">{t('order.currentStatus')}</p>
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
              <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('order.details')}</h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('order.number')}:</span>
                  <span className="font-medium">{order.order_number}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">{t('order.status')}:</span>
                  <span className={`font-medium text-${getStatusColor(order.status)}-600 capitalize`}>
                    {t(`status.${order.status}`)}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">{t('order.paymentStatus')}:</span>
                  <span className={`font-medium text-${getPaymentStatusColor(order.payment_status)}-600 capitalize`}>
                    {t(`payment.${order.payment_status}`)}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">{t('order.totalAmount')}:</span>
                  <span className="font-medium text-lg">${order.total_amount.toFixed(2)}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">{t('order.paymentMethod')}:</span>
                  <span className="font-medium capitalize">{order.payment_method}</span>
                </div>

                {(order.tracking_number || order.shipping_carrier) && (
                  <div className="pt-3 mt-3 border-t border-gray-100">
                    <div className="text-gray-600">{t('order.tracking')}:</div>
                    {order.shipping_carrier ? (
                      <div className="mt-1 font-medium">{t('order.carrier')}: {order.shipping_carrier}</div>
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
              <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('order.customerInfo')}</h2>

              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-gray-600">{t('order.name')}:</span>
                  <div className="font-medium">{order.customer_name}</div>
                </div>

                <div>
                  <span className="text-gray-600">{t('order.email')}:</span>
                  <div className="font-medium">{order.customer_email}</div>
                </div>

                <div>
                  <span className="text-gray-600">{t('order.phone')}:</span>
                  <div className="font-medium">{order.customer_phone}</div>
                </div>

                <div>
                  <span className="text-gray-600">{t('order.shippingAddress')}:</span>
                  <div className="font-medium whitespace-pre-line">{order.shipping_address}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Order Items */}
          <div className="site-panel p-6 mt-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('order.items')}</h2>

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
                        alt={item.product?.name || t('order.product')}
                        width={64}
                        height={64}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    </div>
                  </div>

                  <div className="flex-grow">
                    <h3 className="font-medium text-gray-900">
                      {item.product?.name || t('order.product')}
                    </h3>
                    <p className="text-sm text-gray-500">
                      SKU: {item.product?.sku}
                    </p>
                    <p className="text-sm text-gray-500">
                      {t('order.quantity')}: {item.quantity}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="font-medium text-gray-900">
                      ${item.total_price.toFixed(2)}
                    </div>
                    <div className="text-sm text-gray-500">
                      ${item.unit_price.toFixed(2)} {t('order.each')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="site-panel p-6 mt-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('order.notes')}</h2>
              <p className="text-gray-700 whitespace-pre-line">{order.notes}</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
