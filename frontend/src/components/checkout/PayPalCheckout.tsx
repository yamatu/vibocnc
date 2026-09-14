'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import type { PayPalScriptOptions } from '@paypal/paypal-js';
import { toast } from 'react-hot-toast';
import { PayPalService, OrderService } from '@/services';
import type { Order } from '@/types';

interface PayPalCheckoutProps {
  /** Internal order id. The backend decides the amount for this order. */
  orderId: number;
  /** Display-only amount; the server value is authoritative. */
  amount: number;
  currency?: string;
  onSuccess: (order: Order) => void;
  onError: (error: unknown) => void;
  disabled?: boolean;
}

type PayPalPublicConfig = {
  enabled: boolean;
  mode: 'sandbox' | 'live';
  client_id: string;
  currency: string;
};

function PayPalButtonsWrapper({ orderId, currency = 'USD', onSuccess, onError, disabled }: PayPalCheckoutProps) {
  const creatingRef = useRef(false);

  return (
    <PayPalButtons
      disabled={disabled}
      forceReRender={[orderId, currency, disabled]}
      createOrder={async () => {
        if (creatingRef.current) {
          throw new Error('Order creation already in progress');
        }
        creatingRef.current = true;
        try {
          // Server-side creation: the backend sets the amount and reference.
          const session = await OrderService.createPayPalOrder(orderId);
          return session.paypal_order_id;
        } catch (error) {
          console.error('PayPal create order error:', error);
          toast.error('Could not start PayPal payment. Please try again.');
          throw error;
        } finally {
          creatingRef.current = false;
        }
      }}
      onApprove={async (data) => {
        try {
          if (!data.orderID) {
            throw new Error('PayPal did not return an order id');
          }
          // Server-side capture + verification. Never capture in the browser.
          const order = await OrderService.capturePayPalOrder(orderId, data.orderID);
          onSuccess(order);
        } catch (error) {
          console.error('PayPal capture error:', error);
          onError(error);
          toast.error('Payment capture failed. Please try again.');
        }
      }}
      onError={(error) => {
        console.error('PayPal error:', error);
        onError(error);
        toast.error('PayPal error occurred. Please try again.');
      }}
      onCancel={() => {
        toast('Payment was cancelled');
      }}
      style={{
        layout: 'vertical',
        color: 'gold',
        shape: 'rect',
        label: 'paypal',
        height: 45,
      }}
    />
  );
}

export default function PayPalCheckout(props: PayPalCheckoutProps) {
  const { amount, currency = 'USD' } = props;

  const [config, setConfig] = useState<PayPalPublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await PayPalService.getPublicConfig();
        if (!alive) return;
        setConfig(cfg);
      } catch (e: unknown) {
        if (!alive) return;
        console.error('Failed to load PayPal config:', e);
        setConfig({ enabled: false, mode: 'sandbox', client_id: '', currency: 'USD' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const options = useMemo(() => {
    const clientId = config?.client_id || '';
    const cur = (currency || config?.currency || 'USD').toUpperCase();
    const options: PayPalScriptOptions = {
      clientId,
      currency: cur,
      intent: 'capture',
      components: 'buttons',
      enableFunding: 'venmo,paylater',
      disableFunding: 'credit,card',
    };
    return options;
  }, [config?.client_id, config?.currency, currency]);

  // Keep hooks unconditional when the amount changes during checkout.
  if (!amount || amount <= 0) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
        <div className="text-red-800 text-sm">
          Invalid payment amount. Please refresh and try again.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
        <div className="text-gray-700 text-sm">Loading PayPal...</div>
      </div>
    );
  }

  // Check if PayPal is configured
  if (!config?.enabled || !config.client_id) {
    return (
      <div className="site-form-muted-box p-4">
        <div className="text-slate-700 text-sm">
          <strong>PayPal is not configured</strong>
          <br />
          Please configure PayPal in Admin → PayPal.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-gray-600 mb-2">
          Pay securely with PayPal
        </p>
        <p className="text-lg font-semibold text-gray-900">
          ${amount.toFixed(2)} {currency}
        </p>
      </div>

      <PayPalScriptProvider options={options}>
        <div className="paypal-button-container">
          <PayPalButtonsWrapper {...props} />
        </div>
      </PayPalScriptProvider>

      <div className="text-xs text-gray-500 text-center space-y-1">
        <p>✓ Secure encrypted payment</p>
        <p>✓ Buyer protection included</p>
        <p>✓ No account required</p>
      </div>
    </div>
  );
}
