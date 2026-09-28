import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftToEditForm, draftEditPatch } from './ebay-draft-form.ts';

const draft = {
  status: 'needs_review', ai_review_status: 'ready',
  normalized_title: 'One New Omron CJ1W-DA08C PLC Module In Box Fast Shipping',
  normalized_brand: '', normalized_model: 'CJ1W-DA08C', normalized_price: 251.34,
  meta_description: '<div>seller HTML</div>', meta_keywords: 'EBAY IMPORT',
  proposed_name: 'OMRON CJ1W-DA08C Analog Output Module',
  proposed_brand: 'OMRON', proposed_model: 'CJ1W-DA08C',
  proposed_category_id: 23, proposed_category_name: 'Analog Output Module',
  ebay_category: 'Business & Industrial > PLCs & HMIs',
  proposed_description: 'Optimized product description.', proposed_short_description: 'Short description.',
  proposed_meta_title: 'OMRON CJ1W-DA08C Analog Output Module | Vibocnc',
  proposed_meta_description: 'Optimized SEO description.', proposed_meta_keywords: 'OMRON, CJ1W-DA08C, analog output module',
  exclude_source_images: false,
};

test('all editable fields use the optimized result, not the seller template', () => {
  const form = draftToEditForm(draft);
  assert.equal(form.normalized_title, draft.proposed_name);
  assert.equal(form.normalized_brand, 'OMRON');
  assert.equal(form.suggested_category_id, '23');
  assert.equal(form.ebay_category, draft.ebay_category);
  assert.equal(form.normalized_description, draft.proposed_description);
  assert.equal(form.normalized_short_description, draft.proposed_short_description);
  assert.equal(form.meta_title, draft.proposed_meta_title);
  assert.equal(form.meta_description, draft.proposed_meta_description);
  assert.equal(form.meta_keywords, draft.proposed_meta_keywords);
  assert.equal(form.normalized_price, '251.34');
});
test('unchanged form sends nothing, so saving does not invalidate AI identification', () => {
  assert.deepEqual(draftEditPatch(draftToEditForm(draft), draft), {});
});
test('image opt-out is sent explicitly without posting old identity/category fields', () => {
  const form = { ...draftToEditForm(draft), include_images: false };
  assert.deepEqual(draftEditPatch(form, draft), { include_images: false });
});
test('text edits are saved, not silently ignored by the publish button', () => {
  const form = { ...draftToEditForm(draft), normalized_description: 'My edited description', meta_description: 'My edited SEO text' };
  assert.deepEqual(draftEditPatch(form, draft), { normalized_description: 'My edited description', meta_description: 'My edited SEO text' });
});
test('failed proposals are not used as optimized output', () => {
  const form = draftToEditForm({ ...draft, ai_review_status: 'failed' });
  assert.equal(form.normalized_title, draft.normalized_title);
  assert.equal(form.normalized_brand, '');
});
