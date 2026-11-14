'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  Bars3Icon,
  EyeIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  Squares2X2Icon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

import AdminLayout from '@/components/admin/AdminLayout';
import { HomepageService } from '@/services';
import type { HomepageContentRequest } from '@/services';
import { queryKeys } from '@/lib/react-query';
import type { HomepageContent } from '@/types';
import { useAdminI18n } from '@/lib/admin-i18n';
import { useAuth } from '@/hooks/useAuth';
import { SortableList } from '@/components/admin/homepage/SortableList';
import VisualEditorCanvas, { type CanvasHandle } from '@/components/admin/homepage/VisualEditorCanvas';
import TemplateLibraryModal from '@/components/admin/homepage/TemplateLibraryModal';
import type { SectionPayload } from '@/components/admin/homepage/section-payload';
import { getTemplateDefinition, readTemplateId, sampleModel, templateModelToPayload, type TemplateId } from '@/lib/section-templates';

import HeroEditor from '@/components/admin/homepage/editors/HeroEditor';
import CompanyStatsEditor from '@/components/admin/homepage/editors/CompanyStatsEditor';
import FeaturedProductsEditor from '@/components/admin/homepage/editors/FeaturedProductsEditor';
import WorkshopEditor from '@/components/admin/homepage/editors/WorkshopEditor';
import ServicesEditor from '@/components/admin/homepage/editors/ServicesEditor';
import SimpleSectionEditor from '@/components/admin/homepage/editors/SimpleSectionEditor';
import BrandCarouselEditor from '@/components/admin/homepage/editors/BrandCarouselEditor';
import TemplateSectionEditor from '@/components/admin/homepage/editors/TemplateSectionEditor';
import PageContentEditor from '@/components/admin/homepage/editors/PageContentEditor';
import { EDITABLE_PAGE_SECTION_KEYS, type EditablePage } from '@/lib/page-content';
import { PAGE_SCHEMAS } from '@/lib/page-content-schema';

// Sections rendered by default even before an admin saves them; mirrors HomePage.tsx.
const PRIMARY_SECTIONS: Array<{ key: string; sort: number; zh: string; en: string }> = [
  { key: 'hero_section', sort: 10, zh: '首屏轮播', en: 'Hero slider' },
  { key: 'brand_carousel', sort: 15, zh: '品牌 Logo 轮播', en: 'Brand logo carousel' },
  { key: 'company_stats', sort: 20, zh: '公司数据', en: 'Company stats' },
  { key: 'featured_products', sort: 30, zh: '推荐产品', en: 'Featured products' },
  { key: 'brands_section', sort: 40, zh: '品牌介绍', en: 'Brands we supply' },
  { key: 'repair_capabilities', sort: 50, zh: '维修能力', en: 'Repair capabilities' },
  { key: 'services_section', sort: 60, zh: '服务', en: 'Services' },
  { key: 'home_blog', sort: 70, zh: '文章', en: 'Featured articles' },
  { key: 'workshop_section', sort: 80, zh: '工厂与车间', en: 'Workshop' },
];
const PREVIEW_SRC = '/?admin_preview=1';
const DRAFT_DEBOUNCE_MS = 450;

type EditorPage = 'home' | EditablePage;
const EDITOR_PAGES: Array<{ key: EditorPage; zh: string; en: string }> = [
  { key: 'home', zh: '首页', en: 'Homepage' },
  { key: 'about', zh: '关于我们', en: 'About' },
  { key: 'contact', zh: '联系我们', en: 'Contact' },
];

