import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/observations.js';

test('observation proxy preserves Firefox identity and the original recording', async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.VITE_SUPABASE_URL;
  const oldKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const body = { shopId: '998987706', productId: '23673121581', title: 'Toilet Cleaner' };
  const userAgent = 'Mozilla/5.0 Firefox/143.0';
  let forwarded;
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  globalThis.fetch = async (url, options) => { forwarded = options; return Response.json({ ok: true }); };
  const res = { setHeader() {}, status(value) { this.statusCode = value; return this; }, send(value) { this.body = value; return this; } };
  try {
    await handler({ method: 'POST', headers: { 'user-agent': userAgent }, body }, res);
    assert.equal(forwarded.headers['user-agent'], userAgent);
    assert.deepEqual(JSON.parse(forwarded.body), body);
    assert.equal(res.statusCode, 200);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY; else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
