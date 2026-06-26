'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { toast } from 'react-hot-toast';

import { useCart } from '@/store/cart.store';
import { useCustomer } from '@/store/customer.store';
import { OrderService, OrderCreateRequest } from '@/services/order.service';
import { ShippingRateService } from '@/services/shipping-rate.service';
import type { CouponValidateResponse } from '@/services/coupon.service';
import Layout from '@/components/layout/Layout';
import PayPalCheckout from '@/components/checkout/PayPalCheckout';
import OrderSummary from '@/components/checkout/OrderSummary';
import CheckoutForm from '@/components/checkout/CheckoutForm';
import { Order } from '@/types';

import {
  CreditCardIcon,
  ShoppingBagIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

// Validation schema
const checkoutSchema = yup.object({
  customer_name: yup.string().required('Name is required'),
  customer_email: yup.string().email('Invalid email').required('Email is required'),
  customer_phone: yup.string().required('Phone number is required'),
  shipping_address: yup.string().required('Shipping address is required'),
  shipping_country: yup.string().required('Shipping country is required'),
  billing_address: yup.string().required('Billing address is required'),
  notes: yup.string(),
});

export type CheckoutFormData = yup.InferType<typeof checkoutSchema>;

export default function CheckoutPage() {
  const router = useRouter();
  const { items, total, clearCart } = useCart();
  const { isAuthenticated, customer } = useCustomer();
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [step, setStep] = useState<'form' | 'payment' | 'success'>('form');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidateResponse | null>(null);

  const [shippingCountries, setShippingCountries] = useState<Array<{ country_code: string; country_name: string; currency: string }>>([]);
  const [shippingRatesLoading, setShippingRatesLoading] = useState(true);
  const [shippingFee, setShippingFee] = useState<number>(0);
  const [freeShippingCountryCodes, setFreeShippingCountryCodes] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
    watch,
    setValue
  } = useForm<CheckoutFormData>({
    resolver: yupResolver(checkoutSchema),
    defaultValues: {
      customer_name: '',
      customer_email: '',
      customer_phone: '',
      shipping_address: '',
      shipping_country: '',
      billing_address: '',
      notes: '',
    }
  });

  // Watch for changes to auto-fill billing address
  const shippingAddress = watch('shipping_address');
  const shippingCountry = watch('shipping_country');
  const [sameAsShipping, setSameAsShipping] = useState(false);

  const totalWeightKg = items.reduce((sum, it) => sum + (Number((it.product as any).weight || 0) * Number(it.quantity || 0)), 0);

  // Check authentication - redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      toast.error('Please login to continue with checkout');
      router.push('/login?returnUrl=/checkout');
      return;
    }

    // Auto-fill form with customer data
    if (customer) {
      setValue('customer_name', customer.full_name);
      setValue('customer_email', customer.email);
      setValue('customer_phone', customer.phone || '');
      if (customer.address) {
        setValue('shipping_address', customer.address);
        setValue('billing_address', customer.address);
      }
    }
  }, [isAuthenticated, customer, router, setValue]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [countries, freeCountries] = await Promise.all([
          ShippingRateService.publicCountries(),
          ShippingRateService.publicFreeShippingCountries().catch(() => []),
        ]);
        if (!alive) return;
        setShippingCountries(countries as any);
        setFreeShippingCountryCodes(freeCountries.map((c) => c.country_code));
      } catch {
        if (!alive) return;
        setShippingCountries([]);
      } finally {
        if (alive) setShippingRatesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!shippingCountry) {
        setShippingFee(0);
        return;
      }
      try {
        const q = await ShippingRateService.quote(shippingCountry, totalWeightKg);
        if (!alive) return;
        setShippingFee(Number(q.shipping_fee || 0));
      } catch {
        if (!alive) return;
        setShippingFee(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [shippingCountry, totalWeightKg]);

  useEffect(() => {
    if (items.length === 0 && step !== 'success') {
      router.push('/');
      toast.error('Your cart is empty');
    }
  }, [items, router, step]);

  // Auto-fill billing address when "Same as shipping" is checked
  useEffect(() => {
    if (sameAsShipping && shippingAddress) {
      const billingInput = document.querySelector('textarea[name="billing_address"]') as HTMLTextAreaElement;
      if (billingInput) {
        billingInput.value = shippingAddress;
        // Trigger form update
        const event = new Event('input', { bubbles: true });
        billingInput.dispatchEvent(event);
      }
    }
  }, [sameAsShipping, shippingAddress]);

  const createOrder = async (formData: CheckoutFormData): Promise<Order> => {
    const orderData: OrderCreateRequest = {
      customer_name: formData.customer_name,
      customer_email: formData.customer_email,
      customer_phone: formData.customer_phone,
      shipping_address: formData.shipping_address,
      shipping_country: formData.shipping_country,
      billing_address: formData.billing_address,
      notes: formData.notes || '',
      coupon_code: appliedCoupon?.valid ? appliedCoupon.code : undefined,
      items: items.map(item => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.product.price,
      })),
    };

    return await OrderService.createOrder(orderData);
  };

  const onSubmit = async (formData: CheckoutFormData) => {
    setIsProcessing(true);

    try {
      const order = await createOrder(formData);
      setCurrentOrder(order);
      setStep('payment');
      toast.success('Order created successfully! Please complete payment.');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create order');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaymentSuccess = async (paymentData: any) => {
    if (!currentOrder) return;

    setIsProcessing(true);

    try {
      await OrderService.processPayment(currentOrder.id, {
        payment_method: 'paypal',
        payment_data: paymentData,
      });

      // Mark success first to avoid empty-cart redirect effect.
      setStep('success');
      clearCart();

      toast.success('Payment completed. Redirecting to your orders...');
      router.replace('/account/orders');
    } catch (error: any) {
      toast.error(error.message || 'Payment processing failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaymentError = (error: any) => {
    console.error('Payment error:', error);
    toast.error('Payment failed. Please try again.');
  };

  if (items.length === 0) {
    return null; // Will redirect in useEffect
  }

  return (
    <Layout>
      <div className="site-page-shell min-h-screen py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <span className="site-chip">Secure checkout</span>
            <h1 className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl">Complete your parts order</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Confirm shipping details, review the order, and complete payment through the configured PayPal flow.
            </p>
          </div>

          {/* Progress Steps */}
          <div className="mb-8">
            <div className="site-toolbar flex flex-wrap items-center justify-center gap-3 px-4 py-3">
              <div className="flex items-center">
                <div className={`site-progress-step ${step === 'form' ? 'site-progress-step-active' : step === 'payment' || step === 'success' ? 'site-progress-step-done' : ''}`}>
                  1
                </div>
                <span className="ml-2 text-sm font-semibold text-slate-700">Order Details</span>
              </div>
              <div className={`site-progress-line ${step === 'payment' || step === 'success' ? 'site-progress-line-active' : ''}`} />
              <div className="flex items-center">
                <div className={`site-progress-step ${step === 'payment' ? 'site-progress-step-active' : step === 'success' ? 'site-progress-step-done' : ''}`}>
                  2
                </div>
                <span className="ml-2 text-sm font-semibold text-slate-700">Payment</span>
              </div>
              <div className={`site-progress-line ${step === 'success' ? 'site-progress-line-active' : ''}`} />
              <div className="flex items-center">
                <div className={`site-progress-step ${step === 'success' ? 'site-progress-step-done' : ''}`}>
                  3
                </div>
                <span className="ml-2 text-sm font-semibold text-slate-700">Complete</span>
              </div>
            </div>
          </div>

          {step === 'form' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Checkout Form */}
              <div className="site-panel p-6">
                <CheckoutForm
                  register={register}
                  errors={errors}
                  onSubmit={handleSubmit(onSubmit)}
                  isProcessing={isProcessing}
                  sameAsShipping={sameAsShipping}
                  setSameAsShipping={setSameAsShipping}
					shippingRates={shippingCountries}
					shippingRatesLoading={shippingRatesLoading}
					shippingCountryValue={shippingCountry}
					onShippingCountryChange={(cc) => setValue('shipping_country', cc, { shouldDirty: true, shouldValidate: true })}
                />
              </div>

              {/* Order Summary */}
              <div className="site-panel p-6">
                <OrderSummary
                  items={items}
                  total={total}
					shippingFee={shippingFee}
                  onCouponApplied={setAppliedCoupon}
                  appliedCoupon={appliedCoupon}
                  customerEmail={watch('customer_email')}
                  freeShippingCountryCodes={freeShippingCountryCodes}
                  shippingCountry={shippingCountry}
                />
              </div>
            </div>
          )}

          {step === 'payment' && currentOrder && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Payment Section */}
              <div className="site-panel p-6">
                <div className="flex items-center mb-6">
                  <CreditCardIcon className="h-6 w-6 text-blue-800 mr-2" />
                  <h2 className="text-xl font-semibold text-gray-900">Payment</h2>
                </div>

                <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                  <h3 className="font-medium text-blue-900 mb-2">Order #{currentOrder.order_number}</h3>
                  <p className="text-blue-700 text-sm">
                    Total Amount: <span className="font-semibold">${currentOrder.total_amount.toFixed(2)}</span>
                  </p>
                </div>

                <PayPalCheckout
                  amount={currentOrder.total_amount}
                  currency="USD"
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                  disabled={isProcessing}
                />

                {isProcessing && (
                  <div className="mt-4 flex items-center justify-center text-gray-500">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-800 mr-2"></div>
                    Processing payment...
                  </div>
                )}
              </div>

              {/* Order Summary */}
              <div className="site-panel p-6">
                <OrderSummary
                  items={items}
                  total={currentOrder.subtotal_amount}
                  appliedCoupon={currentOrder.coupon_code ? {
                    valid: true,
                    code: currentOrder.coupon_code,
                    discount_amount: currentOrder.discount_amount,
                    final_amount: currentOrder.total_amount
                  } : null}
                  readonly
                />
              </div>
            </div>
          )}

          {step === 'success' && currentOrder && (
            <div className="max-w-2xl mx-auto text-center">
              <div className="site-panel p-8">
                <div className="flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mx-auto mb-6">
                  <ShoppingBagIcon className="h-8 w-8 text-green-600" />
                </div>

                <h1 className="text-2xl font-bold text-gray-900 mb-4">
                  Order Completed Successfully!
                </h1>

                <p className="text-gray-600 mb-6">
                  Thank you for your order. We have received your payment and will process your order shortly.
                </p>

                  <div className="site-form-muted-box p-4 mb-6">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Order Number:</span>
                      <div className="font-semibold">{currentOrder.order_number}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Total Amount:</span>
                      <div className="font-semibold">${currentOrder.total_amount.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => router.push('/account/orders')}
                    className="site-primary-action w-full px-4 py-2.5 text-sm"
                  >
                    View My Orders
                  </button>

                  <button
                    onClick={() => router.push('/')}
                    className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition duration-200"
                  >
                    Continue Shopping
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
