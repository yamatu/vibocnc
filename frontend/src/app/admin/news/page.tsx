'use client';

import { Suspense, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  NewspaperIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import { NewsService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { useAdminI18n } from '@/lib/admin-i18n';
import type { Article } from '@/types';

function AdminNewsContent() {
  const { locale, t } = useAdminI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('is_published') || '');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('content_type') || '');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = 20;

  const filters = useMemo(
    () => ({ page, page_size: pageSize, search: search.trim(), is_published: statusFilter, content_type: typeFilter as 'news' | 'blog' | undefined }),
    [page, pageSize, search, statusFilter, typeFilter]
  );

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.news.list(filters),
    queryFn: () => NewsService.getAdminArticles(filters),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => NewsService.deleteArticle(id),
    onSuccess: () => {
      toast.success(t('news.deleted', 'Article deleted'));
      queryClient.invalidateQueries({ queryKey: queryKeys.news.lists() });
    },
    onError: (err: Error) => toast.error(err.message || t('news.deleteFailed')),
  });

  const articles = data?.data || [];
  const total = data?.total || 0;
  const totalPages = data?.total_pages || 1;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('is_published', statusFilter);
    if (typeFilter) params.set('content_type', typeFilter);
    params.set('page', '1');
    router.push(`/admin/news?${params.toString()}`);
  };

  const goToPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(p));
    router.push(`/admin/news?${params.toString()}`);
  };

  const handleDelete = (article: Article) => {
    if (!confirm(t('news.deleteConfirm', undefined, { title: article.title }))) return;
    deleteMutation.mutate(article.id);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('nav.news', 'News & Articles')}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {t('news.total', '{count} articles total', { count: total })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/admin/site-pages"
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <DocumentTextIcon className="mr-2 h-5 w-5" />
              {t('nav.sitePages', 'Site Pages')}
            </Link>
            <Link
              href="/admin/news/new"
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <PlusIcon className="mr-2 h-5 w-5" />
              {t('news.create', 'New Article')}
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('news.searchPlaceholder', 'Search articles...')}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                const params = new URLSearchParams(searchParams.toString());
                if (e.target.value) params.set('content_type', e.target.value);
                else params.delete('content_type');
                params.set('page', '1');
                router.push(`/admin/news?${params.toString()}`);
              }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
            >
              <option value="">{t('news.type.all')}</option>
              <option value="news">{t('news.type.news')}</option>
              <option value="blog">{t('news.type.blog')}</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                const params = new URLSearchParams(searchParams.toString());
                if (e.target.value) params.set('is_published', e.target.value);
                else params.delete('is_published');
                params.set('page', '1');
                router.push(`/admin/news?${params.toString()}`);
              }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
            >
              <option value="">{t('news.allStatus', 'All Status')}</option>
              <option value="true">{t('news.published', 'Published')}</option>
              <option value="false">{t('news.draft', 'Draft')}</option>
            </select>
            <button
              type="submit"
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200"
            >
              {t('action.search', 'Search')}
            </button>
          </form>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : articles.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <NewspaperIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>{t('news.empty', 'No articles found')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('news.col.title', 'Title')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('news.col.slug', 'Slug')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('news.col.status', 'Status')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('news.col.author', 'Author')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('news.col.views', 'Views')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('news.col.date', 'Date')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      {t('news.col.actions', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {articles.map((article: Article) => (
                    <tr key={article.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {article.featured_image ? (
                            <img
                              src={article.featured_image}
                              alt=""
                              className="h-10 w-14 object-cover rounded"
                            />
                          ) : (
                            <div className="h-10 w-14 bg-gray-100 rounded flex items-center justify-center">
                              <NewspaperIcon className="h-5 w-5 text-gray-400" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate max-w-[250px]">
                              {article.title}
                            </p>
                            {article.is_featured && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-800">
                                {t('news.featured')}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[150px] truncate">
                        {article.public_path || `/${article.content_type || 'news'}/${article.slug}`}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            article.is_published
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {article.is_published ? t('news.published', 'Published') : t('news.draft', 'Draft')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {article.author?.full_name || article.author?.username || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {article.view_count}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {article.published_at
                          ? new Date(article.published_at).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US')
                          : new Date(article.created_at).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {article.is_published && (
                            <a
                              href={article.public_path || `/${article.content_type || 'news'}/${article.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-gray-400 hover:text-blue-600"
                              title={t('news.view')}
                            >
                              <EyeIcon className="h-4 w-4" />
                            </a>
                          )}
                          <Link
                            href={`/admin/news/${article.id}/edit`}
                            className="p-1.5 text-gray-400 hover:text-blue-600"
                            title={t('common.edit')}
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => handleDelete(article)}
                            className="p-1.5 text-gray-400 hover:text-red-600"
                            title={t('common.delete')}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {t('news.pagination', undefined, { page, pages: totalPages, total })}
              </p>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  {t('news.previous')}
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let p: number;
                  if (totalPages <= 7) {
                    p = i + 1;
                  } else if (page <= 4) {
                    p = i + 1;
                  } else if (page >= totalPages - 3) {
                    p = totalPages - 6 + i;
                  } else {
                    p = page - 3 + i;
                  }
                  return (
                    <button
                      key={p}
                      onClick={() => goToPage(p)}
                      className={`px-3 py-1 text-sm border rounded ${
                        p === page ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-100'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                >
                  {t('news.next')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

export default function AdminNewsPage() {
  return (
    <Suspense fallback={
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </AdminLayout>
    }>
      <AdminNewsContent />
    </Suspense>
  );
}
