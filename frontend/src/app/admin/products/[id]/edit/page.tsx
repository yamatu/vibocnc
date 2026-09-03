'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import ProductImageManager, { type ManagedProductImage } from '@/components/admin/ProductImageManager';
import SeoPreview from '@/components/admin/SeoPreview';
import CategoryCombobox from '@/components/admin/CategoryCombobox';
import ShippingQuoteCalculator from '@/components/admin/ShippingQuoteCalculator';
import TranslationEditor from '@/components/admin/TranslationEditor';
import { ProductService, CategoryService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { ProductCreateRequest } from '@/types';
import { useAdminI18n } from '@/lib/admin-i18n';

interface ProductFormData extends Omit<ProductCreateRequest, 'images'> {
  images: FileList | null;
}

function normalizeWhitespace(value?: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function trimMetaTitle(value: string, maxLength = 69): string {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const idx = cut.lastIndexOf(' ');
  return normalizeWhitespace(idx >= 24 ? cut.slice(0, idx) : cut);
}

function trimMetaDescription(value: string, maxLength = 160): string {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const idx = cut.lastIndexOf(' ');
  const trimmed = normalizeWhitespace(idx >= 60 ? cut.slice(0, idx) : cut);
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function normalizeModel(value?: string): string {
  let text = normalizeWhitespace(value);
  if (!text) return '';
  text = text.replace(/[\\/]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toUpperCase();
  if (text.startsWith('FANUC-')) text = text.slice(6);
  if (text.startsWith('FANUC ')) text = text.slice(6).trim();
  return text;
}

function toBooleanFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function buildDefaultSeoValues(input: {
  name?: string;
  sku?: string;
  brand?: string;
  partNumber?: string;
  categoryName?: string;
}) {
  const brand = normalizeWhitespace(input.brand);
  const sku = normalizeModel(input.sku);
  const partNumber = normalizeModel(input.partNumber);
  const model = sku || partNumber || normalizeWhitespace(input.name);
  const categoryName = normalizeWhitespace(input.categoryName) || 'Industrial Automation Part';
  const titleBase = [brand, model, categoryName].filter(Boolean).join(' ') || normalizeWhitespace(input.name) || 'Product';
  const metaTitle = trimMetaTitle(`${titleBase} | Vibocnc`);
  const subject = [brand, model].filter(Boolean).join(' ') || model || normalizeWhitespace(input.name) || 'This product';
  const metaDescription = trimMetaDescription(
    `${subject} ${categoryName} for industrial automation repair and replacement. Compatibility support, 12-month warranty, and fast worldwide shipping from Vibocnc.`
  );
  const metaKeywords = [
    normalizeWhitespace(input.sku),
    partNumber,
    normalizeWhitespace(input.name),
    [brand, categoryName].filter(Boolean).join(' '),
    brand ? `${brand} parts` : 'industrial automation parts',
    'CNC replacement parts',
    'Vibocnc',
  ]
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(', ');

  return { metaTitle, metaDescription, metaKeywords };
}

export default function EditProductPage() {
  const { locale, t } = useAdminI18n();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const productId = Number(params.id);
  const returnTo = searchParams?.get('returnTo') || '';

  const [images, setImages] = useState<ManagedProductImage[]>([]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormData>();

	const watchedWeight = Number(watch('weight') || 0);
	const watchedPrice = Number(watch('price') || 0);

  // Fetch product details
  const { data: product, isLoading } = useQuery({
    queryKey: queryKeys.products.detail(productId),
    queryFn: () => ProductService.getAdminProduct(productId),
    enabled: !!productId,
  });

  // Fetch categories for dropdown
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.lists(),
    queryFn: () => CategoryService.getAdminCategories(),
  });

  // Update product mutation
  const updateProductMutation = useMutation({
    mutationFn: (data: Partial<ProductCreateRequest>) =>
      ProductService.updateProduct(productId, data),
    onSuccess: () => {
      toast.success(t('products.toast.updated', 'Product updated successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.products.detail(productId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
      // If we have a returnTo param, go back to list position
      if (returnTo) {
        router.push(returnTo);
      }
    },
    onError: (error: any) => {
      toast.error(error.message || t('products.toast.updateFailed', 'Failed to update product'));
    },
  });

  // Populate form when product data is loaded
  useEffect(() => {
    if (product) {
      setValue('name', product.name);
      setValue('sku', product.sku);
      setValue('description', product.description || '');
      setValue('meta_title', (product as any).meta_title || '');
      setValue('meta_description', (product as any).meta_description || '');
      setValue('meta_keywords', (product as any).meta_keywords || '');
      setValue('disable_auto_seo', toBooleanFlag((product as any).disable_auto_seo));
      setValue('price', product.price);
      setValue('category_id', product.category_id);
      setValue('is_active', product.is_active);
      setValue('is_featured', product.is_featured);
      setValue('stock_quantity', product.stock_quantity);
      setValue('weight', (product as any).weight ?? undefined);
      setValue('brand' as any, (product as any).brand || '');
      setValue('model', product.model || product.sku);
      setValue('part_number' as any, (product as any).part_number || product.sku);
      setValue('warranty_period' as any, (product as any).warranty_period || '12 months');
      setValue('lead_time' as any, (product as any).lead_time || '3-7 days');
	  setValue('translations', (product.translations || []).map((translation) => ({
		language_code: translation.language_code,
		name: translation.name,
		short_description: translation.short_description || '',
		description: translation.description || '',
		meta_title: translation.meta_title || '',
		meta_description: translation.meta_description || '',
		meta_keywords: translation.meta_keywords || '',
	  })));

      // Convert image_urls to the expected format for editing
      try {
        let urls: string[] = [];
        if (product.image_urls && Array.isArray(product.image_urls)) {
          urls = product.image_urls as any;
        } else if (product.image_urls && typeof (product as any).image_urls === 'string') {
          // Some admin endpoints may return JSON string; parse it
          const parsed = JSON.parse((product as any).image_urls || '[]');
          if (Array.isArray(parsed)) urls = parsed;
        }

        if (Array.isArray(urls) && urls.length > 0) {
          const imageObjects = urls.map((url, index) => ({
            url,
            alt_text: '',
            is_primary: index === 0, // First image is primary
            sort_order: index,
          }));
          setImages(imageObjects);
        } else if ((product as any).images) {
          // Fallback: old API shape
          setImages((product as any).images || []);
        } else {
          setImages([]);
        }
      } catch (e) {
        console.warn('Failed to parse product.image_urls', e);
        setImages([]);
      }
    }
  }, [product, setValue]);

  // Fallback: if no images parsed but backend has them, fetch via images endpoint
  useEffect(() => {
    const fetchImagesIfMissing = async () => {
      if (!productId || !product) return;
      if (images.length > 0) return;
      try {
        // Try backend images list (reads JSON image_urls and maps to array)
        const list = await ProductService.getProductImages(productId);
        if (Array.isArray(list) && list.length > 0) {
          const normalized = list.map((img: any, i: number) => ({
            url: img.url,
            alt_text: img.alt_text || '',
            is_primary: !!img.is_primary || i === 0,
            sort_order: typeof img.sort_order === 'number' ? img.sort_order : i,
          }));
          setImages(normalized);
        }
      } catch (err) {
        // Silently ignore; UI still allows adding images
        console.warn('Fallback getProductImages failed', err);
      }
    };
    fetchImagesIfMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, product]);
  const onSubmit = async (data: ProductFormData) => {
    try {
      // Validate category matches one from server
      const catId = Number(data.category_id);
      const hasValidCategory = Array.isArray(categories) && categories.some((c: any) => Number(c.id) === catId);
      if (!catId || !hasValidCategory) {
        toast.error(t('products.toast.categoryInvalid', locale === 'zh' ? '请选择有效的分类' : 'Please select a valid category'));
        return;
      }
		if (!product) {
			toast.error(t('products.notLoaded', locale === 'zh' ? '产品未加载完成' : 'Product not loaded'));
			return;
		}
      // Convert images to the format expected by the API
      const imageReqs = images.map((img, index) => ({
        url: img.url,
        alt_text: img.alt_text || '',
        is_primary: img.is_primary || index === 0,
        sort_order: img.sort_order || index,
        source: img.source
      }));

      const weightNum = data.weight ? Number(data.weight) : undefined;
		const existing = product as any;

		const attrs = Array.isArray(existing.attributes)
			? existing.attributes.map((a: any, i: number) => ({
				attribute_name: a.attribute_name,
				attribute_value: a.attribute_value,
				sort_order: typeof a.sort_order === 'number' ? a.sort_order : i,
			}))
			: [];

		const trans = Array.isArray(data.translations) ? data.translations : [];

		// Backend PUT expects a full ProductCreateRequest.
		const productData: ProductCreateRequest = {
			name: data.name,
			sku: data.sku,
			short_description: existing.short_description || '',
			description: data.description || '',
			price: Number(data.price),
			compare_price: existing.compare_price ?? undefined,
			stock_quantity: Number(data.stock_quantity),
			weight: weightNum,
			dimensions: existing.dimensions || '',
			brand: ((data as any).brand || '').trim(),
			model: (data.model || data.sku).trim(),
			part_number: ((data as any).part_number || data.sku).trim(),
			warranty_period: ((data as any).warranty_period || '12 months').trim(),
			lead_time: ((data as any).lead_time || '3-7 days').trim(),
			category_id: catId,
			is_active: data.is_active,
			is_featured: data.is_featured,
			meta_title: data.meta_title || '',
			meta_description: data.meta_description || '',
			meta_keywords: data.meta_keywords || '',
			disable_auto_seo: toBooleanFlag((data as any).disable_auto_seo),
			images: imageReqs,
			attributes: attrs,
			translations: trans,
		};

      await updateProductMutation.mutateAsync(productData);
    } catch (error) {
      console.error('Error updating product:', error);
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

  if (!product) {
    return (
      <AdminLayout>
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900">{t('products.notFound', locale === 'zh' ? '未找到产品' : 'Product not found')}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('products.notFound.desc', locale === 'zh' ? '你要编辑的产品不存在。' : "The product you're trying to edit doesn't exist.")}
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

  const handleResetSeoToDefault = () => {
    const categoryName =
      categories.find((item: any) => Number(item.id) === Number(watch('category_id')))?.name ||
      product.category?.name ||
      '';
    const defaults = buildDefaultSeoValues({
      name: watch('name') || product.name,
      sku: watch('sku') || product.sku,
      brand: (watch('brand' as any) as string) || (product as any).brand,
      partNumber: (watch('part_number' as any) as string) || (product as any).part_number,
      categoryName,
    });

    setValue('meta_title', defaults.metaTitle, { shouldDirty: true });
    setValue('meta_description', defaults.metaDescription, { shouldDirty: true });
    setValue('meta_keywords', defaults.metaKeywords, { shouldDirty: true });
    setValue('disable_auto_seo', true, { shouldDirty: true });
    toast.success(locale === 'zh' ? '已恢复默认 SEO，并关闭自动品牌 SEO 覆盖' : 'Default SEO restored and automatic brand SEO disabled');
  };

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
              <h1 className="text-2xl font-bold text-gray-900">{t('products.edit.title', locale === 'zh' ? '编辑产品' : 'Edit Product')}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {t('products.edit.subtitle', locale === 'zh' ? `更新产品信息：${product.name}` : `Update product information for ${product.name}`)}
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Basic Information */}
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">{t('products.basic.title', locale === 'zh' ? '基础信息' : 'Basic Information')}</h3>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('products.field.name', locale === 'zh' ? '产品名称 *' : 'Product Name *')}
                    </label>
                    <input
                      {...register('name', { required: t('products.validation.nameRequired', locale === 'zh' ? '请输入产品名称' : 'Product name is required') })}
                      type="text"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('products.placeholder.name', locale === 'zh' ? '例如：Siemens 6SN1123-1AA00-0CA1' : 'e.g., Siemens 6SN1123-1AA00-0CA1')}
                    />
                    {errors.name && (
                      <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="sku" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('products.field.sku', locale === 'zh' ? 'SKU *' : 'SKU *')}
                    </label>
                    <input
                      {...register('sku', { required: t('products.validation.skuRequired', locale === 'zh' ? '请输入 SKU' : 'SKU is required') })}
                      type="text"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('products.placeholder.sku', locale === 'zh' ? '例如：A02B-0120-C041' : 'e.g., A02B-0120-C041')}
                    />
                    {errors.sku && (
                      <p className="mt-1 text-sm text-red-600">{errors.sku.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('products.field.price', locale === 'zh' ? '价格 *' : 'Price *')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="text-gray-500 sm:text-sm">$</span>
                      </div>
                        <input
                          {...register('price', {
                            required: t('products.validation.priceRequired', locale === 'zh' ? '请输入价格' : 'Price is required'),
                            min: { value: 0, message: t('products.validation.pricePositive', locale === 'zh' ? '价格必须大于等于 0' : 'Price must be positive') }
                          })}
                        type="number"
                        step="0.01"
                        className="block w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                    {errors.price && (
                      <p className="mt-1 text-sm text-red-600">{errors.price.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="category_id" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('products.field.category', locale === 'zh' ? '分类 *' : 'Category *')}
                    </label>

					{/* Hidden field for react-hook-form validation/submission */}
					<input
						type="hidden"
						{...register('category_id', { required: t('products.validation.categoryRequired', locale === 'zh' ? '请选择分类' : 'Category is required') })}
					/>
					<CategoryCombobox
						categories={Array.isArray(categories) ? categories : []}
						value={watch('category_id') as any}
						onChange={(categoryId) =>
							setValue('category_id', categoryId as any, { shouldDirty: true, shouldValidate: true })
						}
						placeholder={t('products.placeholder.category', locale === 'zh' ? '输入搜索分类（名称 / 路径 / slug）' : 'Type to search categories (name / path / slug)')}
					/>
                    {errors.category_id && (
                      <p className="mt-1 text-sm text-red-600">{errors.category_id.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="stock_quantity" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('products.field.stock', locale === 'zh' ? '库存数量' : 'Stock Quantity')}
                    </label>
                    <input
                      {...register('stock_quantity', {
                        min: { value: 0, message: t('products.validation.stockPositive', locale === 'zh' ? '库存必须大于等于 0' : 'Stock quantity must be positive') }
                      })}
                      type="number"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="0"
                    />
                    {errors.stock_quantity && (
                      <p className="mt-1 text-sm text-red-600">{errors.stock_quantity.message}</p>
                    )}
                  </div>

				  <div>
					<label htmlFor="weight" className="block text-sm font-medium text-gray-700 mb-1">
						{t('products.field.weight', locale === 'zh' ? '重量(kg)' : 'Weight (kg)')}
					</label>
					<input
						{...register('weight', { min: { value: 0, message: t('products.validation.weightPositive', locale === 'zh' ? '重量必须大于等于 0' : 'Weight must be positive') } })}
						type="number"
						step="0.001"
						className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
						placeholder={t('products.placeholder.weight', locale === 'zh' ? '例如：1.25' : 'e.g., 1.25')}
					/>
					{errors.weight && (
						<p className="mt-1 text-sm text-red-600">{String(errors.weight.message)}</p>
					)}
				  </div>

				  <div>
					<label htmlFor="brand" className="block text-sm font-medium text-gray-700 mb-1">
						{locale === 'zh' ? '品牌' : 'Brand'}
					</label>
					<input
						{...register('brand' as any)}
						type="text"
						className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
						placeholder={locale === 'zh' ? '例如：FANUC、Allen-Bradley、Siemens' : 'e.g., FANUC, Allen-Bradley, Siemens'}
					/>
				  </div>

				  <div>
					<label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-1">
						{locale === 'zh' ? '型号' : 'Model'}
					</label>
					<input
						{...register('model')}
						type="text"
						className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
						placeholder={locale === 'zh' ? '例如：A06B-0215-B805' : 'e.g., A06B-0215-B805'}
					/>
				  </div>

				  <div>
					<label htmlFor="part_number" className="block text-sm font-medium text-gray-700 mb-1">
						{locale === 'zh' ? '零件号' : 'Part Number'}
					</label>
					<input
						{...register('part_number' as any)}
						type="text"
						className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
						placeholder={locale === 'zh' ? '例如：A02B-0120-C041' : 'e.g., A02B-0120-C041'}
					/>
				  </div>

				  <div>
					<label htmlFor="warranty_period" className="block text-sm font-medium text-gray-700 mb-1">
						{locale === 'zh' ? '质保期' : 'Warranty Period'}
					</label>
					<input
						{...register('warranty_period' as any)}
						type="text"
						className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
						placeholder={locale === 'zh' ? '例如：12 months' : 'e.g., 12 months'}
					/>
				  </div>

				  <div>
					<label htmlFor="lead_time" className="block text-sm font-medium text-gray-700 mb-1">
						{locale === 'zh' ? '交货期' : 'Lead Time'}
					</label>
					<input
						{...register('lead_time' as any)}
						type="text"
						className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
						placeholder={locale === 'zh' ? '例如：3-7 days' : 'e.g., 3-7 days'}
					/>
				  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('products.field.description', locale === 'zh' ? '描述' : 'Description')}
                    </label>
                    <textarea
                      {...register('description')}
                      rows={4}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('products.placeholder.description', locale === 'zh' ? '产品描述...' : 'Product description...')}
                    />
                  </div>
            </div>
          </div>

		  <ShippingQuoteCalculator
			weightKg={watchedWeight}
			price={watchedPrice}
			onSetPrice={(nextPrice) => setValue('price', nextPrice as any, { shouldDirty: true, shouldValidate: true })}
		  />

          {/* SEO Basic Information */}
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex flex-col gap-3 mb-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900">{t('products.seo.title', locale === 'zh' ? 'SEO 基础信息' : 'SEO Basic Information')}</h3>
              </div>
              <button
                type="button"
                onClick={handleResetSeoToDefault}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {locale === 'zh' ? '恢复默认 SEO 并关闭自动优化' : 'Restore default SEO and disable auto SEO'}
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{t('products.seo.subtitle', locale === 'zh' ? '这些字段用于控制产品在搜索引擎与社交预览中的展示。' : 'These fields control how your product appears in search engines and social previews.')}</p>
            <input type="hidden" {...register('disable_auto_seo')} />
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {watch('disable_auto_seo')
                ? (locale === 'zh' ? '当前产品已关闭自动品牌 SEO 覆盖，保存后将保留你现在的标题/描述。' : 'Automatic brand SEO override is disabled for this product. Saving will keep your current title and description.')
                : (locale === 'zh' ? '当前产品仍允许自动 SEO 优化覆盖。点击右侧按钮可恢复默认标题并关闭自动覆盖。' : 'Automatic SEO override is still enabled for this product. Use the button to restore default SEO and stop future overrides.')}
            </div>
            <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={toBooleanFlag(watch('disable_auto_seo'))}
                onChange={(e) => setValue('disable_auto_seo', e.target.checked, { shouldDirty: true })}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{locale === 'zh' ? '关闭该产品的自动 SEO 覆盖' : 'Disable automatic SEO override for this product'}</span>
            </label>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label htmlFor="meta_title" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('products.seo.metaTitle', locale === 'zh' ? 'SEO 标题' : 'SEO Title')}
                </label>
                <input
                  {...register('meta_title')}
                  type="text"
                  maxLength={70}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('products.seo.metaTitlePh', locale === 'zh' ? '例如：Siemens 6SN1123-1AA00-0CA1 驱动模块 | 现货' : 'e.g., Siemens 6SN1123-1AA00-0CA1 Drive Module | In Stock')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('products.seo.metaTitleHint', locale === 'zh' ? '建议 50–60 字符，包含 SKU 和分类。' : 'Recommended 50–60 characters. Include SKU and category.')}</p>
              </div>

              <div>
                <label htmlFor="meta_description" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('products.seo.metaDesc', locale === 'zh' ? 'SEO 描述' : 'SEO Description')}
                </label>
                <textarea
                  {...register('meta_description')}
                  rows={3}
                  maxLength={180}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('products.seo.metaDescPh', locale === 'zh' ? '例如：Siemens 6SN1123-1AA00-0CA1 驱动模块，现货，1 年质保，全球快速发货。' : 'e.g., Siemens 6SN1123-1AA00-0CA1 drive module, in stock, 1-year warranty, fast global shipping.')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('products.seo.metaDescHint', locale === 'zh' ? '建议 150–160 字符，包含价格、库存、质保、运费等信息。' : 'Recommended 150–160 characters. Mention price, availability, warranty, shipping.')}</p>
              </div>

              <div>
                <label htmlFor="meta_keywords" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('products.seo.metaKeywords', locale === 'zh' ? 'SEO 关键词（可选）' : 'SEO Keywords (optional)')}
                </label>
                <input
                  {...register('meta_keywords')}
                  type="text"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder={t('products.seo.metaKeywordsPh', locale === 'zh' ? '例如：A16B-2202-0420, A16B22020420, 电源, 24V' : 'e.g., A16B-2202-0420, A16B22020420, power supply, 24V')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('products.seo.metaKeywordsHint', locale === 'zh' ? '用逗号分隔，建议包含不同格式的 SKU。' : 'Comma-separated keywords. Include alternate SKU format.')}</p>
              </div>
            </div>

            {/* Live SERP Preview */}
            <SeoPreview
              title={watch('meta_title')}
              description={watch('meta_description')}
              sku={watch('sku')}
              name={watch('name')}
            />
          </div>

          <ProductImageManager images={images} onChange={setImages} sku={watch('sku')} />

          <TranslationEditor
            kind="product"
            locale={locale}
            value={watch('translations') || []}
            onChange={(translations) => setValue('translations', translations, { shouldDirty: true })}
          />
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Status */}
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">{t('products.status.title', locale === 'zh' ? '状态' : 'Status')}</h3>

                <div className="space-y-4">
                  <div className="flex items-center">
                    <input
                      {...register('is_active')}
                      id="is_active"
                      type="checkbox"
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                      {t('products.status.active', locale === 'zh' ? '启用' : 'Active')}
                    </label>
                  </div>

                  <div className="flex items-center">
                    <input
                      {...register('is_featured')}
                      id="is_featured"
                      type="checkbox"
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="is_featured" className="ml-2 block text-sm text-gray-900">
                      {t('products.status.featured', locale === 'zh' ? '推荐产品' : 'Featured Product')}
                    </label>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="bg-white shadow rounded-lg p-6">
                <div className="space-y-4">
                  <button
                    type="submit"
                    disabled={isSubmitting || updateProductMutation.isPending}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting || updateProductMutation.isPending ? (
                      <div className="flex items-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
						{t('common.updating', locale === 'zh' ? '更新中...' : 'Updating...')}
                      </div>
                    ) : (
                      <>
                        <PencilIcon className="h-4 w-4 mr-2" />
						{t('products.edit.update', locale === 'zh' ? '更新产品' : 'Update Product')}
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    {t('common.cancel', locale === 'zh' ? '取消' : 'Cancel')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>

    </AdminLayout>
  );
}
