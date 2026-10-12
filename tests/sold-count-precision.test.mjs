import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../extension/product-activity.js', import.meta.url), 'utf8'), context);
const reader = context.PriceTrackProductActivity;

test('exact visible sold counts do not receive approximate flag', () => {
  for (const label of ['58', '5,563', '1000']) {
    const visible = reader.extractVisibleProductActivity({ body: { innerText: `Example product ${label} Sold` } }, 'Example product');
    assert.equal(reader.mergeProductActivity(null, visible).approximateTotalSold, false);
  }
});

test('compact sold labels remain approximate and exact API counts take precedence', () => {
  for (const label of ['1K', '4K+', '10K']) {
    const visible = reader.extractVisibleProductActivity({ body: { innerText: `Example product ${label} Sold` } }, 'Example product');
    assert.equal(reader.mergeProductActivity(null, visible).approximateTotalSold, true);
    const merged = reader.mergeProductActivity({ totalSold: 5563 }, visible);
    assert.equal(merged.totalSold, 5563);
    assert.equal(merged.approximateTotalSold, false);
  }
});

test('unrelated page text has no product activity', () => {
  assert.equal(reader.extractVisibleProductActivity({ body: { innerText: 'Example product description only' } }, 'Example product'), null);
});
