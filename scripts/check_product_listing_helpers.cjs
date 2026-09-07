const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../frontend/node_modules/typescript');
const filename = path.resolve(__dirname, '../frontend/src/lib/product-listing.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(source, { exports: loaded.exports, module: loaded, URLSearchParams });
const { normalizeProductPageSize, buildProductListingPath } = loaded.exports;

for (const size of [12, 24, 36, 48, 96]) {
  assert.equal(normalizeProductPageSize(String(size)), size);
  assert.equal(normalizeProductPageSize([String(size)]), size);
}
for (const invalid of [undefined, '', 'all', '24abc', 0, -12, 25, 24.5, 1000000]) {
  assert.equal(normalizeProductPageSize(invalid), 48);
}

const existing = { search: 'servo & motor', category_id: '123', brand: 'FANUC', page: '7', page_size: '24', sort_by: 'price' };
const resized = new URL(buildProductListingPath(existing, { page: 1, page_size: 96 }), 'https://vibocnc.com');
assert.equal(resized.searchParams.get('page'), null);
assert.equal(resized.searchParams.get('page_size'), '96');
for (const key of ['search', 'category_id', 'brand', 'sort_by']) {
  assert.equal(resized.searchParams.get(key), existing[key]);
}
const nextPage = new URL(buildProductListingPath(existing, { page: 8 }), 'https://vibocnc.com');
assert.equal(nextPage.searchParams.get('page'), '8');
assert.equal(nextPage.searchParams.get('page_size'), '24');
assert.equal(buildProductListingPath({}, { page: 1, page_size: 48 }), '/products');
assert.equal(buildProductListingPath({ page_size: '96' }, { page_size: 12 }), '/products?page_size=12');
assert.equal(buildProductListingPath({ search: 'servo', page_size: '48' }, { search: undefined }), '/products');
console.log('PASS allowed sizes, invalid values, resizing resets page, filters survive, pagination preserves size');

const navigationSource = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../frontend/src/lib/category-navigation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const navigation = { exports: {} };
vm.runInNewContext(navigationSource, { exports: navigation.exports, module: navigation, Set });
const { findCategoryTrail, prioritizeCategoryTrail } = navigation.exports;
const tree = [{ id: 1 }, { id: 2, children: [{ id: 3 }, { id: 4, children: [{ id: 5 }] }] }];
const trail = findCategoryTrail(tree, 5);
assert.equal(JSON.stringify(trail), '[2,4,5]');
assert.equal(prioritizeCategoryTrail(tree, trail)[0].id, 2);
assert.equal(prioritizeCategoryTrail(tree[1].children, trail)[0].id, 4);
assert.equal(tree[0].id, 1);
assert.equal(findCategoryTrail(tree, 99).length, 0);
console.log('PASS selected category ancestry, stable priority and original tree preserved');
