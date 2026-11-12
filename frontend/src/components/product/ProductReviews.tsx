'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckBadgeIcon, StarIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import type { AxiosError } from 'axios';
import type { ProductReview } from '@/types';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import { useCustomer } from '@/store/customer.store';
import { authUtils } from '@/lib/api';
import { ReviewService } from '@/services/review.service';
import { TurnstileService } from '@/services/turnstile.service';
import TurnstileWidget, { type TurnstileWidgetHandle } from '@/components/common/TurnstileWidget';

const PAGE_SIZE = 10;

export function RatingStars({ rating, className = 'h-4 w-4' }: { rating: number; className?: string }) {
  const rounded = Math.round(rating);
  return (
    <span className="inline-flex items-center" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((star) =>
        star <= rounded
          ? <StarIconSolid key={star} className={`${className} text-[var(--site-accent)]`} />
          : <StarIcon key={star} className={`${className} text-slate-300`} />,
      )}
    </span>
  );
}

export function summarizeReviews(reviews?: ProductReview[]) {
  const approved = (reviews || []).filter((r) => r.is_approved);
  const average = approved.length ? approved.reduce((sum, r) => sum + r.rating, 0) / approved.length : 0;
  return { approved, count: approved.length, average };
}

function apiErrorMessage(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string }>;
  return axiosError?.response?.data?.message || (error instanceof Error ? error.message : '');
}

interface ProductReviewsProps {
  productId: number;
  reviews?: ProductReview[];
}

