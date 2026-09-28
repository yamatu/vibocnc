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
import AIReviewPanel from '@/components/admin/AIReviewPanel';
import { hasReadyDraftReview, draftDisplayTitle, draftDisplayCategory } from '@/lib/ebay-draft-preview';
import EbayMarketPanel from '@/components/admin/EbayMarketPanel';
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

/**
 * Page sizes the drafts list offers.
 *
 * The server caps a page at 200; anything larger would make the list endpoint
 * slow for no benefit because the admin is reading the rows, not scanning them.
 */
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

const clampPageSize = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PAGE_SIZE;
  return PAGE_SIZE_OPTIONS.includes(value) ? value : DEFAULT_PAGE_SIZE;
};

/**
 * The category this store will publish under.
 *
 * It only exists when the draft matched a category (suggested_category_id).
 * Otherwise suggested_category_name holds the *source* site's wording, which
 * is what used to make eBay's taxonomy and the BAS collection look like the
 * same field; that wording is shown in the source category column instead.
 */
/**
 * Whether the row was scraped from eBay.
 *
 * A row can be an eBay row before the crawler recorded a breadcrumb for it, and
 * that is exactly when an admin wants to set one.
 */
const isEbaySourceDraft = (draft: EbayImportDraftListItem): boolean =>
  (draft.source_site || '').trim().toLowerCase() === 'ebay';

/** A row whose category is settled must not be edited: a product already points at it. */
const isDraftCategoryReadOnly = (draft: EbayImportDraftListItem): boolean =>
  draft.status === 'imported' || draft.status === 'skipped';

const siteCategoryName = (draft: EbayImportDraftListItem): string =>
  draftDisplayCategory(draft);

/**
 * Build the status allow-list for a filter-based bulk delete.
 *
 * The backend refuses a delete with no status bound, so that a single click can
 * never empty the entire review queue. When the admin has not filtered by status
 * we scope the delete to "not yet imported" drafts, which is the set the review
 * queue is about: imported drafts are history, not work in progress.
 */
const DELETE_STATUS_VALUES = ['pending', 'imported', 'skipped', 'failed', 'needs_review', 'reviewed', 'confirmed'];

const deleteStatusScope = (statusFilter: string | undefined): string[] => {
  const status = (statusFilter || '').trim();
  return status ? [status] : DELETE_STATUS_VALUES;
};

