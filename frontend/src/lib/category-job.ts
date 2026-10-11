export interface CategoryJobOptions {
  scope?: string;
  category_id?: number;
  category_name?: string;
  include_descendants?: boolean;
  brand?: string;
  status?: string;
  product_count?: number;
  repair_content?: boolean;
  rewrite_content?: boolean;
  activate_resolved?: boolean;
  selection_fingerprint?: string;
}

export function categoryJobOptions(prompt: string): CategoryJobOptions {
  try {
    const encoded = prompt.split('[[VIBOCNC_CATEGORY_JOB_OPTIONS=')[1]?.split(']]')[0];
    if (!encoded) return {};
    // Decode UTF-8 rather than treating category names as Latin-1.
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as CategoryJobOptions;
  } catch { return {}; }
}

export function categoryJobDescription(prompt: string, total: number, zh: boolean): string {
  const opts = categoryJobOptions(prompt);
  const count = opts.product_count ?? total;
  let scope: string;
  switch (opts.scope) {
    case 'category': scope = `${zh ? '仅分类' : 'Category only'}「${opts.category_name || ''}」(#${opts.category_id})${opts.include_descendants ? (zh ? '及子分类' : ' + descendants') : ''}`; break;
    case 'products': scope = zh ? '指定商品' : 'Selected products'; break;
    case 'brand': scope = `${zh ? '品牌' : 'Brand'}「${opts.brand || ''}」`; break;
    case 'uncategorized': scope = zh ? '未分类商品' : 'Uncategorized products'; break;
    case 'rework': scope = zh ? '全站审计筛出的待返工商品' : 'Products flagged by catalog audit'; break;
    case 'all': scope = zh ? '已确认的全站范围' : 'Explicitly confirmed catalog scope'; break;
    case 'filtered': scope = zh ? '已确认的筛选范围' : 'Confirmed filters'; break;
    default: scope = zh ? '历史任务（未记录原始范围）' : 'Legacy job (original scope not recorded)';
  }
  const operations = opts.rewrite_content
    ? (zh ? '核验分类 → 重写名称、简介、描述、SEO → 校验保存' : 'Verify category → rewrite name, descriptions and SEO → validate and save')
    : opts.repair_content
      ? (zh ? '核验分类 → 审核修复名称、描述、SEO' : 'Verify category → audit and repair name, content and SEO')
      : (zh ? '仅核验分类，不重写内容' : 'Category verification only; no content rewrite');
  const status = opts.activate_resolved
    ? (zh ? '已选择：核验后启用' : 'Verified products may be activated')
    : (zh ? '保留商品启停状态' : 'Publication status is preserved');
  return `${scope} · ${count.toLocaleString()} ${zh ? '件' : 'products'}；${operations}；${status}。${zh ? '无法确认的商品不编造内容，留待审核。' : 'Uncertain identity requires review, not invented copy.'}`;
}
