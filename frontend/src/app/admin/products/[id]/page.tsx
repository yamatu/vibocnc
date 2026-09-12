'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  EyeSlashIcon,
  StarIcon,
  PhotoIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import AdminLayout from '@/components/admin/AdminLayout';
import { ProductService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { formatCurrency, toProductPathId } from '@/lib/utils';
import { useAdminI18n } from '@/lib/admin-i18n';

export default function ProductDetailPage() {
  const { locale, t } = useAdminI18n();
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const productId = Number(params.id);

  // Fetch product details
  const { data: product, isLoading, error } = useQuery({
    queryKey: queryKeys.products.detail(productId),
    queryFn: () => ProductService.getAdminProduct(productId),
    enabled: !!productId,
  });

  // Toggle product status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: () => ProductService.toggleProductStatus(productId),
    onSuccess: () => {
      toast.success(t('products.detail.toast.statusUpdated', locale === 'zh' ? '产品状态已更新！' : 'Product status updated successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.products.detail(productId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
    onError: (error: any) => {
      toast.error(error.message || t('products.detail.toast.statusUpdateFailed', locale === 'zh' ? '更新产品状态失败' : 'Failed to update product status'));
    },
  });

  // Toggle featured status mutation
  const toggleFeaturedMutation = useMutation({
    mutationFn: () => ProductService.toggleFeaturedStatus(productId),
    onSuccess: () => {
      toast.success(t('products.detail.toast.featuredUpdated', locale === 'zh' ? '推荐状态已更新！' : 'Featured status updated successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.products.detail(productId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
    onError: (error: any) => {
      toast.error(error.message || t('products.detail.toast.featuredUpdateFailed', locale === 'zh' ? '更新推荐状态失败' : 'Failed to update featured status'));
    },
  });

  // Delete product mutation
  const deleteProductMutation = useMutation({
    mutationFn: () => ProductService.deleteProduct(productId),
    onSuccess: () => {
      toast.success(t('products.detail.toast.deleted', locale === 'zh' ? '产品已删除！' : 'Product deleted successfully!'));
      router.push('/admin/products');
    },
    onError: (error: any) => {
      toast.error(error.message || t('products.detail.toast.deleteFailed', locale === 'zh' ? '删除产品失败' : 'Failed to delete product'));
    },
  });

  const handleDelete = () => {
    if (window.confirm(t('products.detail.confirmDelete', locale === 'zh' ? '确定要删除这个产品吗？此操作不可撤销。' : 'Are you sure you want to delete this product? This action cannot be undone.'))) {
      deleteProductMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </AdminLayout>
    );
  }

  if (error || !product) {
    return (
      <AdminLayout>
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900">{t('products.notFound', locale === 'zh' ? '未找到产品' : 'Product not found')}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('products.detail.notFound.desc', locale === 'zh' ? '你要查看的产品不存在或已被删除。' : "The product you're looking for doesn't exist or has been deleted.")}
          </p>
          <div className="mt-6">
            <button
              onClick={() => router.push('/admin/products')}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              {t('products.backToList', locale === 'zh' ? '返回产品列表' : 'Back to Products')}
            </button>
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
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              {t('common.back', locale === 'zh' ? '返回' : 'Back')}
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
              <p className="mt-1 text-sm text-gray-500">SKU: {product.sku}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => toggleStatusMutation.mutate()}
              disabled={toggleStatusMutation.isPending}
              className={`inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium ${
                product.is_active
                  ? 'text-red-700 bg-red-100 hover:bg-red-200'
                  : 'text-green-700 bg-green-100 hover:bg-green-200'
              }`}
            >
              {product.is_active ? (
                <>
                  <EyeSlashIcon className="h-4 w-4 mr-2" />
                  {t('products.detail.deactivate', locale === 'zh' ? '停用' : 'Deactivate')}
                </>
              ) : (
                <>
                  <EyeIcon className="h-4 w-4 mr-2" />
                  {t('products.detail.activate', locale === 'zh' ? '启用' : 'Activate')}
                </>
              )}
            </button>

            <button
              onClick={() => toggleFeaturedMutation.mutate()}
              disabled={toggleFeaturedMutation.isPending}
              className={`inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium ${
                product.is_featured
                  ? 'text-yellow-700 bg-yellow-100 hover:bg-yellow-200'
                  : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
              }`}
            >
              {product.is_featured ? (
                <>
                  <StarIconSolid className="h-4 w-4 mr-2" />
                  {t('products.detail.unfeature', locale === 'zh' ? '取消推荐' : 'Unfeature')}
                </>
              ) : (
                <>
                  <StarIcon className="h-4 w-4 mr-2" />
                  {t('products.detail.feature', locale === 'zh' ? '设为推荐' : 'Feature')}
                </>
              )}
            </button>

            <button
              onClick={() => router.push(`/admin/products/${productId}/edit`)}
              className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <PencilIcon className="h-4 w-4 mr-2" />
              {t('common.edit', locale === 'zh' ? '编辑' : 'Edit')}
            </button>

            <button
              onClick={handleDelete}
              disabled={deleteProductMutation.isPending}
              className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700"
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              {t('common.delete', locale === 'zh' ? '删除' : 'Delete')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Product Images */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('products.images.title', locale === 'zh' ? '产品图片' : 'Product Images')}</h3>
              
              {product.images && product.images.length > 0 ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {product.images.map((image, index) => (
                    <div key={image.id} className="relative">
                      <Image
                        src={image.url || '/images/placeholder.svg'}
                        alt={`${product.name} - Image ${index + 1}`}
                        width={200}
                        height={200}
                        className="w-full h-32 object-cover rounded-lg"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <PhotoIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">{t('products.detail.noImages', locale === 'zh' ? '暂无图片' : 'No images')}</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {t('products.detail.noImages.desc', locale === 'zh' ? '该产品还没有图片。' : "This product doesn't have any images yet.")}
                  </p>
                </div>
              )}
            </div>

            {/* Product Details */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('products.detail.details', locale === 'zh' ? '产品详情' : 'Product Details')}</h3>
              
              <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('products.field.name', locale === 'zh' ? '产品名称' : 'Name')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">{product.name}</dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('products.field.sku', locale === 'zh' ? 'SKU' : 'SKU')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">{product.sku}</dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('products.field.price', locale === 'zh' ? '价格' : 'Price')}</dt>
                  <dd className="mt-1 text-sm text-gray-900 font-semibold">
                    {formatCurrency(product.price)}
                  </dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('products.field.category', locale === 'zh' ? '分类' : 'Category')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">{product.category?.name}</dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('products.field.stock', locale === 'zh' ? '库存数量' : 'Stock Quantity')}</dt>
                  <dd className={`mt-1 text-sm font-medium ${
                    product.stock_quantity > 10 ? 'text-green-600' :
                    product.stock_quantity > 0 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {product.stock_quantity} {t('products.detail.units', locale === 'zh' ? '件' : 'units')}
                  </dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('common.createdAt', locale === 'zh' ? '创建时间' : 'Created')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {new Date(product.created_at).toLocaleDateString()}
                  </dd>
                </div>

                {product.description && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500">{t('products.field.description', locale === 'zh' ? '描述' : 'Description')}</dt>
                    <dd className="mt-1 text-sm text-gray-900">{product.description}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Specifications */}
            {product.specifications && Object.keys(product.specifications).length > 0 && (
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">{t('products.detail.specs', locale === 'zh' ? '规格参数' : 'Specifications')}</h3>
                
                <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                  {Object.entries(product.specifications).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-sm font-medium text-gray-500 capitalize">
                        {key.replace(/_/g, ' ')}
                      </dt>
                      <dd className="mt-1 text-sm text-gray-900">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('products.status.title', locale === 'zh' ? '状态' : 'Status')}</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">{t('products.status.active', locale === 'zh' ? '启用' : 'Active')}</span>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    product.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {product.is_active ? t('common.active', locale === 'zh' ? '启用' : 'Active') : t('common.inactive', locale === 'zh' ? '停用' : 'Inactive')}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">{t('products.status.featured', locale === 'zh' ? '推荐' : 'Featured')}</span>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    product.is_featured 
                      ? 'bg-yellow-100 text-yellow-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {product.is_featured ? t('products.detail.featuredYes', locale === 'zh' ? '已推荐' : 'Featured') : t('products.detail.featuredNo', locale === 'zh' ? '未推荐' : 'Not Featured')}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('common.actions', locale === 'zh' ? '快捷操作' : 'Quick Actions')}</h3>
              
              <div className="space-y-3">
                <button
                  onClick={() => router.push(`/admin/products/${productId}/edit`)}
                  className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                >
                  <PencilIcon className="h-4 w-4 mr-2" />
                  {t('products.edit.title', locale === 'zh' ? '编辑产品' : 'Edit Product')}
                </button>

                <button
                  onClick={() => window.open(`/products/${toProductPathId(product?.sku || String(productId))}`, '_blank')}
                  className="w-full inline-flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <EyeIcon className="h-4 w-4 mr-2" />
                  {t('products.detail.viewOnSite', locale === 'zh' ? '在网站中查看' : 'View on Site')}
                </button>

                <button
                  onClick={handleDelete}
                  disabled={deleteProductMutation.isPending}
                  className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  <TrashIcon className="h-4 w-4 mr-2" />
                  {deleteProductMutation.isPending
						? t('common.deleting', locale === 'zh' ? '删除中...' : 'Deleting...')
						: t('products.detail.deleteProduct', locale === 'zh' ? '删除产品' : 'Delete Product')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
