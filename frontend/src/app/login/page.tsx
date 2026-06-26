'use client';

import { Suspense } from 'react';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { useCustomer } from '@/store/customer.store';
import Layout from '@/components/layout/Layout';
import { LockClosedIcon, EnvelopeIcon } from '@heroicons/react/24/outline';

const loginSchema = yup.object({
  email: yup.string().email('Invalid email').required('Email is required'),
  password: yup.string().required('Password is required'),
});

type LoginFormData = yup.InferType<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get('returnUrl') || '/account';

  const { login, isLoading, isAuthenticated } = useCustomer();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: yupResolver(loginSchema),
  });

  useEffect(() => {
    if (isAuthenticated) {
      router.push(returnUrl);
    }
  }, [isAuthenticated, router, returnUrl]);

  const onSubmit = async (data: LoginFormData) => {
    try {
      await login(data);
      toast.success('Login successful!');
      router.push(returnUrl);
    } catch (error: any) {
      toast.error(error.message || 'Login failed');
    }
  };

  return (
    <div className="site-auth-shell px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-12rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1fr_28rem]">
        <div className="text-white">
          <span className="site-hero-kicker">Customer portal</span>
          <h1 className="mt-5 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
            Access orders, quotes, and FANUC parts support in one place.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-blue-100">
            Sign in to review order history, track purchasing activity, and keep your industrial spare-parts requests moving.
          </p>
          <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
            {['Order tracking', 'Saved details', 'Support history'].map((item) => (
              <div key={item} className="site-stat-card">
                <div className="text-sm font-semibold text-white">{item}</div>
                <div className="mt-1 h-0.5 w-10 bg-orange-300" />
              </div>
            ))}
          </div>
        </div>

        <div className="w-full">
          <div className="site-auth-card px-5 py-8 sm:px-8">
            <div className="text-center">
              <div className="site-auth-mark mx-auto">
                <LockClosedIcon className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-2xl font-bold text-slate-950">
                Sign in to your account
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                New customer?{' '}
                <Link href="/register" className="site-link-accent">
                  Create an account
                </Link>
              </p>
            </div>

            <div className="mt-8">
          <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-700">
                Email address
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

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-700">
                Password
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

            {/* Remember & Forgot */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">
                  Remember me
                </label>
              </div>

              <div className="text-sm">
                <Link href="/forgot-password" className="site-link-accent">
                  Forgot password?
                </Link>
              </div>
            </div>

            {/* Submit */}
            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="site-primary-action w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>
            </div>
        </div>
      </div>
    </div>
    </div>
  );
}

function LoginFormFallback() {
  return (
    <div className="site-auth-shell flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-800"></div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Layout>
      <Suspense fallback={<LoginFormFallback />}>
        <LoginForm />
      </Suspense>
    </Layout>
  );
}
