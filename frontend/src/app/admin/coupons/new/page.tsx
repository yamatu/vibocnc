'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type Resolver } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { toast } from 'react-hot-toast';
import AdminLayout from '@/components/admin/AdminLayout';
import { CouponService, CouponCreateRequest } from '@/services/coupon.service';
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
type CouponSchemaData = Omit<CouponFormData, 'description' | 'max_discount_amount' | 'usage_limit' | 'user_usage_limit' | 'starts_at' | 'expires_at'> & {
  description: string | undefined;
  max_discount_amount: number | null | undefined;
  usage_limit: number | null | undefined;
  user_usage_limit: number | null | undefined;
  starts_at: string | null | undefined;
  expires_at: string | null | undefined;
};

export default function NewCouponPage() {
  const { locale, t } = useAdminI18n();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue
  } = useForm<CouponSchemaData>({
    resolver: yupResolver(couponSchema) as unknown as Resolver<CouponSchemaData>,
    defaultValues: {
      type: 'percentage',
      min_order_amount: 0,
      is_active: true
    }
  });

  const watchType = watch('type');
  const watchValue = watch('value');

  const onSubmit = async (data: CouponSchemaData) => {
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
        max_discount_amount: data.max_discount_amount ?? undefined,
        usage_limit: data.usage_limit ?? undefined,
        user_usage_limit: data.user_usage_limit ?? undefined,
        code: data.code.toUpperCase(),
        starts_at: data.starts_at || undefined,
        expires_at: data.expires_at || undefined
      };

      await CouponService.createCoupon(formattedData);
      toast.success(t('coupons.toast.created', locale === 'zh' ? '优惠券创建成功' : 'Coupon created successfully'));
      router.push('/admin/coupons');
    } catch (error: any) {
      toast.error(error.message || t('coupons.toast.createFailed', locale === 'zh' ? '创建优惠券失败' : 'Failed to create coupon'));
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

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/admin/coupons"
              className="text-gray-400 hover:text-gray-600"
            >
              <ArrowLeftIcon className="h-6 w-6" />
            </Link>
            <TagIcon className="h-8 w-8 text-amber-600" />
            <h1 className="text-2xl font-bold text-gray-900">{t('coupons.new.title', locale === 'zh' ? '创建优惠券' : 'Create New Coupon')}</h1>
          </div>
        </div>

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
                    {t('coupons.field.code', locale === 'zh' ? '优惠券代码 *' : 'Coupon Code *')}
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
                      placeholder={watchType === 'percentage' ? '0-100' : '0.00'}
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
                    <p className="mt-1 text-sm text-red-600">{t('coupons.validation.percentMax', locale === 'zh' ? '百分比不能超过 100%' : 'Percentage cannot exceed 100%')}</p>
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
                      placeholder="0.00"
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
                        {t('common.noLimitHint', locale === 'zh' ? '留空表示不限制' : 'Leave empty for no limit')}
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
                    {t('coupons.limit.total', locale === 'zh' ? '总使用上限' : 'Total Usage Limit')}
                  </label>
                  <input
                    type="number"
                    id="usage_limit"
                    {...register('usage_limit')}
                    min="1"
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                      errors.usage_limit ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder={t('coupons.unlimited', locale === 'zh' ? '不限' : 'Unlimited')}
                  />
                  {errors.usage_limit && (
                    <p className="mt-1 text-sm text-red-600">{errors.usage_limit.message}</p>
                  )}
                  <p className="mt-1 text-sm text-gray-500">
                    {t('common.leaveEmptyUnlimited', locale === 'zh' ? '留空表示不限' : 'Leave empty for unlimited usage')}
                  </p>
                </div>

                {/* Per User Usage Limit */}
                <div>
                  <label htmlFor="user_usage_limit" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.limit.perUser', locale === 'zh' ? '单用户使用上限' : 'Per User Usage Limit')}
                  </label>
                  <input
                    type="number"
                    id="user_usage_limit"
                    {...register('user_usage_limit')}
                    min="1"
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${
                      errors.user_usage_limit ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder={t('coupons.unlimited', locale === 'zh' ? '不限' : 'Unlimited')}
                  />
                  {errors.user_usage_limit && (
                    <p className="mt-1 text-sm text-red-600">{errors.user_usage_limit.message}</p>
                  )}
                  <p className="mt-1 text-sm text-gray-500">
                    {t('coupons.limit.perUserHint', locale === 'zh' ? '每个用户最多可使用次数' : 'How many times each user can use this coupon')}
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
                    {t('coupons.field.startsAt', locale === 'zh' ? '开始时间' : 'Start Date')}
                  </label>
                  <input
                    type="datetime-local"
                    id="starts_at"
                    {...register('starts_at')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    {t('coupons.startImmediate', locale === 'zh' ? '留空表示立即生效' : 'Leave empty to start immediately')}
                  </p>
                </div>

                {/* End Date */}
                <div>
                  <label htmlFor="expires_at" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('coupons.field.expiresAt', locale === 'zh' ? '过期时间' : 'Expiry Date')}
                  </label>
                  <input
                    type="datetime-local"
                    id="expires_at"
                    {...register('expires_at')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    {t('coupons.noExpiry', locale === 'zh' ? '留空表示永不过期' : 'Leave empty for no expiry')}
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
                  {t('common.active', locale === 'zh' ? '启用' : 'Active')}
                </label>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {t('coupons.inactiveHint', locale === 'zh' ? '停用的优惠券无法被客户使用' : 'Inactive coupons cannot be used by customers')}
              </p>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <div className="flex">
                <InformationCircleIcon className="h-5 w-5 text-blue-400 mt-0.5" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">
                    {t('coupons.guidelines', locale === 'zh' ? '优惠券使用说明' : 'Coupon Guidelines')}
                  </h3>
                  <div className="mt-2 text-sm text-blue-700">
                    <ul className="list-disc list-inside space-y-1">
                      <li>{t('coupons.guidelines.1', locale === 'zh' ? '优惠券代码不区分大小写，系统会以大写保存' : 'Coupon codes are case-insensitive and will be stored in uppercase')}</li>
                      <li>{t('coupons.guidelines.2', locale === 'zh' ? '百分比折扣建议在 0-100 之间' : 'Percentage discounts should be between 0-100')}</li>
                      <li>{t('coupons.guidelines.3', locale === 'zh' ? '固定金额立减不能超过订单总额' : 'Fixed amount discounts cannot exceed the order total')}</li>
                      <li>{t('coupons.guidelines.4', locale === 'zh' ? '设置使用限制可防止优惠码被滥用' : 'Usage limits help prevent abuse of discount codes')}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="flex items-center justify-end space-x-4 pt-6">
              <Link
                href="/admin/coupons"
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
                    {t('common.creating', locale === 'zh' ? '创建中...' : 'Creating...')}
                  </div>
                ) : (
                  t('coupons.create', locale === 'zh' ? '创建优惠券' : 'Create Coupon')
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AdminLayout>
  );
}