type Block = { key: string; id: string; label: string; content: HomepageContent | null; sort: number; active: boolean; primary: boolean };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function AdminHomepageVisualEditor() {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const L = useCallback((z: string, e: string) => (zh ? z : e), [zh]);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();
  const canvasRef = useRef<CanvasHandle>(null);

  const [selectedKey, setSelectedKey] = useState('hero_section');
  const [page, setPage] = useState<EditorPage>('home');
  const [tab, setTab] = useState<'blocks' | 'edit'>('blocks');
  const [mobileView, setMobileView] = useState<'panel' | 'preview'>('panel');
  const [widePanel, setWidePanel] = useState(false);
  const [search, setSearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<Block[] | null>(null);

  const { data: contents = [], isLoading, error } = useQuery({
    queryKey: queryKeys.homepage.adminContents(),
    queryFn: () => HomepageService.getAdminHomepageContents(),
    retry: 1,
  });

  const blocks = useMemo<Block[]>(() => {
    const byKey = new Map(contents.map((c) => [c.section_key, c]));
    const primary = PRIMARY_SECTIONS.map((p) => {
      const content = byKey.get(p.key) || null;
      return {
        key: p.key,
        id: p.key,
        label: zh ? p.zh : p.en,
        content,
        sort: Number(content?.sort_order ?? p.sort),
        active: content ? content.is_active !== false : true,
        primary: true,
      };
    });
    const primaryKeys = new Set(PRIMARY_SECTIONS.map((p) => p.key));
    const custom = contents
      .filter((c) => !primaryKeys.has(c.section_key) && !EDITABLE_PAGE_SECTION_KEYS.has(c.section_key))
      .map((c) => {
        const def = getTemplateDefinition(readTemplateId(c.data));
        const typeName = def ? (zh ? def.name.zh : def.name.en) : L('自定义区块', 'Custom block');
        return {
          key: c.section_key,
          id: c.section_key,
          label: c.title ? `${typeName} · ${c.title}` : typeName,
          content: c,
          sort: Number(c.sort_order ?? 999),
          active: c.is_active !== false,
          primary: false,
        };
      });
    return [...primary, ...custom].sort((a, b) => a.sort - b.sort);
  }, [contents, zh, L]);

  const list = order ?? blocks;
  useEffect(() => setOrder(null), [blocks]);

  const selected = list.find((b) => b.key === selectedKey) || null;
  const pageSchema = page === 'home' ? null : PAGE_SCHEMAS[page];
  const pageContent = pageSchema ? contents.find((c) => c.section_key === pageSchema.sectionKey) ?? null : null;
  const filtered = search.trim()
    ? list.filter((b) => `${b.label} ${b.key}`.toLowerCase().includes(search.trim().toLowerCase()))
    : list;

  // Start from the published state; leftover drafts from an earlier session would
  // otherwise make the preview disagree with the editors.
  useEffect(() => {
    HomepageService.clearDrafts().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (dirtyKeys.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyKeys]);

  // Draft sync: debounce per section, then soft-refresh the preview.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const suppressUntil = useRef(new Map<string, number>());
  const queueDraft = useCallback((key: string, payload: Partial<SectionPayload>) => {
    if ((suppressUntil.current.get(key) || 0) > Date.now()) return;
    setDirtyKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(key, setTimeout(async () => {
      timers.current.delete(key);
      setSyncing(true);
      try {
        await HomepageService.saveDraft(key, payload);
        canvasRef.current?.refresh();
      } catch {
        // The preview simply lags; saving still publishes the editor state.
      } finally {
        setSyncing(false);
      }
    }, DRAFT_DEBOUNCE_MS));
  }, []);
  const onDraftChange = useMemo(() => (payload: Partial<SectionPayload>) => queueDraft(selectedKey, payload), [selectedKey, queueDraft]);

  const settle = useCallback(async (key: string) => {
    const pending = timers.current.get(key);
    if (pending) clearTimeout(pending);
    timers.current.delete(key);
    // Editors re-emit their state when the saved content reloads; ignore that echo.
    suppressUntil.current.set(key, Date.now() + 1500);
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    await HomepageService.deleteDraft(key).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: queryKeys.homepage.adminContents() });
    canvasRef.current?.refresh();
  }, [queryClient]);

  const saveSection = useCallback(async (payload: Partial<HomepageContentRequest>) => {
    try {
      await HomepageService.upsertAdminBySectionKey(selectedKey, payload);
      toast.success(L('已保存', 'Saved'));
      await settle(selectedKey);
    } catch (err) {
      toast.error(errorMessage(err, L('保存失败', 'Failed to save')));
      throw err;
    }
  }, [selectedKey, settle, L]);

  const toggleActive = async (block: Block) => {
    if (dirtyKeys.has(block.key)) {
      toast.error(L('该区块有未保存的修改，请先保存或撤销后再切换显示', 'Save or discard this block’s changes before changing its visibility'));
      return;
    }
    try {
      await HomepageService.upsertAdminBySectionKey(block.key, { is_active: !block.active });
      toast.success(block.active ? L('已在首页隐藏', 'Hidden from homepage') : L('已在首页显示', 'Shown on homepage'));
      await queryClient.invalidateQueries({ queryKey: queryKeys.homepage.adminContents() });
      canvasRef.current?.refresh();
    } catch (err) {
      toast.error(errorMessage(err, L('更新失败', 'Update failed')));
    }
  };

  const removeBlock = async (block: Block) => {
    if (!block.content?.id || block.primary) return;
    if (!window.confirm(L(`确定删除区块「${block.label}」吗？`, `Delete block "${block.label}"?`))) return;
    try {
      await HomepageService.deleteHomepageContent(block.content.id);
      await HomepageService.deleteDraft(block.key).catch(() => undefined);
      toast.success(L('区块已删除', 'Block deleted'));
      if (selectedKey === block.key) {
        setSelectedKey('hero_section');
        setTab('blocks');
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.homepage.adminContents() });
      canvasRef.current?.reload();
    } catch (err) {
      toast.error(errorMessage(err, L('删除失败', 'Delete failed')));
    }
  };

  const reorder = async (next: Block[]) => {
    setOrder(next);
    try {
      await Promise.all(next.map((b, i) => HomepageService.upsertAdminBySectionKey(b.key, { sort_order: (i + 1) * 10 })));
      await queryClient.invalidateQueries({ queryKey: queryKeys.homepage.adminContents() });
      canvasRef.current?.refresh();
    } catch (err) {
      toast.error(errorMessage(err, L('保存顺序失败', 'Failed to save order')));
      setOrder(null);
    }
  };

  const addBlock = async (template: TemplateId) => {
    setCreating(true);
    try {
      const anchor = selected ?? list[list.length - 1];
      const key = `block_${template}_${Math.random().toString(36).slice(2, 8)}`;
      const created = await HomepageService.createHomepageContent({
        section_key: key,
        ...templateModelToPayload(sampleModel(template)),
        sort_order: (anchor?.sort ?? 900) + 5,
        is_active: false,
      });
      // GORM drops a false boolean on create when the column defaults to true, so
      // hide the new block explicitly: visitors must not see sample content.
      await HomepageService.upsertAdminBySectionKey(created.section_key, { is_active: false });
      await queryClient.invalidateQueries({ queryKey: queryKeys.homepage.adminContents() });
      setLibraryOpen(false);
      setSelectedKey(created.section_key);
      setTab('edit');
      toast.success(L('区块已插入（未发布），编辑后点“在首页显示”发布', 'Block inserted (hidden). Edit it, then show it on the homepage.'));
      canvasRef.current?.reload();
      setTimeout(() => canvasRef.current?.select(created.section_key, true), 2500);
    } catch (err) {
      toast.error(errorMessage(err, L('添加区块失败', 'Failed to add block')));
    } finally {
      setCreating(false);
    }
  };

  const openEditor = useCallback((key: string, fromCanvas = false) => {
    setSelectedKey(key);
    setTab('edit');
    if (!fromCanvas) canvasRef.current?.select(key, true);
    else setMobileView('panel');
  }, []);
  const onCanvasSelect = useCallback((key: string) => openEditor(key, true), [openEditor]);

  const switchPage = async (next: EditorPage) => {
    if (next === page) return;
    if (dirtyKeys.size > 0) {
      if (!window.confirm(L('当前有未保存的修改，切换页面会放弃这些修改。确定切换吗？', 'You have unsaved changes. Switching pages discards them. Continue?'))) return;
      await Promise.all(Array.from(dirtyKeys).map((key) => settle(key)));
    }
    setPage(next);
    setMobileView('panel');
    if (next === 'home') {
      setSelectedKey('hero_section');
      setTab('blocks');
    } else {
      setSelectedKey(PAGE_SCHEMAS[next].sectionKey);
      setTab('edit');
    }
  };

  const renderEditor = () => {
    if (!selected) return null;
    const content = selected.content;
    const common = { onSave: saveSection, onDraftChange };
    if (content && readTemplateId(content.data)) {
      return <TemplateSectionEditor key={selectedKey} content={content} {...common} />;
    }
    switch (selectedKey) {
      case 'hero_section': return <HeroEditor key={selectedKey} content={content} {...common} />;
      case 'brand_carousel': return <BrandCarouselEditor key={selectedKey} content={content} {...common} />;
      case 'company_stats': return <CompanyStatsEditor key={selectedKey} content={content} {...common} />;
      case 'featured_products': return <FeaturedProductsEditor key={selectedKey} content={content} {...common} />;
      case 'workshop_section': return <WorkshopEditor key={selectedKey} content={content} {...common} />;
      case 'services_section': return <ServicesEditor key={selectedKey} content={content} {...common} />;
      default: return <SimpleSectionEditor key={selectedKey} content={content} {...common} />;
    }
  };

  if (error) {
    return (
      <AdminLayout>
        <div className="py-20 text-center">
          <XCircleIcon className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">{L('首页内容加载失败', 'Error loading homepage content')}</h3>
          <p className="mt-2 text-sm text-gray-500">{errorMessage(error, L('未知错误', 'Unknown error'))}</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="flex flex-col gap-3 lg:h-[calc(100dvh-8rem)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">
              {pageSchema ? L(`${pageSchema.zh}页面编辑`, `${pageSchema.en} editor`) : L('首页可视化编辑', 'Homepage visual editor')}
            </h1>
            <p className="hidden text-xs text-gray-500 sm:block">
              {dirtyKeys.size > 0
                ? L(`${dirtyKeys.size} 个区块有未发布的修改（预览已实时显示）`, `${dirtyKeys.size} block(s) with unpublished changes (shown in preview)`)
                : L('在右侧编辑，左侧实时预览；点击预览中的任意区块即可编辑', 'Edit on the right, preview live on the left; click any block in the preview to edit it')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="tablist" aria-label={L('选择要编辑的页面', 'Page to edit')}>
              {EDITOR_PAGES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={page === item.key}
                  onClick={() => switchPage(item.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${page === item.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {zh ? item.zh : item.en}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 lg:hidden">
              <button type="button" onClick={() => setMobileView('panel')} className={`rounded-md px-3 py-1.5 text-sm ${mobileView === 'panel' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>{L('编辑', 'Edit')}</button>
              <button type="button" onClick={() => setMobileView('preview')} className={`rounded-md px-3 py-1.5 text-sm ${mobileView === 'preview' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>{L('预览', 'Preview')}</button>
            </div>
            {pageSchema ? null : (
              <button type="button" onClick={() => setLibraryOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
                <PlusIcon className="h-4 w-4" />{L('添加区块', 'Add block')}
              </button>
            )}
            <a href={pageSchema?.path ?? '/'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <ArrowTopRightOnSquareIcon className="h-4 w-4" /><span className="hidden sm:inline">{pageSchema ? L('查看页面', 'View page') : L('查看首页', 'View site')}</span>
            </a>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 gap-4">
          <div className={`${mobileView === 'preview' ? 'flex' : 'hidden'} h-[78dvh] min-h-0 min-w-0 flex-1 flex-col lg:flex lg:h-auto`}>
            <VisualEditorCanvas key={page} ref={canvasRef} src={pageSchema ? `${pageSchema.path}?admin_preview=1` : PREVIEW_SRC} locale={locale} selectedKey={selectedKey} onSelectSection={onCanvasSelect} savingDraft={syncing} />
          </div>

          <aside
            className={`@container ${mobileView === 'panel' ? 'flex' : 'hidden'} min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:flex ${
              widePanel ? 'lg:w-[min(760px,55vw)]' : 'lg:w-[440px]'
            }`}
          >
            {pageSchema ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <PageContentEditor key={pageSchema.sectionKey} schema={pageSchema} content={pageContent} onSave={saveSection} onDraftChange={onDraftChange} />
              </div>
            ) : (<>
            <div className="flex items-center gap-1 border-b border-gray-200 px-2 py-2">
              <button type="button" onClick={() => setTab('blocks')} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'blocks' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                <Squares2X2Icon className="h-4 w-4" />{L('区块', 'Blocks')}
              </button>
              <button type="button" onClick={() => setTab('edit')} disabled={!selected} className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'edit' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                <PencilSquareIcon className="h-4 w-4 shrink-0" /><span className="truncate">{L('编辑', 'Edit')}{selected ? ` · ${selected.label}` : ''}</span>
              </button>
              <button type="button" onClick={() => setWidePanel((v) => !v)} className="ml-auto hidden rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 lg:inline-flex" title={widePanel ? L('收窄面板', 'Narrow panel') : L('加宽面板', 'Widen panel')}>
                {widePanel ? <ArrowsPointingInIcon className="h-5 w-5" /> : <ArrowsPointingOutIcon className="h-5 w-5" />}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'blocks' ? (
                <div className="p-3">
                  <div className="relative mb-3">
                    <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L('搜索区块', 'Search blocks')} className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:ring-blue-500" />
                  </div>
                  {isLoading ? (
                    <div className="p-6 text-center text-sm text-gray-500">{L('加载中…', 'Loading…')}</div>
                  ) : search.trim() ? (
                    filtered.map((block) => <BlockRow key={block.key} block={block} selected={block.key === selectedKey} dirty={dirtyKeys.has(block.key)} L={L} isAdmin={isAdmin} onEdit={() => openEditor(block.key)} onToggle={() => toggleActive(block)} onDelete={() => removeBlock(block)} />)
                  ) : (
                    <SortableList items={list} onReorder={reorder}>
                      {(block, drag) => (
                        <BlockRow
                          block={block}
                          selected={block.key === selectedKey}
                          dirty={dirtyKeys.has(block.key)}
                          L={L}
                          isAdmin={isAdmin}
                          handle={
                            <button type="button" ref={drag.setActivatorNodeRef} {...drag.attributes} {...drag.listeners} className="cursor-grab touch-none rounded p-1 text-gray-400 hover:bg-gray-100" aria-label={L('拖动排序', 'Drag to reorder')}>
                              <Bars3Icon className="h-5 w-5" />
                            </button>
                          }
                          onEdit={() => openEditor(block.key)}
                          onToggle={() => toggleActive(block)}
                          onDelete={() => removeBlock(block)}
                        />
                      )}
                    </SortableList>
                  )}
                  <button type="button" onClick={() => setLibraryOpen(true)} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-700">
                    <PlusIcon className="h-4 w-4" />{L('从样式库添加区块', 'Add a block from the library')}
                  </button>
                </div>
              ) : selected ? (
                <div className="p-3">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setTab('blocks')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100">
                      <ArrowLeftIcon className="h-4 w-4" />{L('全部区块', 'All blocks')}
                    </button>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selected.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {selected.active ? L('首页显示中', 'Visible') : L('已隐藏', 'Hidden')}
                    </span>
                    <button type="button" onClick={() => toggleActive(selected)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                      {selected.active ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                      {selected.active ? L('在首页隐藏', 'Hide') : L('在首页显示', 'Show on homepage')}
                    </button>
                  </div>
                  {renderEditor()}
                </div>
              ) : null}
            </div>
            </>)}
          </aside>
        </div>
      </div>

      <TemplateLibraryModal open={libraryOpen} locale={locale} creating={creating} onClose={() => setLibraryOpen(false)} onChoose={addBlock} />
    </AdminLayout>
  );
}

function BlockRow({
  block,
  selected,
  dirty,
  handle,
  isAdmin,
  L,
  onEdit,
  onToggle,
  onDelete,
}: {
  block: Block;
  selected: boolean;
  dirty: boolean;
  handle?: React.ReactNode;
  isAdmin: boolean;
  L: (zh: string, en: string) => string;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`mb-2 flex items-center gap-1.5 rounded-xl border p-2 transition ${selected ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
      {handle}
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className={`truncate text-sm font-medium ${block.active ? 'text-gray-900' : 'text-gray-400'}`}>{block.label}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="truncate font-mono">{block.key}</span>
          {dirty ? <span className="shrink-0 rounded bg-amber-100 px-1 text-amber-700">{L('未发布', 'Unpublished')}</span> : null}
          {!block.active ? <span className="shrink-0 rounded bg-gray-100 px-1 text-gray-500">{L('隐藏', 'Hidden')}</span> : null}
        </div>
      </button>
      <button type="button" onClick={onToggle} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title={block.active ? L('隐藏', 'Hide') : L('显示', 'Show')}>
        {block.active ? <EyeIcon className="h-5 w-5" /> : <EyeSlashIcon className="h-5 w-5" />}
      </button>
      <button type="button" onClick={onEdit} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-700" title={L('编辑', 'Edit')}>
        <PencilSquareIcon className="h-5 w-5" />
      </button>
      {!block.primary && isAdmin ? (
        <button type="button" onClick={onDelete} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title={L('删除', 'Delete')}>
          <TrashIcon className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
