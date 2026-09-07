type TreeNode = { id: number; children?: TreeNode[] };

export function findCategoryTrail(nodes: readonly TreeNode[], id: number | null): number[] {
  for (const node of nodes) {
    if (node.id === id) return [node.id];
    const childTrail = findCategoryTrail(node.children || [], id);
    if (childTrail.length) return [node.id, ...childTrail];
  }
  return [];
}

export function prioritizeCategoryTrail<T extends TreeNode>(nodes: readonly T[], trail: readonly number[]): T[] {
  const active = new Set(trail);
  return [...nodes].sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)));
}
