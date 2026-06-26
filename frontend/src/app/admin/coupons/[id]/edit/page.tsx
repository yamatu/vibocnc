'use client';

import { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { toast } from 'react-hot-toast';
import AdminLayout from '@/components/admin/AdminLayout';
import { CouponService, Coupon, CouponCreateRequest } from '@/services/coupon.service';
import { useAdminI18n } from '@/lib/admin-i18n';
import {
  TagIcon,
  ArrowLeftIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import Link from 'next/link';

type CouponFormData = {
  code: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  min_order_amount?: number;
  max_discount_amount?: number | null;
  usage_limit?: number | null;
  user_usage_limit?: number | null;
  is_active: boolean;
  starts_at?: string | null;
  expires_at?: string | null;
};

export default function EditCouponPage() {
  const { locale, t } = useAdminI18n();
  const params = useParams();
  const router = useRouter();
  const couponId = parseInt(params.id as string);

  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const couponSchema = useMemo(
    () =>
      yup.object({
        code: yup
          .string()
          .required(t('coupons.validation.codeRequired', 'Coupon code is required'))
          .min(3, t('coupons.validation.codeMin', 'Code must be at least 3 characters')),
        name: yup.string().required(t('coupons.validation.nameRequired', 'Coupon name is required')),
        description: yup.string(),
        type: yup
          .string()
          .oneOf(['percentage', 'fixed_amount'])
          .required(t('coupons.validation.typeRequired', 'Discount type is required')),
        value: yup
          .number()
          .required(t('coupons.validation.valueRequired', 'Discount value is required'))
          .min(0.01, t('coupons.validation.valueMin', 'Value must be greater than 0')),
        min_order_amount: yup
          .number()
          .min(0, t('coupons.validation.minOrderNonNeg', 'Minimum order amount cannot be negative'))
          .default(0),
        max_discount_amount: yup
          .number()
          .min(0, t('coupons.validation.maxNonNeg', 'Maximum discount amount cannot be negative'))
          .nullable(),
        usage_limit: yup
          .number()
          .min(1, t('coupons.validation.usageMin', 'Usage limit must be at least 1'))
          .nullable(),
        user_usage_limit: yup
          .number()
          .min(1, t('coupons.validation.userUsageMin', 'User usage limit must be at least 1'))
          .nullable(),
        is_active: yup.boolean().default(true),
        starts_at: yup.string().nullable(),
        expires_at: yup.string().nullable(),
      }),
    [t]
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    reset
  } = useForm<CouponFormData>({
    resolver: yupResolver(couponSchema)
  });

  const watchType = watch('type');
  const watchValue = watch('value');

  const fetchCoupon = async () => {
    try {
      const couponData = await CouponService.getCoupon(couponId);
      setCoupon(couponData);

      // Format dates for datetime-local input
      const formatDateForInput = (dateString?: string) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toISOString().slice(0, 16);
      };

      // Reset form with coupon data
      reset({
        code: couponData.code,
        name: couponData.name,
        description: couponData.description || '',
        type: couponData.type,
        value: couponData.value,
        min_order_amount: couponData.min_order_amount,
        max_discount_amount: couponData.max_discount_amount || undefined,
        usage_limit: couponData.usage_limit || undefined,
        user_usage_limit: couponData.user_usage_limit || undefined,
        is_active: couponData.is_active,
        starts_at: formatDateForInput(couponData.starts_at),
        expires_at: formatDateForInput(couponData.expires_at)
      });
    } catch (error: any) {
      toast.error(error.message || t('coupons.toast.detailLoadFailed', locale === 'zh' ? '加载优惠券失败' : 'Failed to fetch coupon'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (couponId) {
      fetchCoupon();
    }
  }, [couponId]);

  const onSubmit = async (data: CouponFormData) => {
    setIsSubmitting(true);

    try {
      // Validate percentage value
      if (data.type === 'percentage' && data.value > 100) {
        toast.error(t('coupons.validation.percentMax', locale === 'zh' ? '百分比折扣不能超过 100%' : 'Percentage discount cannot exceed 100%'));
        return;
      }

      // Format dates
      const formattedData: CouponCreateRequest = {
        ...data,
        code: data.code.toUpperCase(),
        starts_at: data.starts_at || undefined,
        expires_at: data.expires_at || undefined
      };

      await CouponService.updateCoupon(couponId, formattedData);
      toast.success(t('coupons.toast.updated', locale === 'zh' ? '优惠券更新成功' : 'Coupon updated successfully'));
      router.push(`/admin/coupons/${couponId}`);
    } catch (error: any) {
      toast.error(error.message || t('coupons.toast.updateFailed', locale === 'zh' ? '更新优惠券失败' : 'Failed to update coupon'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateRandomCode = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    setValue('code', result);
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
        </div>
      </AdminLayout>
    );
  }

  if (!coupon) {
    return (
      <AdminLayout>
        <div className="text-center py-12">
          <TagIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">{t('coupons.notFound', locale === 'zh' ? '未找到优惠券' : 'Coupon not found')}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('coupons.notFound.desc', locale === 'zh' ? '你要编辑的优惠券不存在或已被删除。' : "The coupon you're trying to edit doesn't exist or has been deleted.")}
          </p>
          <div className="mt-6">
            <Link
              href="/admin/coupons"
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-amber-600 hover:bg-amber-700"
            >
              {t('coupons.back', locale === 'zh' ? '返回优惠券列表' : 'Back to Coupons')}
            </Link>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href={`/admin/coupons/${coupon.id}`}
              className="text-gray-400 hover:text-gray-600"
            >
              <ArrowLeftIcon className="h-6 w-6" />
            </Link>
            <TagIcon className="h-8 w-8 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t('coupons.edit', locale === 'zh' ? '编辑优惠券' : 'Edit Coupon')}</h1>
              <p className="text-sm text-gray-500">{coupon.code}</p>
            </div>
          </div>
        </div>

        {/* Usage Warning */}
        {coupon.used_count > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
            <div className="flex">
              <InformationCircleIcon className="h-5 w-5 text-yellow-400 mt-0.5" />
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">
                  {t('coupons.usedWarning', locale === 'zh' ? '该优惠券已被使用' : 'Coupon Already Used')}
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                    <p>
                    {t(
                      'coupons.usedWarning.desc',
                      locale === 'zh'
                        ? '该优惠券已被使用 {count} 次。修改时请谨慎，可能会影响已有的使用记录。'
                        : 'This coupon has been used {count} times. Be careful when making changes as they may affect existing usage records.',
                      { count: coupon.used_count }
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        <div className="bg-white shadow-sm rounded-lg">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 p-6">
            {/* Basic Information */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('coupons.section.basic', locale === 'zh' ? '基础信息' : 'Basic Information')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Coupon Code */}
                <div>
                  <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
                    Coupon Code *
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      id="code"
                      {...register('code')}
                      className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                        errors.code ? 'border-red-300' : 'border-gray-300'
                      }`}
                      placeholder={t('coupons.field.codePh', locale === 'zh' ? '输入优惠券代码' : 'Enter coupon code')}
                      style={{ textTransform: 'uppercase' }}
                    />
                    <button
                      type="button"
                      onClick={generateRandomCode}
                      className="px-3 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {t('common.generate', locale === 'zh' ? '生成' : 'Generate')}
                    </button>
                  </div>
                  {errors.code && (
                    <p className="mt-1 text-sm text-red-600">{errors.code.message}</p>
                  )}
                </div>

                {/* Coupon Name */}
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.field.name', locale === 'zh' ? '优惠券名称 *' : 'Coupon Name *')}
                  </label>
                  <input
                    type="text"
                    id="name"
                    {...register('name')}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                      errors.name ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder={t('coupons.field.namePh', locale === 'zh' ? '输入优惠券名称' : 'Enter coupon name')}
                  />
                  {errors.name && (
                    <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                  )}
                </div>

                {/* Description */}
                <div className="md:col-span-2">
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.field.description', locale === 'zh' ? '描述' : 'Description')}
                  </label>
                  <textarea
                    id="description"
                    {...register('description')}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    placeholder={t('coupons.field.descriptionPh', locale === 'zh' ? '输入优惠券描述' : 'Enter coupon description')}
                  />
                </div>
              </div>
            </div>

            {/* Discount Settings */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('coupons.section.discount', locale === 'zh' ? '优惠设置' : 'Discount Settings')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Discount Type */}
                <div>
                  <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.field.type', locale === 'zh' ? '优惠类型 *' : 'Discount Type *')}
                  </label>
                  <select
                    id="type"
                    {...register('type')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  >
                    <option value="percentage">{t('coupons.type.percentage', locale === 'zh' ? '百分比折扣' : 'Percentage Discount')}</option>
                    <option value="fixed_amount">{t('coupons.type.fixed', locale === 'zh' ? '固定金额立减' : 'Fixed Amount Discount')}</option>
                  </select>
                </div>

                {/* Discount Value */}
                <div>
                  <label htmlFor="value" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.field.value', locale === 'zh' ? '优惠数值 *' : 'Discount Value *')}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      id="value"
                      {...register('value')}
                      step={watchType === 'percentage' ? '0.01' : '0.01'}
                      min="0"
                      max={watchType === 'percentage' ? '100' : undefined}
                      className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                        errors.value ? 'border-red-300' : 'border-gray-300'
                      }`}
                      placeholder={watchType === 'percentage'
                        ? t('coupons.field.valuePh.percent', locale === 'zh' ? '0-100' : '0-100')
                        : t('coupons.field.valuePh.amount', locale === 'zh' ? '0.00' : '0.00')}
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                      <span className="text-gray-500 text-sm">
                        {watchType === 'percentage' ? '%' : '$'}
                      </span>
                    </div>
                  </div>
                  {errors.value && (
                    <p className="mt-1 text-sm text-red-600">{errors.value.message}</p>
                  )}
                  {watchType === 'percentage' && watchValue > 100 && (
                    <p className="mt-1 text-sm text-red-600">
                      {t('coupons.validation.percentMax', locale === 'zh' ? '百分比不能超过 100%' : 'Percentage cannot exceed 100%')}
                    </p>
                  )}
                </div>

                {/* Minimum Order Amount */}
                <div>
                  <label htmlFor="min_order_amount" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.field.minOrder', locale === 'zh' ? '最低订单金额' : 'Minimum Order Amount')}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      id="min_order_amount"
                      {...register('min_order_amount')}
                      step="0.01"
                      min="0"
                      className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                        errors.min_order_amount ? 'border-red-300' : 'border-gray-300'
                      }`}
                      placeholder={t('coupons.field.moneyPh', locale === 'zh' ? '0.00' : '0.00')}
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                      <span className="text-gray-500 text-sm">$</span>
                    </div>
                  </div>
                  {errors.min_order_amount && (
                    <p className="mt-1 text-sm text-red-600">{errors.min_order_amount.message}</p>
                  )}
                </div>

                {/* Maximum Discount Amount (for percentage coupons) */}
                {watchType === 'percentage' && (
                  <div>
                    <label htmlFor="max_discount_amount" className="block text-sm font-medium text-gray-700 mb-2">
                      {t('coupons.field.maxDiscount', locale === 'zh' ? '最高优惠金额' : 'Maximum Discount Amount')}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        id="max_discount_amount"
                        {...register('max_discount_amount')}
                        step="0.01"
                        min="0"
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                          errors.max_discount_amount ? 'border-red-300' : 'border-gray-300'
                        }`}
                        placeholder={t('common.noLimit', locale === 'zh' ? '不限制' : 'No limit')}
                      />
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                        <span className="text-gray-500 text-sm">$</span>
                      </div>
                    </div>
                    {errors.max_discount_amount && (
                      <p className="mt-1 text-sm text-red-600">{errors.max_discount_amount.message}</p>
                    )}
                    <p className="mt-1 text-sm text-gray-500">
                      Leave empty for no limit
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Usage Limits */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('coupons.section.limits', locale === 'zh' ? '使用限制' : 'Usage Limits')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Total Usage Limit */}
                <div>
                  <label htmlFor="usage_limit" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.field.usageLimit', locale === 'zh' ? '总使用上限' : 'Total Usage Limit')}
                  </label>
                  <input
                    type="number"
                    id="usage_limit"
                    {...register('usage_limit')}
                    min="1"
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                      errors.usage_limit ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder={t('common.unlimited', locale === 'zh' ? '无限制' : 'Unlimited')}
                  />
                  {errors.usage_limit && (
                    <p className="mt-1 text-sm text-red-600">{errors.usage_limit.message}</p>
                  )}
                  <p className="mt-1 text-sm text-gray-500">
                    Current usage: {coupon.used_count} times
                  </p>
                </div>

                {/* Per User Usage Limit */}
                <div>
                  <label htmlFor="user_usage_limit" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.field.userUsageLimit', locale === 'zh' ? '单用户上限' : 'Per User Usage Limit')}
                  </label>
                  <input
                    type="number"
                    id="user_usage_limit"
                    {...register('user_usage_limit')}
                    min="1"
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                      errors.user_usage_limit ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder={t('common.unlimited', locale === 'zh' ? '无限制' : 'Unlimited')}
                  />
                  {errors.user_usage_limit && (
                    <p className="mt-1 text-sm text-red-600">{errors.user_usage_limit.message}</p>
                  )}
                  <p className="mt-1 text-sm text-gray-500">
                    How many times each user can use this coupon
                  </p>
                </div>
              </div>
            </div>

            {/* Date Range */}
            <div className="border-b border-gray-200 pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('coupons.section.dates', locale === 'zh' ? '时间范围' : 'Date Range')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Start Date */}
                <div>
                  <label htmlFor="starts_at" className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="datetime-local"
                    id="starts_at"
                    {...register('starts_at')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Leave empty to start immediately
                  </p>
                </div>

                {/* End Date */}
                <div>
                  <label htmlFor="expires_at" className="block text-sm font-medium text-gray-700 mb-2">
                    Expiry Date
                  </label>
                  <input
                    type="datetime-local"
                    id="expires_at"
                    {...register('expires_at')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Leave empty for no expiry
                  </p>
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="pb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('common.status', locale === 'zh' ? '状态' : 'Status')}</h3>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_active"
                  {...register('is_active')}
                  className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                  Active
                </label>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Inactive coupons cannot be used by customers
              </p>
            </div>

            {/* Submit Buttons */}
            <div className="flex items-center justify-end space-x-4 pt-6">
              <Link
                href={`/admin/coupons/${coupon.id}`}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
              >
                {t('common.cancel', locale === 'zh' ? '取消' : 'Cancel')}
              </Link>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    {t('common.updating', locale === 'zh' ? '更新中...' : 'Updating...')}
                  </div>
                ) : (
                  t('coupons.update', locale === 'zh' ? '更新优惠券' : 'Update Coupon')
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AdminLayout>
  );
}
/*
  const couponSchema = useMemo(
    () =>
      yup.object({
        code: yup
          .string()
          .required(t('coupons.validation.codeRequired', locale === 'zh' ? '请输入优惠券代码' : 'Coupon code is required'))
          .min(3, t('coupons.validation.codeMin', locale === 'zh' ? '代码至少 3 个字符' : 'Code must be at least 3 characters')),
        name: yup.string().required(t('coupons.validation.nameRequired', locale === 'zh' ? '请输入优惠券名称' : 'Coupon name is required')),
        description: yup.string(),
        type: yup
          .string()
          .oneOf(['percentage', 'fixed_amount'])
          .required(t('coupons.validation.typeRequired', locale === 'zh' ? '请选择优惠类型' : 'Discount type is required')),
        value: yup
          .number()
          .required(t('coupons.validation.valueRequired', locale === 'zh' ? '请输入优惠数值' : 'Discount value is required'))
          .min(0.01, t('coupons.validation.valueMin', locale === 'zh' ? '数值必须大于 0' : 'Value must be greater than 0')),
        min_order_amount: yup
          .number()
          .min(0, t('coupons.validation.minOrderNonNeg', locale === 'zh' ? '最低订单金额不能为负数' : 'Minimum order amount cannot be negative'))
          .default(0),
        max_discount_amount: yup
          .number()
          .min(0, t('coupons.validation.maxNonNeg', locale === 'zh' ? '最高优惠不能为负数' : 'Maximum discount amount cannot be negative'))
          .nullable(),
        usage_limit: yup
          .number()
          .min(1, t('coupons.validation.usageMin', locale === 'zh' ? '使用上限至少为 1' : 'Usage limit must be at least 1'))
          .nullable(),
        user_usage_limit: yup
          .number()
          .min(1, t('coupons.validation.userUsageMin', locale === 'zh' ? '单用户上限至少为 1' : 'User usage limit must be at least 1'))
          .nullable(),
        is_active: yup.boolean().default(true),
        starts_at: yup.string().nullable(),
        expires_at: yup.string().nullable(),
      }),
    [locale, t]
  );
*/
