'use client';

import Image from 'next/image';
import { getDefaultProductImageWithSku, getProductImageUrl } from '@/lib/utils';
import { useState } from 'react';
import { CartItem } from '@/types';
import { ShoppingCartIcon } from '@heroicons/react/24/outline';
import { CouponService } from '@/services/coupon.service';
import type { CouponValidateResponse } from '@/services/coupon.service';
import { toast } from 'react-hot-toast';

interface OrderSummaryProps {
  items: CartItem[];
  total: number;
  shippingFee?: number;
  readonly?: boolean;
  onCouponApplied?: (couponResponse: CouponValidateResponse) => void;
  appliedCoupon?: CouponValidateResponse | null;
  customerEmail?: string;
  freeShippingCountryCodes?: string[];
  shippingCountry?: string;
}

export default function OrderSummary({
  items,
  total,
  shippingFee = 0,
  readonly = false,
  onCouponApplied,
  appliedCoupon,
  customerEmail,
  freeShippingCountryCodes = [],
  shippingCountry = '',
}: OrderSummaryProps) {
  const [couponCode, setCouponCode] = useState('');
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);

  const isFreeShipping = shippingCountry && freeShippingCountryCodes.includes(shippingCountry.toUpperCase());

  const subtotal = total;
  const discount = appliedCoupon?.discount_amount || 0;
  const effectiveShippingFee = isFreeShipping ? 0 : Number(shippingFee || 0);
  const finalTotal = subtotal + effectiveShippingFee - discount;

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      toast.error('Please enter a coupon code');
      return;
    }

    if (!customerEmail) {
      toast.error('Customer email is required for coupon validation');
      return;
    }

    setIsValidatingCoupon(true);

    try {
      const response = await CouponService.validateCoupon({
        code: couponCode.trim(),
        order_amount: subtotal,
        customer_email: customerEmail
      });

      if (response.valid) {
        onCouponApplied?.(response);
        toast.success(`Coupon applied! You saved $${response.discount_amount?.toFixed(2)}`);
      } else {
        toast.error(response.message);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to validate coupon');
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponCode('');
    onCouponApplied?.(null);
    toast.success('Coupon removed');
  };

  return (
    <div>
      <div className="site-form-heading mb-6">
        <ShoppingCartIcon className="h-6 w-6" />
        <h2 className="text-xl font-semibold text-gray-900">Order Summary</h2>
      </div>

      {/* Items List */}
      <div className="space-y-4 mb-6">
        {items.map((item) => (
          <div key={item.product.id} className="site-form-muted-box flex items-center space-x-4 p-3">
            <div className="flex-shrink-0">
              <div className="w-16 h-16 bg-gray-200 rounded-md overflow-hidden">
                <Image
                  src={getProductImageUrl(
                    item.product.image_urls || item.product.images || [],
                    getDefaultProductImageWithSku(item.product.sku, '/images/placeholder-image.png')
                  )}
                  alt={item.product.name}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                  unoptimized
                />
              </div>
            </div>

            <div className="flex-grow min-w-0">
              <h3 className="text-sm font-medium text-gray-900 truncate">
                {item.product.name}
              </h3>
              <p className="text-sm text-gray-500">
                SKU: {item.product.sku}
              </p>
              {item.product.part_number && (
                <p className="text-sm text-gray-500">
                  Part #: {item.product.part_number}
                </p>
              )}
            </div>

            <div className="flex-shrink-0 text-right">
              <div className="text-sm font-medium text-gray-900">
                ${(item.product.price * item.quantity).toFixed(2)}
              </div>
              <div className="text-sm text-gray-500">
                Qty: {item.quantity} × ${item.product.price.toFixed(2)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Coupon Section */}
      {!readonly && (
        <div className="site-form-muted-box mb-6 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Coupon Code</h3>

          {appliedCoupon?.valid ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-800">
                    {appliedCoupon.code} - {appliedCoupon.name}
                  </p>
                  <p className="text-sm text-green-600">
                    Discount: ${appliedCoupon.discount_amount?.toFixed(2)}
                  </p>
                </div>
                <button
                  onClick={handleRemoveCoupon}
                  className="text-red-600 hover:text-red-800 text-sm font-medium"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="flex space-x-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="Enter coupon code"
                className="site-input flex-1 px-3 py-2.5"
                disabled={isValidatingCoupon}
              />
              <button
                onClick={handleApplyCoupon}
                disabled={isValidatingCoupon || !couponCode.trim()}
                className="site-primary-action px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isValidatingCoupon ? 'Validating...' : 'Apply'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Order Totals */}
      <div className="border-t border-gray-200 pt-6">
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span className="text-gray-900">${subtotal.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Shipping</span>
            {isFreeShipping ? (
              <span className="text-green-600 font-medium">Free Shipping</span>
            ) : (
              <span className="text-gray-900">${Number(shippingFee || 0).toFixed(2)}</span>
            )}
          </div>

          {discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Discount</span>
              <span className="text-green-600 font-medium">-${discount.toFixed(2)}</span>
            </div>
          )}

          <div className="border-t border-gray-200 pt-3">
            <div className="flex justify-between">
              <span className="text-base font-medium text-gray-900">Total</span>
              <span className="text-lg font-bold text-orange-700">
                ${finalTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Security Notice */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              Secure Checkout
            </h3>
            <div className="mt-1 text-sm text-blue-700">
              Your payment information is encrypted and secure. We accept PayPal for safe and convenient payment processing.
            </div>
          </div>
        </div>
      </div>

      {/* Items Count */}
      <div className="mt-4 text-sm text-gray-500 text-center">
        {items.length} item{items.length !== 1 ? 's' : ''} in your order
      </div>
    </div>
  );
}
