// Staged AI results are the display/publishing source of truth while ready.
// Raw listing fields remain available for audit; failed/rejected results must
// never appear as a successful optimization.
interface DraftPreview {
  status: string;
  ai_review_status?: string;
  proposed_name?: string;
  proposed_category_id?: number;
  proposed_category_name?: string;
  normalized_title: string;
  title_raw: string;
  suggested_category_id?: number;
  suggested_category_name: string;
  suggested_category?: { name: string };
}

export function hasReadyDraftReview(draft: DraftPreview): boolean {
  return draft.ai_review_status === 'ready' && !['imported', 'skipped'].includes(draft.status);
}

export function draftDisplayTitle(draft: DraftPreview): string {
  return (hasReadyDraftReview(draft) ? draft.proposed_name : '') || draft.normalized_title || draft.title_raw || '';
}

export function draftDisplayCategory(draft: DraftPreview): string {
  if (hasReadyDraftReview(draft) && draft.proposed_category_id) {
    return draft.proposed_category_name || '';
  }
  return draft.suggested_category?.name || (draft.suggested_category_id ? draft.suggested_category_name : '') || '';
}
