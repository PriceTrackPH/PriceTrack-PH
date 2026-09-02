import assert from 'node:assert/strict';
import test from 'node:test';

import handler from '../api/find-product-by-title.js';

const originalFetch = globalThis.fetch;
const originalUrl = process.env.VITE_SUPABASE_URL;
const originalKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';

test.after(() => {
  globalThis.fetch = originalFetch;
  process.env.VITE_SUPABASE_URL = originalUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = originalKey;
});

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function search(title, resultSets) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const rows = resultSets.shift() ?? [];
    return { ok: true, json: async () => rows };
  };

  const res = responseRecorder();
  await handler({ method: 'GET', query: { title } }, res);
  return { res, urls };
}

const iphone = {
  external_shop_id: '448087759',
  external_product_id: '42571515280',
  product_url: 'https://shopee.ph/Apple-iPhone-17-Pro-(6.3-inch)-i.448087759.42571515280',
  name: 'Apple iPhone 17 Pro (6.3 inch)',
};

test('keeps the case-insensitive exact-title lookup as the first choice', async () => {
  const exact = { ...iphone, name: 'Apple iPhone 17 Pro' };
  const { res, urls } = await search('apple iphone 17 pro', [[exact]]);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.productUrl, exact.product_url);
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).searchParams.get('name'), 'ilike.apple iphone 17 pro');
});

test('accepts only parenthetical metadata after the searched product name', async () => {
  const { res, urls } = await search('apple iphone 17 pro', [[], [
    iphone,
    { ...iphone, name: 'Apple iPhone 17 Pro Max' },
    { ...iphone, name: 'Apple iPhone 17 Pro Case' },
  ]]);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.title, 'Apple iPhone 17 Pro (6.3 inch)');
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get('name'), 'ilike.apple iphone 17 pro*');
});

test('does not treat Pro Max or accessories as the requested product', async () => {
  const { res } = await search('apple iphone 17 pro', [[], [
    { ...iphone, name: 'Apple iPhone 17 Pro Max' },
    { ...iphone, name: 'Apple iPhone 17 Pro Case' },
  ]]);

  assert.equal(res.statusCode, 404);
});

test('requires a Shopee link when multiple parenthetical variants qualify', async () => {
  const { res } = await search('apple iphone 17 pro', [[], [
    iphone,
    { ...iphone, name: 'Apple iPhone 17 Pro (512GB)' },
  ]]);

  assert.equal(res.statusCode, 409);
});