function EbayImportDraftsContent() {
  const { locale } = useAdminI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  // The drafts list and the eBay market tools are two views of one workflow
  // (scrape -> review -> price -> publish), so they share a page instead of
  // living in two places that must be kept in sync.
  const activeTab = searchParams.get('tab') === 'market' ? 'market' : 'drafts';
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [includeImages, setIncludeImages] = useState(false);
  const [bulkConfirmTask, setBulkConfirmTask] = useState<EbayBulkConfirmTaskSnapshot | null>(null);
  const [bulkTaskControlPending, setBulkTaskControlPending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [jsonImportTask, setJsonImportTask] = useState<EbayImportDraftJSONTaskSnapshot | null>(null);
  // The JSON task endpoint returns only the current state, so the history is
  // accumulated client-side every time an observation differs. That is what
  // turns "progress: 43%" into a log an administrator can read after the fact.
  const [jsonTaskLog, setJsonTaskLog] = useState<{ at: string; level: 'info' | 'success' | 'error'; text: string }[]>([]);
  const [jsonUploadPending, setJsonUploadPending] = useState(false);
  const [jsonUploadPct, setJsonUploadPct] = useState(0);
  const [jsonTaskControlPending, setJsonTaskControlPending] = useState(false);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  const page = parseInt(searchParams.get('page') || '1', 10);
  // Page size is a real usability knob (20 rows is too few for triage), so it
  // lives in the URL like the other list state: a reload or a shared link keeps
  // the view the admin chose.
  const pageSize = clampPageSize(parseInt(searchParams.get('page_size') || '50', 10));
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const matchStatus = searchParams.get('match_status') || '';
  const brand = searchParams.get('brand') || '';
  const sourceSite = searchParams.get('source_site') || '';
  const aiReviewStatus = searchParams.get('ai_review_status') || '';

  const filters = useMemo(
    () => ({
      page,
      page_size: pageSize,
      search: search.trim(),
      status,
      match_status: matchStatus,
      brand,
      source_site: sourceSite,
      ai_review_status: aiReviewStatus,
    }),
    [page, pageSize, search, status, matchStatus, brand, sourceSite, aiReviewStatus]
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
  // True only when the server had to cap the selected IDs. In that case the
  // delete uses the active filter; complete selections use exact IDs.
  const [selectionCoversAll, setSelectionCoversAll] = useState(false);
  const allDraftsSelected = selectionCoversAll;

  useEffect(() => {
    setSelectedIds([]);
    setSelectionCoversAll(false);
  }, [search, status, matchStatus, brand, sourceSite, aiReviewStatus]);

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
    if (!taskId || (taskStatus !== 'uploading' && taskStatus !== 'queued' && taskStatus !== 'processing' && taskStatus !== 'paused')) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void EbayImportDraftService.getJSONImportTask(taskId)
        .then(async (task) => {
          setJsonImportTask(task);
          if (task.status === 'completed' || task.status === 'completed_with_errors' || task.status === 'failed') {
            await queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.lists() });
            toast(task.status === 'completed' || task.status === 'completed_with_errors'
              ? (locale === 'zh' ? `后台导入完成：新增 ${task.created}，跳过重复 ${task.skipped}，失败 ${task.failed}` : `Background import completed: ${task.created} created, ${task.skipped} duplicates skipped, ${task.failed} failed`)
              : (locale === 'zh' ? `后台导入失败：${task.message || '未知错误'}` : `Background import failed: ${task.message || 'Unknown error'}`),
            { id: `ebay-json-task-${task.id}`, icon: task.status === 'completed' ? '✅' : task.status === 'completed_with_errors' ? '⚠️' : '❌' });
          }
        })
        .catch(() => undefined)
        .finally(() => { polling = false; });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jsonImportTask?.id, jsonImportTask?.status, locale, queryClient]);

  /**
   * Append a line to the JSON import log whenever the task's observable state
   * changes. Comparing against the previous snapshot is what keeps a poll that
   * changes nothing from filling the log with duplicates.
   */
  useEffect(() => {
    if (!jsonImportTask) return;
    const task = jsonImportTask;
    const at = new Date().toISOString();
    setJsonTaskLog((current) => {
      const previous = current[current.length - 1];
      const entry = (text: string, level: 'info' | 'success' | 'error' = 'info') => {
        if (previous && previous.text === text && previous.level === level) return current;
        return [...current, { at, level, text }].slice(-200);
      };
      const failed = task.errors?.length ?? 0;
      switch (task.status) {
        case 'uploading':
          return entry(`上传文件中 ${task.uploaded_bytes}/${task.file_size} 字节`);
        case 'queued':
          return entry('文件已上传，等待后台处理');
        case 'processing':
          return entry(
            `处理中：已处理 ${task.processed} 条，新增 ${task.created}，跳过 ${task.skipped}，失败 ${task.failed}`
          );
        case 'paused':
          return entry(`已暂停：已处理 ${task.processed} 条`);
        case 'completed':
          return entry(
            `完成：新增 ${task.created}，跳过重复 ${task.skipped}，失败 ${task.failed}`,
            task.failed > 0 ? 'error' : 'success'
          );
        case 'completed_with_errors':
          return entry(
            `完成（有失败）：新增 ${task.created}，跳过 ${task.skipped}，失败 ${task.failed}`,
            'error'
          );
        case 'failed':
          return entry(`失败：${task.error || task.message || '未知错误'}`, 'error');
        case 'cancelled':
          return entry('任务已取消', 'error');
        default:
          return failed > 0
            ? entry(`${failed} 条导入失败：${(task.errors || []).slice(0, 3).join(' | ')}`, 'error')
            : current;
      }
    });
  }, [jsonImportTask]);

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
     
    [locale, stopPolling]
  );

  const bulkConfirmMutation = useMutation({
    mutationFn: (ids: number[]) => EbayImportDraftService.bulkConfirm(ids, undefined, includeImages),
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

  const reopenOrphanedMutation = useMutation({
    mutationFn: () => EbayImportDraftService.reopenOrphaned(),
    onSuccess: async (result) => {
      await invalidateAll();
      toast.success(locale === 'zh' ? `已恢复 ${result.reopened} 条孤立草稿` : `Reopened ${result.reopened} orphaned drafts`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '恢复孤立草稿失败' : 'Failed to reopen orphaned drafts')),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => EbayImportDraftService.bulkDelete(ids),
    onSuccess: async (result) => {
      await invalidateAll();
      setSelectedIds([]);
      setSelectionCoversAll(false);
      toast.success(locale === 'zh' ? `已删除 ${result.deleted} 条草稿` : `Deleted ${result.deleted} drafts`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '批量删除失败' : 'Bulk delete failed')),
  });

  // Setting a draft's eBay category is a per-row edit of the *source* site's
  // taxonomy. It goes through the draft update endpoint, which stores it beside
  // the scraped breadcrumb and leaves the site category (suggested_category_id)
  // untouched.
  const updateEbayCategoryMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) =>
      EbayImportDraftService.update(id, { ebay_category: value }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success(locale === 'zh' ? 'eBay 分类已更新，请重新运行 AI 优化' : 'eBay category updated; rerun AI optimization');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, locale === 'zh' ? '更新 eBay 分类失败' : 'Failed to update the eBay category')),
  });

  // The eBay vocabulary the stored drafts carry, so the picker offers paths that
  // really came off the marketplaces instead of a hand-kept list.
  const { data: ebayCategoryOptions } = useQuery({
    queryKey: ['ebayImportDrafts', 'source-categories', 'ebay'],
    queryFn: () => EbayImportDraftService.getSourceCategories('ebay'),
    staleTime: 5 * 60 * 1000,
  });

  // Deleting everything the filters match goes through a filter-based request.
  /**
 * The four stages of the draft queue, in the order a row moves through them.
 *
 * Each stage is just a filter combination, so a step both states the order of
 * operations and applies it. Previously that order was only discoverable by
 * working through the dropdowns one at a time.
 */
