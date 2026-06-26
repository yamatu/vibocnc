'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { useCustomer } from '@/store/customer.store';
import { EmailService } from '@/services';
import Layout from '@/components/layout/Layout';
import {
  UserIcon,
  EnvelopeIcon,
  LockClosedIcon,
  PhoneIcon,
  BuildingOfficeIcon
} from '@heroicons/react/24/outline';

const registerSchema = yup.object({
  full_name: yup.string().required('Full name is required'),
  email: yup.string().email('Invalid email').required('Email is required'),
  email_code: yup.string(),
  password: yup.string().min(6, 'Password must be at least 6 characters').required('Password is required'),
  confirmPassword: yup.string()
    .oneOf([yup.ref('password')], 'Passwords must match')
    .required('Please confirm your password'),
  phone: yup.string(),
  company: yup.string(),
});

type RegisterFormData = yup.InferType<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerUser, isLoading, isAuthenticated } = useCustomer();

  const [emailCfg, setEmailCfg] = useState<{ enabled: boolean; verification_enabled: boolean; code_resend_seconds: number } | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: yupResolver(registerSchema),
  });

  const emailValue = watch('email');
  const verificationRequired = Boolean(emailCfg?.enabled && emailCfg?.verification_enabled);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await EmailService.getPublicConfig();
        setEmailCfg({
          enabled: cfg.enabled,
          verification_enabled: cfg.verification_enabled,
          code_resend_seconds: cfg.code_resend_seconds || 60,
        });
      } catch {
        setEmailCfg({ enabled: false, verification_enabled: false, code_resend_seconds: 60 });
      }
    })();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/account');
    }
  }, [isAuthenticated, router]);

  const onSubmit = async (data: RegisterFormData) => {
    try {
      const { confirmPassword, ...registerData } = data;

      if (verificationRequired && !String((registerData as any).email_code || '').trim()) {
        toast.error('Email verification code is required');
        return;
      }

      await registerUser(registerData);
      toast.success('Registration successful! Welcome!');
      router.push('/account');
    } catch (error: any) {
      toast.error(error.message || 'Registration failed');
    }
  };

  const sendCode = async () => {
    const email = String(emailValue || '').trim();
    if (!email) {
      toast.error('Please enter your email first');
      return;
    }
    if (!emailCfg?.enabled || !emailCfg.verification_enabled) {
      toast.error('Email verification is currently disabled');
      return;
    }
    if (cooldown > 0) return;
    setSendingCode(true);
    try {
      await EmailService.sendCode({ email, purpose: 'register' });
      toast.success('Verification code sent');
      setCooldown(emailCfg.code_resend_seconds || 60);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send code');
    } finally {
      setSendingCode(false);
    }
  };

  return (
    <Layout>
      <div className="site-auth-shell px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl items-start gap-10 lg:grid-cols-[1fr_34rem]">
          <div className="pt-4 text-white lg:sticky lg:top-28">
            <span className="site-hero-kicker">Trade account</span>
            <h1 className="mt-5 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
              Build a faster purchasing workflow for FANUC spare parts.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-blue-100">
              Create an account for repeat ordering, verified contact details, and cleaner communication with the VCO CNC team.
            </p>
            <div className="mt-8 space-y-3 text-sm text-blue-50">
              {['Centralized order details', 'Email verification support', 'Company purchasing profile'].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="h-1.5 w-8 rounded-full bg-orange-300" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full">
          <div className="site-auth-card px-5 py-8 sm:px-8">
            <div className="text-center">
              <div className="site-auth-mark mx-auto">
                <UserIcon className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-2xl font-bold text-slate-950">
                Create your account
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Already have an account?{' '}
                <Link href="/login" className="site-link-accent">
                  Sign in
                </Link>
              </p>
            </div>

            <div className="mt-8">
            <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
              {/* Full Name */}
              <div>
                <label htmlFor="full_name" className="block text-sm font-semibold text-slate-700">
                  Full Name *
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <UserIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('full_name')}
                    type="text"
                    className="site-input pl-10 block w-full appearance-none px-3 py-2.5 placeholder-gray-400 sm:text-sm"
                    placeholder="John Doe"
                  />
                </div>
                {errors.full_name && (
                  <p className="mt-2 text-sm text-red-600">{errors.full_name.message}</p>
                )}
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-700">
                  Email address *
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <EnvelopeIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('email')}
                    type="email"
                    className="site-input pl-10 block w-full appearance-none px-3 py-2.5 placeholder-gray-400 sm:text-sm"
                    placeholder="you@example.com"
                  />
                </div>
                {errors.email && (
                  <p className="mt-2 text-sm text-red-600">{errors.email.message}</p>
                )}
              </div>

              {/* Email Code */}
              <div>
                <label htmlFor="email_code" className="block text-sm font-semibold text-slate-700">
                  Email verification code {verificationRequired ? '*' : ''}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    {...register('email_code')}
                    type="text"
                    className="site-input block w-full appearance-none px-3 py-2.5 placeholder-gray-400 sm:text-sm"
                    placeholder="123456"
                  />
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={sendingCode || cooldown > 0 || !verificationRequired}
                    className="site-secondary-action shrink-0 px-3 py-2.5 text-sm disabled:opacity-50"
                  >
                    {cooldown > 0 ? `${cooldown}s` : sendingCode ? 'Sending...' : 'Send'}
                  </button>
                </div>
                {verificationRequired ? (
                  <p className="mt-1 text-xs text-gray-500">We will send a 6-digit code to your email.</p>
                ) : (
                  <p className="mt-1 text-xs text-gray-500">Email verification is currently disabled.</p>
                )}
              </div>

              {/* Phone (Optional) */}
              <div>
                <label htmlFor="phone" className="block text-sm font-semibold text-slate-700">
                  Phone Number
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <PhoneIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('phone')}
                    type="tel"
                    className="site-input pl-10 block w-full appearance-none px-3 py-2.5 placeholder-gray-400 sm:text-sm"
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
              </div>

              {/* Company (Optional) */}
              <div>
                <label htmlFor="company" className="block text-sm font-semibold text-slate-700">
                  Company
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <BuildingOfficeIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('company')}
                    type="text"
                    className="site-input pl-10 block w-full appearance-none px-3 py-2.5 placeholder-gray-400 sm:text-sm"
                    placeholder="Your Company Name"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700">
                  Password *
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <LockClosedIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('password')}
                    type="password"
                    className="site-input pl-10 block w-full appearance-none px-3 py-2.5 placeholder-gray-400 sm:text-sm"
                    placeholder="********"
                  />
                </div>
                {errors.password && (
                  <p className="mt-2 text-sm text-red-600">{errors.password.message}</p>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-700">
                  Confirm Password *
                </label>
                <div className="mt-1 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <LockClosedIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    {...register('confirmPassword')}
                    type="password"
                    className="site-input pl-10 block w-full appearance-none px-3 py-2.5 placeholder-gray-400 sm:text-sm"
                    placeholder="********"
                  />
                </div>
                {errors.confirmPassword && (
                  <p className="mt-2 text-sm text-red-600">{errors.confirmPassword.message}</p>
                )}
              </div>

              {/* Terms */}
              <div className="flex items-center">
                <input
                  id="terms"
                  name="terms"
                  type="checkbox"
                  required
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="terms" className="ml-2 block text-sm text-gray-900">
                  I agree to the{' '}
                  <a href="#" className="site-link-accent">
                    Terms and Conditions
                  </a>
                </label>
              </div>

              {/* Submit */}
              <div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="site-primary-action w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? 'Creating account...' : 'Create account'}
                </button>
              </div>
            </form>
          </div>
        </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