export default function ProductReviews({ productId, reviews }: ProductReviewsProps) {
  const { locale, t, href } = usePublicI18n();
  const { approved, count, average } = useMemo(() => summarizeReviews(reviews), [reviews]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [mounted, setMounted] = useState(false);
  const { isAuthenticated } = useCustomer();
  useEffect(() => setMounted(true), []);
  const loggedIn = mounted && isAuthenticated && authUtils.isCustomerAuthenticated();

  const distribution = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0];
    for (const r of approved) buckets[Math.min(5, Math.max(1, r.rating)) - 1] += 1;
    return buckets;
  }, [approved]);

  const dateLocale = locale === 'zh' ? 'zh-CN' : locale;
  // Same value during SSR and the first client render to avoid a hydration mismatch.
  const returnPath = mounted ? `${window.location.pathname}#reviews` : '/account';
  const loginHref = `${href('/login')}?returnUrl=${encodeURIComponent(returnPath)}`;

  return (
    <section id="reviews" className="scroll-mt-24">
      <h2 className="mb-3 text-lg font-semibold text-slate-950 sm:mb-4 sm:text-xl">{t('product.reviews')}</h2>
      <div className="site-detail-panel p-4 sm:p-6">
        <div className="grid gap-6 md:grid-cols-[minmax(0,240px)_1fr]">
          <div>
            {count > 0 ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-slate-950">{average.toFixed(1)}</span>
                  <span className="text-sm text-slate-500">/ 5</span>
                </div>
                <RatingStars rating={average} className="h-5 w-5" />
                <span className="sr-only">{t('review.stars', { count: average.toFixed(1) })}</span>
                <p className="mt-1 text-sm text-slate-600">
                  {count === 1 ? t('review.basedOnOne') : t('review.basedOn', { count })}
                </p>
                <div className="mt-4 space-y-1.5">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const n = distribution[star - 1];
                    const pct = count ? Math.round((n / count) * 100) : 0;
                    return (
                      <div key={star} className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="w-6 shrink-0">{star}★</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-[var(--site-accent)]" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-6 shrink-0 text-right">{n}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-600">{t('review.none')}</p>
            )}
          </div>

          <div>
            {loggedIn ? (
              <ReviewForm productId={productId} />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
                <p>{t('review.loginPrompt')}</p>
                <Link href={loginHref} className="site-primary-action mt-3 inline-flex px-4 py-2 text-sm">
                  {t('review.signIn')}
                </Link>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">{t('review.moderationNote')}</p>
          </div>
        </div>

        {count > 0 && (
          <ul className="mt-6 divide-y divide-slate-200 border-t border-slate-200">
            {approved.slice(0, visible).map((review) => (
              <li key={review.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-950">{review.customer_name}</span>
                    {review.is_verified ? (
                      <span className="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        <CheckBadgeIcon className="mr-0.5 h-3.5 w-3.5" />
                        {t('review.verifiedBuyer')}
                      </span>
                    ) : review.source ? (
                      <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {t('review.via', { source: t(`review.source.${review.source}`) })}
                      </span>
                    ) : null}
                  </div>
                  <time dateTime={review.created_at} className="text-xs text-slate-500">
                    {new Date(review.created_at).toLocaleDateString(dateLocale)}
                  </time>
                </div>
                <div className="mt-1 flex items-center">
                  <RatingStars rating={review.rating} />
                  <span className="sr-only">{t('review.stars', { count: review.rating })}</span>
                </div>
                {review.review_title && <h3 className="mt-2 font-semibold text-slate-950">{review.review_title}</h3>}
                <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{review.review_content}</p>
              </li>
            ))}
          </ul>
        )}
        {count > visible && (
          <button
            type="button"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="site-secondary-action mt-2 px-4 py-2 text-sm"
          >
            {t('review.showMore')}
          </button>
        )}
      </div>
    </section>
  );
}

function ReviewForm({ productId }: { productId: number }) {
  const { locale, t } = usePublicI18n();
  const queryClient = useQueryClient();
  const eligibilityKey = ['review-eligibility', productId];
  const { data: eligibility, isLoading } = useQuery({
    queryKey: eligibilityKey,
    queryFn: () => ReviewService.getEligibility(productId),
    staleTime: 60_000,
    retry: false,
  });
  const { data: captcha } = useQuery({
    queryKey: ['turnstile', 'public-config'],
    queryFn: () => TurnstileService.getPublicConfig(),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [token, setToken] = useState('');
  const [captchaError, setCaptchaError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const widgetRef = useRef<TurnstileWidgetHandle>(null);

  useEffect(() => {
    if (eligibility && !name) setName(eligibility.default_name || '');
  }, [eligibility, name]);

  if (isLoading || !eligibility) {
    return <div className="h-24 animate-pulse rounded-lg bg-slate-100" />;
  }

  if (submitted) {
    return <Notice tone="success">{t('review.submitted')}</Notice>;
  }
  if (!eligibility.eligible) {
    if (eligibility.reason === 'already_reviewed') {
      return eligibility.review?.status === 'approved'
        ? <Notice tone="success">{t('review.approvedExisting')}</Notice>
        : <Notice tone="info">{t('review.pendingExisting')}</Notice>;
    }
    return <Notice tone="info">{t('review.notPurchased')}</Notice>;
  }

  const captchaEnabled = Boolean(captcha?.enabled && captcha.site_key);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (rating < 1) return setError(t('review.selectRating'));
    if (content.trim().length < 10) return setError(t('review.contentTooShort'));
    if (captchaEnabled && !token) return setError(t('review.captchaRequired'));
    setSubmitting(true);
    try {
      await ReviewService.create({
        product_id: productId,
        rating,
        customer_name: name.trim(),
        review_title: title.trim(),
        review_content: content.trim(),
        turnstile_token: token || undefined,
      });
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: eligibilityKey });
    } catch (err) {
      setError(apiErrorMessage(err) || t('review.failed'));
      widgetRef.current?.reset();
    } finally {
      setSubmitting(false);
    }
  };

  const shown = hover || rating;
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-base font-semibold text-slate-950">{t('review.write')}</h3>
      {eligibility.review?.status === 'rejected' && <Notice tone="info">{t('review.rejectedExisting')}</Notice>}
      {eligibility.orders[0] && (
        <p className="text-xs text-slate-500">{t('review.purchasedIn', { number: eligibility.orders[0].order_number })}</p>
      )}
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">{t('review.rating')}</span>
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t('review.rating')} onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={t('review.stars', { count: star })}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHover(star)}
              className="rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-accent)]"
            >
              {star <= shown
                ? <StarIconSolid className="pointer-events-none h-7 w-7 text-[var(--site-accent)]" />
                : <StarIcon className="pointer-events-none h-7 w-7 text-slate-300" />}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t('review.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required className="site-input w-full px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t('review.title')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="site-input w-full px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">{t('review.content')}</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          maxLength={3000}
          required
          placeholder={t('review.contentPlaceholder')}
          className="site-input w-full px-3 py-2 text-sm"
        />
      </label>
      {captchaEnabled && (
        <div>
          <TurnstileWidget
            ref={widgetRef}
            siteKey={captcha!.site_key}
            language={locale}
            onToken={setToken}
            onError={() => setCaptchaError(t('review.captchaLoadFailed'))}
          />
          {captchaError && <p className="mt-1 text-xs text-red-600">{captchaError}</p>}
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={submitting} className="site-primary-action px-5 py-2.5 text-sm disabled:opacity-60">
        {submitting ? t('review.submitting') : t('review.submit')}
      </button>
    </form>
  );
}

function Notice({ tone, children }: { tone: 'success' | 'info'; children: React.ReactNode }) {
  const cls = tone === 'success'
    ? 'border-green-200 bg-green-50 text-green-800'
    : 'border-slate-200 bg-slate-50 text-slate-700';
  return <div className={`rounded-lg border p-4 text-sm ${cls}`}>{children}</div>;
}
