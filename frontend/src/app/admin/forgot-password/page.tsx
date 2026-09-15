'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { AuthService, EmailService } from '@/services';
import { useAdminI18n } from '@/lib/admin-i18n';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export default function AdminForgotPasswordPage() {
  const router = useRouter();
  const { locale, t } = useAdminI18n();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [cooldown, setCooldown] = useState(0);
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
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [cooldown]);

  const sendCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error(t('admin.forgot.emailRequired', locale === 'zh' ? '请输入邮箱' : 'Please enter your email'));
      return;
    }
    if (!enabled) {
      toast.error(t('admin.forgot.disabled', locale === 'zh' ? '邮件重置功能当前未开启' : 'Password reset via email is currently disabled'));
      return;
    }
    if (cooldown > 0 || sending) {
      return;
    }

    setSending(true);
    try {
      await AuthService.requestPasswordReset(normalizedEmail);
      toast.success(t('admin.forgot.codeSent', locale === 'zh' ? '验证码已发送，请检查邮箱' : 'Reset code sent. Please check your inbox.'));
      setStep('confirm');
      setCooldown(resendSeconds);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('admin.forgot.sendFailed', locale === 'zh' ? '发送验证码失败' : 'Failed to send reset code')));
    } finally {
      setSending(false);
    }
  };

  const resetPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error(t('admin.forgot.emailRequired', locale === 'zh' ? '请输入邮箱' : 'Please enter your email'));
      return;
    }
    if (!code.trim()) {
      toast.error(t('admin.forgot.codeRequired', locale === 'zh' ? '请输入验证码' : 'Please enter the verification code'));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(t('admin.forgot.passwordMin', locale === 'zh' ? '新密码至少 6 位' : 'Password must be at least 6 characters'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('admin.forgot.passwordMismatch', locale === 'zh' ? '两次密码输入不一致' : 'Passwords do not match'));
      return;
    }

    setResetting(true);
    try {
      await AuthService.confirmPasswordReset({
        email: normalizedEmail,
        code: code.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      toast.success(t('admin.forgot.resetOk', locale === 'zh' ? '密码重置成功，请重新登录' : 'Password reset successful. Please sign in again.'));
      router.push('/admin/login');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('admin.forgot.resetFailed', locale === 'zh' ? '密码重置失败' : 'Failed to reset password')));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold text-2xl">Vibocnc</div>
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            {t('admin.forgot.title', locale === 'zh' ? '找回管理员密码' : 'Reset admin password')}
          </h2>
          <p className="text-gray-600">
            {t('admin.forgot.subtitle', locale === 'zh' ? '通过邮箱验证码重置密码' : 'Reset with a verification code sent to your email')}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('admin.forgot.email', locale === 'zh' ? '邮箱' : 'Email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            />
          </div>

          {step === 'confirm' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('admin.forgot.code', locale === 'zh' ? '验证码' : 'Verification code')}
                </label>
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="123456"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  />
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={sending || cooldown > 0 || !enabled}
                    className="shrink-0 px-3 py-3 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    {cooldown > 0
                      ? `${cooldown}s`
                      : sending
                        ? t('admin.forgot.sending', locale === 'zh' ? '发送中...' : 'Sending...')
                        : t('admin.forgot.resend', locale === 'zh' ? '重发' : 'Resend')}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('admin.forgot.newPassword', locale === 'zh' ? '新密码' : 'New password')}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('admin.forgot.confirmPassword', locale === 'zh' ? '确认新密码' : 'Confirm new password')}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                />
              </div>

              <button
                type="button"
                onClick={resetPassword}
                disabled={resetting}
                className="w-full py-3 px-4 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {resetting
                  ? t('admin.forgot.updating', locale === 'zh' ? '重置中...' : 'Updating...')
                  : t('admin.forgot.submit', locale === 'zh' ? '重置密码' : 'Reset password')}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                {enabled
                  ? t('admin.forgot.hint', locale === 'zh' ? '我们会向你的邮箱发送 6 位验证码。' : 'We will send a 6-digit reset code to your email.')
                  : t('admin.forgot.disabled', locale === 'zh' ? '邮件重置功能当前未开启' : 'Password reset via email is currently disabled')}
              </p>

              <button
                type="button"
                onClick={sendCode}
                disabled={sending || !enabled}
                className="w-full py-3 px-4 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {sending
                  ? t('admin.forgot.sending', locale === 'zh' ? '发送中...' : 'Sending...')
                  : t('admin.forgot.sendCode', locale === 'zh' ? '发送验证码' : 'Send reset code')}
              </button>
            </>
          )}

          <div className="text-center text-sm">
            <Link href="/admin/login" className="font-medium text-blue-600 hover:text-blue-500">
              {t('admin.forgot.backToLogin', locale === 'zh' ? '返回管理员登录' : 'Back to admin login')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
