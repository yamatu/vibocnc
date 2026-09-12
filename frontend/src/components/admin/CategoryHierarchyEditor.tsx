'use client';

import { DndContext, DragEndEvent, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core';
import { useMemo, useState, type CSSProperties } from 'react';
import { toast } from 'react-hot-toast';
import { ArrowsUpDownIcon } from '@heroicons/react/24/outline';
import type { Category } from '@/types';
import { CategoryService } from '@/services';
import { useAdminI18n } from '@/lib/admin-i18n';

type Props = {
  categories: Category[];
  onUpdated?: () => void;
};

type TreeNode = Omit<Category, 'children'> & { children: TreeNode[] };

function buildTree(list: Category[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  for (const c of list) {
    const category = { ...c };
    delete category.children;
    byId.set(c.id, { ...category, children: [] });
  }

  const roots: TreeNode[] = [];
  for (const c of byId.values()) {
    if (!c.parent_id) {
      roots.push(c);
      continue;
    }
    const parent = byId.get(c.parent_id);
    if (parent) parent.children.push(c);
    else roots.push(c);
  }

  const sort = (a: Category, b: Category) => {
    const ao = Number(a.sort_order ?? 0);
    const bo = Number(b.sort_order ?? 0);
    if (ao !== bo) return ao - bo;
    return String(a.name || '').localeCompare(String(b.name || ''));
  };

  const walk = (nodes: TreeNode[]) => {
    nodes.sort(sort);
    for (const n of nodes) walk(n.children);
  };
  walk(roots);
  return roots;
}

function DraggableRow({ node, depth }: { node: TreeNode; depth: number }) {
  const { locale, t } = useAdminI18n();
  const rowId = `row:${node.id}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: rowId });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: rowId });

  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div className="rounded-md">
      <div
        ref={setDropRef}
        className={`rounded-md ${isOver ? 'bg-yellow-50 ring-1 ring-yellow-300' : ''}`}
      >
        <div ref={setNodeRef} style={style} className="flex items-center gap-2 px-2 py-1.5">
          <div style={{ width: depth * 14 }} />
          <button
            type="button"
            className="cursor-grab text-gray-400 hover:text-gray-600"
            {...listeners}
            {...attributes}
            aria-label={t('common.drag', locale === 'zh' ? '拖拽' : 'Drag')}
          >
            <ArrowsUpDownIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 truncate">{node.name}</div>
            <div className="text-xs text-gray-500 truncate">/{node.path || node.slug}</div>
          </div>
          <div className={`text-xs px-2 py-0.5 rounded-full ${node.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {node.is_active ? t('common.active', locale === 'zh' ? '启用' : 'Active') : t('common.hidden', locale === 'zh' ? '隐藏' : 'Hidden')}
          </div>
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="space-y-1">
          {node.children.map((c) => (
            <DraggableRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CategoryHierarchyEditor({ categories, onUpdated }: Props) {
  const { locale, t } = useAdminI18n();
  const tree = useMemo(() => buildTree(categories), [categories]);

  const [mode, setMode] = useState<'sort' | 'parent'>('sort');

  const parentOf = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const c of categories) {
      m.set(Number(c.id), c.parent_id ? Number(c.parent_id) : null);
    }
    return m;
  }, [categories]);

  const [activeId, setActiveId] = useState<number | null>(null);
  const activeItem = useMemo(() => categories.find((c) => c.id === activeId) || null, [activeId, categories]);

  const { setNodeRef: setRootDropRef, isOver: isRootOver } = useDroppable({ id: 'root' });
  const { setNodeRef: setRootBottomDropRef, isOver: isRootBottomOver } = useDroppable({ id: 'root-bottom' });

  const wouldCreateCycle = (potentialParentId: number, childId: number): boolean => {
    let cur: number | null = potentialParentId;
    while (cur != null) {
      if (cur === childId) return true;
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };

  const siblingsSorted = (parentId: number | null): Category[] => {
    const pid = parentId ?? null;
    const list = categories.filter((c) => (c.parent_id ? Number(c.parent_id) : null) === pid);
    list.sort((a, b) => {
      const ao = Number(a.sort_order ?? 0);
      const bo = Number(b.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return list;
  };

  const normalizeSiblingOrders = (ids: number[], parentId: number | null, updates: Array<{ id: number; parent_id?: number; sort_order: number }>) => {
    for (let i = 0; i < ids.length; i++) {
      updates.push({
        id: ids[i],
        parent_id: parentId ?? undefined,
        sort_order: i + 1,
      });
    }
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const active = e.active?.id;
    const over = e.over?.id;
    if (!active || !over) return;
    if (active === over) return;

    const activeStr = String(active);
    if (!activeStr.startsWith('row:')) return;
    const activeNum = Number(activeStr.slice(4));
    if (!Number.isFinite(activeNum) || activeNum <= 0) return;

    const dragged = categories.find((c) => c.id === activeNum);
    if (!dragged) return;

    const overStr = String(over);

    const draggedOldParentId = dragged.parent_id ? Number(dragged.parent_id) : null;

    // Mode A: sort only (no parent changes)
    if (mode === 'sort') {
      if (!overStr.startsWith('row:')) return;
      const tid = Number(overStr.slice(4));
      if (!Number.isFinite(tid) || tid <= 0) return;
      if (tid === dragged.id) return;

      const target = categories.find((c) => c.id === tid);
      if (!target) return;
      const targetParentId = target.parent_id ? Number(target.parent_id) : null;

      // Only reorder within the same parent.
      if (targetParentId !== draggedOldParentId) {
        toast.error(
          t(
            'categories.hierarchy.sortOnlyHint',
            locale === 'zh'
              ? '“排序”模式只能在同一父级下调整顺序。如需修改层级，请切换到“移动”。'
              : 'Sort mode only reorders within the same parent. Switch to "Move" to change hierarchy.'
          )
        );
        return;
      }

      const sibs = siblingsSorted(draggedOldParentId);
      const base = sibs.map((c) => c.id).filter((id) => id !== dragged.id);

      const overRect = e.over?.rect;
      const activeRect = e.active?.rect?.current?.translated || e.active?.rect?.current?.initial;
      let after = false;
      if (overRect && activeRect && typeof overRect.top === 'number' && typeof overRect.height === 'number') {
        const overMid = overRect.top + overRect.height / 2;
        const activeMid = activeRect.top + activeRect.height / 2;
        after = activeMid > overMid;
      }

      const idx = base.indexOf(tid);
      const insertIdx = Math.min(base.length, (idx >= 0 ? idx : base.length) + (after ? 1 : 0));
      const next = [...base.slice(0, insertIdx), dragged.id, ...base.slice(insertIdx)];

      const updates: Array<{ id: number; parent_id?: number; sort_order: number }> = [];
      normalizeSiblingOrders(next, draggedOldParentId, updates);

      try {
        await CategoryService.reorderCategories(updates);
        toast.success(t('categories.hierarchy.sortUpdated', locale === 'zh' ? '排序已更新' : 'Sort order updated'));
        onUpdated?.();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : t('categories.hierarchy.sortUpdateFailed', locale === 'zh' ? '更新排序失败' : 'Failed to update sort order'));
      }
      return;
    }

    // Mode B: move (change parent)
    let newParentId: number | null = draggedOldParentId;
    if (overStr === 'root' || overStr === 'root-bottom') {
      newParentId = null;
    } else if (overStr.startsWith('row:')) {
      const pid = Number(overStr.slice(4));
      if (!Number.isFinite(pid) || pid <= 0) return;
      if (pid === dragged.id) return;
      if (wouldCreateCycle(pid, dragged.id)) {
        toast.error(t('categories.hierarchy.cycle', locale === 'zh' ? '不能把分类移动到自己的子分类中。' : 'Cannot move a category into its own descendant.'));
        return;
      }
      newParentId = pid;
    } else {
      return;
    }

    if (newParentId === draggedOldParentId) {
      // No-op
      return;
    }

    const oldSibs = siblingsSorted(draggedOldParentId).map((c) => c.id).filter((id) => id !== dragged.id);
    const newSibs = siblingsSorted(newParentId).map((c) => c.id).filter((id) => id !== dragged.id);
    const nextNew = [...newSibs, dragged.id];

    const updates: Array<{ id: number; parent_id?: number; sort_order: number }> = [];
    normalizeSiblingOrders(oldSibs, draggedOldParentId, updates);
    normalizeSiblingOrders(nextNew, newParentId, updates);

    try {
      await CategoryService.reorderCategories(updates);
      toast.success(t('categories.hierarchy.updated', locale === 'zh' ? '层级已更新' : 'Hierarchy updated'));
      onUpdated?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('categories.hierarchy.updateFailed', locale === 'zh' ? '更新分类层级失败' : 'Failed to update category hierarchy'));
    }
  };

  return (
    <DndContext
      onDragStart={(e) => {
        const id = String(e.active.id);
        if (id.startsWith('row:')) setActiveId(Number(id.slice(4)));
        else setActiveId(null);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            {mode === 'sort'
              ? t('categories.hierarchy.mode.sort', locale === 'zh' ? '模式：同级排序' : 'Mode: Sort within same parent')
              : t('categories.hierarchy.mode.move', locale === 'zh' ? '模式：移动（拖到父级下以嵌套）' : 'Mode: Move (drop onto parent to nest)')}
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setMode('sort')}
              className={`px-3 py-1.5 text-sm rounded-md ${mode === 'sort' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {t('common.sort', locale === 'zh' ? '排序' : 'Sort')}
            </button>
            <button
              type="button"
              onClick={() => setMode('parent')}
              className={`px-3 py-1.5 text-sm rounded-md ${mode === 'parent' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {t('common.move', locale === 'zh' ? '移动' : 'Move')}
            </button>
          </div>
        </div>

        <div
          ref={setRootDropRef}
          className={`sticky top-0 z-10 rounded-lg border border-dashed px-3 py-2 text-sm ${isRootOver ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200 bg-gray-50 text-gray-600'} ${mode === 'sort' ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {t('categories.hierarchy.dropRoot', locale === 'zh' ? '拖到这里：移动到根级（顶级分类）' : 'Drop here to move into root (top level)')}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1">
          {tree.map((n) => (
            <DraggableRow key={n.id} node={n} depth={0} />
          ))}
        </div>

        <div
          ref={setRootBottomDropRef}
          className={`rounded-lg border border-dashed px-3 py-2 text-sm ${isRootBottomOver ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200 bg-gray-50 text-gray-600'} ${mode === 'sort' ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {t('categories.hierarchy.dropRoot', locale === 'zh' ? '拖到这里：移动到根级（顶级分类）' : 'Drop here to move into root (top level)')}
        </div>
      </div>

      <DragOverlay>
        {activeItem ? (
          <div className="bg-white shadow-lg rounded-md px-3 py-2 text-sm font-medium">{activeItem.name}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