type WorkflowStep = {
  key: string;
  zh: string;
  en: string;
  params: Record<string, string | undefined>;
};

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    key: 'new',
    zh: '① 新品待确认',
    en: '1. New items',
    params: { status: 'pending', match_status: 'new_unique', ai_review_status: undefined },
  },
  {
    key: 'review',
    zh: '② 待 AI 审核',
    en: '2. To review',
    params: { status: 'pending', match_status: undefined, ai_review_status: 'unreviewed' },
  },
  {
    key: 'ready_new_unique',
    zh: '③ AI 新品可上架',
    en: '3. AI new products',
    params: { status: undefined, match_status: 'new_unique', ai_review_status: 'ready' },
  },
  {
    key: 'approve',
    zh: '④ 待批准上架',
    en: '3. To approve',
    params: { status: undefined, match_status: undefined, ai_review_status: 'ready' },
  },
  {
    key: 'published',
    zh: '⑤ 已上架',
    en: '5. Published',
    params: { status: 'imported', match_status: undefined, ai_review_status: undefined },
  },
];

// Sending tens of thousands of ids in one body (and one `WHERE id IN (...)`) is
  // what produced the 500 on the select-all path.
  const bulkDeleteAllMutation = useMutation({
    mutationFn: () =>
      EbayImportDraftService.bulkDeleteByFilter(filters, deleteStatusScope(filters.status)),
    onSuccess: async (result) => {
      await invalidateAll();
      setSelectedIds([]);
      setSelectionCoversAll(false);
      toast.success(locale === 'zh' ? `已删除 ${result.deleted} 条草稿` : `Deleted ${result.deleted} drafts`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '批量删除失败' : 'Bulk delete failed')),
  });

  const selectAllMutation = useMutation({
    mutationFn: () => EbayImportDraftService.selectionIds(filters),
    onSuccess: (result) => {
      setSelectedIds(result.ids);
      // Only a truncated selection uses the filter-delete path. A complete ID
      // list is deleted exactly, even when no filter is active.
      setSelectionCoversAll(Boolean(result.truncated));
      if (result.truncated) {
        setSelectionCoversAll(true);
        toast.success(
          locale === 'zh'
            ? `已选中当前筛选条件下的全部 ${result.total} 条（超过 ${result.limit} 条，删除时按筛选条件整批执行）`
            : `Selected all ${result.total} matching drafts; delete applies to every one of them`
        );
        return;
      }
      toast.success(locale === 'zh' ? `已选择全部 ${result.total} 条草稿` : `Selected all ${result.total} drafts`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err, locale === 'zh' ? '全选草稿失败' : 'Failed to select all drafts')),
  });

  const selectEligibleMutation = useMutation({
    mutationFn: () => EbayImportDraftService.selectionIds(filters, true),
    onSuccess: (result) => {
      setSelectedIds(result.ids);
      // An eligible-only selection is a strict subset, so it is always removed
      // by id; never treat it as "everything matching the filter".
      setSelectionCoversAll(false);
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
    // A manual checkbox action converts the selection into an exact ID set;
    // never leave a stale "all filtered" delete marker behind.
    setSelectionCoversAll(false);
    setSelectedIds((prev) => {
      if (checked) return Array.from(new Set([...prev, ...visibleIds]));
      const visible = new Set(visibleIds);
      return prev.filter((id) => !visible.has(id));
    });
  };

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectionCoversAll(false);
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
    if (allDraftsSelected) {
      const hasFilter = [search, status, matchStatus, brand, sourceSite, aiReviewStatus]
        .some((value) => value.trim() !== '');
      if (!hasFilter) {
        toast.error(locale === 'zh'
          ? '为安全起见，请先选择状态、来源或其他筛选条件，再删除全部匹配草稿'
          : 'Choose a status, source, or another filter before deleting all matching drafts');
        return;
      }
    }
    const confirmMessage = allDraftsSelected
      ? locale === 'zh'
        ? `确定删除当前筛选条件下的全部 ${total} 条草稿吗？这只会删除当前筛选结果。`
        : `Delete all ${total} drafts matching the current filters? Other drafts will not be touched.`
      : locale === 'zh'
        ? `确定删除选中的 ${selectedIds.length} 条草稿吗？`
        : `Delete the ${selectedIds.length} selected drafts?`;
    if (!window.confirm(confirmMessage)) return;

    if (allDraftsSelected) {
      bulkDeleteAllMutation.mutate();
      return;
    }
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

  const cancelJSONImportTask = async () => {
    if (!jsonImportTask) return;
    if (!window.confirm(locale === 'zh' ? '确定取消这个 JSON 上传/导入任务吗？' : 'Cancel this JSON upload/import task?')) return;
    setJsonTaskControlPending(true);
    try {
      const task = await EbayImportDraftService.cancelJSONImportTask(jsonImportTask.id);
      setJsonImportTask(task);
      toast.success(locale === 'zh' ? 'JSON 任务已取消' : 'JSON task cancelled');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, locale === 'zh' ? '取消任务失败' : 'Failed to cancel task'));
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

  const workflowStepActive = (step: WorkflowStep) =>
    (step.params.status || '') === status &&
    (step.params.match_status || '') === matchStatus &&
    (step.params.ai_review_status || '') === aiReviewStatus;

  /**
   * What this row needs next, and - when it is blocked - why.
   *
   * Every row looks alike in a list this size, but the pipeline is scrape ->
   * human confirm -> AI review -> publish and a row can stall at any of those.
   * The AI review refuses a draft with no model or part number, so naming that
   * on the row is the difference between a queue an operator can work through
   * and one that silently rejects a whole batch.
   */
  /** The eBay category picker for one row: a value from the scraped vocabulary. */
  const renderEbayCategoryPicker = (draft: EbayImportDraftListItem) => {
    const choices = ebayCategoryOptions || [];
    const current = draft.ebay_category || '';
    // A row can carry a path no other draft has, so the current value is always
    // offered even when it is not in the vocabulary.
    const currentIsMissing = current !== '' && !choices.some((option) => option.value === current);
    return (
      <select
        className="mt-1 w-full max-w-[240px] rounded border border-gray-300 bg-white px-1 py-0.5 text-xs"
        value={current}
        disabled={updateEbayCategoryMutation.isPending || ['queued', 'processing'].includes(draft.ai_review_status || '')}
        onChange={(event) => updateEbayCategoryMutation.mutate({ id: draft.id, value: event.target.value })}
        aria-label={locale === 'zh' ? `草稿 ${draft.id} 的 eBay 分类` : `eBay category of draft ${draft.id}`}
      >
        <option value="">{locale === 'zh' ? '（未选择）' : '(none)'}</option>
        {currentIsMissing ? <option value={current}>{current}</option> : null}
        {choices.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} ({option.count})
          </option>
        ))}
      </select>
    );
  };

  const nextStepHint = (draft: EbayImportDraftListItem): { text: string; tone: string } => {
    const zh = locale === 'zh';
    const identifier =
      draft.normalized_model || draft.normalized_part_number || draft.normalized_mpn || '';
    const title = (draft.normalized_title || draft.title_raw || '').trim();

    if (draft.status === 'imported') {
      return { text: zh ? '已完成，无需操作' : 'Published', tone: 'text-emerald-700' };
    }
    if (draft.status === 'skipped') {
      return { text: zh ? '已跳过' : 'Skipped', tone: 'text-gray-500' };
    }
    if (draft.ai_review_status === 'ready') {
      return {
        text: zh ? '可上架：勾选后点「上架选中的」' : 'Ready: approve to publish',
        tone: 'text-indigo-700',
      };
    }
    if (draft.ai_review_status === 'queued' || draft.ai_review_status === 'processing') {
      return { text: zh ? 'AI 审核中，请等待' : 'AI reviewing', tone: 'text-indigo-600' };
    }
    if (draft.ai_review_status === 'approved') {
      return { text: zh ? '已批准，正在上架' : 'Approved, importing', tone: 'text-indigo-600' };
    }
    // The two preflight conditions the AI review enforces. Reporting them here
    // means a batch that cannot be reviewed says so before it is selected.
    if (!title) {
      return {
        text: zh ? '缺少标题，无法识别；请到详情页补全' : 'No title: cannot be identified',
        tone: 'text-amber-700',
      };
    }
    if (!identifier) {
      // The review parses the title for a model instead of skipping the row, so
      // this must not promise a skip: only a row whose title names no part at all
      // is refused, and that is reported by the batch error.
      return {
        text: zh
          ? '无型号字段：审核时会从标题识别型号'
          : 'No model field: read from the title during review',
        tone: 'text-amber-700',
      };
    }
    if (draft.match_status === 'matched_exact') {
      return {
        text: zh ? '已在售：先确认是否重复' : 'Already listed: confirm first',
        tone: 'text-amber-700',
      };
    }
    if (draft.status === 'failed') {
      return { text: zh ? '导入失败，打开详情查看原因' : 'Import failed', tone: 'text-red-700' };
    }
    return {
      text: zh ? '可审核：勾选后点「审核选中的」' : 'Reviewable: run AI review',
      tone: 'text-gray-600',
    };
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Tabs live above the header so switching views is always possible,
            even when the drafts list is still loading or empty. */}
        <div className="flex gap-1 border-b border-gray-200" role="tablist">
          {([
            { id: 'drafts', label: locale === 'zh' ? '采集草稿' : 'Drafts' },
            { id: 'market', label: locale === 'zh' ? '市场调研 / 价格' : 'Market & Pricing' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => updateParams({ tab: tab.id === 'drafts' ? undefined : tab.id, page: 1 })}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'market' && <EbayMarketPanel />}

        {activeTab === 'drafts' && (
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
              {jsonUploadPending ? '文件分片上传中...' : '创建后台 JSON 导入任务'}
            </button>
            <button
              onClick={() => {
                if (window.confirm('只恢复产品已被删除、但草稿仍标记为已上架的记录，继续吗？')) reopenOrphanedMutation.mutate();
              }}
              disabled={reopenOrphanedMutation.isPending}
              className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {reopenOrphanedMutation.isPending ? '恢复中...' : '恢复已删除产品草稿'}
            </button>
            <button
              onClick={handleBulkRecheck}
              disabled={bulkRecheckMutation.isPending || selectedIds.length === 0}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <ArrowPathIcon className="mr-2 h-4 w-4" />
              {locale === 'zh' ? '批量重检' : 'Bulk Recheck'}
            </button>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} disabled={isTaskRunning || bulkConfirmMutation.isPending} />{locale === 'zh' ? '上架时使用来源图片' : 'Use source images'}</label>
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
              disabled={
                bulkDeleteMutation.isPending || bulkDeleteAllMutation.isPending || selectedIds.length === 0
              }
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-7">
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
                <option value="skipped">{locale === 'zh' ? '已跳过' : 'Skipped'}</option>
                <option value="reviewed">{locale === 'zh' ? '已复核' : 'Reviewed'}</option>
                <option value="confirmed">{locale === 'zh' ? '已确认' : 'Confirmed'}</option>
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
              <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? 'AI 审核' : 'AI Review'}</label>
              <select
                value={aiReviewStatus}
                onChange={(e) => updateParams({ ai_review_status: e.target.value, page: 1 })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">{locale === 'zh' ? '全部' : 'All'}</option>
                <option value="ready">{locale === 'zh' ? '待批准' : 'Ready to approve'}</option>
                <option value="queued">{locale === 'zh' ? '排队中' : 'Queued'}</option>
                <option value="processing">{locale === 'zh' ? '处理中' : 'Processing'}</option>
                <option value="approved">{locale === 'zh' ? '已批准' : 'Approved'}</option>
                <option value="rejected">{locale === 'zh' ? '已跳过' : 'Rejected'}</option>
                <option value="failed">{locale === 'zh' ? '失败' : 'Failed'}</option>
                <option value="unreviewed">{locale === 'zh' ? '未审核' : 'Not reviewed'}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{locale === 'zh' ? '来源站点' : 'Source site'}</label>
              <select
                value={sourceSite}
                onChange={(e) => updateParams({ source_site: e.target.value, page: 1 })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">{locale === 'zh' ? '全部来源' : 'All sources'}</option>
                <option value="ebay">eBay</option>
                <option value="b-automationservice">B-Automation</option>
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
              <span>正在分片上传 JSON；网络中断后重新选择同一文件即可从服务器进度继续。</span>
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
                    {jsonImportTask.status === 'uploading'
                      ? `文件上传中：${(jsonImportTask.uploaded_bytes || 0).toLocaleString()} / ${(jsonImportTask.file_size || 0).toLocaleString()} 字节`
                      : jsonImportTask.status === 'queued'
                      ? '等待后台处理'
                      : jsonImportTask.status === 'processing'
                        ? `处理中：新增 ${jsonImportTask.created}，跳过重复 ${jsonImportTask.skipped}，失败 ${jsonImportTask.failed}`
                        : jsonImportTask.status === 'paused'
                          ? `已暂停：新增 ${jsonImportTask.created}，跳过重复 ${jsonImportTask.skipped}，失败 ${jsonImportTask.failed}`
                          : jsonImportTask.status === 'completed' || jsonImportTask.status === 'completed_with_errors'
                            ? `已完成：新增 ${jsonImportTask.created}，跳过重复 ${jsonImportTask.skipped}，失败 ${jsonImportTask.failed}`
                            : `任务失败：${jsonImportTask.message || jsonImportTask.error || '未知错误'}`}
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
              {(jsonImportTask?.status === 'uploading' || jsonImportTask?.status === 'queued' || jsonImportTask?.status === 'processing' || jsonImportTask?.status === 'paused') && (
                <button
                  type="button"
                  onClick={() => void cancelJSONImportTask()}
                  disabled={jsonTaskControlPending}
                  className="inline-flex items-center rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  取消任务
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
                  style={{ width: `${Math.max(jsonImportTask.status === 'completed' || jsonImportTask.status === 'completed_with_errors' ? 100 : 2, Math.min(100, jsonImportTask.progress_pct || 0))}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-blue-800">
                已处理 {jsonImportTask.processed} 条 · 最后更新 {new Date(jsonImportTask.updated_at).toLocaleString()}。上传完成后关闭或刷新网页不会终止后台任务。
              </p>

              {/* The backend captures per-row failures but the UI only ever
                  showed a percentage, so a failed import looked like it was
                  still running. Render the reasons instead. */}
              {jsonImportTask.error && (
                <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
                  任务错误：{jsonImportTask.error}
                </p>
              )}
              {(jsonImportTask.errors?.length ?? 0) > 0 && (
                <details className="mt-2" open={jsonImportTask.status === 'failed'}>
                  <summary className="cursor-pointer text-xs font-medium text-red-800">
                    {jsonImportTask.errors?.length} 条导入失败记录（点击展开）
                  </summary>
                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto rounded bg-slate-900 p-2 font-mono text-xs text-red-300">
                    {jsonImportTask.errors?.map((message, index) => (
                      <li key={`${index}-${message.slice(0, 24)}`} className="break-words">
                        {message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* A run that stays on screen must also be readable afterwards, so
                  the state transitions are kept as a log instead of
                  overwriting a single progress line. */}
              {jsonTaskLog.length > 0 && (
                <details className="mt-2" open>
                  <summary className="cursor-pointer text-xs font-medium text-blue-900">
                    任务日志（{jsonTaskLog.length} 条）
                  </summary>
                  <div className="mt-1 max-h-48 overflow-y-auto rounded bg-slate-900 p-2 font-mono text-xs leading-relaxed">
                    {jsonTaskLog.map((line, index) => (
                      <p
                        key={`${line.at}-${index}`}
                        className={
                          line.level === 'error'
                            ? 'text-red-300'
                            : line.level === 'success'
                              ? 'text-emerald-300'
                              : 'text-slate-300'
                        }
                      >
                        <span className="text-slate-500">
                          {new Date(line.at).toLocaleTimeString('zh-CN', { hour12: false })}{' '}
                        </span>
                        {line.text}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        <AIReviewPanel
          selectedIds={selectedIds}
          filters={{
            search: search.trim(),
            status,
            match_status: matchStatus,
            brand,
            source_site: sourceSite,
            ai_review_status: aiReviewStatus,
          }}
          onApproved={() => {
            setSelectedIds([]);
            setSelectionCoversAll(false);
            queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.all() });
          }}
          onReviewFinished={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.ebayImportDrafts.all() });
          }}
        />

        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              {locale === 'zh' ? '处理流程：' : 'Workflow:'}
            </span>
            {WORKFLOW_STEPS.map((step) => {
              const active = workflowStepActive(step);
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => updateParams(step.params)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {locale === 'zh' ? step.zh : step.en}
                </button>
              );
            })}
            <span className="text-xs text-gray-500">
              {locale === 'zh'
                ? '选阶段 → 勾选草稿 → 用右侧按钮审核 / 上架 / 删除'
                : 'Pick a stage, tick drafts, then run an action'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
          <p className="text-sm text-blue-900" role="status" aria-live="polite">
            {locale === 'zh' ? `已选择 ${selectedIds.length} 条草稿` : `${selectedIds.length} draft(s) selected`}
            {allDraftsSelected &&
              (locale === 'zh'
                ? `（本筛选共 ${total} 条，删除会整批生效）`
                : ` (all ${total} matching drafts; delete applies to all of them)`)}
          </p>
          <label className="flex items-center gap-2 text-sm text-blue-900">
            <span>{locale === 'zh' ? '每页显示' : 'Rows per page'}</span>
            <select
              value={pageSize}
              onChange={(event) => updateParams({ page_size: Number(event.target.value) })}
              className="rounded border border-blue-200 bg-white px-2 py-1 text-sm"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
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
              onClick={() => { setSelectedIds([]); setSelectionCoversAll(false); }}
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
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '本站分类' : 'Site Category'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">eBay {locale === 'zh' ? '分类' : 'Category'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">B-Automation {locale === 'zh' ? '分类' : 'Category'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '匹配' : 'Match'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '状态' : 'Status'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{locale === 'zh' ? '下一步' : 'Next Step'}</th>
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
                        <div className="font-medium text-gray-900">{draftDisplayTitle(draft) || '-'}</div>
                        {hasReadyDraftReview(draft) && (
                          <div className="mt-1 text-xs text-emerald-700">{locale === 'zh' ? 'AI 已优化 · 待手动上架' : 'AI optimized · awaiting publishing'}</div>
                        )}
                        {hasReadyDraftReview(draft) && draft.title_raw !== draft.proposed_name && (
                          <div className="mt-1 max-w-[360px] truncate text-xs text-gray-400" title={draft.title_raw}>{locale === 'zh' ? '原标题：' : 'Original: '}{draft.title_raw}</div>
                        )}
                        <div className="mt-1 max-w-[320px] truncate text-gray-500">{draft.source_url || '-'}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        <div>{(hasReadyDraftReview(draft) ? draft.proposed_brand : '') || draft.normalized_brand || '-'}</div>
                        <div className="text-gray-500">{(hasReadyDraftReview(draft) ? draft.proposed_model : '') || draft.normalized_model || draft.normalized_part_number || draft.normalized_mpn || '-'}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        {/* Only a draft that matched a category has a site category. When it
                            did not, this cell used to print the *source* site's wording
                            unlabelled, which is how eBay's taxonomy and the BAS collection got
                            mixed up; that wording now lives in its own column. */}
                        <div>{siteCategoryName(draft) || (locale === 'zh' ? '未归类' : 'Unassigned')}</div>
                        <div className="text-xs text-gray-500">
                          {hasReadyDraftReview(draft)
                            ? (draft.proposed_category_created ? (locale === 'zh' ? 'AI 自动新建分类' : 'Created by AI') : (locale === 'zh' ? 'AI 已匹配分类' : 'Matched by AI'))
                            : draft.taxonomy_status}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        {/* eBay owns this column; BAS rows never receive an eBay picker. */}
                        {draft.ebay_category || isEbaySourceDraft(draft) ? (
                          <div className="max-w-[260px] break-words">
                            <span className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">eBay</span>
                            {isDraftCategoryReadOnly(draft) ? (
                              <span className="align-middle">{draft.ebay_category || '-'}</span>
                            ) : (
                              renderEbayCategoryPicker(draft)
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        {/* B-Automation owns this column; it is never displayed as eBay. */}
                        {draft.bas_category ? (
                          <div className="max-w-[260px] break-words">
                            <span className="mr-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-700">BAS</span>
                            <span className="align-middle">{draft.bas_category}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        <div>{renderMatchStatus(draft)}</div>
                        {draft.matched_product && (
                          <div className="mt-1 text-xs text-gray-500">
                            #{draft.matched_product.id} · {draft.matched_product.sku}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        <div>{renderStatus(draft)}</div>
                        {draft.ai_review_status === 'ready' && (
                          <div className="mt-1">
                            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800">
                              待批准
                            </span>
                          </div>
                        )}
                        {draft.ai_review_status === 'queued' || draft.ai_review_status === 'processing' ? (
                          <div className="mt-1 text-xs text-indigo-700">AI 审核中…</div>
                        ) : null}
                        {draft.ai_review_status === 'rejected' && draft.ai_review_error && (
                          <div className="mt-1 max-w-[220px] text-xs text-amber-700">
                            AI 跳过：{draft.ai_review_error}
                          </div>
                        )}
                        {draft.ai_review_status === 'failed' && draft.ai_review_error && (
                          <div className="mt-1 max-w-[220px] text-xs text-red-700">
                            AI 失败：{draft.ai_review_error}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm">
                        {(() => {
                          const hint = nextStepHint(draft);
                          return <span className={hint.tone}>{hint.text}</span>;
                        })()}
                      </td>
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
