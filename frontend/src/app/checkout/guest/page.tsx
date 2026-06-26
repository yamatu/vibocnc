'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'react-hot-toast';
import Link from 'next/link';

import { useCart } from '@/store/cart.store';
import { OrderService, OrderCreateRequest } from '@/services/order.service';
import { ShippingRateService } from '@/services/shipping-rate.service';
import Layout from '@/components/layout/Layout';
import PayPalCheckout from '@/components/checkout/PayPalCheckout';
import { formatCurrency } from '@/lib/utils';
import { Order } from '@/types';

import {
  ShoppingBagIcon,
  CreditCardIcon,
  TruckIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

interface GuestCheckoutForm {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  company?: string;
  shipping_address: string;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  shipping_country: string;
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_zip: string;
  billing_country: string;
  notes?: string;
}

export default function GuestCheckoutPage() {
  const router = useRouter();
  const { items, total, clearCart } = useCart();
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [step, setStep] = useState<'form' | 'payment' | 'success'>('form');
  const [sameAsShipping, setSameAsShipping] = useState(true);

  const [shippingCountries, setShippingCountries] = useState<Array<{ country_code: string; country_name: string; currency: string }>>([]);
  const [freeShippingCodes, setFreeShippingCodes] = useState<string[]>([]);
  const [shippingFee, setShippingFee] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<GuestCheckoutForm>({
    defaultValues: {
      shipping_country: '',
      billing_country: '',
    },
  });

  // Searchable country combobox state
  const [shipCountrySearch, setShipCountrySearch] = useState('');
  const [shipCountryOpen, setShipCountryOpen] = useState(false);
  const shipCountryRef = useRef<HTMLDivElement>(null);
  const [billCountrySearch, setBillCountrySearch] = useState('');
  const [billCountryOpen, setBillCountryOpen] = useState(false);
  const billCountryRef = useRef<HTMLDivElement>(null);

  const filteredShipCountries = useMemo(() => {
    if (!shipCountrySearch.trim()) return shippingCountries;
    const q = shipCountrySearch.toLowerCase();
    return shippingCountries.filter(c => c.country_name.toLowerCase().includes(q) || c.country_code.toLowerCase().includes(q));
  }, [shippingCountries, shipCountrySearch]);

  const filteredBillCountries = useMemo(() => {
    if (!billCountrySearch.trim()) return shippingCountries;
    const q = billCountrySearch.toLowerCase();
    return shippingCountries.filter(c => c.country_name.toLowerCase().includes(q) || c.country_code.toLowerCase().includes(q));
  }, [shippingCountries, billCountrySearch]);

  // Click outside handlers
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (shipCountryRef.current && !shipCountryRef.current.contains(e.target as Node)) setShipCountryOpen(false);
      if (billCountryRef.current && !billCountryRef.current.contains(e.target as Node)) setBillCountryOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectShipCountry = useCallback((code: string, name: string) => {
    setValue('shipping_country', code, { shouldDirty: true, shouldValidate: true });
    setShipCountrySearch(name);
    setShipCountryOpen(false);
  }, [setValue]);

  const selectBillCountry = useCallback((code: string, name: string) => {
    setValue('billing_country', code, { shouldDirty: true, shouldValidate: true });
    setBillCountrySearch(name);
    setBillCountryOpen(false);
  }, [setValue]);

  const shippingCountry = watch('shipping_country');
  const totalWeightKg = items.reduce((sum, it) => sum + (Number((it.product as any).weight || 0) * Number(it.quantity || 0)), 0);

  // Fetch shipping countries
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
        setFreeShippingCodes(freeCountries.map((c) => c.country_code));
      } catch {
        if (alive) setShippingCountries([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Calculate shipping fee
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!shippingCountry) { setShippingFee(0); return; }
      if (freeShippingCodes.includes(shippingCountry)) { setShippingFee(0); return; }
      try {
        const q = await ShippingRateService.quote(shippingCountry, totalWeightKg || 0.5);
        if (alive) setShippingFee(Number(q.shipping_fee || 0));
      } catch {
        if (alive) setShippingFee(0);
      }
    })();
    return () => { alive = false; };
  }, [shippingCountry, totalWeightKg, freeShippingCodes]);

  // Redirect if cart is empty
  useEffect(() => {
    if (items.length === 0 && step !== 'success') {
      router.push('/products');
    }
  }, [items, router, step]);

  // Sync billing from shipping
  const watchedShipAddr = watch('shipping_address');
  const watchedShipCity = watch('shipping_city');
  const watchedShipState = watch('shipping_state');
  const watchedShipZip = watch('shipping_zip');

  useEffect(() => {
    if (sameAsShipping) {
      setValue('billing_address', watchedShipAddr);
      setValue('billing_city', watchedShipCity);
      setValue('billing_state', watchedShipState);
      setValue('billing_zip', watchedShipZip);
      setValue('billing_country', shippingCountry);
    }
  }, [sameAsShipping, watchedShipAddr, watchedShipCity, watchedShipState, watchedShipZip, shippingCountry, setValue]);

  const onSubmit = async (data: GuestCheckoutForm) => {
    setIsProcessing(true);
    try {
      const billingParts = [
        data.billing_address,
        data.billing_city,
        data.billing_state,
        data.billing_zip,
      ].filter(Boolean);
      const shippingParts = [
        data.shipping_address,
        data.shipping_city,
        data.shipping_state,
        data.shipping_zip,
      ].filter(Boolean);

      const orderData: OrderCreateRequest = {
        customer_name: data.customer_name,
        customer_email: data.customer_email,
        customer_phone: data.customer_phone,
        shipping_address: shippingParts.join(', '),
        shipping_country: data.shipping_country,
        billing_address: billingParts.join(', '),
        notes: [data.company ? `Company: ${data.company}` : '', data.notes || ''].filter(Boolean).join('\n'),
        items: items.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: item.product.price,
        })),
      };

      const order = await OrderService.createOrder(orderData);
      setCurrentOrder(order);
      setStep('payment');
      toast.success('Order created! Please complete payment.');
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
      setStep('success');
      clearCart();
      toast.success('Payment completed successfully!');
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

  const isFreeShipping = freeShippingCodes.includes(shippingCountry);
  const grandTotal = total + (isFreeShipping ? 0 : shippingFee);

  if (items.length === 0 && step !== 'success') return null;

  return (
    <Layout>
      <div className="site-page-shell min-h-screen py-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <span className="site-chip">Guest checkout</span>
            <h1 className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl">Place an order without an account</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Enter contact, shipping, and payment details for a one-time parts purchase.
            </p>
          </div>

          {/* Progress Steps */}
          <div className="mb-8">
            <div className="site-toolbar flex flex-wrap items-center justify-center gap-3 px-4 py-3">
              {['Order Details', 'Payment', 'Complete'].map((label, i) => {
                const stepIdx = step === 'form' ? 0 : step === 'payment' ? 1 : 2;
                const done = i < stepIdx;
                const active = i === stepIdx;
                return (
                  <div key={label} className="flex items-center">
                    {i > 0 && <div className={`site-progress-line mr-1 ${done || active ? 'site-progress-line-active' : ''}`} />}
                    <div className={`site-progress-step ${active ? 'site-progress-step-active' : done ? 'site-progress-step-done' : ''}`}>
                      {i + 1}
                    </div>
                    <span className="ml-2 text-sm font-semibold text-slate-700">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {step === 'form' && (
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Form Section */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Contact Info */}
                  <div className="site-panel p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                        <input {...register('customer_name', { required: 'Name is required' })} className="site-input w-full px-3 py-2.5" />
                        {errors.customer_name && <p className="mt-1 text-sm text-red-600">{errors.customer_name.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                        <input type="email" {...register('customer_email', { required: 'Email is required', pattern: { value: /^\S+@\S+$/i, message: 'Invalid email' } })} className="site-input w-full px-3 py-2.5" />
                        {errors.customer_email && <p className="mt-1 text-sm text-red-600">{errors.customer_email.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                        <input type="tel" {...register('customer_phone', { required: 'Phone is required' })} className="site-input w-full px-3 py-2.5" />
                        {errors.customer_phone && <p className="mt-1 text-sm text-red-600">{errors.customer_phone.message}</p>}
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company (optional)</label>
                        <input {...register('company')} className="site-input w-full px-3 py-2.5" />
                      </div>
                    </div>
                  </div>

                  {/* Shipping Address */}
                  <div className="site-panel p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Shipping Address</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Street Address *</label>
                        <input {...register('shipping_address', { required: 'Address is required' })} className="site-input w-full px-3 py-2.5" />
                        {errors.shipping_address && <p className="mt-1 text-sm text-red-600">{errors.shipping_address.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                        <input {...register('shipping_city', { required: 'City is required' })} className="site-input w-full px-3 py-2.5" />
                        {errors.shipping_city && <p className="mt-1 text-sm text-red-600">{errors.shipping_city.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">State / Province</label>
                        <input {...register('shipping_state')} className="site-input w-full px-3 py-2.5" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">ZIP / Postal Code *</label>
                        <input {...register('shipping_zip', { required: 'ZIP code is required' })} className="site-input w-full px-3 py-2.5" />
                        {errors.shipping_zip && <p className="mt-1 text-sm text-red-600">{errors.shipping_zip.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
                        <input type="hidden" {...register('shipping_country', { required: 'Country is required' })} />
                        <div className="relative" ref={shipCountryRef}>
                          <div className="relative">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                            <input
                              type="text"
                              placeholder="Search country..."
                              value={shipCountrySearch}
                              onChange={(e) => { setShipCountrySearch(e.target.value); setShipCountryOpen(true); if (!e.target.value) setValue('shipping_country', '', { shouldValidate: true }); }}
                              onFocus={() => setShipCountryOpen(true)}
                              className="site-input w-full pl-9 pr-8 py-2.5"
                            />
                            {shipCountrySearch && (
                              <button type="button" onClick={() => { setShipCountrySearch(''); setValue('shipping_country', '', { shouldValidate: true }); setShipCountryOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
                              </button>
                            )}
                          </div>
                          {shipCountryOpen && (
                            <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                              {filteredShipCountries.length === 0 ? (
                                <li className="px-3 py-2 text-sm text-gray-500">No countries found</li>
                              ) : filteredShipCountries.map(c => (
                                <li key={c.country_code} onClick={() => selectShipCountry(c.country_code, c.country_name)} className={`cursor-pointer px-3 py-2 text-sm hover:bg-blue-50 ${shippingCountry === c.country_code ? 'bg-blue-50 font-medium text-blue-950' : ''}`}>
                                  {c.country_name}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        {errors.shipping_country && <p className="mt-1 text-sm text-red-600">{errors.shipping_country.message}</p>}
                      </div>
                    </div>
                  </div>

                  {/* Billing Address */}
                  <div className="site-panel p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-gray-900">Billing Address</h2>
                      <label className="flex items-center text-sm text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={sameAsShipping} onChange={(e) => setSameAsShipping(e.target.checked)} className="mr-2 rounded border-gray-300" />
                        Same as shipping
                      </label>
                    </div>
                    {!sameAsShipping && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Street Address *</label>
                          <input {...register('billing_address', { required: !sameAsShipping ? 'Address is required' : false })} className="site-input w-full px-3 py-2.5" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                          <input {...register('billing_city', { required: !sameAsShipping ? 'City is required' : false })} className="site-input w-full px-3 py-2.5" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">State / Province</label>
                          <input {...register('billing_state')} className="site-input w-full px-3 py-2.5" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">ZIP / Postal Code *</label>
                          <input {...register('billing_zip', { required: !sameAsShipping ? 'ZIP is required' : false })} className="site-input w-full px-3 py-2.5" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
                          <input type="hidden" {...register('billing_country', { required: !sameAsShipping ? 'Country is required' : false })} />
                          <div className="relative" ref={billCountryRef}>
                            <div className="relative">
                              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                              <input
                                type="text"
                                placeholder="Search country..."
                                value={billCountrySearch}
                                onChange={(e) => { setBillCountrySearch(e.target.value); setBillCountryOpen(true); if (!e.target.value) setValue('billing_country', '', { shouldValidate: true }); }}
                                onFocus={() => setBillCountryOpen(true)}
                                className="site-input w-full pl-9 pr-8 py-2.5"
                              />
                              {billCountrySearch && (
                                <button type="button" onClick={() => { setBillCountrySearch(''); setValue('billing_country', '', { shouldValidate: true }); setBillCountryOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
                                </button>
                              )}
                            </div>
                            {billCountryOpen && (
                              <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                                {filteredBillCountries.length === 0 ? (
                                  <li className="px-3 py-2 text-sm text-gray-500">No countries found</li>
                                ) : filteredBillCountries.map(c => (
                                  <li key={c.country_code} onClick={() => selectBillCountry(c.country_code, c.country_name)} className="cursor-pointer px-3 py-2 text-sm hover:bg-blue-50">
                                    {c.country_name}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {sameAsShipping && (
                      <p className="text-sm text-gray-500">Billing address will be the same as your shipping address.</p>
                    )}
                  </div>

                  {/* Notes */}
                  <div className="site-panel p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Notes (optional)</h2>
                    <textarea {...register('notes')} rows={3} className="site-input w-full px-3 py-2.5" placeholder="Any special instructions..." />
                  </div>
                </div>

                {/* Order Summary Sidebar */}
                <div>
                  <div className="site-panel sticky top-24 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Summary</h2>
                    <div className="space-y-3 mb-4">
                      {items.map((item) => (
                        <div key={item.product.id} className="flex justify-between text-sm">
                          <span className="text-gray-600 truncate mr-2">{item.product.name} x{item.quantity}</span>
                          <span className="font-medium whitespace-nowrap">{formatCurrency(item.product.price * item.quantity)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t pt-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Subtotal</span>
                        <span>{formatCurrency(total)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 flex items-center"><TruckIcon className="h-4 w-4 mr-1" />Shipping</span>
                        {shippingCountry ? (
                          isFreeShipping ? (
                            <span className="text-green-600 font-medium">Free</span>
                          ) : (
                            <span>{formatCurrency(shippingFee)}</span>
                          )
                        ) : (
                          <span className="text-gray-400 text-xs">Select country</span>
                        )}
                      </div>
                      <div className="flex justify-between text-base font-semibold border-t pt-2">
                        <span>Total</span>
                        <span className="text-orange-700">{formatCurrency(grandTotal)}</span>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={isProcessing}
                      className="site-primary-action w-full mt-6 px-4 py-3 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isProcessing ? 'Processing...' : 'Place Order & Pay'}
                    </button>
                    <p className="mt-3 text-xs text-gray-500 text-center">
                      A confirmation email with your order number will be sent to your email address.
                    </p>
                  </div>
                </div>
              </div>
            </form>
          )}

          {step === 'payment' && currentOrder && (
            <div className="max-w-2xl mx-auto">
              <div className="site-panel p-6">
                <div className="flex items-center mb-6">
                  <CreditCardIcon className="h-6 w-6 text-blue-800 mr-2" />
                  <h2 className="text-xl font-semibold text-gray-900">Payment</h2>
                </div>
                <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                  <h3 className="font-medium text-blue-900 mb-1">Order #{currentOrder.order_number}</h3>
                  <p className="text-blue-700 text-sm">Total: <span className="font-semibold">${currentOrder.total_amount.toFixed(2)}</span></p>
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
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-800 mr-2" />
                    Processing payment...
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'success' && currentOrder && (
            <div className="max-w-2xl mx-auto text-center">
              <div className="site-panel p-8">
                <div className="flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mx-auto mb-6">
                  <ShoppingBagIcon className="h-8 w-8 text-green-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-4">Order Placed Successfully!</h1>
                <p className="text-gray-600 mb-2">Thank you for your purchase. A confirmation email has been sent to your email address.</p>
                <p className="text-gray-600 mb-6">You can use the order number below to track your order status.</p>
                <div className="site-form-muted-box p-4 mb-6">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Order Number:</span>
                      <div className="font-semibold text-lg">{currentOrder.order_number}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Total Amount:</span>
                      <div className="font-semibold">${currentOrder.total_amount.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <Link
                    href={`/orders/track/${currentOrder.order_number}`}
                    className="site-primary-action block w-full px-4 py-2.5 text-center text-sm"
                  >
                    Track My Order
                  </Link>
                  <Link
                    href="/products"
                    className="block w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 text-center"
                  >
                    Continue Shopping
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
