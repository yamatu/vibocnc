'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { toast } from 'react-hot-toast';
import { PayPalService } from '@/services';

interface PayPalCheckoutProps {
  amount: number;
  currency?: string;
  onSuccess: (details: any) => void;
  onError: (error: any) => void;
  disabled?: boolean;
}

type PayPalPublicConfig = {
  enabled: boolean;
  mode: 'sandbox' | 'live';
  client_id: string;
  currency: string;
};

function PayPalButtonsWrapper({ amount, currency = 'USD', onSuccess, onError, disabled }: PayPalCheckoutProps) {
  const hasCreatedOrder = useRef(false);

  return (
    <PayPalButtons
      disabled={disabled}
      forceReRender={[amount, currency, disabled]}
      createOrder={(data, actions) => {
        if (hasCreatedOrder.current) return Promise.reject('Order already created');

        hasCreatedOrder.current = true;

        return actions.order.create({
          purchase_units: [
            {
              amount: {
                currency_code: currency,
                value: amount.toFixed(2),
              },
              description: 'FANUC Parts Order',
            },
          ],
          application_context: {
            shipping_preference: 'NO_SHIPPING',
          },
        });
      }}
      onApprove={async (data, actions) => {
        try {
          if (!actions.order) {
            throw new Error('PayPal order actions not available');
          }

          const orderDetails = await actions.order.capture();

          // Reset the order creation flag
          hasCreatedOrder.current = false;

          // Call success handler with PayPal order details
          onSuccess({
            orderID: data.orderID,
            payerID: data.payerID,
            details: orderDetails,
            paymentSource: data.paymentSource,
          });
        } catch (error) {
          console.error('PayPal capture error:', error);
          hasCreatedOrder.current = false;
          onError(error);
          toast.error('Payment capture failed. Please try again.');
        }
      }}
      onError={(error) => {
        console.error('PayPal error:', error);
        hasCreatedOrder.current = false;
        onError(error);
        toast.error('PayPal error occurred. Please try again.');
      }}
      onCancel={(data) => {
        console.log('PayPal payment cancelled:', data);
        hasCreatedOrder.current = false;
        toast.info('Payment was cancelled');
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

  // Validate amount
  if (!amount || amount <= 0) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
        <div className="text-red-800 text-sm">
          Invalid payment amount. Please refresh and try again.
        </div>
      </div>
    );
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await PayPalService.getPublicConfig();
        if (!alive) return;
        setConfig(cfg as any);
      } catch (e: any) {
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
    return {
      'client-id': clientId,
      currency: cur,
      intent: 'capture',
      components: 'buttons',
      'enable-funding': 'venmo,paylater',
      'disable-funding': 'credit,card',
    } as any;
  }, [config?.client_id, config?.currency, currency]);

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

      <div className="flex items-center justify-center space-x-2 text-xs text-gray-400">
        <span>Powered by</span>
        <svg className="h-4 w-auto" viewBox="0 0 100 32" fill="currentColor">
          <path d="M12.017 10.002c2.827 0 5.104 2.305 5.104 5.152 0 2.848-2.277 5.153-5.104 5.153s-5.104-2.305-5.104-5.153c0-2.847 2.277-5.152 5.104-5.152zM12.017 22.519c4.142 0 7.506-3.393 7.506-7.575 0-4.181-3.364-7.574-7.506-7.574s-7.506 3.393-7.506 7.574c0 4.182 3.364 7.575 7.506 7.575z" />
          <path d="M35.968 20.307V9.693h2.402v8.212c0 1.416.798 2.402 2.103 2.402 1.305 0 2.103-.986 2.103-2.402V9.693h2.402v10.614h-2.402v-1.305c-.658.986-1.743 1.543-3.107 1.543-2.522 0-3.501-1.663-3.501-4.238z" />
          <path d="M51.447 20.546c-2.999 0-4.896-2.103-4.896-5.582 0-3.48 1.897-5.583 4.896-5.583s4.896 2.103 4.896 5.583c0 3.479-1.897 5.582-4.896 5.582zm0-2.163c1.504 0 2.402-1.106 2.402-3.419 0-2.314-.898-3.42-2.402-3.42s-2.402 1.106-2.402 3.42c0 2.313.898 3.419 2.402 3.419z" />
          <path d="M62.39 20.546c-2.999 0-4.896-2.103-4.896-5.582 0-3.48 1.897-5.583 4.896-5.583s4.896 2.103 4.896 5.583c0 3.479-1.897 5.582-4.896 5.582zm0-2.163c1.504 0 2.402-1.106 2.402-3.419 0-2.314-.898-3.42-2.402-3.42s-2.402 1.106-2.402 3.42c0 2.313.898 3.419 2.402 3.419z" />
          <path d="M68.712 20.307V9.693h2.402v1.305c.658-.986 1.743-1.543 3.107-1.543 2.522 0 3.501 1.663 3.501 4.238v6.614h-2.402v-5.642c0-1.416-.798-2.402-2.103-2.402-1.305 0-2.103.986-2.103 2.402v5.642h-2.402z" />
          <path d="M85.968 20.307h-2.402V9.693h2.402v10.614zm-1.201-12.479c-.778 0-1.305-.527-1.305-1.305s.527-1.305 1.305-1.305 1.305.527 1.305 1.305-.527 1.305-1.305 1.305z" />
          <path d="M94.521 20.546c-2.999 0-4.896-2.103-4.896-5.582 0-3.48 1.897-5.583 4.896-5.583 1.783 0 3.228.818 3.946 2.163l-2.043 1.186c-.419-.778-1.066-1.186-1.903-1.186-1.504 0-2.402 1.106-2.402 3.42 0 2.313.898 3.419 2.402 3.419.837 0 1.484-.408 1.903-1.186l2.043 1.186c-.718 1.345-2.163 2.163-3.946 2.163z" />
        </svg>
      </div>
    </div>
  );
}
