'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import Pagination from '@/components/common/Pagination';
import { EbayImportDraftService } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { useAdminI18n } from '@/lib/admin-i18n';
import type { EbayImportDraftListItem } from '@/types';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

function EbayImportDraftsContent() {
  const { locale } = useAdminI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = 20;
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const matchStatus = searchParams.get('match_status') || '';
  const brand = searchParams.get('brand') || '';

  const filters = useMemo(
    () => ({
      page,
      page_size: pageSize,
      search: search.trim(),
      status,
      match_status: matchStatus,
      brand,
    }),
    [page, pageSize, search, status, matchStatus, brand]
  );

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.ebayImportDrafts.list(filters),
    queryFn: () => EbayImportDraftService.list(filters),
  });

  const list = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.total_pages || 1;

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.lists() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
  };

  const bulkConfirmMutation = useMutation({
    mutationFn: (ids: number[]) => EbayImportDraftService.bulkConfirm(ids),
    onSuccess: async (result) => {
      await invalidateAll();
      setSelectedIds([]);
      toast.success(
        locale === 'zh'
          ? `已确认 ${result.success_count}/${result.total} 条草稿`
          : `Confirmed ${result.success_count}/${result.total} drafts`
      );
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '批量确认失败' : 'Bulk confirm failed')),
  });

  const bulkRecheckMutation = useMutation({
    mutationFn: (ids: number[]) => EbayImportDraftService.bulkRecheck(ids),
    onSuccess: async (result) => {
      await invalidateAll();
      toast.success(
        locale === 'zh'
          ? `已重新检测 ${result.updated}/${result.total} 条草稿`
          : `Rechecked ${result.updated}/${result.total} drafts`
      );
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '批量重检失败' : 'Bulk recheck failed')),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => EbayImportDraftService.bulkDelete(ids),
    onSuccess: async (result) => {
      await invalidateAll();
      setSelectedIds([]);
      toast.success(locale === 'zh' ? `已删除 ${result.deleted} 条草稿` : `Deleted ${result.deleted} drafts`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '批量删除失败' : 'Bulk delete failed')),
  });

  const updateParams = (updates: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') params.delete(key);
      else params.set(key, String(value));
    });
    if (!('page' in updates)) params.set('page', '1');
    router.push(`/admin/ebay-import-drafts?${params.toString()}`);
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? list.map((item) => item.id) : []);
  };

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)));
  };

  const handleBulkConfirm = () => {
    if (selectedIds.length === 0) {
      toast.error(locale === 'zh' ? '请先选择草稿' : 'Select drafts first');
      return;
    }
    bulkConfirmMutation.mutate(selectedIds);
  };

  const handleBulkRecheck = () => {
    if (selectedIds.length === 0) {
      toast.error(locale === 'zh' ? '请先选择草稿' : 'Select drafts first');
      return;
    }
    bulkRecheckMutation.mutate(selectedIds);
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) {
      toast.error(locale === 'zh' ? '请先选择草稿' : 'Select drafts first');
      return;
    }
    if (!window.confirm(locale === 'zh' ? '确定删除选中的草稿吗？' : 'Delete selected drafts?')) return;
    bulkDeleteMutation.mutate(selectedIds);
  };

  const renderStatus = (draft: EbayImportDraftListItem) => {
    const labelMap: Record<string, string> = locale === 'zh'
      ? {
          pending: '待处理',
          reviewed: '已复核',
          confirmed: '已确认',
          imported: '已导入',
          failed: '失败',
          skipped: '已跳过',
          needs_review: '待人工确认',
        }
      : {
          pending: 'Pending',
          reviewed: 'Reviewed',
          confirmed: 'Confirmed',
          imported: 'Imported',
          failed: 'Failed',
          skipped: 'Skipped',
          needs_review: 'Needs Review',
        };

    const colorMap: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      reviewed: 'bg-blue-100 text-blue-800',
      confirmed: 'bg-indigo-100 text-indigo-800',
      imported: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      skipped: 'bg-gray-100 text-gray-800',
      needs_review: 'bg-orange-100 text-orange-800',
    };

    return (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${colorMap[draft.status] || 'bg-gray-100 text-gray-800'}`}>
        {labelMap[draft.status] || draft.status}
      </span>
    );
  };

  const renderMatchStatus = (draft: EbayImportDraftListItem) => {
    const labelMap: Record<string, string> = locale === 'zh'
      ? {
          matched_exact: '精确重复',
          possible_duplicate: '疑似重复',
          new_unique: '新品',
        }
      : {
          matched_exact: 'Exact Match',
          possible_duplicate: 'Possible Duplicate',
          new_unique: 'New Unique',
        };

    const colorMap: Record<string, string> = {
      matched_exact: 'bg-red-100 text-red-800',
      possible_duplicate: 'bg-amber-100 text-amber-800',
      new_unique: 'bg-emerald-100 text-emerald-800',
    };

    return (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${colorMap[draft.match_status] || 'bg-gray-100 text-gray-800'}`}>
        {labelMap[draft.match_status] || draft.match_status}
      </span>
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{locale === 'zh' ? 'eBay 草稿' : 'eBay Drafts'}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {locale === 'zh' ? `共 ${total} 条待审核抓取草稿` : `${total} scraped drafts pending review`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleBulkRecheck}
              disabled={bulkRecheckMutation.isPending || selectedIds.length === 0}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <ArrowPathIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '批量重检' : 'Bulk Recheck'}
            </button>
            <button
              onClick={handleBulkConfirm}
              disabled={bulkConfirmMutation.isPending || selectedIds.length === 0}
              className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircleIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '批量确认导入' : 'Bulk Confirm'}
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending || selectedIds.length === 0}
              className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <TrashIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '批量删除' : 'Bulk Delete'}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '搜索' : 'Search'}</label>
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  defaultValue={search}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateParams({ search: (e.target as HTMLInputElement).value, page: 1 });
                    }
                  }}
                  placeholder={locale === 'zh' ? '标题 / 品牌 / 型号 / MPN' : 'Title / Brand / Model / MPN'}
                  className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-3 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '状态' : 'Status'}</label>
              <select
                value={status}
                onChange={(e) => updateParams({ status: e.target.value, page: 1 })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">{locale === 'zh' ? '全部状态' : 'All status'}</option>
                <option value="pending">{locale === 'zh' ? '待处理' : 'Pending'}</option>
                <option value="needs_review">{locale === 'zh' ? '待人工确认' : 'Needs Review'}</option>
                <option value="imported">{locale === 'zh' ? '已导入' : 'Imported'}</option>
                <option value="failed">{locale === 'zh' ? '失败' : 'Failed'}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '重复匹配' : 'Match Status'}</label>
              <select
                value={matchStatus}
                onChange={(e) => updateParams({ match_status: e.target.value, page: 1 })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">{locale === 'zh' ? '全部匹配' : 'All matches'}</option>
                <option value="new_unique">{locale === 'zh' ? '新品' : 'New Unique'}</option>
                <option value="possible_duplicate">{locale === 'zh' ? '疑似重复' : 'Possible Duplicate'}</option>
                <option value="matched_exact">{locale === 'zh' ? '精确重复' : 'Exact Match'}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '品牌' : 'Brand'}</label>
              <select
                value={brand}
                onChange={(e) => updateParams({ brand: e.target.value, page: 1 })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">{locale === 'zh' ? '全部品牌' : 'All brands'}</option>
                <option value="fanuc">FANUC</option>
                <option value="mitsubishi">Mitsubishi</option>
                <option value="siemens">Siemens</option>
                <option value="abb">ABB</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {isLoading ? (
            <div className="flex justify-center p-12">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
          ) : error ? (
            <div className="p-12 text-center text-red-600">{(error as Error).message}</div>
          ) : list.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <ClipboardDocumentListIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p>{locale === 'zh' ? '暂无草稿数据' : 'No draft data found'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={list.length > 0 && selectedIds.length === list.length}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '标题' : 'Title'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '品牌 / 型号' : 'Brand / Model'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '建议分类' : 'Suggested Category'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '匹配' : 'Match'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '状态' : 'Status'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '上传时间' : 'Uploaded'}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '操作' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {list.map((draft) => (
                    <tr key={draft.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={selectedIds.includes(draft.id)}
                          onChange={(e) => toggleSelectOne(draft.id, e.target.checked)}
                        />
                      </td>
                      <td className="px-4 py-4 text-sm">
                        <div className="font-medium text-gray-900">{draft.normalized_title || draft.title_raw || '-'}</div>
                        <div className="mt-1 max-w-[320px] truncate text-gray-500">{draft.source_url || '-'}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        <div>{draft.normalized_brand || '-'}</div>
                        <div className="text-gray-500">{draft.normalized_model || draft.normalized_part_number || draft.normalized_mpn || '-'}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        <div>{draft.suggested_category?.name || draft.suggested_category_name || '-'}</div>
                        <div className="text-xs text-gray-500">{draft.taxonomy_status}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        <div>{renderMatchStatus(draft)}</div>
                        {draft.matched_product && (
                          <div className="mt-1 text-xs text-gray-500">
                            #{draft.matched_product.id} · {draft.matched_product.sku}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">{renderStatus(draft)}</td>
                      <td className="px-4 py-4 text-sm text-gray-500">
                        <div>{new Date(draft.created_at).toLocaleDateString()}</div>
                        <div className="text-xs text-gray-400">{new Date(draft.created_at).toLocaleTimeString()}</div>
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium">
                        <Link href={`/admin/ebay-import-drafts/${draft.id}`} className="inline-flex text-blue-600 hover:text-blue-800">
                          <EyeIcon className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!isLoading && !error && totalPages > 1 && (
          <div className="flex justify-center">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={(nextPage) => updateParams({ page: nextPage })}
              showFirstLast
              showPageNumbers
              maxVisiblePages={5}
            />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

export default function EbayImportDraftsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-10">Loading...</div>}>
      <EbayImportDraftsContent />
    </Suspense>
  );
}
