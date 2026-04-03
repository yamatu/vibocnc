'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  PhotoIcon,
  XMarkIcon,
  PlusIcon,
  LinkIcon
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import MediaPickerModal from '@/components/admin/MediaPickerModal';
import SeoPreview from '@/components/admin/SeoPreview';
import CategoryCombobox from '@/components/admin/CategoryCombobox';
import ShippingQuoteCalculator from '@/components/admin/ShippingQuoteCalculator';
import { ProductService, CategoryService } from '@/services';
import { ProductCreateRequest } from '@/types';
import { queryKeys } from '@/lib/react-query';
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
  const metaTitle = trimMetaTitle(`${titleBase} | Vcocnc`);
  const subject = [brand, model].filter(Boolean).join(' ') || model || normalizeWhitespace(input.name) || 'This product';
  const metaDescription = trimMetaDescription(
    `${subject} ${categoryName} for industrial automation repair and replacement. Compatibility support, 12-month warranty, and fast worldwide shipping from Vcocnc.`
  );
  const metaKeywords = [
    normalizeWhitespace(input.sku),
    partNumber,
    normalizeWhitespace(input.name),
    [brand, categoryName].filter(Boolean).join(' '),
    brand ? `${brand} parts` : 'industrial automation parts',
    'CNC replacement parts',
    'Vcocnc',
  ]
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(', ');

  return { metaTitle, metaDescription, metaKeywords };
}

