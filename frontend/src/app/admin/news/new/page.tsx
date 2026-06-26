'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  PhotoIcon,
  XMarkIcon,
  EyeIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import MediaPickerModal from '@/components/admin/MediaPickerModal';
import { NewsService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { useAdminI18n } from '@/lib/admin-i18n';
import type { ArticleCreateRequest } from '@/types';

// Simple markdown to HTML converter for preview
function markdownToHtml(md: string): string {
  let html = md;
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>');
  // Bold / Italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full rounded-lg my-4" />');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 underline" target="_blank" rel="noopener">$1</a>');
  // Lists
  html = html.replace(/^\- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-100 p-4 rounded-lg overflow-x-auto my-4"><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">$1</code>');
  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p class="mb-4">');
  html = '<p class="mb-4">' + html + '</p>';
  // Line breaks
  html = html.replace(/\n/g, '<br/>');
  return html;
}

export default function NewArticlePage() {
  const { t } = useAdminI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaPickerTarget, setMediaPickerTarget] = useState<'featured' | 'content'>('featured');
  const [previewMode, setPreviewMode] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ArticleCreateRequest>({
    defaultValues: {
      is_published: false,
      is_featured: false,
      sort_order: 0,
      content: '',
      image_urls: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: ArticleCreateRequest) => NewsService.createArticle(data),
    onSuccess: () => {
      toast.success(t('news.toast.created', 'Article created successfully!'));
      queryClient.invalidateQueries({ queryKey: queryKeys.news.lists() });
      router.push('/admin/news');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create article'),
  });

  const onSubmit = (data: ArticleCreateRequest) => {
    createMutation.mutate(data);
  };

  const watchTitle = watch('title') || '';
  const watchSlug = watch('slug') || '';
  const watchContent = watch('content') || '';
  const watchMetaTitle = watch('meta_title') || '';
  const watchMetaDesc = watch('meta_description') || '';
  const watchFeaturedImage = watch('featured_image') || '';

  const openMediaPicker = (target: 'featured' | 'content') => {
    setMediaPickerTarget(target);
    setShowMediaPicker(true);
  };

  const insertImageToContent = (url: string) => {
    const current = watch('content') || '';
    setValue('content', current + `\n\n![](${url})\n\n`);
  };

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-md">
            <ArrowLeftIcon className="h-5 w-5 text-gray-500" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{t('news.new', 'New Article')}</h1>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content - 2 cols */}
            <div className="lg:col-span-2 space-y-6">
              {/* Title */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('news.field.title', 'Title')} *
                </label>
                <input
                  {...register('title', { required: 'Title is required' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="Article title..."
                />
                {errors.title && (
                  <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>
                )}

                <label className="block text-sm font-medium text-gray-700 mb-1 mt-4">
                  {t('news.field.slug', 'Custom URL Slug')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">/news/</span>
                  <input
                    {...register('slug')}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder={t('news.field.slugPlaceholder', 'auto-generated-from-title')}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">{t('news.field.slugHint', 'Leave empty to auto-generate from title')}</p>
              </div>

              {/* Summary */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('news.field.summary', 'Summary')}
                </label>
                <textarea
                  {...register('summary')}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief summary shown in article list..."
                />
              </div>

              {/* Content Editor */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700">
                    {t('news.field.content', 'Content')} * <span className="text-gray-400 font-normal">(Markdown)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openMediaPicker('content')}
                      className="inline-flex items-center px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-md"
                    >
                      <PhotoIcon className="h-4 w-4 mr-1" />
                      {t('news.insertImage', 'Insert Image')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode(!previewMode)}
                      className={`inline-flex items-center px-3 py-1.5 text-xs rounded-md ${
                        previewMode ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 hover:bg-gray-200'
                      }`}
                    >
                      {previewMode ? (
                        <><PencilIcon className="h-4 w-4 mr-1" />{t('news.edit', 'Edit')}</>
                      ) : (
                        <><EyeIcon className="h-4 w-4 mr-1" />{t('news.preview', 'Preview')}</>
                      )}
                    </button>
                  </div>
                </div>
                {previewMode ? (
                  <div
                    className="prose prose-sm max-w-none min-h-[400px] p-4 border border-gray-200 rounded-md bg-gray-50"
                    dangerouslySetInnerHTML={{ __html: markdownToHtml(watchContent) }}
                  />
                ) : (
                  <textarea
                    {...register('content', { required: 'Content is required' })}
                    rows={20}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-500"
                    placeholder="Write your article in Markdown format..."
                  />
                )}
                {errors.content && (
                  <p className="text-red-500 text-xs mt-1">{errors.content.message}</p>
                )}
              </div>

              {/* SEO Settings */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">
                  {t('news.seo', 'SEO Settings')}
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Meta Title</label>
                    <input
                      {...register('meta_title')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="SEO title (recommended 50-60 chars)"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      {(watchMetaTitle || watchTitle).length} / 60 characters
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Meta Description</label>
                    <textarea
                      {...register('meta_description')}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="SEO description (recommended 150-160 chars)"
                    />
                    <p className="text-xs text-gray-400 mt-1">{watchMetaDesc.length} / 160 characters</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Meta Keywords</label>
                    <input
                      {...register('meta_keywords')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="keyword1, keyword2, keyword3"
                    />
                  </div>

                  {/* Google Preview */}
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Google Preview</h4>
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="text-[#1a0dab] text-[18px] leading-6 truncate">
                        {watchMetaTitle || watchTitle || 'Article Title'}
                      </div>
                      <div className="text-[#202124] text-sm mt-0.5 truncate">
                        vibocnc.com <span className="text-gray-400">{'>'}</span> news <span className="text-gray-400">{'>'}</span> {watchSlug || 'article-slug'}
                      </div>
                      <div className="text-[#4d5156] text-sm mt-1 line-clamp-2">
                        {watchMetaDesc || watch('summary') || 'Article description will appear here...'}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
                        <span className="text-gray-600">Title length (50-60 rec.)</span>
                        <span className={`font-medium ${
                          (watchMetaTitle || watchTitle).length >= 50 && (watchMetaTitle || watchTitle).length <= 60
                            ? 'text-green-600'
                            : (watchMetaTitle || watchTitle).length > 70
                            ? 'text-red-600'
                            : 'text-amber-600'
                        }`}>
                          {(watchMetaTitle || watchTitle).length} chars
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
                        <span className="text-gray-600">Desc length (150-160 rec.)</span>
                        <span className={`font-medium ${
                          watchMetaDesc.length >= 150 && watchMetaDesc.length <= 160
                            ? 'text-green-600'
                            : watchMetaDesc.length > 180
                            ? 'text-red-600'
                            : 'text-amber-600'
                        }`}>
                          {watchMetaDesc.length} chars
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar - 1 col */}
            <div className="space-y-6">
              {/* Publish settings */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('news.publish', 'Publish')}</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" {...register('is_published')} className="rounded border-gray-300" />
                    <span className="text-sm text-gray-700">{t('news.published', 'Published')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" {...register('is_featured')} className="rounded border-gray-300" />
                    <span className="text-sm text-gray-700">{t('news.featured', 'Featured')}</span>
                  </label>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('news.field.sortOrder', 'Sort Order')}</label>
                    <input
                      type="number"
                      {...register('sort_order', { valueAsNumber: true })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                </div>

                <div className="mt-6 flex gap-2">
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createMutation.isPending ? t('action.saving', 'Saving...') : t('action.save', 'Save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="px-4 py-2 border border-gray-300 text-sm text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    {t('action.cancel', 'Cancel')}
                  </button>
                </div>
              </div>

              {/* Featured Image */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">
                  {t('news.field.featuredImage', 'Featured Image')}
                </h3>
                {watchFeaturedImage ? (
                  <div className="relative group">
                    <img src={watchFeaturedImage} alt="" className="w-full h-40 object-cover rounded-md" />
                    <button
                      type="button"
                      onClick={() => setValue('featured_image', '')}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openMediaPicker('featured')}
                    className="w-full h-40 border-2 border-dashed border-gray-300 rounded-md flex flex-col items-center justify-center text-gray-400 hover:text-gray-500 hover:border-gray-400"
                  >
                    <PhotoIcon className="h-10 w-10 mb-2" />
                    <span className="text-sm">{t('news.selectImage', 'Select from Media')}</span>
                  </button>
                )}
                <div className="mt-3">
                  <input
                    {...register('featured_image')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs"
                    placeholder="Or paste image URL..."
                  />
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Media Picker Modal */}
      <MediaPickerModal
        open={showMediaPicker}
        onClose={() => setShowMediaPicker(false)}
        onSelect={(assets) => {
          if (mediaPickerTarget === 'featured') {
            setValue('featured_image', assets[0]?.url || '');
          } else {
            assets.forEach((a) => insertImageToContent(a.url));
          }
          setShowMediaPicker(false);
        }}
        multiple={mediaPickerTarget === 'content'}
        title={mediaPickerTarget === 'featured' ? 'Select Featured Image' : 'Insert Image(s)'}
      />
    </AdminLayout>
  );
}
