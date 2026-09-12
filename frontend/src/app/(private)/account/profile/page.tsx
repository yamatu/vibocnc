'use client';

import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '@/lib/errors';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { toast } from 'react-hot-toast';
import Layout from '@/components/layout/Layout';
import { useCustomer } from '@/store/customer.store';
import { CustomerService } from '@/services/customer.service';

const profileSchema = yup.object({
  full_name: yup.string().required('Full name is required'),
  phone: yup.string().defined().default(''),
  company: yup.string().defined().default(''),
  address: yup.string().defined().default(''),
  city: yup.string().defined().default(''),
  state: yup.string().defined().default(''),
  country: yup.string().defined().default(''),
  postal_code: yup.string().defined().default(''),
});

const passwordSchema = yup.object({
  old_password: yup.string().required('Current password is required'),
  new_password: yup.string().min(6, 'Password must be at least 6 characters').required('New password is required'),
  confirm_password: yup
    .string()
    .oneOf([yup.ref('new_password')], 'Passwords must match')
    .required('Please confirm your new password'),
});

type ProfileForm = yup.InferType<typeof profileSchema>;
type PasswordForm = yup.InferType<typeof passwordSchema>;

export default function AccountProfilePage() {
  const router = useRouter();
  const { customer, isAuthenticated, checkAuth, updateCustomer } = useCustomer();

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?returnUrl=/account/profile');
      return;
    }
    checkAuth();
  }, [isAuthenticated, router, checkAuth]);

  const defaults = useMemo<ProfileForm>(() => {
    return {
      full_name: customer?.full_name || '',
      phone: customer?.phone || '',
      company: customer?.company || '',
      address: customer?.address || '',
      city: customer?.city || '',
      state: customer?.state || '',
      country: customer?.country || '',
      postal_code: customer?.postal_code || '',
    };
  }, [customer]);

  const profileForm = useForm<ProfileForm>({
    resolver: yupResolver(profileSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    profileForm.reset(defaults);
  }, [defaults, profileForm]);

  const passwordForm = useForm<PasswordForm>({
    resolver: yupResolver(passwordSchema),
    defaultValues: {
      old_password: '',
      new_password: '',
      confirm_password: '',
    },
  });

  if (!isAuthenticated || !customer) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600" />
        </div>
      </Layout>
    );
  }

  const onSaveProfile = async (data: ProfileForm) => {
    setSavingProfile(true);
    try {
      const updated = await CustomerService.updateProfile(data);
      updateCustomer(updated);
      toast.success('Profile updated');
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Failed to update profile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async (data: PasswordForm) => {
    setSavingPassword(true);
    try {
      await CustomerService.changePassword({
        old_password: data.old_password,
        new_password: data.new_password,
      });
      passwordForm.reset({ old_password: '', new_password: '', confirm_password: '' });
      toast.success('Password updated');
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Failed to change password'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="bg-white shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h1 className="text-2xl font-bold text-gray-900">Profile Settings</h1>
              <p className="mt-1 text-sm text-gray-600">Update your contact info and password.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white shadow sm:rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
                <form className="mt-4 space-y-4" onSubmit={profileForm.handleSubmit(onSaveProfile)}>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Full Name</label>
                    <input
                      {...profileForm.register('full_name')}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    />
                    {profileForm.formState.errors.full_name ? (
                      <p className="mt-1 text-sm text-red-600">{profileForm.formState.errors.full_name.message}</p>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Phone</label>
                      <input
                        {...profileForm.register('phone')}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Company</label>
                      <input
                        {...profileForm.register('company')}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Address</label>
                    <textarea
                      rows={3}
                      {...profileForm.register('address')}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">City</label>
                      <input
                        {...profileForm.register('city')}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">State</label>
                      <input
                        {...profileForm.register('state')}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Postal Code</label>
                      <input
                        {...profileForm.register('postal_code')}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Country</label>
                    <input
                      {...profileForm.register('country')}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                      {savingProfile ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div className="bg-white shadow sm:rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900">Change Password</h2>
                <form className="mt-4 space-y-4" onSubmit={passwordForm.handleSubmit(onChangePassword)}>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Current Password</label>
                    <input
                      type="password"
                      {...passwordForm.register('old_password')}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    />
                    {passwordForm.formState.errors.old_password ? (
                      <p className="mt-1 text-sm text-red-600">{passwordForm.formState.errors.old_password.message}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">New Password</label>
                    <input
                      type="password"
                      {...passwordForm.register('new_password')}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    />
                    {passwordForm.formState.errors.new_password ? (
                      <p className="mt-1 text-sm text-red-600">{passwordForm.formState.errors.new_password.message}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Confirm New Password</label>
                    <input
                      type="password"
                      {...passwordForm.register('confirm_password')}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    />
                    {passwordForm.formState.errors.confirm_password ? (
                      <p className="mt-1 text-sm text-red-600">{passwordForm.formState.errors.confirm_password.message}</p>
                    ) : null}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingPassword}
                      className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
                    >
                      {savingPassword ? 'Updating...' : 'Update Password'}
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
