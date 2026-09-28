import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasReadyDraftReview, draftDisplayTitle, draftDisplayCategory } from './ebay-draft-preview.ts';

const row = {
  status: 'needs_review', ai_review_status: 'ready',
  normalized_title: '1PC OMRON E3S-CL2 New Fast Shipping', title_raw: 'raw listing',
  proposed_name: 'OMRON E3S-CL2 Photoelectric Sensor',
  suggested_category_id: 1, suggested_category_name: 'Control Board', suggested_category: { name: 'Control Board' },
  proposed_category_id: 2, proposed_category_name: 'Photoelectric Sensor',
};
test('ready AI title and category replace old values on screen', () => {
  assert.equal(draftDisplayTitle(row), row.proposed_name);
  assert.equal(draftDisplayCategory(row), row.proposed_category_name);
  assert.equal(hasReadyDraftReview(row), true);
});
test('failed, rejected and queued runs never display stale proposals', () => {
  for (const ai_review_status of ['', 'failed', 'rejected', 'queued', 'processing', 'approved']) {
    const draft = { ...row, ai_review_status };
    assert.equal(hasReadyDraftReview(draft), false);
    assert.equal(draftDisplayTitle(draft), row.normalized_title);
    assert.equal(draftDisplayCategory(draft), 'Control Board');
  }
});
test('already processed rows do not offer stale ready results', () => {
  for (const status of ['imported', 'skipped']) {
    assert.equal(hasReadyDraftReview({ ...row, status }), false);
  }
});
test('source breadcrumbs do not masquerade as a site category', () => {
  assert.equal(draftDisplayCategory({ ...row, ai_review_status: '', suggested_category_id: undefined, suggested_category: undefined, suggested_category_name: 'Business > PLCs' }), '');
});
