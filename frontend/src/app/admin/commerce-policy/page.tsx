'use client';

import AdminLayout from '@/components/admin/AdminLayout';
import { CommercePolicyService } from '@/services';
import type { CommercePolicySetting } from '@/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

/**
 * Single source of truth for every commercial promise the storefront makes.
 * Changing a value here updates product pages, category pages, the FAQ and the
 * structured data on the next revalidation — no code change required.
 */
export default function AdminCommercePolicyPage() {
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['commerce-policy', 'settings'],
    queryFn: () => CommercePolicyService.getSettings(),
  });

  const [form, setForm] = useState<CommercePolicySetting | null>(null);

  useEffect(() => {
    if (data) setForm({ ...data });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error('Nothing to save');
      return CommercePolicyService.updateSettings(form);
    },
    onSuccess: (saved) => {
      setForm({ ...saved });
      toast.success('Commerce policy saved');
      qc.invalidateQueries({ queryKey: ['commerce-policy'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to save commerce policy'),
  });

  const update = <K extends keyof CommercePolicySetting>(key: K, value: CommercePolicySetting[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const numberValue = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Commerce Policy</h1>
            <p className="mt-1 text-sm text-slate-600">
              Shipping, warranty and return promises shown on product pages, category pages, FAQs and
              structured data. Editing here never rewrites existing product copy.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Reload
            </button>
            <button
              type="button"
              disabled={!form || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {(error as any)?.message || 'Failed to load commerce policy'}
          </div>
        )}

        {form && (
          <div className="space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-900">Shipping</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Handling time (shown to customers)">
                  <input
                    className={inputClass}
                    value={form.shipping_handling_time_text}
                    onChange={(e) => update('shipping_handling_time_text', e.target.value)}
                    placeholder="1-2 days"
                  />
                </Field>
                <Field label="Transit time (shown to customers)">
                  <input
                    className={inputClass}
                    value={form.shipping_transit_time_text}
                    onChange={(e) => update('shipping_transit_time_text', e.target.value)}
                    placeholder="4-5 DAYS"
                  />
                </Field>
                <Field label="Handling days min">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className={inputClass}
                    value={form.shipping_handling_days_min}
                    onChange={(e) => update('shipping_handling_days_min', numberValue(e.target.value, form.shipping_handling_days_min))}
                  />
                </Field>
                <Field label="Handling days max">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className={inputClass}
                    value={form.shipping_handling_days_max}
                    onChange={(e) => update('shipping_handling_days_max', numberValue(e.target.value, form.shipping_handling_days_max))}
                  />
                </Field>
                <Field label="Transit days min">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className={inputClass}
                    value={form.shipping_transit_days_min}
                    onChange={(e) => update('shipping_transit_days_min', numberValue(e.target.value, form.shipping_transit_days_min))}
                  />
                </Field>
                <Field label="Transit days max">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className={inputClass}
                    value={form.shipping_transit_days_max}
                    onChange={(e) => update('shipping_transit_days_max', numberValue(e.target.value, form.shipping_transit_days_max))}
                  />
                </Field>
                <Field label="Carriers (comma separated)">
                  <input
                    className={inputClass}
                    value={form.shipping_carriers}
                    onChange={(e) => update('shipping_carriers', e.target.value)}
                    placeholder="DHL,FedEx,UPS"
                  />
                </Field>
                <Field
                  label="Destination countries"
                  hint="ISO-3166 alpha-2 codes, comma separated. Use GLOBAL for worldwide."
                >
                  <input
                    className={inputClass}
                    value={form.shipping_destination_countries}
                    onChange={(e) => update('shipping_destination_countries', e.target.value)}
                    placeholder="GLOBAL"
                  />
                </Field>
                <Field label="Flat shipping rate">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={form.shipping_rate_amount}
                    onChange={(e) => update('shipping_rate_amount', numberValue(e.target.value, form.shipping_rate_amount))}
                  />
                </Field>
                <Field label="Currency">
                  <input
                    className={inputClass}
                    value={form.shipping_currency}
                    onChange={(e) => update('shipping_currency', e.target.value.toUpperCase().slice(0, 3))}
                    placeholder="USD"
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Shipping notes (internal or public notes)">
                  <textarea
                    rows={3}
                    className={inputClass}
                    value={form.shipping_notes}
                    onChange={(e) => update('shipping_notes', e.target.value)}
                  />
                </Field>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-900">Warranty &amp; lead time defaults</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Default warranty period">
                  <input
                    className={inputClass}
                    value={form.default_warranty_period}
                    onChange={(e) => update('default_warranty_period', e.target.value)}
                    placeholder="12 months"
                  />
                </Field>
                <Field label="Default lead time">
                  <input
                    className={inputClass}
                    value={form.default_lead_time}
                    onChange={(e) => update('default_lead_time', e.target.value)}
                    placeholder="4-5 DAYS"
                  />
                </Field>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-900">Returns</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Return window (days)" hint="Maximum 365 days.">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className={inputClass}
                    value={form.return_window_days}
                    onChange={(e) => update('return_window_days', numberValue(e.target.value, form.return_window_days))}
                  />
                </Field>
                <Field label="Return window (shown to customers)">
                  <input
                    className={inputClass}
                    value={form.return_window_text}
                    onChange={(e) => update('return_window_text', e.target.value)}
                    placeholder="1 year"
                  />
                </Field>
                <Field label="Who pays return shipping">
                  <select
                    className={inputClass}
                    value={form.return_shipping_payer}
                    onChange={(e) => update('return_shipping_payer', e.target.value as CommercePolicySetting['return_shipping_payer'])}
                  >
                    <option value="shared">Shared — both parties share the cost</option>
                    <option value="customer">Customer pays</option>
                    <option value="merchant">Vibocnc pays</option>
                  </select>
                </Field>
                <Field label="Return policy country" hint="ISO-3166 alpha-2 code shown in structured data.">
                  <input
                    className={inputClass}
                    value={form.return_policy_country}
                    onChange={(e) => update('return_policy_country', e.target.value.toUpperCase().slice(0, 2))}
                    placeholder="US"
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Return notes">
                  <textarea
                    rows={3}
                    className={inputClass}
                    value={form.return_policy_notes}
                    onChange={(e) => update('return_policy_notes', e.target.value)}
                  />
                </Field>
              </div>
            </section>

            <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
              <h2 className="text-base font-semibold">Applying the policy to products</h2>
              <p className="mt-2">
                Saving here changes the promise shown on the storefront immediately. To push the new
                lead time / warranty onto existing product records, use{' '}
                <strong>Admin → Products → bulk actions → Fill from commerce policy</strong>. That action only
                fills blank fields unless you explicitly choose to overwrite.
              </p>
              <p className="mt-2">
                The product pages, category pages, FAQ and structured data all read this policy, so the shipping,
                warranty and return figures never have to be typed into code again. The standalone{' '}
                <strong>/shipping-policy</strong>, <strong>/warranty-policy</strong> and <strong>/returns</strong> pages
                are separate editable documents — update them under{' '}
                <strong>Admin → Site Pages</strong> when a promise changes so the legal text matches the promise shown
                on product pages.
              </p>
            </section>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
