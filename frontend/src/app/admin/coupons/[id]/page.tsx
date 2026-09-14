'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import AdminLayout from '@/components/admin/AdminLayout';
import { CouponService, Coupon } from '@/services/coupon.service';
import { useAdminI18n } from '@/lib/admin-i18n';
import {
  TagIcon,
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  ChartBarIcon,
  CalendarIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';
import Link from 'next/link';

export default function CouponDetailPage() {
  const { locale, t } = useAdminI18n();
  const params = useParams();
  const couponId = parseInt(params.id as string);

  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const fetchCouponDetails = async () => {
    try {
      const [couponData, usageData] = await Promise.all([
        CouponService.getCoupon(couponId),
        CouponService.getCouponUsage(couponId)
      ]);

      setCoupon(couponData);
      setUsage(usageData);
    } catch (error: any) {
      toast.error(error.message || t('coupons.toast.detailLoadFailed', locale === 'zh' ? '加载优惠券详情失败' : 'Failed to fetch coupon details'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (couponId) {
      fetchCouponDetails();
    }
  }, [couponId]);

  const handleDelete = async () => {
    if (!confirm(t('coupons.confirm.delete', locale === 'zh' ? '确定要删除这个优惠券吗？' : 'Are you sure you want to delete this coupon?'))) return;

    setDeleting(true);
    try {
      await CouponService.deleteCoupon(couponId);
      toast.success(t('coupons.toast.deleted', locale === 'zh' ? '优惠券已删除' : 'Coupon deleted successfully'));
      // Redirect to coupons list
      window.location.href = '/admin/coupons';
    } catch (error: any) {
      toast.error(error.message || t('coupons.toast.deleteFailed', locale === 'zh' ? '删除优惠券失败' : 'Failed to delete coupon'));
    } finally {
      setDeleting(false);
    }
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
            {t('coupons.notFound.desc', locale === 'zh' ? '你要查看的优惠券不存在或已被删除。' : "The coupon you're looking for doesn't exist or has been deleted.")}
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

  const getStatusBadge = () => {
    const status = CouponService.getCouponStatus(coupon);
    const colors = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      expired: 'bg-red-100 text-red-800',
      scheduled: 'bg-blue-100 text-blue-800',
      exhausted: 'bg-orange-100 text-orange-800'
    };

    const label =
      status.status === 'active'
        ? t('coupons.status.active', locale === 'zh' ? '可用' : 'Active')
        : status.status === 'inactive'
          ? t('coupons.status.inactive', locale === 'zh' ? '停用' : 'Inactive')
          : status.status === 'expired'
            ? t('coupons.status.expired', locale === 'zh' ? '已过期' : 'Expired')
            : status.status === 'scheduled'
              ? t('coupons.status.scheduled', locale === 'zh' ? '未开始' : 'Scheduled')
              : status.status === 'exhausted'
                ? t('coupons.status.exhausted', locale === 'zh' ? '已用尽' : 'Usage Limit Reached')
                : status.label;

    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[status.status as keyof typeof colors] || colors.inactive}`}>
        {label}
      </span>
    );
  };

  const formatDiscount = () => {
    if (!coupon) return '';
    if (coupon.type === 'percentage') {
      const base = t('coupons.discount.percentage', locale === 'zh' ? '{value}% 折扣' : '{value}% off', { value: coupon.value });
      if (coupon.max_discount_amount) {
        return t(
          'coupons.discount.percentageMax',
          locale === 'zh' ? '{base}（最高 ${max}）' : '{base} (max ${max})',
          { base, max: coupon.max_discount_amount }
        );
      }
      return base;
    }
    return t('coupons.discount.fixed', locale === 'zh' ? '立减 ${value}' : '${value} off', { value: coupon.value });
  };

  const getUsageProgress = () => {
    if (!coupon.usage_limit) return null;

    const percentage = (coupon.used_count / coupon.usage_limit) * 100;
    return (
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className="bg-blue-600 h-3 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        ></div>
      </div>
    );
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
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{coupon.code}</h1>
              <p className="text-sm text-gray-500">{coupon.name}</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {getStatusBadge()}
            <Link
              href={`/admin/coupons/${coupon.id}/edit`}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              <PencilIcon className="h-4 w-4 mr-2" />
              {t('common.edit', locale === 'zh' ? '编辑' : 'Edit')}
            </Link>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600 mr-2"></div>
              ) : (
                <TrashIcon className="h-4 w-4 mr-2" />
              )}
              {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Coupon Details */}
            <div className="bg-white shadow-sm rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('coupons.detail.section', locale === 'zh' ? '优惠券详情' : 'Coupon Details')}</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.field.code', locale === 'zh' ? '代码' : 'Code')}</dt>
                  <dd className="mt-1 text-sm text-gray-900 font-mono bg-gray-100 px-2 py-1 rounded">
                    {coupon.code}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.field.name', locale === 'zh' ? '名称' : 'Name')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">{coupon.name}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.field.type', locale === 'zh' ? '类型' : 'Type')}</dt>
                  <dd className="mt-1 text-sm text-gray-900 capitalize">
                    {coupon.type.replace('_', ' ')}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.field.discount', locale === 'zh' ? '优惠' : 'Discount')}</dt>
                  <dd className="mt-1 text-sm text-gray-900 font-semibold">
                    {formatDiscount()}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.field.minOrder', locale === 'zh' ? '最低订单金额' : 'Minimum Order')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">${coupon.min_order_amount}</dd>
                </div>
                {coupon.max_discount_amount && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">{t('coupons.field.maxDiscount', locale === 'zh' ? '最高优惠' : 'Maximum Discount')}</dt>
                    <dd className="mt-1 text-sm text-gray-900">${coupon.max_discount_amount}</dd>
                  </div>
                )}
                {coupon.description && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500">{t('coupons.field.description', locale === 'zh' ? '描述' : 'Description')}</dt>
                    <dd className="mt-1 text-sm text-gray-900">{coupon.description}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Usage Statistics */}
            <div className="bg-white shadow-sm rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <ChartBarIcon className="h-5 w-5 mr-2" />
                {t('coupons.usageStats', locale === 'zh' ? '使用统计' : 'Usage Statistics')}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{coupon.used_count}</div>
                  <div className="text-sm text-gray-500">{t('coupons.timesUsed', locale === 'zh' ? '使用次数' : 'Times Used')}</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    ${usage?.total_discount?.toFixed(2) || '0.00'}
                  </div>
                  <div className="text-sm text-gray-500">{t('coupons.totalSavings', locale === 'zh' ? '累计优惠' : 'Total Savings')}</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-600">
                    {coupon.usage_limit || '∞'}
                  </div>
                  <div className="text-sm text-gray-500">{t('coupons.usageLimit', locale === 'zh' ? '使用上限' : 'Usage Limit')}</div>
                </div>
              </div>

              {coupon.usage_limit && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>{t('coupons.usageProgress', locale === 'zh' ? '使用进度' : 'Usage Progress')}</span>
                    <span>{coupon.used_count} / {coupon.usage_limit}</span>
                  </div>
                  {getUsageProgress()}
                </div>
              )}

              {/* Recent Usage */}
              {usage?.usage_records && usage.usage_records.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-3">{t('coupons.recentUsage', locale === 'zh' ? '最近使用记录' : 'Recent Usage')}</h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {usage.usage_records.slice(0, 10).map((record: any) => (
                      <div key={record.id} className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded-md">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {record.customer_email}
                          </div>
                          <div className="text-xs text-gray-500">
                            {new Date(record.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-sm font-medium text-green-600">
                          -${record.discount_amount.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Date Information */}
            <div className="bg-white shadow-sm rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <CalendarIcon className="h-5 w-5 mr-2" />
                {t('coupons.dateInfo', locale === 'zh' ? '时间信息' : 'Date Information')}
              </h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('common.created', locale === 'zh' ? '创建时间' : 'Created')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {new Date(coupon.created_at).toLocaleDateString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('common.updated', locale === 'zh' ? '更新时间' : 'Last Updated')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {new Date(coupon.updated_at).toLocaleDateString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.field.startsAt', locale === 'zh' ? '开始时间' : 'Start Date')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {coupon.starts_at ? new Date(coupon.starts_at).toLocaleDateString() : t('coupons.startImmediate', locale === 'zh' ? '立即生效' : 'Immediate')}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.field.expiresAt', locale === 'zh' ? '过期时间' : 'Expiry Date')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString() : t('coupons.noExpiry', locale === 'zh' ? '永不过期' : 'No expiry')}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Usage Limits */}
            <div className="bg-white shadow-sm rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <UserGroupIcon className="h-5 w-5 mr-2" />
                {t('coupons.limits', locale === 'zh' ? '使用限制' : 'Usage Limits')}
              </h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.limit.total', locale === 'zh' ? '总使用上限' : 'Total Usage Limit')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {coupon.usage_limit || t('coupons.unlimited', locale === 'zh' ? '不限' : 'Unlimited')}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.limit.perUser', locale === 'zh' ? '单用户上限' : 'Per User Limit')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {coupon.user_usage_limit || t('coupons.unlimited', locale === 'zh' ? '不限' : 'Unlimited')}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('coupons.limit.current', locale === 'zh' ? '当前使用' : 'Current Usage')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {t('coupons.usedCount', locale === 'zh' ? '{count} 次' : '{count} times', { count: coupon.used_count })}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Quick Actions */}
            <div className="bg-white shadow-sm rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('dashboard.quickActions', locale === 'zh' ? '快捷操作' : 'Quick Actions')}</h3>
              <div className="space-y-3">
                <Link
                  href={`/admin/coupons/${coupon.id}/edit`}
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                >
                  <PencilIcon className="h-4 w-4 mr-2" />
                  {t('coupons.edit', locale === 'zh' ? '编辑优惠券' : 'Edit Coupon')}
                </Link>
                <button
                  onClick={() => navigator.clipboard.writeText(coupon.code)}
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                >
                  {t('coupons.copyCode', locale === 'zh' ? '复制代码' : 'Copy Code')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
