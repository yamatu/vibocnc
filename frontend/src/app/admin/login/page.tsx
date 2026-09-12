'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useLogin } from '@/hooks/useAuth';
import { LoginRequest } from '@/types';
import { useAdminI18n } from '@/lib/admin-i18n';

export default function AdminLoginPage() {
  const { t } = useAdminI18n();
  const [showPassword, setShowPassword] = useState(false);
  const loginMutation = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>();

  const onSubmit = async (data: LoginRequest) => {
    try {
      await loginMutation.mutateAsync(data);
      // Redirect will be handled by the useLogin hook
    } catch (error) {
      // Error handling is done in the useLogin hook
      console.error('Login failed:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold text-2xl">
              FANUC
            </div>
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            {t('admin.login.title', 'Admin Login')}
          </h2>
          <p className="text-gray-600">
            {t('admin.login.subtitle', 'Sign in to access the admin dashboard')}
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
            {/* Username Field */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                {t('admin.login.username', 'Username')}
              </label>
              <input
                {...register('username', {
                  required: t('admin.login.usernameRequired', 'Username is required'),
                  minLength: {
                    value: 3,
                    message: t('admin.login.usernameMin', 'Username must be at least 3 characters')
                  }
                })}
                type="text"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                placeholder={t('admin.login.usernamePlaceholder', 'Enter your username')}
              />
              {errors.username && (
                <p className="mt-1 text-sm text-red-600">{errors.username.message}</p>
              )}
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                {t('admin.login.password', 'Password')}
              </label>
              <div className="relative">
                <input
                  {...register('password', {
                    required: t('admin.login.passwordRequired', 'Password is required'),
                    minLength: {
                      value: 6,
                      message: t('admin.login.passwordMin', 'Password must be at least 6 characters')
                    }
                  })}
                  type={showPassword ? 'text' : 'password'}
                  className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  placeholder={t('admin.login.passwordPlaceholder', 'Enter your password')}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5 text-gray-400" />
                  ) : (
                    <EyeIcon className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700">
                  {t('admin.login.remember', 'Remember me')}
                </label>
              </div>

              <div className="text-sm">
                <Link href="/admin/forgot-password" className="font-medium text-blue-600 hover:text-blue-500">
                  {t('admin.login.forgot', 'Forgot your password?')}
                </Link>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || loginMutation.isPending}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting || loginMutation.isPending ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {String(t('admin.login.signingIn', 'Signing in...'))}
                </div>
              ) : (
                String(t('admin.login.signIn', 'Sign in'))
              )}
            </button>
          </form>

          {/* Error Message */}
          {Boolean(loginMutation.error) && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">
                {loginMutation.error instanceof Error
                  ? String(loginMutation.error.message)
                  : String(t('admin.login.failed', 'Login failed. Please try again.'))}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-sm text-gray-600">
            {t('admin.login.footer', '© 2024 FANUC Sales. All rights reserved.')}
          </p>
        </div>
      </div>
    </div>
  );
}
