'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  DocumentMagnifyingGlassIcon,
  MagnifyingGlassCircleIcon,
  PencilSquareIcon,
  RocketLaunchIcon,
  SparklesIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { CategoryService, ProductService } from '@/services';
import type { CategoryCleanupOptions, CategoryCleanupPlan, CategoryCleanupResult } from '@/services/category.service';
import type { ProductClassificationAudit, ProductClassificationIssue, ProductTitleProposal, ProductTitleStandardizationResult } from '@/services/product.service';
import { AIAgentService } from '@/services/ai-agent.service';
import type { ProductSEOAudit, ProductSEOIssueSample } from '@/services/ai-agent.service';
import { queryKeys } from '@/lib/react-query';
import { useAdminI18n } from '@/lib/admin-i18n';
import { useAuth } from '@/hooks/useAuth';

function errorText(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function CategoryAIToolsPanel() {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [cleanupOptions, setCleanupOptions] = useState<Required<CategoryCleanupOptions>>({
    merge_duplicates: true,
    delete_empty: true,
    delete_empty_active: false,
  });
  const [cleanupPlan, setCleanupPlan] = useState<CategoryCleanupPlan | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CategoryCleanupResult | null>(null);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [previewingCleanup, setPreviewingCleanup] = useState(false);
  const [applyingCleanup, setApplyingCleanup] = useState(false);

  const [startingClassifyJob, setStartingClassifyJob] = useState(false);

  const [audit, setAudit] = useState<ProductClassificationAudit | null>(null);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [startingRework, setStartingRework] = useState(false);

  const [seoAudit, setSeoAudit] = useState<ProductSEOAudit | null>(null);
  const [seoAuditModalOpen, setSeoAuditModalOpen] = useState(false);
  const [seoAuditing, setSeoAuditing] = useState(false);
  const [startingSeoFix, setStartingSeoFix] = useState(false);

  const [categorySeoRunning, setCategorySeoRunning] = useState(false);
  const [categorySeoProgress, setCategorySeoProgress] = useState<{ processed: number; updated: number } | null>(null);

  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [titlePreview, setTitlePreview] = useState<ProductTitleStandardizationResult | null>(null);
  const [previewingTitles, setPreviewingTitles] = useState(false);
  const [applyingTitles, setApplyingTitles] = useState(false);
  const [titleProgress, setTitleProgress] = useState<{ updated: number; processed: number } | null>(null);

  const invalidateCategoryData = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.categories.lists() });
    queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree() });
    queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
  };

  const previewCleanup = async () => {
    setPreviewingCleanup(true);
    setCleanupResult(null);
    try {
      const plan = await CategoryService.previewCleanup(cleanupOptions);
      setCleanupPlan(plan);
      setCleanupModalOpen(true);
      if (plan.merges.length === 0 && plan.deletions.length === 0) {
        toast.success(zh ? '没有发现重复或空分类，分类树很干净！' : 'No duplicate or empty categories found — the tree is clean!');
      }
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '分类检查失败' : 'Category scan failed'));
    } finally {
      setPreviewingCleanup(false);
    }
  };

  const applyCleanup = async () => {
    if (!cleanupPlan) return;
    const summary = zh
      ? `确认执行清理？将合并 ${cleanupPlan.merges.length} 个重复分类、删除 ${cleanupPlan.deletions.length} 个空分类。产品会被移动到保留的分类，此操作不可撤销。`
      : `Apply cleanup? ${cleanupPlan.merges.length} duplicates will be merged and ${cleanupPlan.deletions.length} empty categories deleted. Products move to the surviving category; this cannot be undone.`;
    if (!window.confirm(summary)) return;
    setApplyingCleanup(true);
    try {
      const result = await CategoryService.applyCleanup(cleanupOptions);
      setCleanupResult(result);
      setCleanupPlan(result.plan);
      invalidateCategoryData();
      toast.success(zh
        ? `清理完成：合并 ${result.merged_count} 个、删除 ${result.deleted_count} 个分类，移动 ${result.moved_products} 个产品`
        : `Cleanup done: ${result.merged_count} merged, ${result.deleted_count} deleted, ${result.moved_products} products moved`);
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '分类清理失败' : 'Category cleanup failed'));
    } finally {
      setApplyingCleanup(false);
    }
  };

  const startClassificationJob = async () => {
    const message = zh
      ? '启动 AI 智能分类后台任务？系统会按品牌/型号规则并结合官方资料联网核验，为产品匹配或创建规范的「品牌 > 类型」分类，无法核验的产品保留原分类并标记待审核。'
      : 'Start the AI classification background job? Products are verified against brand/model rules plus official web sources and moved into canonical "Brand > Type" categories; uncertain results retain their original category for review.';
    if (!window.confirm(message)) return;
    setStartingClassifyJob(true);
    try {
      const job = await AIAgentService.startCategoryOptimizationJob({
        limit: 0,
        status: 'all',
        include_inactive: true,
        use_web_search: true,
        create_missing_categories: true,
        activate_resolved: true,
        use_llm_fallback: true,
      });
      toast.success(zh
        ? `智能分类任务已启动（${job.total} 个产品），可到 AI SEO 页面查看进度`
        : `Classification job started for ${job.total} products — track it on the AI SEO page`);
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '无法启动智能分类任务' : 'Could not start the classification job'));
    } finally {
      setStartingClassifyJob(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    try {
      const result = await ProductService.auditClassification();
      setAudit(result);
      setAuditModalOpen(true);
      if (result.product_ids.length === 0) {
        toast.success(zh ? '没有发现分类或描述需要返工的产品！' : 'No product classifications or descriptions need rework!');
      }
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '返工检测失败' : 'Rework audit failed'));
    } finally {
      setAuditing(false);
    }
  };

  const startReworkJob = async () => {
    
    const message = zh
      ? `启动综合返工任务？将对 全部未占用的产品（包括规则检查通过的产品）先重新核验分类，再检测产品描述；缺失、单薄、型号/品牌不一致或重复的描述会由 AI 重写。无法核验时保留原数据并标记待审核。`
      : `Start the combined rework job? all available products, including those passing rule checks, will be reclassified first, then weak, missing, repetitive, or inconsistent descriptions will be rewritten by AI. Uncertain products retain their original data for review.`;
    if (!window.confirm(message)) return;
    setStartingRework(true);
    try {
      const job = await AIAgentService.startCategoryOptimizationJob({
        rework_only: true,
        limit: 0,
        status: 'all',
        include_inactive: true,
        use_web_search: true,
        create_missing_categories: true,
        activate_resolved: true,
        use_llm_fallback: true,
        repair_content: true,
      });
      setAuditModalOpen(false);
      toast.success(zh
        ? `返工任务已启动（${job.total} 个产品），可到 AI SEO 页面查看进度`
        : `Rework job started for ${job.total} products — track it on the AI SEO page`);
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '无法启动返工任务' : 'Could not start the rework job'));
    } finally {
      setStartingRework(false);
    }
  };

  const previewTitles = async () => {
    setPreviewingTitles(true);
    setTitleProgress(null);
    try {
      const result = await ProductService.standardizeTitles({ limit: 100, include_inactive: true });
      setTitlePreview(result);
      setTitleModalOpen(true);
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '标题预览失败' : 'Title preview failed'));
    } finally {
      setPreviewingTitles(false);
    }
  };

  const applyTitles = async () => {
    const message = zh
      ? '将所有可核验产品的标题统一为「品牌 型号 类型」格式？只有品牌和类型都验证通过的产品才会被重命名，URL 不受影响。'
      : 'Rename all verifiable products to the "Brand Model Type" format? Only products with a verified brand and type are renamed; URLs are unchanged.';
    if (!window.confirm(message)) return;
    setApplyingTitles(true);
    setTitleProgress({ updated: 0, processed: 0 });
    try {
      let afterId = 0;
      let updated = 0;
      let processed = 0;
      // The endpoint pages through the catalog; keep requesting batches until
      // it reports no further products.
      for (let batch = 0; batch < 200; batch++) {
        const result = await ProductService.standardizeTitles({
          limit: 500,
          include_inactive: true,
          after_id: afterId,
          apply: true,
        });
        updated += result.updated;
        processed += result.processed;
        setTitleProgress({ updated, processed });
        if (!result.has_more || !result.next_after_id || result.next_after_id <= afterId) break;
        afterId = result.next_after_id;
      }
      invalidateCategoryData();
      toast.success(zh
        ? `标题规范化完成：检查 ${processed} 个产品，重命名 ${updated} 个`
        : `Title standardization done: ${processed} checked, ${updated} renamed`);
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '标题规范化失败' : 'Title standardization failed'));
    } finally {
      setApplyingTitles(false);
    }
  };

  const runSeoAudit = async () => {
    setSeoAuditing(true);
    try {
      const result = await AIAgentService.auditSEO();
      setSeoAudit(result);
      setSeoAuditModalOpen(true);
      if (result.product_ids.length === 0) {
        toast.success(zh ? '所有上架产品的 SEO 都是健康的！' : 'Every active product has healthy SEO!');
      }
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? 'SEO 体检失败' : 'SEO audit failed'));
    } finally {
      setSeoAuditing(false);
    }
  };

  const startSeoAutoFix = async () => {
    if (!seoAudit || seoAudit.product_ids.length === 0) return;
    const message = zh
      ? `一键修复 ${seoAudit.product_ids.length.toLocaleString()} 个产品的 SEO？AI 会按已验证的品牌、型号和当前分类重写 SEO 标题和描述，清除按旧分类名生成的陈旧内容。`
      : `Fix SEO for ${seoAudit.product_ids.length.toLocaleString()} products? The AI rewrites titles and metadata from the verified brand, model, and current category, replacing stale content generated from old category names.`;
    if (!window.confirm(message)) return;
    setStartingSeoFix(true);
    try {
      const result = await AIAgentService.startSEOAutoFix(['seo']);
      setSeoAuditModalOpen(false);
      toast.success(zh
        ? `一键 SEO 修复任务已启动（${result.job.total.toLocaleString()} 个产品），可到 AI SEO 页面查看进度`
        : `One-click SEO fix started for ${result.job.total.toLocaleString()} products — track it on the AI SEO page`);
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '无法启动 SEO 修复任务' : 'Could not start the SEO fix job'));
    } finally {
      setStartingSeoFix(false);
    }
  };

  const runCategorySeo = async () => {
    const message = zh
      ? '为所有描述缺失或过于简单的分类生成 SEO 描述？AI 会按「品牌 + 类型 + 示例型号」为每个分类页写 2-3 句自然的介绍文案，已有完整描述的分类会跳过。'
      : 'Generate SEO descriptions for categories with missing or thin descriptions? The AI writes 2-3 natural sentences per category page from the brand, type, and sample models; complete descriptions are kept.';
    if (!window.confirm(message)) return;
    setCategorySeoRunning(true);
    setCategorySeoProgress({ processed: 0, updated: 0 });
    try {
      let afterId = 0;
      let processed = 0;
      let updated = 0;
      for (let batch = 0; batch < 300; batch++) {
        const result = await AIAgentService.optimizeCategorySEO({ limit: 8, after_id: afterId });
        processed += result.processed;
        updated += result.updated;
        setCategorySeoProgress({ processed, updated });
        if (!result.has_more || !result.next_after_id || result.next_after_id <= afterId) break;
        afterId = result.next_after_id;
      }
      invalidateCategoryData();
      toast.success(zh
        ? `分类 SEO 完成：检查 ${processed} 个分类，更新 ${updated} 个描述`
        : `Category SEO done: ${processed} categories checked, ${updated} descriptions updated`);
    } catch (error: unknown) {
      toast.error(errorText(error, zh ? '分类 SEO 生成失败' : 'Category SEO generation failed'));
    } finally {
      setCategorySeoRunning(false);
    }
  };

  const statusBadge = (proposal: ProductTitleProposal) => {
    const map: Record<string, string> = {
      ready: 'bg-blue-100 text-blue-700',
      updated: 'bg-emerald-100 text-emerald-700',
      skipped: 'bg-gray-100 text-gray-600',
      unresolved: 'bg-amber-100 text-amber-700',
      failed: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, [string, string]> = {
      ready: ['可重命名', 'Ready'],
      updated: ['已更新', 'Updated'],
      skipped: ['已规范', 'OK'],
      unresolved: ['无法核验', 'Unverified'],
      failed: ['失败', 'Failed'],
    };
    const [zhLabel, enLabel] = labels[proposal.status] || [proposal.status, proposal.status];
    return (
      <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[proposal.status] || 'bg-gray-100 text-gray-600'}`}>
        {zh ? zhLabel : enLabel}
      </span>
    );
  };

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="flex items-start gap-3 border-b border-gray-200 px-6 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <SparklesIcon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{zh ? 'AI 智能整理' : 'AI taxonomy tools'}</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {zh
              ? '自动合并重复分类、删除空分类，按「品牌 > 类型」规则智能分类产品，并统一产品标题格式。'
              : 'Merge duplicate categories, remove empty ones, classify products into "Brand > Type" nodes, and standardize product titles.'}
          </p>
        </div>
      </div>
      {!isAdmin && (
        <p className="border-b border-amber-100 bg-amber-50 px-6 py-2.5 text-xs text-amber-800">
          {zh ? '以下操作需要管理员权限。' : 'These actions require administrator access.'}
        </p>
      )}

      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        {/* Cleanup card */}
        <div className="flex flex-col rounded-lg border border-gray-200 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <TrashIcon className="h-4 w-4 text-red-500" />
            {zh ? '清理混乱分类' : 'Clean up categories'}
          </h3>
          <p className="mt-1 flex-1 text-xs leading-5 text-gray-500">
            {zh
              ? '合并同级重复分类（如 “Servo Drive” 与 “Servo Drives”），产品自动移入保留的分类；删除整棵无产品的空分类。'
              : 'Merges duplicate siblings (e.g. "Servo Drive" vs "Servo Drives") moving products into the survivor, and deletes empty subtrees.'}
          </p>
          <div className="mt-3 space-y-1.5 text-xs text-gray-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={cleanupOptions.merge_duplicates} onChange={(event) => setCleanupOptions((current) => ({ ...current, merge_duplicates: event.target.checked }))} className="rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
              {zh ? '合并重复分类' : 'Merge duplicates'}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={cleanupOptions.delete_empty} onChange={(event) => setCleanupOptions((current) => ({ ...current, delete_empty: event.target.checked }))} className="rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
              {zh ? '删除隐藏的空分类' : 'Delete hidden empty categories'}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={cleanupOptions.delete_empty_active} disabled={!cleanupOptions.delete_empty} onChange={(event) => setCleanupOptions((current) => ({ ...current, delete_empty_active: event.target.checked }))} className="rounded border-gray-300 text-violet-600 focus:ring-violet-500 disabled:opacity-40" />
              {zh ? '空分类即使前台可见也删除' : 'Also delete visible empty categories'}
            </label>
          </div>
          <button
            onClick={previewCleanup}
            disabled={!isAdmin || previewingCleanup || (!cleanupOptions.merge_duplicates && !cleanupOptions.delete_empty)}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewingCleanup ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <DocumentMagnifyingGlassIcon className="h-4 w-4" />}
            {zh ? '扫描并预览' : 'Scan & preview'}
          </button>
        </div>

        {/* Classification job card */}
        <div className="flex flex-col rounded-lg border border-gray-200 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <SparklesIcon className="h-4 w-4 text-violet-600" />
            {zh ? 'AI 智能分类产品' : 'AI product classification'}
          </h3>
          <p className="mt-1 flex-1 text-xs leading-5 text-gray-500">
            {zh
              ? '后台任务按品牌/型号规则分类全部产品，未识别的型号先联网核验官方资料，再由配置的 AI 兜底识别（任何品牌都能分类）；只在核验通过时创建「品牌 > 类型」分类，绝不重复建类。'
              : 'A background job classifies every product by brand/model rules, then official-source web verification, then the configured AI as a fallback (any brand works). "Brand > Type" nodes are created only when verified — never duplicates.'}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              onClick={startClassificationJob}
              disabled={!isAdmin || startingClassifyJob}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startingClassifyJob ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
              {zh ? '启动智能分类任务' : 'Start classification job'}
            </button>
            <Link href="/admin/ai-seo" className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900">
              {zh ? '查看任务进度' : 'View job progress'}
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Rework audit card */}
        <div className="flex flex-col rounded-lg border border-gray-200 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <WrenchScrewdriverIcon className="h-4 w-4 text-amber-600" />
            {zh ? 'AI 返工检测' : 'AI rework audit'}
          </h3>
          <p className="mt-1 flex-1 text-xs leading-5 text-gray-500">
            {zh
              ? '扫描全部产品的分类与描述质量；逐项调用 AI 核验分类、名称、简介、描述和 SEO，不限总量；无法核验则保留原数据待审核。'
              : 'Scans classification and description quality. Category problems are reverified, while missing, thin, inconsistent, or repetitive descriptions are rewritten by AI.'}
          </p>
          <button
            onClick={startReworkJob}
            disabled={!isAdmin || auditing || startingRework}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {auditing ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <DocumentMagnifyingGlassIcon className="h-4 w-4" />}
            {zh ? '全量 AI 检测并返工' : 'Full AI audit and repair'}
          </button>
        </div>

        <button type="button" onClick={runAudit} disabled={auditing || !isAdmin} className="text-sm text-gray-600 underline">{zh ? '仅规则预检（不调用 AI）' : 'Rules preview only (no AI request)'}</button>

        {/* Title standardization card */}
        <div className="flex flex-col rounded-lg border border-gray-200 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <PencilSquareIcon className="h-4 w-4 text-blue-600" />
            {zh ? '统一产品标题' : 'Standardize product titles'}
          </h3>
          <p className="mt-1 flex-1 text-xs leading-5 text-gray-500">
            {zh
              ? '将产品标题统一为「品牌 型号 类型」，例如 “FANUC A06B-6114-H105 Servo Amplifier”。仅重命名品牌与类型均核验通过的产品，URL 保持不变。'
              : 'Renames products to "Brand Model Type", e.g. "FANUC A06B-6114-H105 Servo Amplifier". Only verified products are renamed; URLs are unchanged.'}
          </p>
          {titleProgress && (
            <p className="mt-2 text-xs font-medium text-blue-700">
              {zh ? `进度：已检查 ${titleProgress.processed}，已重命名 ${titleProgress.updated}` : `Progress: ${titleProgress.processed} checked, ${titleProgress.updated} renamed`}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={previewTitles}
              disabled={!isAdmin || previewingTitles || applyingTitles}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewingTitles ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <DocumentMagnifyingGlassIcon className="h-4 w-4" />}
              {zh ? '预览' : 'Preview'}
            </button>
            <button
              onClick={applyTitles}
              disabled={!isAdmin || applyingTitles || previewingTitles}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applyingTitles ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
              {zh ? '全部应用' : 'Apply all'}
            </button>
          </div>
        </div>

        {/* One-click SEO audit & fix card */}
        <div className="flex flex-col rounded-lg border border-gray-200 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <RocketLaunchIcon className="h-4 w-4 text-emerald-600" />
            {zh ? '一键 SEO 体检修复' : 'One-click SEO fix'}
          </h3>
          <p className="mt-1 flex-1 text-xs leading-5 text-gray-500">
            {zh
              ? '自动识别 SEO 没优化好的产品：缺少 SEO、上次失败、标题按旧分类名生成、写错品牌、标题缺型号、从未 AI 优化，一键全部重新优化。'
              : 'Auto-detects products with broken SEO — missing metadata, failed runs, titles built from old category names, wrong brand, missing model, or never optimized — and fixes them in one job.'}
          </p>
          <button
            onClick={runSeoAudit}
            disabled={seoAuditing || startingSeoFix}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {seoAuditing ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <MagnifyingGlassCircleIcon className="h-4 w-4" />}
            {zh ? 'SEO 体检' : 'Run SEO audit'}
          </button>
        </div>

        {/* Category SEO descriptions card */}
        <div className="flex flex-col rounded-lg border border-gray-200 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <DocumentMagnifyingGlassIcon className="h-4 w-4 text-teal-600" />
            {zh ? '分类页 SEO 描述' : 'Category page SEO'}
          </h3>
          <p className="mt-1 flex-1 text-xs leading-5 text-gray-500">
            {zh
              ? '为描述缺失或过于简单的分类页批量生成 SEO 介绍文案（品牌 + 类型 + 示例型号），已有完整描述的分类保持不变。'
              : 'Batch-writes SEO descriptions for category pages with missing or thin copy, built from the brand, type, and sample models. Complete descriptions are kept.'}
          </p>
          {categorySeoProgress && (
            <p className="mt-2 text-xs font-medium text-teal-700">
              {zh ? `进度：已检查 ${categorySeoProgress.processed}，已更新 ${categorySeoProgress.updated}` : `Progress: ${categorySeoProgress.processed} checked, ${categorySeoProgress.updated} updated`}
            </p>
          )}
          <button
            onClick={runCategorySeo}
            disabled={!isAdmin || categorySeoRunning}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {categorySeoRunning ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
            {zh ? '生成分类描述' : 'Generate descriptions'}
          </button>
        </div>
      </div>

      {/* Cleanup preview modal */}
      {cleanupModalOpen && cleanupPlan ? (
        <div className="fixed inset-0 z-[70] overflow-y-auto" role="dialog" aria-modal="true">
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <div className="fixed inset-0 bg-gray-900/60" onClick={() => !applyingCleanup && setCleanupModalOpen(false)} />
            <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{zh ? '分类清理预览' : 'Cleanup preview'}</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {zh
                      ? `共 ${cleanupPlan.total_categories} 个分类：${cleanupPlan.merges.length} 个重复待合并，${cleanupPlan.deletions.length} 个空分类待删除`
                      : `${cleanupPlan.total_categories} categories: ${cleanupPlan.merges.length} duplicates to merge, ${cleanupPlan.deletions.length} empty to delete`}
                  </p>
                </div>
                <button onClick={() => setCleanupModalOpen(false)} disabled={applyingCleanup} className="rounded-md p-2 text-gray-500 hover:bg-gray-50">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {cleanupResult && (
                  <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
                    {zh
                      ? `已执行：合并 ${cleanupResult.merged_count} 个、删除 ${cleanupResult.deleted_count} 个，移动 ${cleanupResult.moved_products} 个产品。`
                      : `Applied: ${cleanupResult.merged_count} merged, ${cleanupResult.deleted_count} deleted, ${cleanupResult.moved_products} products moved.`}
                  </div>
                )}
                {cleanupPlan.merges.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{zh ? '将合并的重复分类' : 'Duplicates to merge'}</h3>
                    <div className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                      {cleanupPlan.merges.map((merge) => (
                        <div key={`${merge.source_id}-${merge.target_id}`} className="px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center gap-1.5 text-gray-800">
                            <span className="font-medium text-red-700 line-through decoration-red-300">{merge.source_path}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-medium text-emerald-700">{merge.target_path}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            {zh
                              ? `${merge.product_count} 个产品、${merge.child_count} 个子分类将移入保留的分类（${merge.reason === 'duplicate slug' ? '重复链接' : '重复名称'}）`
                              : `${merge.product_count} products and ${merge.child_count} children move to the survivor (${merge.reason})`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {cleanupPlan.deletions.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{zh ? '将删除的空分类' : 'Empty categories to delete'}</h3>
                    <div className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                      {cleanupPlan.deletions.map((deletion) => (
                        <div key={deletion.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate text-gray-800">{deletion.path}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${deletion.is_active ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                            {deletion.is_active ? (zh ? '前台可见' : 'Visible') : (zh ? '已隐藏' : 'Hidden')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {cleanupPlan.merges.length === 0 && cleanupPlan.deletions.length === 0 && (
                  <p className="rounded-md bg-green-50 p-4 text-sm text-green-700">
                    {zh ? '没有发现需要清理的分类，分类树已经很干净。' : 'Nothing to clean up — the category tree is already tidy.'}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button onClick={() => setCleanupModalOpen(false)} disabled={applyingCleanup} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {zh ? '关闭' : 'Close'}
                </button>
                {(cleanupPlan.merges.length > 0 || cleanupPlan.deletions.length > 0) && !cleanupResult && (
                  <button onClick={applyCleanup} disabled={applyingCleanup} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {applyingCleanup ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <TrashIcon className="h-4 w-4" />}
                    {applyingCleanup ? (zh ? '正在清理…' : 'Cleaning…') : (zh ? '确认执行清理' : 'Apply cleanup')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Title standardization preview modal */}
      {titleModalOpen && titlePreview ? (
        <div className="fixed inset-0 z-[70] overflow-y-auto" role="dialog" aria-modal="true">
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <div className="fixed inset-0 bg-gray-900/60" onClick={() => setTitleModalOpen(false)} />
            <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{zh ? '标题规范化预览（前 100 个）' : 'Title preview (first 100)'}</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {zh
                      ? `${titlePreview.ready} 个可重命名 · ${titlePreview.skipped} 个已规范 · ${titlePreview.unresolved} 个无法核验${titlePreview.has_more ? '（还有更多产品未显示）' : ''}`
                      : `${titlePreview.ready} ready · ${titlePreview.skipped} already OK · ${titlePreview.unresolved} unverified${titlePreview.has_more ? ' (more not shown)' : ''}`}
                  </p>
                </div>
                <button onClick={() => setTitleModalOpen(false)} className="rounded-md p-2 text-gray-500 hover:bg-gray-50">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
                  {titlePreview.results.map((proposal) => (
                    <div key={proposal.product_id} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-mono text-xs text-gray-500">{proposal.sku}</span>
                        {statusBadge(proposal)}
                      </div>
                      <div className="mt-1 text-gray-800">
                        {proposal.status === 'ready' || proposal.status === 'updated' ? (
                          <>
                            <span className="text-gray-400 line-through">{proposal.old_name}</span>
                            <span className="mx-1.5 text-gray-400">→</span>
                            <span className="font-medium text-emerald-700">{proposal.new_name}</span>
                          </>
                        ) : (
                          <>
                            <span>{proposal.old_name}</span>
                            {proposal.message ? <span className="ml-2 text-xs text-gray-500">（{proposal.message}）</span> : null}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button onClick={() => setTitleModalOpen(false)} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  {zh ? '关闭' : 'Close'}
                </button>
                <button
                  onClick={() => { setTitleModalOpen(false); applyTitles(); }}
                  disabled={applyingTitles}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <CheckCircleIcon className="h-4 w-4" />
                  {zh ? '应用到全部产品' : 'Apply to all products'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {/* Rework audit modal */}
      {auditModalOpen && audit ? (
        <div className="fixed inset-0 z-[70] overflow-y-auto" role="dialog" aria-modal="true">
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <div className="fixed inset-0 bg-gray-900/60" onClick={() => !startingRework && setAuditModalOpen(false)} />
            <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{zh ? '返工检测结果' : 'Rework audit result'}</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {zh
                      ? `扫描 ${audit.scanned.toLocaleString()} 个产品：${audit.ok.toLocaleString()} 个分类与描述正常，${audit.product_ids.length.toLocaleString()} 个需要返工`
                      : `${audit.scanned.toLocaleString()} products scanned: ${audit.ok.toLocaleString()} have healthy classification and content, ${audit.product_ids.length.toLocaleString()} need rework`}
                  </p>
                </div>
                <button onClick={() => setAuditModalOpen(false)} disabled={startingRework} className="rounded-md p-2 text-gray-500 hover:bg-gray-50">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    [zh ? '无分类' : 'Uncategorized', audit.uncategorized],
                    [zh ? '放错分类' : 'Wrong category', audit.wrong_category],
                    [zh ? '挂在根分类' : 'On root category', audit.root_category],
                    [zh ? '杂项分类待整理' : 'In catch-all tree', audit.generic_category],
                    [zh ? '未识别已下架' : 'Unresolved inactive', audit.inactive_unresolved],
                    [zh ? 'SEO 失败' : 'SEO failed', audit.seo_failed],
                    [zh ? '描述问题合计' : 'Content issues', audit.content_issues || 0],
                    [zh ? '描述缺失' : 'Missing descriptions', audit.content_missing || 0],
                    [zh ? '描述单薄' : 'Thin descriptions', audit.content_thin || 0],
                    [zh ? '描述缺型号' : 'Model missing in content', audit.content_model_missing || 0],
                    [zh ? '描述品牌不符' : 'Wrong brand in content', audit.content_brand_mismatch || 0],
                    [zh ? '描述重复' : 'Repetitive content', audit.content_repetitive || 0],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border border-gray-200 p-3">
                      <div className="text-xs text-gray-500">{label}</div>
                      <div className="mt-1 text-xl font-semibold text-gray-900">{Number(value).toLocaleString()}</div>
                    </div>
                  ))}
                </div>

                {audit.samples.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {zh ? `问题示例（最多显示 ${audit.samples.length} 个）` : `Sample issues (${audit.samples.length} shown)`}
                    </h3>
                    <div className="mt-2 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                      {audit.samples.map((sample) => (
                        <div key={sample.product_id} className="px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate font-mono text-xs text-gray-500">{sample.sku}</span>
                            <div className="flex shrink-0 flex-wrap justify-end gap-1">
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{auditIssueLabel(sample.issue, zh)}</span>
                              {sample.content_issue ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">{contentIssueLabel(sample.content_issue, zh)}</span> : null}
                            </div>
                          </div>
                          <div className="mt-0.5 truncate text-gray-800">{sample.name}</div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            {sample.category_path ? `${zh ? '当前分类：' : 'Current: '}${sample.category_path} · ` : ''}{sample.detail}
                            {sample.content_detail ? `${sample.detail ? ' · ' : ''}${sample.content_detail}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-md bg-green-50 p-4 text-sm text-green-700">
                    {zh ? '所有产品的分类与描述质量都验证正常，无需返工。' : 'Every product classification and description checks out — nothing to rework.'}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button onClick={() => setAuditModalOpen(false)} disabled={startingRework} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {zh ? '关闭' : 'Close'}
                </button>
                {audit.product_ids.length > 0 && (
                  <button
                    onClick={startReworkJob}
                    disabled={startingRework}
                    className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {startingRework ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <WrenchScrewdriverIcon className="h-4 w-4" />}
                    {zh ? '启动全量 AI 返工（分类、名称、内容、SEO）' : 'Start full AI rework (category, name, content, SEO)'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {/* SEO audit modal */}
      {seoAuditModalOpen && seoAudit ? (
        <div className="fixed inset-0 z-[70] overflow-y-auto" role="dialog" aria-modal="true">
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <div className="fixed inset-0 bg-gray-900/60" onClick={() => !startingSeoFix && setSeoAuditModalOpen(false)} />
            <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{zh ? 'SEO 体检结果' : 'SEO audit result'}</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {zh
                      ? `检查 ${seoAudit.scanned.toLocaleString()} 个产品：${seoAudit.ok.toLocaleString()} 个健康，${seoAudit.product_ids.length.toLocaleString()} 个需要修复`
                      : `${seoAudit.scanned.toLocaleString()} products checked: ${seoAudit.ok.toLocaleString()} healthy, ${seoAudit.product_ids.length.toLocaleString()} need fixing`}
                  </p>
                </div>
                <button onClick={() => setSeoAuditModalOpen(false)} disabled={startingSeoFix} className="rounded-md p-2 text-gray-500 hover:bg-gray-50">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    [zh ? '缺少 SEO 信息' : 'Missing metadata', seoAudit.missing_meta],
                    [zh ? '旧分类名残留' : 'Stale catch-all wording', seoAudit.generic_meta],
                    [zh ? '标题缺型号' : 'Model missing from title', seoAudit.model_missing],
                    [zh ? '品牌写错' : 'Wrong brand in title', seoAudit.brand_mismatch],
                    [zh ? '上次失败' : 'Failed runs', seoAudit.seo_failed],
                    [zh ? '从未 AI 优化' : 'Never AI-optimized', seoAudit.never_optimized],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border border-gray-200 p-3">
                      <div className="text-xs text-gray-500">{label}</div>
                      <div className="mt-1 text-xl font-semibold text-gray-900">{Number(value).toLocaleString()}</div>
                    </div>
                  ))}
                </div>

                {seoAudit.samples.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {zh ? `问题示例（最多显示 ${seoAudit.samples.length} 个）` : `Sample issues (${seoAudit.samples.length} shown)`}
                    </h3>
                    <div className="mt-2 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                      {seoAudit.samples.map((sample) => (
                        <div key={sample.product_id} className="px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate font-mono text-xs text-gray-500">{sample.sku}</span>
                            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">{seoIssueLabel(sample.issue, zh)}</span>
                          </div>
                          {sample.meta_title ? <div className="mt-0.5 truncate text-gray-800">{sample.meta_title}</div> : null}
                          <div className="mt-0.5 text-xs text-gray-500">{sample.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-md bg-green-50 p-4 text-sm text-green-700">
                    {zh ? '所有上架产品的 SEO 都是健康的，无需修复。' : 'Every active product has healthy SEO — nothing to fix.'}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button onClick={() => setSeoAuditModalOpen(false)} disabled={startingSeoFix} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {zh ? '关闭' : 'Close'}
                </button>
                {seoAudit.product_ids.length > 0 && (
                  <button
                    onClick={startSeoAutoFix}
                    disabled={startingSeoFix}
                    className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {startingSeoFix ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <RocketLaunchIcon className="h-4 w-4" />}
                    {zh ? `一键修复（${seoAudit.product_ids.length.toLocaleString()} 个产品）` : `Fix all (${seoAudit.product_ids.length.toLocaleString()} products)`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function seoIssueLabel(issue: ProductSEOIssueSample['issue'], zh: boolean) {
  const labels: Record<ProductSEOIssueSample['issue'], [string, string]> = {
    seo_failed: ['上次失败', 'Failed run'],
    missing_meta: ['缺少 SEO', 'Missing metadata'],
    never_optimized: ['从未 AI 优化', 'Never optimized'],
    generic_meta: ['旧分类名残留', 'Stale wording'],
    model_missing: ['标题缺型号', 'Model missing'],
    brand_mismatch: ['品牌写错', 'Wrong brand'],
  };
  return labels[issue][zh ? 0 : 1];
}

function auditIssueLabel(issue: ProductClassificationIssue['issue'], zh: boolean) {
  const labels: Record<ProductClassificationIssue['issue'], [string, string]> = {
    uncategorized: ['无分类', 'Uncategorized'],
    wrong_category: ['放错分类', 'Wrong category'],
    root_category: ['挂在根分类', 'On root category'],
    generic_category: ['杂项分类', 'Catch-all tree'],
    inactive_unresolved: ['未识别已下架', 'Unresolved inactive'],
    seo_failed: ['SEO 失败', 'SEO failed'],
    content_only: ['分类正常', 'Category OK'],
  };
  return labels[issue][zh ? 0 : 1];
}

function contentIssueLabel(issue: NonNullable<ProductClassificationIssue['content_issue']>, zh: boolean) {
  const labels: Record<NonNullable<ProductClassificationIssue['content_issue']>, [string, string]> = {
    missing_description: ['描述缺失', 'Missing content'],
    thin_description: ['描述单薄', 'Thin content'],
    description_model_missing: ['描述缺型号', 'Model missing'],
    description_brand_mismatch: ['描述品牌不符', 'Wrong brand'],
    repetitive_description: ['描述重复', 'Repetitive content'],
  };
  return labels[issue][zh ? 0 : 1];
}
