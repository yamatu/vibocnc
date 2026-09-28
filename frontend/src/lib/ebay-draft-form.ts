import type { EbayImportDraftDetail, EbayImportDraftUpdateRequest } from '@/types';

export function draftToEditForm(draft: EbayImportDraftDetail) {
  const reviewed = ['ready', 'approved'].includes(draft.ai_review_status || '');
  const category = (reviewed ? draft.proposed_category_id : undefined) || draft.suggested_category_id;
  return {
    normalized_title: (reviewed ? draft.proposed_name : '') || draft.normalized_title || '',
    normalized_brand: (reviewed ? draft.proposed_brand : '') || draft.normalized_brand || '',
    normalized_model: (reviewed ? draft.proposed_model : '') || draft.normalized_model || '',
    normalized_part_number: draft.normalized_part_number || '',
    normalized_mpn: draft.normalized_mpn || '',
    normalized_price: String(draft.normalized_price ?? ''),
    normalized_description: (reviewed ? draft.proposed_description : '') || draft.normalized_description || '',
    normalized_short_description: (reviewed ? draft.proposed_short_description : '') || draft.normalized_short_description || '',
    suggested_category_id: category ? String(category) : '',
    ebay_category: draft.ebay_category || '',
    import_action: draft.import_action || '',
    meta_title: (reviewed ? draft.proposed_meta_title : '') || draft.meta_title || '',
    meta_description: (reviewed ? draft.proposed_meta_description : '') || draft.meta_description || '',
    meta_keywords: (reviewed ? draft.proposed_meta_keywords : '') || draft.meta_keywords || '',
    review_note: draft.review_note || '',
    disable_auto_seo: !!draft.disable_auto_seo,
    include_images: !draft.exclude_source_images,
  };
}

export type DraftEditForm = ReturnType<typeof draftToEditForm>;

export function draftEditPatch(form: DraftEditForm, draft: EbayImportDraftDetail): EbayImportDraftUpdateRequest {
  const initial = draftToEditForm(draft);
  const patch: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(form) as (keyof DraftEditForm)[]) {
    if (form[key] === initial[key]) continue;
    if (key === 'normalized_price') patch[key] = Number(form[key] || 0);
    else if (key === 'suggested_category_id') patch[key] = Number(form[key] || 0);
    else patch[key] = form[key];
  }
  return patch;
}
