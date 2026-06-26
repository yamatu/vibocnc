'use client';

import { useEffect, useState } from 'react';
import Layout from '@/components/layout/Layout';
import { EmailService } from '@/services';
import { toast } from 'react-hot-toast';
import Link from 'next/link';
import { EnvelopeIcon, LockClosedIcon } from '@heroicons/react/24/outline';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [enabled, setEnabled] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(60);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await EmailService.getPublicConfig();
        setEnabled(Boolean(cfg.enabled && cfg.verification_enabled));
        setResendSeconds(cfg.code_resend_seconds || 60);
      } catch {
        setEnabled(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const sendCode = async () => {
    const e = email.trim();
    if (!e) return toast.error('Please enter your email');
    if (!enabled) return toast.error('Password reset via email is currently disabled');
    if (cooldown > 0) return;
    setSending(true);
    try {
      await EmailService.requestPasswordReset(e);
      toast.success('Reset code sent');
      setCooldown(resendSeconds);
      setStep('confirm');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to send code'));
    } finally {
      setSending(false);
    }
  };

  const resetPassword = async () => {
    const e = email.trim();
    if (!e) return toast.error('Please enter your email');
    if (!code.trim()) return toast.error('Please enter the code');
    if (newPassword.length < 6) return toast.error('Password must be at least 6 characters');
    if (newPassword !== confirmPassword) return toast.error('Passwords do not match');

    setResetting(true);
    try {
      await EmailService.confirmPasswordReset({
        email: e,
        code: code.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      toast.success('Password updated. You can now sign in.');
      window.location.href = `/login?returnUrl=/account`;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reset password'));
    } finally {
      setResetting(false);
    }
  };

  return (
    <Layout>
      <div className="site-auth-shell px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100vh-12rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1fr_28rem]">
          <div className="text-white">
            <span className="site-hero-kicker">Account recovery</span>
            <h1 className="mt-5 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
              Restore account access without slowing down procurement.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-blue-100">
              Use your registered email to receive a reset code and return to order tracking or checkout.
            </p>
          </div>

          <div className="w-full">
          <div className="site-auth-card space-y-6 px-5 py-8 sm:px-8">
            <div className="text-center">
              <div className="site-auth-mark mx-auto">
                <LockClosedIcon className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-2xl font-bold text-slate-950">Reset password</h2>
              <p className="mt-2 text-sm text-slate-600">
                <Link href="/login" className="site-link-accent">
                  Back to sign in
                </Link>
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700">Email</label>
              <div className="relative mt-1">
                <EnvelopeIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  className="site-input block w-full px-3 py-2.5 pl-10 shadow-sm sm:text-sm"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            {step === 'confirm' ? (
              <>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Code</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="site-input block w-full px-3 py-2.5 shadow-sm sm:text-sm"
                      placeholder="123456"
                    />
                    <button
                      type="button"
                      onClick={sendCode}
                      disabled={sending || cooldown > 0 || !enabled}
                      className="site-secondary-action shrink-0 px-3 py-2.5 text-sm disabled:opacity-50"
                    >
                      {cooldown > 0 ? `${cooldown}s` : sending ? 'Sending...' : 'Resend'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700">New password</label>
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    type="password"
                    className="site-input mt-1 block w-full px-3 py-2.5 shadow-sm sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700">Confirm new password</label>
                  <input
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    type="password"
                    className="site-input mt-1 block w-full px-3 py-2.5 shadow-sm sm:text-sm"
                  />
                </div>

                <button
                  type="button"
                  disabled={resetting}
                  onClick={resetPassword}
                  className="site-primary-action w-full px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {resetting ? 'Updating...' : 'Update password'}
                </button>
              </>
            ) : (
              <>
                <div className="site-form-muted-box px-4 py-3 text-sm text-slate-600">
                  {enabled ? 'We will send a 6-digit reset code to your email.' : 'Email reset is currently disabled.'}
                </div>
                <button
                  type="button"
                  disabled={sending || !enabled}
                  onClick={sendCode}
                  className="site-primary-action w-full px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {sending ? 'Sending...' : 'Send reset code'}
                </button>
              </>
            )}
          </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
