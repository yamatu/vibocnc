'use client';

import { ChangeEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ArrowUpTrayIcon,
  PauseIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import AdminLayout from '@/components/admin/AdminLayout';
import Pagination from '@/components/common/Pagination';
import { EbayImportDraftService } from '@/services';
import type { EbayImportDraftJSONTaskSnapshot } from '@/services';
import { queryKeys } from '@/lib/react-query';
import { useAdminI18n } from '@/lib/admin-i18n';
import type { EbayImportDraftListItem, EbayBulkConfirmTaskSnapshot } from '@/types';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const MAX_JSON_IMPORT_BYTES = 1024 * 1024 * 1024;

function EbayImportDraftsContent() {
  const { locale } = useAdminI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkConfirmTask, setBulkConfirmTask] = useState<EbayBulkConfirmTaskSnapshot | null>(null);
  const [bulkTaskControlPending, setBulkTaskControlPending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [jsonImportTask, setJsonImportTask] = useState<EbayImportDraftJSONTaskSnapshot | null>(null);
  const [jsonUploadPending, setJsonUploadPending] = useState(false);
  const [jsonUploadPct, setJsonUploadPct] = useState(0);
  const [jsonTaskControlPending, setJsonTaskControlPending] = useState(false);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

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
  const visibleIds = list.map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const allDraftsSelected = total > 0 && selectedIds.length >= total;

  useEffect(() => {
    setSelectedIds([]);
  }, [search, status, matchStatus, brand]);

  useEffect(() => {
    let cancelled = false;
    void EbayImportDraftService.getLatestJSONImportTask()
      .then((task) => {
        if (!cancelled && task) setJsonImportTask(task);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const taskId = jsonImportTask?.id;
    const taskStatus = jsonImportTask?.status;
    if (!taskId || (taskStatus !== 'queued' && taskStatus !== 'processing' && taskStatus !== 'paused')) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void EbayImportDraftService.getJSONImportTask(taskId)
        .then(async (task) => {
          setJsonImportTask(task);
          if (task.status === 'completed' || task.status === 'failed') {
            await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.lists() });
            toast(task.status === 'completed'
              ? (locale === 'zh' ? `后台导入完成：新增 ${task.created}，跳过重复 ${task.skipped}，失败 ${task.failed}` : `Background import completed: ${task.created} created, ${task.skipped} duplicates skipped, ${task.failed} failed`)
              : (locale === 'zh' ? `后台导入失败：${task.message || '未知错误'}` : `Background import failed: ${task.message || 'Unknown error'}`),
            { id: `ebay-json-task-${task.id}`, icon: task.status === 'completed' ? '✅' : '❌' });
          }
        })
        .catch(() => undefined)
        .finally(() => { polling = false; });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jsonImportTask?.id, jsonImportTask?.status, locale, queryClient]);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.lists() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
  };

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startPolling = useCallback(
    (taskId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const snapshot = await EbayImportDraftService.getBulkConfirmTask(taskId);
          setBulkConfirmTask(snapshot);

          if (snapshot.status === 'completed' || snapshot.status === 'failed') {
            stopPolling();
            await invalidateAll();
            setSelectedIds([]);
            if (snapshot.status === 'completed') {
              toast.success(
                locale === 'zh'
                  ? `批量导入完成: ${snapshot.success_count}/${snapshot.total} 成功`
                  : `Bulk import done: ${snapshot.success_count}/${snapshot.total} succeeded`
              );
            } else {
              toast.error(locale === 'zh' ? '批量导入任务失败' : 'Bulk import task failed');
            }
          }
        } catch {
          stopPolling();
          toast.error(locale === 'zh' ? '批量导入进度刷新失败，请点击刷新任务' : 'Failed to refresh bulk import progress');
        }
      }, 1500);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, stopPolling]
  );

  const bulkConfirmMutation = useMutation({
    mutationFn: (ids: number[]) => EbayImportDraftService.bulkConfirm(ids),
    onSuccess: (snapshot) => {
      setBulkConfirmTask(snapshot);
      startPolling(snapshot.id);
      toast.success(
        locale === 'zh'
          ? `批量导入任务已启动 (${snapshot.total} 条)`
          : `Bulk import task started (${snapshot.total} drafts)`
      );
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, locale === 'zh' ? '批量确认失败' : 'Bulk confirm failed')),
  });

  useEffect(() => {
    let cancelled = false;
    void EbayImportDraftService.getLatestBulkConfirmTask()
      .then((task) => {
        if (cancelled || !task) return;
        setBulkConfirmTask(task);
        if (task.status === 'queued' || task.status === 'processing' || task.status === 'paused') {
          startPolling(task.id);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [startPolling]);

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

  const selectAllMutation = useMutation({
    mutationFn: () => EbayImportDraftService.selectionIds(filters),
    onSuccess: (result) => {
      setSelectedIds(result.ids);
      toast.success(locale === 'zh' ? `已选择全部 ${result.total} 条草稿` : `Selected all ${result.total} drafts`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '全选草稿失败' : 'Failed to select all drafts')),
  });

  const selectEligibleMutation = useMutation({
    mutationFn: () => EbayImportDraftService.selectionIds(filters, true),
    onSuccess: (result) => {
      setSelectedIds(result.ids);
      if (result.total === 0) toast(locale === 'zh' ? '当前筛选条件下没有可自动导入的草稿' : 'No auto-importable drafts match the current filters');
      else toast.success(locale === 'zh' ? `已选择 ${result.total} 条可自动导入草稿` : `Selected ${result.total} auto-importable drafts`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '选择可导入草稿失败' : 'Failed to select importable drafts')),
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
    setSelectedIds((prev) => {
      if (checked) return Array.from(new Set([...prev, ...visibleIds]));
      const visible = new Set(visibleIds);
      return prev.filter((id) => !visible.has(id));
    });
  };

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)));
  };

  const isTaskRunning = bulkConfirmTask != null && (bulkConfirmTask.status === 'queued' || bulkConfirmTask.status === 'processing' || bulkConfirmTask.status === 'paused');

  const handleBulkConfirm = () => {
    if (selectedIds.length === 0) {
      toast.error(locale === 'zh' ? '请先选择草稿' : 'Select drafts first');
      return;
    }
    if (isTaskRunning) return;
    if (!window.confirm(locale === 'zh' ? `确定创建后台任务并导入选中的 ${selectedIds.length} 条草稿吗？` : `Start a background import for ${selectedIds.length} selected drafts?`)) return;
    bulkConfirmMutation.mutate(selectedIds);
  };

  const refreshBulkConfirmTask = async () => {
    setBulkTaskControlPending(true);
    try {
      const task = bulkConfirmTask?.id
        ? await EbayImportDraftService.getBulkConfirmTask(bulkConfirmTask.id)
        : await EbayImportDraftService.getLatestBulkConfirmTask();
      setBulkConfirmTask(task);
      if (task && (task.status === 'queued' || task.status === 'processing' || task.status === 'paused')) startPolling(task.id);
      if (!task) toast(locale === 'zh' ? '暂无批量导入任务' : 'No bulk import task found');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '刷新批量导入任务失败' : 'Failed to refresh bulk import task'));
    } finally {
      setBulkTaskControlPending(false);
    }
  };

  const pauseBulkConfirmTask = async () => {
    if (!bulkConfirmTask) return;
    setBulkTaskControlPending(true);
    try {
      const task = await EbayImportDraftService.pauseBulkConfirmTask(bulkConfirmTask.id);
      setBulkConfirmTask(task);
      startPolling(task.id);
      toast.success(locale === 'zh' ? '已请求暂停，当前草稿处理完成后暂停' : 'Pause requested; the task will pause after the current draft');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '暂停批量导入失败' : 'Failed to pause bulk import'));
    } finally {
      setBulkTaskControlPending(false);
    }
  };

  const resumeBulkConfirmTask = async () => {
    if (!bulkConfirmTask) return;
    setBulkTaskControlPending(true);
    try {
      const task = await EbayImportDraftService.resumeBulkConfirmTask(bulkConfirmTask.id);
      setBulkConfirmTask(task);
      startPolling(task.id);
      toast.success(locale === 'zh' ? '批量导入任务已继续' : 'Bulk import task resumed');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '继续批量导入失败' : 'Failed to resume bulk import'));
    } finally {
      setBulkTaskControlPending(false);
    }
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

  const handleSelectAll = () => {
    if (total === 0 || allDraftsSelected || selectAllMutation.isPending) return;
    selectAllMutation.mutate();
  };

  const handleJsonFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setJsonUploadPending(true);
    setJsonUploadPct(0);
    try {
      if (file.size > MAX_JSON_IMPORT_BYTES) throw new Error('JSON 文件不能超过 1 GB');
      const task = await EbayImportDraftService.startJSONImport(file, setJsonUploadPct);
      setJsonImportTask(task);
      toast.success(locale === 'zh'
        ? '文件上传完成，后台任务已开始；现在可以关闭或刷新网页'
        : 'File uploaded and background import started; you may close or refresh this page');
    } catch (error: unknown) {
      const message = getErrorMessage(error, locale === 'zh' ? 'JSON 导入失败' : 'JSON import failed');
      toast.error(message);
    } finally {
      setJsonUploadPending(false);
    }
  };

  const refreshJSONImportTask = async () => {
    setJsonTaskControlPending(true);
    try {
      const task = jsonImportTask?.id
        ? await EbayImportDraftService.getJSONImportTask(jsonImportTask.id)
        : await EbayImportDraftService.getLatestJSONImportTask();
      setJsonImportTask(task);
      if (!task) toast(locale === 'zh' ? '暂无后台导入任务' : 'No background import task found');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '刷新任务失败' : 'Failed to refresh task'));
    } finally {
      setJsonTaskControlPending(false);
    }
  };

  const pauseJSONImportTask = async () => {
    if (!jsonImportTask) return;
    setJsonTaskControlPending(true);
    try {
      const task = await EbayImportDraftService.pauseJSONImportTask(jsonImportTask.id);
      setJsonImportTask(task);
      toast.success(locale === 'zh' ? '已请求暂停，当前商品处理完成后暂停' : 'Pause requested; the task will pause after the current product');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '暂停任务失败' : 'Failed to pause task'));
    } finally {
      setJsonTaskControlPending(false);
    }
  };

  const resumeJSONImportTask = async () => {
    if (!jsonImportTask) return;
    setJsonTaskControlPending(true);
    try {
      const task = await EbayImportDraftService.resumeJSONImportTask(jsonImportTask.id);
      setJsonImportTask(task);
      toast.success(locale === 'zh' ? '后台导入任务已继续' : 'Background import resumed');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '继续任务失败' : 'Failed to resume task'));
    } finally {
      setJsonTaskControlPending(false);
    }
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
            <input
              ref={jsonFileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleJsonFileChange}
            />
            <button
              type="button"
              onClick={() => jsonFileInputRef.current?.click()}
              disabled={jsonUploadPending || jsonImportTask?.status === 'queued' || jsonImportTask?.status === 'processing' || jsonImportTask?.status === 'paused'}
              className="inline-flex items-center rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUpTrayIcon className="mr-2 h-4 w-4" />
              {jsonUploadPending ? '文件上传中...' : '创建后台 JSON 导入任务'}
            </button>
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
              disabled={bulkConfirmMutation.isPending || isTaskRunning || selectedIds.length === 0}
              className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircleIcon className="mr-2 h-4 w-4" />
              {isTaskRunning
                ? (locale === 'zh' ? '导入中...' : 'Importing...')
                : (locale === 'zh' ? '批量确认导入' : 'Bulk Confirm')}
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

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm text-emerald-950">
              <p className="font-semibold">后台批量确认导入任务</p>
              {bulkConfirmTask ? (
                <p className="mt-1">
                  {bulkConfirmTask.status === 'completed'
                    ? '批量导入已完成'
                    : bulkConfirmTask.status === 'failed'
                      ? '批量导入任务失败'
                      : bulkConfirmTask.status === 'paused'
                        ? '批量导入已暂停'
                        : '批量导入正在后台运行'}
                  {bulkConfirmTask.current_id ? ` · 当前草稿 #${bulkConfirmTask.current_id}` : ''}
                </p>
              ) : (
                <p className="mt-1 text-emerald-700">暂无任务。全选草稿并点击“批量确认导入”后，进度会显示在这里。</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshBulkConfirmTask()}
                disabled={bulkTaskControlPending}
                className="inline-flex items-center rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                <ArrowPathIcon className={`mr-1.5 h-4 w-4 ${bulkTaskControlPending ? 'animate-spin' : ''}`} />刷新任务
              </button>
              {(bulkConfirmTask?.status === 'queued' || bulkConfirmTask?.status === 'processing') && (
                <button
                  type="button"
                  onClick={() => void pauseBulkConfirmTask()}
                  disabled={bulkTaskControlPending}
                  className="inline-flex items-center rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  <PauseIcon className="mr-1.5 h-4 w-4" />暂停任务
                </button>
              )}
              {bulkConfirmTask?.status === 'paused' && (
                <button
                  type="button"
                  onClick={() => void resumeBulkConfirmTask()}
                  disabled={bulkTaskControlPending}
                  className="inline-flex items-center rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <PlayIcon className="mr-1.5 h-4 w-4" />继续任务
                </button>
              )}
            </div>
          </div>
          {bulkConfirmTask && (
            <>
              <div className="mt-3 flex items-center justify-between text-xs text-emerald-800">
                <span>{bulkConfirmTask.message || bulkConfirmTask.status}</span>
                <span>{bulkConfirmTask.processed}/{bulkConfirmTask.total} · {Math.min(100, bulkConfirmTask.progress_pct).toFixed(1)}%</span>
              </div>
              <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-emerald-100">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${bulkConfirmTask.status === 'completed' ? 'bg-green-500' : bulkConfirmTask.status === 'failed' ? 'bg-red-500' : bulkConfirmTask.status === 'paused' ? 'bg-amber-500' : 'bg-emerald-600'}`}
                  style={{ width: `${Math.max(bulkConfirmTask.status === 'completed' ? 100 : 1, Math.min(100, bulkConfirmTask.progress_pct))}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-emerald-800">
                <span>成功：{bulkConfirmTask.success_count}</span>
                <span>已跳过：{bulkConfirmTask.skipped_count}</span>
                <span>已处理过：{bulkConfirmTask.already_processed_count || 0}</span>
                <span>待确认分类：{bulkConfirmTask.needs_review_count || 0}</span>
                <span>重复 SKU：{bulkConfirmTask.duplicate_count || 0}</span>
                <span>缺少型号：{bulkConfirmTask.missing_identifier_count || 0}</span>
                <span>失败：{bulkConfirmTask.failed_count}</span>
                <span>剩余：{Math.max(0, bulkConfirmTask.total - bulkConfirmTask.processed)}</span>
                <span>最后更新：{new Date(bulkConfirmTask.updated_at).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-xs text-emerald-700">任务由服务器后台执行，关闭或刷新网页不会终止。</p>
            </>
          )}
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

        {jsonUploadPending && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-sm text-amber-900">
              <span>正在把 JSON 文件上传到服务器，请在上传完成前保持此页面打开。</span>
              <span>{jsonUploadPct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100">
              <div className="h-full bg-amber-500 transition-[width] duration-200" style={{ width: `${jsonUploadPct}%` }} />
            </div>
          </div>
        )}

        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4" role="status" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 text-sm text-blue-900">
              <p className="font-semibold">后台 JSON 导入任务</p>
              {jsonImportTask ? (
                <>
                  <p className="mt-1 break-all">{jsonImportTask.filename} · 任务 ID：{jsonImportTask.id}</p>
                  <p className="mt-1">
                    {jsonImportTask.status === 'queued'
                      ? '等待后台处理'
                      : jsonImportTask.status === 'processing'
                        ? `处理中：新增 ${jsonImportTask.created}，跳过重复 ${jsonImportTask.skipped}，失败 ${jsonImportTask.failed}`
                        : jsonImportTask.status === 'paused'
                          ? `已暂停：新增 ${jsonImportTask.created}，跳过重复 ${jsonImportTask.skipped}，失败 ${jsonImportTask.failed}`
                          : jsonImportTask.status === 'completed'
                            ? `已完成：新增 ${jsonImportTask.created}，跳过重复 ${jsonImportTask.skipped}，失败 ${jsonImportTask.failed}`
                            : `任务失败：${jsonImportTask.message || '未知错误'}`}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-blue-700">暂无任务。上传 JSON 后，进度会固定显示在这里。</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshJSONImportTask()}
                disabled={jsonTaskControlPending}
                className="inline-flex items-center rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <ArrowPathIcon className={`mr-1.5 h-4 w-4 ${jsonTaskControlPending ? 'animate-spin' : ''}`} />
                刷新任务
              </button>
              {(jsonImportTask?.status === 'queued' || jsonImportTask?.status === 'processing') && (
                <button
                  type="button"
                  onClick={() => void pauseJSONImportTask()}
                  disabled={jsonTaskControlPending}
                  className="inline-flex items-center rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  <PauseIcon className="mr-1.5 h-4 w-4" />暂停任务
                </button>
              )}
              {jsonImportTask?.status === 'paused' && (
                <button
                  type="button"
                  onClick={() => void resumeJSONImportTask()}
                  disabled={jsonTaskControlPending}
                  className="inline-flex items-center rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <PlayIcon className="mr-1.5 h-4 w-4" />继续任务
                </button>
              )}
            </div>
          </div>
          {jsonImportTask && (
            <>
              <div className="mt-3 flex items-center justify-between text-xs text-blue-800">
                <span>{jsonImportTask.message || jsonImportTask.status}</span>
                <span>{Math.min(100, Math.max(0, jsonImportTask.progress_pct || 0)).toFixed(1)}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-blue-100">
                <div
                  className={`h-full transition-[width] duration-300 ${jsonImportTask.status === 'paused' ? 'bg-amber-500' : jsonImportTask.status === 'failed' ? 'bg-red-500' : 'bg-blue-600'}`}
                  style={{ width: `${Math.max(jsonImportTask.status === 'completed' ? 100 : 2, Math.min(100, jsonImportTask.progress_pct || 0))}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-blue-800">
                已处理 {jsonImportTask.processed} 条 · 最后更新 {new Date(jsonImportTask.updated_at).toLocaleString()}。关闭或刷新网页不会终止任务。
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
          <p className="text-sm text-blue-900" role="status" aria-live="polite">
            {locale === 'zh' ? `已选择 ${selectedIds.length} 条草稿` : `${selectedIds.length} draft(s) selected`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => selectEligibleMutation.mutate()}
              disabled={selectEligibleMutation.isPending || isTaskRunning}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectEligibleMutation.isPending ? '筛选中...' : '全选可导入产品管理'}
            </button>
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={total === 0 || allDraftsSelected || selectAllMutation.isPending || bulkDeleteMutation.isPending}
              className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectAllMutation.isPending
                ? (locale === 'zh' ? '全选中...' : 'Selecting...')
                : (locale === 'zh' ? `全选所有草稿（${total}）` : `Select all drafts (${total})`)}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0 || bulkDeleteMutation.isPending || bulkConfirmMutation.isPending || bulkRecheckMutation.isPending}
              className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {locale === 'zh' ? '清除选择' : 'Clear selection'}
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={selectedIds.length === 0 || bulkDeleteMutation.isPending}
              className="inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <TrashIcon className="mr-2 h-4 w-4" />
              {bulkDeleteMutation.isPending
                ? (locale === 'zh' ? '删除中...' : 'Deleting...')
                : (locale === 'zh' ? '删除选中草稿' : 'Delete selected')}
            </button>
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
                        checked={allVisibleSelected}
                        aria-label={locale === 'zh' ? '选择当前页草稿' : 'Select drafts on this page'}
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
                          aria-label={locale === 'zh' ? `选择草稿 ${draft.id}` : `Select draft ${draft.id}`}
                          onChange={(e) => toggleSelectOne(draft.id, e.target.checked)}
                        />
                      </td>
                      <td className="px-4 py-4 text-sm">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          {draft.source_site || 'ebay'}
                        </div>
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
