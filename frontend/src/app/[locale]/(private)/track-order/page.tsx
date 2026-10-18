'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/layout/Layout';
import { MagnifyingGlassIcon, TruckIcon } from '@heroicons/react/24/outline';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';

export default function TrackOrderPage() {
  const [orderNumber, setOrderNumber] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const { t, href } = usePublicI18n();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = orderNumber.trim();
    if (!trimmed) {
      setError(t('order.enterNumber'));
      return;
    }
    setError('');
    router.push(href(`/orders/track/${encodeURIComponent(trimmed)}`));
  };

  return (
    <Layout>
      <div className="site-page-shell min-h-screen">
        <section className="site-page-hero">
          <div className="site-hero-inner mx-auto max-w-5xl px-4 py-14 text-center sm:px-6 lg:px-8">
            <span className="site-hero-kicker">{t('order.kicker')}</span>
            <h1 className="mt-5 text-4xl font-bold sm:text-5xl">{t('order.trackTitle')}</h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-blue-100">
              {t('order.trackDescription')}
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="site-panel p-6 text-center sm:p-8">
            <div className="site-auth-mark mx-auto mb-6">
              <TruckIcon className="h-8 w-8" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={orderNumber}
                  onChange={(e) => { setOrderNumber(e.target.value); setError(''); }}
                  placeholder="e.g., ORD-20250225-XXXXXX"
                  className="site-input w-full px-4 py-3 text-center text-lg font-semibold tracking-wide"
                  autoFocus
                />
                {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              </div>
              <button
                type="submit"
                className="site-primary-action w-full px-6 py-3"
              >
                <MagnifyingGlassIcon className="mr-2 h-5 w-5" />
                {t('order.trackAction')}
              </button>
            </form>

            <p className="mt-6 text-xs text-slate-500">
              {t('order.numberHint')}
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