export default function NewProductPage() {
  const { locale, t } = useAdminI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [imageUrl, setImageUrl] = useState<string>('');
  const [images, setImages] = useState<Array<{url: string; alt_text?: string; is_primary?: boolean}>>([]);
  const [showImageForm, setShowImageForm] = useState<boolean>(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormData>({
    defaultValues: {
      is_active: true,
      is_featured: false,
      stock_quantity: 0,
      brand: '',
      disable_auto_seo: false,
    }
  });

	const watchedWeight = Number(watch('weight') || 0);
	const watchedPrice = Number(watch('price') || 0);

  // Fetch categories for dropdown
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.lists(),
    queryFn: () => CategoryService.getAdminCategories(),
  });

  // Create product mutation
  const createProductMutation = useMutation({
    mutationFn: (data: ProductCreateRequest) => ProductService.createProduct(data),
    onSuccess: () => {
      toast.success(t('products.toast.created', 'Product created successfully!'));
      // Invalidate and refetch products list
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
      router.push('/admin/products');
    },
    onError: (error: any) => {
      toast.error(error.message || t('products.toast.createFailed', 'Failed to create product'));
    },
  });

  // Image management functions
  const handleAddImage = () => {
    if (!imageUrl.trim()) {
      toast.error(t('products.toast.imageUrlInvalid', 'Please enter a valid image URL'));
      return;
    }

    // Basic URL validation
    try {
      new URL(imageUrl);
    } catch {
      toast.error(t('products.toast.urlInvalid', 'Please enter a valid URL'));
      return;
    }

    const newImage = {
      url: imageUrl.trim(),
      alt_text: '',
      is_primary: false
    };

    setImages([...images, newImage]);
    setImageUrl('');
    setShowImageForm(false);
    toast.success(t('products.toast.imageAdded', 'Image added successfully!'));
  };

  const removeImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    setImages(newImages);
  };

  const onSubmit = async (data: ProductFormData) => {
    try {
      // Validate category selection against fetched categories
      const catId = Number(data.category_id);
      const hasValidCategory = Array.isArray(categories) && categories.some((c: any) => Number(c.id) === catId);
      if (!catId || !hasValidCategory) {
        toast.error(t('products.toast.categoryInvalid', 'Please select a valid category'));
        return;
      }
      // Convert form data to ProductCreateRequest
      const productData: ProductCreateRequest = {
        name: data.name,
        sku: data.sku,
        short_description: data.short_description || '',
        description: data.description || '',
        price: Number(data.price),
        compare_price: data.compare_price ? Number(data.compare_price) : undefined,
        stock_quantity: Number(data.stock_quantity),
        weight: data.weight ? Number(data.weight) : undefined,
        dimensions: data.dimensions || '',
		brand: (data.brand || '').trim(),
		model: (data.model || data.sku).trim(),
		part_number: (data.part_number || data.sku).trim(),
        category_id: catId,
        is_active: data.is_active,
        is_featured: data.is_featured,
        meta_title: data.meta_title || '',
        meta_description: data.meta_description || '',
        meta_keywords: data.meta_keywords || '',
        disable_auto_seo: toBooleanFlag((data as any).disable_auto_seo),
        images: images, // Add images to the request
        attributes: [],
        translations: [],
      };

      await createProductMutation.mutateAsync(productData);
    } catch (error) {
      console.error('Error creating product:', error);
    }
  };

  const handleResetSeoToDefault = () => {
    const categoryName = categories.find((item: any) => Number(item.id) === Number(watch('category_id')))?.name || '';
    const defaults = buildDefaultSeoValues({
      name: watch('name'),
      sku: watch('sku'),
      brand: watch('brand'),
      partNumber: watch('part_number'),
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
              <h1 className="text-2xl font-bold text-gray-900">{t('products.new.title', locale === 'zh' ? '新增产品' : 'Add New Product')}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {t('products.new.subtitle', locale === 'zh' ? '创建新的工业自动化产品条目' : 'Create a new industrial automation product listing')}
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
                      placeholder={t('products.placeholder.name', locale === 'zh' ? '例如：Mitsubishi MR-J2S-200B' : 'e.g., Mitsubishi MR-J2S-200B')}
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
                    <label htmlFor="brand" className="block text-sm font-medium text-gray-700 mb-1">
                      {locale === 'zh' ? '品牌' : 'Brand'}
                    </label>
                    <input
                      {...register('brand')}
                      type="text"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder={locale === 'zh' ? '例如：Mitsubishi、Siemens、ABB' : 'e.g., Mitsubishi, Siemens, ABB'}
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
                      placeholder={locale === 'zh' ? '例如：MR-J2S-200B' : 'e.g., MR-J2S-200B'}
                    />
                  </div>

                  <div>
                    <label htmlFor="part_number" className="block text-sm font-medium text-gray-700 mb-1">
                      {locale === 'zh' ? '零件号' : 'Part Number'}
                    </label>
                    <input
                      {...register('part_number')}
                      type="text"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder={locale === 'zh' ? '例如：MR-J2S-200B' : 'e.g., MR-J2S-200B'}
                    />
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
                <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <h3 className="text-lg font-medium text-gray-900">{t('products.seo.title', locale === 'zh' ? 'SEO 基础信息' : 'SEO Basic Information')}</h3>
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
                    ? (locale === 'zh' ? '新产品已关闭自动品牌 SEO 覆盖，创建后不会再自动写入 FANUC 风格的 SEO/兼容性说明。' : 'Automatic brand SEO override is disabled for this new product. Creation will not inject FANUC-style SEO or compatibility content.')
                    : (locale === 'zh' ? '新产品默认仍允许自动 SEO 覆盖。若这是非 FANUC 产品，建议关闭。' : 'Automatic SEO override is still enabled by default. Disable it for non-FANUC products.')}
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
                      placeholder={t('products.seo.metaTitlePh', locale === 'zh' ? '例如：Mitsubishi MR-J2S-200B 伺服驱动器 | 现货' : 'e.g., Mitsubishi MR-J2S-200B Servo Drive | In Stock')}
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
                      placeholder={t('products.seo.metaDescPh', locale === 'zh' ? '例如：Mitsubishi MR-J2S-200B 伺服驱动器，现货，1 年质保，全球快速发货。' : 'e.g., Mitsubishi MR-J2S-200B servo drive, in stock, 1-year warranty, fast global shipping.')}
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

              {/* Product Images */}
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">{t('products.images.title', locale === 'zh' ? '产品图片' : 'Product Images')}</h3>
                
                <div className="space-y-4">


                  {/* External Images Section */}
                  <div className="border-t pt-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-medium text-gray-700">{t('products.images.urlsTitle', locale === 'zh' ? '图片（链接）' : 'Images (URLs)')}</h4>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowMediaPicker(true)}
                          className="inline-flex items-center px-3 py-1 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          <PhotoIcon className="h-4 w-4 mr-1" />
                          {t('products.images.chooseFromLibrary', locale === 'zh' ? '从图库选择' : 'Choose From Library')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowImageForm(!showImageForm)}
                          className="inline-flex items-center px-3 py-1 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          <LinkIcon className="h-4 w-4 mr-1" />
                          {t('products.images.addUrl', locale === 'zh' ? '添加图片链接' : 'Add Image URL')}
                        </button>
                      </div>
                    </div>

                    {/* Image Form */}
                    {showImageForm && (
                      <div className="mb-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
                        <div className="space-y-3">
                          <div>
                            <label htmlFor="image-url" className="block text-sm font-medium text-gray-700 mb-1">
                              {t('products.images.imageUrl', locale === 'zh' ? '图片链接 *' : 'Image URL *')}
                            </label>
                            <input
                              id="image-url"
                              type="url"
                              value={imageUrl}
                              onChange={(e) => setImageUrl(e.target.value)}
                              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                              placeholder={t('products.images.imageUrlPh', locale === 'zh' ? '例如：https://example.com/image.jpg' : 'https://example.com/image.jpg')}
                            />
                          </div>
                          <div className="flex space-x-2">
                            <button
                              type="button"
                              onClick={handleAddImage}
                              disabled={!imageUrl.trim()}
                              className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <PlusIcon className="h-4 w-4 mr-1" />
                              {t('products.images.addImage', locale === 'zh' ? '添加图片' : 'Add Image')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowImageForm(false);
                                setImageUrl('');
                              }}
                              className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            >
                              {t('common.cancel', locale === 'zh' ? '取消' : 'Cancel')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* External Images Display */}
                    {images.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">{t('products.images.external', locale === 'zh' ? '外链图片' : 'External Images')}</h4>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                          {images.map((image, index) => (
                            <div key={index} className="relative">
                              <div className="relative h-24 w-full">
                                <img
                                  src={image.url}
                                  alt={image.alt_text || t('products.images.externalAlt', locale === 'zh' ? `外链图片 ${index + 1}` : `External image ${index + 1}`)}
                                  className="h-24 w-full object-cover rounded-lg"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = '/images/placeholder-image.png';
                                  }}
                                />
                              </div>
                              <div className="absolute top-1 left-1">
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  <LinkIcon className="h-3 w-3 mr-1" />
                                  {t('products.images.urlTag', locale === 'zh' ? '链接' : 'URL')}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeImage(index)}
                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {images.length === 0 && !showImageForm && (
                      <div className="text-center py-6 text-gray-500 text-sm">
                        {t('products.images.empty', locale === 'zh'
						? '还没有添加外链图片。点击“添加图片链接”从 URL 添加图片。'
						: 'No external images added yet. Click "Add Image URL" to add images from URLs.')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
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
                    disabled={isSubmitting || createProductMutation.isPending}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting || createProductMutation.isPending ? (
                      <div className="flex items-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        {t('common.creating', locale === 'zh' ? '创建中...' : 'Creating...')}
                      </div>
                    ) : (
                      <>
                        <PlusIcon className="h-4 w-4 mr-2" />
						{t('products.new.create', locale === 'zh' ? '创建产品' : 'Create Product')}
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

        <MediaPickerModal
          open={showMediaPicker}
          onClose={() => setShowMediaPicker(false)}
          multiple={true}
		  title={t('products.images.pickerTitle', locale === 'zh' ? '选择产品图片' : 'Select product images')}
          onSelect={(assets) => {
            setImages((prev) => {
              const existing = new Set(prev.map((p) => p.url));
              const next = [...prev];
              for (const a of assets) {
                if (!existing.has(a.url)) {
                  next.push({ url: a.url, alt_text: a.alt_text || '' });
                  existing.add(a.url);
                }
              }
              return next;
            });
            toast.success(t('products.toast.addedFromLibrary', locale === 'zh' ? '已从图库添加' : 'Added from media library'));
          }}
        />
      </div>
    </AdminLayout>
  );
}
