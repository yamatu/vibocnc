'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { toast } from 'react-hot-toast';
import {
  CheckCircleIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import ContactService from '@/services/contact.service';
import { useQuoteModalStore } from '@/store/quote-modal.store';
import { useCustomerStore } from '@/store/customer.store';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { formatCurrency } from '@/lib/utils';

const SESSION_PREFILL_KEY = 'vibocnc_quote_contact_prefill';

interface SavedContactPrefill {
  name?: string;
  email?: string;
  company?: string;
  phone?: string;
}

function readSavedPrefill(): SavedContactPrefill {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SESSION_PREFILL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SavedContactPrefill) : {};
  } catch {
    return {};
  }
}

function savePrefill(data: SavedContactPrefill) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_PREFILL_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

export default function QuickQuoteModal() {
  const { isOpen, product, closeQuoteModal } = useQuoteModalStore();
  const customer = useCustomerStore((state) => state.customer);
  const { t, dir } = usePublicI18n();

  const titleId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);

  const [partNumber, setPartNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submittedId, setSubmittedId] = useState<number | null>(null);

  // Reset product context & hydrate saved customer info whenever modal opens
  useEffect(() => {
    if (!isOpen) return;

    const saved = readSavedPrefill();
    setPartNumber(product?.sku || '');
    setQuantity(String(product?.quantity && product.quantity > 0 ? product.quantity : 1));
    setName(saved.name || customer?.full_name || '');
    setEmail(saved.email || customer?.email || '');
    setCompany(saved.company || customer?.company || '');
    setPhone(saved.phone || customer?.phone || '');
    setNotes('');
    setErrorMessage('');
    setSubmittedId(null);

    const timer = window.setTimeout(() => {
      firstInputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [isOpen, product, customer]);

  // Body scroll lock & Escape to close
  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        closeQuoteModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, isSubmitting, closeQuoteModal]);

  if (!isOpen) return null;

  const trimmedPart = partNumber.trim() || product?.sku || '';
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const parsedQty = Math.max(1, parseInt(quantity, 10) || 1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!trimmedName || !trimmedEmail) {
      setErrorMessage(t('quoteModal.requiredFields'));
      return;
    }

    setIsSubmitting(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const resolvedUrl = product?.productUrl
        ? product.productUrl.startsWith('http')
          ? product.productUrl
          : `${origin}${product.productUrl}`
        : typeof window !== 'undefined'
          ? window.location.href
          : '';

      const subjectTarget = trimmedPart || product?.name || 'Industrial Automation Part';
      const subject = `Quote Request: ${subjectTarget}`.slice(0, 190);

      const messageLines = [
        'Quick Quote Inquiry (Submitted from Product Page)',
        '----------------------------------------',
        ...(trimmedPart ? [`SKU / Part Number: ${trimmedPart}`] : []),
        ...(product?.name ? [`Product: ${product.name}`] : []),
        ...(product?.brand ? [`Brand: ${product.brand}`] : []),
        ...(product?.price && product.price > 0 ? [`Listed Price: ${formatCurrency(product.price)}`] : []),
        `Quantity: ${parsedQty}`,
        ...(resolvedUrl ? [`Page URL: ${resolvedUrl}`] : []),
        '',
        notes.trim()
          ? `Customer Notes:\n${notes.trim()}`
          : 'Customer Notes:\nPlease provide your best quote, stock availability, and lead time.',
      ];

      const result = await ContactService.submitContact({
        name: trimmedName,
        email: trimmedEmail,
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        subject,
        message: messageLines.join('\n'),
        inquiry_type: 'quote',
      });

      savePrefill({
        name: trimmedName,
        email: trimmedEmail,
        company: company.trim(),
        phone: phone.trim(),
      });

      setSubmittedId(result?.id ?? 0);
      toast.success(t('contact.success'));
    } catch (error: unknown) {
      const msg =
        error instanceof Error && error.message
          ? error.message
          : t('contact.error');
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWhatsAppFallback = () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const text = [
      `Hi, I'd like to request a quote:`,
      ...(trimmedPart ? [`SKU / Model: ${trimmedPart}`] : []),
      ...(product?.name ? [`Product: ${product.name}`] : []),
      `Quantity: ${parsedQty}`,
      ...(notes.trim() ? [`Notes: ${notes.trim()}`] : []),
      ...(url ? [`Link: ${url}`] : []),
    ].join('\n');
    window.open(`https://wa.me/8613301553506?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      dir={dir}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/65 backdrop-blur-[2px] transition-opacity"
        onClick={() => !isSubmitting && closeQuoteModal()}
        aria-hidden="true"
      />

      {/* Modal Panel */}
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 bg-slate-950 px-5 py-4 text-white sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-orange-300">
              <EnvelopeIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-bold leading-snug text-white">
                {t('quoteModal.title')}
              </h2>
              <p className="mt-0.5 text-xs text-slate-300">
                {t('quoteModal.subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isSubmitting && closeQuoteModal()}
            aria-label={t('header.closeMenu')}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {/* Auto-filled Product Context Banner */}
          {product && (product.sku || product.name) && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
              {product.imageUrl && (
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-blue-200 bg-white">
                  <Image
                    src={product.imageUrl}
                    alt={product.name || product.sku}
                    width={48}
                    height={48}
                    unoptimized
                    className="h-full w-full object-contain p-1"
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {product.sku && (
                    <span className="inline-flex items-center rounded bg-slate-950 px-2 py-0.5 font-mono text-xs font-semibold text-orange-300">
                      {product.sku}
                    </span>
                  )}
                  {product.price && product.price > 0 && (
                    <span className="text-xs font-semibold text-[var(--site-primary)]">
                      {t('quoteModal.listedPrice', { price: formatCurrency(product.price) })}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                  {product.name}
                </p>
              </div>
            </div>
          )}

          {submittedId !== null ? (
            <div className="py-4 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
                <CheckCircleIcon className="h-9 w-9" />
              </div>
              <h3 className="text-lg font-bold text-slate-950">{t('quoteModal.successTitle')}</h3>
              <p className="mt-1.5 text-sm text-slate-600">
                {t('quoteModal.successDescription', {
                  sku: trimmedPart || product?.name || '-',
                  email: trimmedEmail,
                })}
                {submittedId > 0 ? ` (#${submittedId})` : ''}
              </p>
              <div className="mt-6 flex flex-col justify-center gap-2.5 sm:flex-row">
                <button
                  type="button"
                  onClick={closeQuoteModal}
                  className="site-primary-action h-10 px-5 text-sm"
                >
                  {t('quoteModal.continueBrowsing')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSubmittedId(null);
                    setNotes('');
                  }}
                  className="site-secondary-action h-10 px-5 text-sm"
                >
                  {t('quoteModal.sendAnother')}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  {errorMessage}
                </div>
              )}

              {/* Row 1: Auto-filled Part Number / Model + Quantity */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label htmlFor="vibo-quote-part-number" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {t('quoteModal.partNumber')} *
                  </label>
                  <input
                    id="vibo-quote-part-number"
                    type="text"
                    required
                    value={partNumber}
                    onChange={(e) => setPartNumber(e.target.value)}
                    placeholder="e.g. 6ES7-315-2EH14-0AB0"
                    className="site-input w-full bg-slate-50 px-3 py-2 font-mono text-sm font-medium text-slate-950 focus:bg-white"
                  />
                </div>
                <div>
                  <label htmlFor="vibo-quote-quantity" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {t('quoteModal.quantity')} *
                  </label>
                  <input
                    id="vibo-quote-quantity"
                    type="number"
                    min={1}
                    max={99999}
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="site-input w-full px-3 py-2 text-sm text-slate-950"
                  />
                </div>
              </div>

              {/* Row 2: Full Name + Email */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label htmlFor="vibo-quote-name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {t('contact.fullName')} *
                  </label>
                  <input
                    ref={firstInputRef}
                    id="vibo-quote-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('contact.fullName')}
                    className="site-input w-full px-3 py-2 text-sm text-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="vibo-quote-email" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {t('contact.emailAddress')} *
                  </label>
                  <input
                    id="vibo-quote-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="site-input w-full px-3 py-2 text-sm text-slate-950"
                  />
                </div>
              </div>

              {/* Row 3: Company + Phone / WhatsApp */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label htmlFor="vibo-quote-company" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {t('contact.company')}
                  </label>
                  <input
                    id="vibo-quote-company"
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder={t('contact.company')}
                    className="site-input w-full px-3 py-2 text-sm text-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="vibo-quote-phone" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {t('contact.phoneNumber')}
                  </label>
                  <input
                    id="vibo-quote-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 / +86 ..."
                    className="site-input w-full px-3 py-2 text-sm text-slate-950"
                  />
                </div>
              </div>

              {/* Row 4: Notes */}
              <div>
                <label htmlFor="vibo-quote-notes" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700">
                  {t('quoteModal.notesLabel')}
                </label>
                <textarea
                  id="vibo-quote-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('quoteModal.notesPlaceholder')}
                  className="site-input w-full px-3 py-2 text-sm text-slate-950"
                />
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={handleWhatsAppFallback}
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-green-700 transition-colors hover:text-green-800 sm:justify-start"
                >
                  <span>{t('quoteModal.whatsappFallback')}</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeQuoteModal}
                    disabled={isSubmitting}
                    className="site-secondary-action h-10 px-4 text-sm disabled:opacity-50"
                  >
                    {t('quoteModal.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="site-primary-action h-10 flex-1 gap-2 px-5 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:flex-initial"
                  >
                    <PaperAirplaneIcon className="h-4 w-4 shrink-0" />
                    <span>{isSubmitting ? t('contact.sending') : t('quoteModal.submit')}</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
