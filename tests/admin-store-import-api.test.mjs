import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const originalUrl = process.env.SUPABASE_URL;
const originalSecret = process.env.SUPABASE_SECRET_KEY;
const originalToken = process.env.ADMIN_HEALTH_TOKEN;
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "service-secret";
process.env.ADMIN_HEALTH_TOKEN = "admin-secret";

const { default: handler } = await import("../api/admin-pc-collector.js");

test("keeps the Vercel API independent from frontend TypeScript configuration", async () => {
  const source = await readFile(new URL("../api/admin-pc-collector.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/server\/store-import-contract\.js"/);
  assert.doesNotMatch(source, /\.\.\/src\/.*\.ts/);
});

test.after(() => {
  for (const [key, value] of [["SUPABASE_URL", originalUrl], ["SUPABASE_SECRET_KEY", originalSecret], ["ADMIN_HEALTH_TOKEN", originalToken]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function responseRecorder() {
  return { statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function request(action, body = {}, token = "admin-secret") {
  return { method: "POST", query: { action: `store-${action}` }, headers: { authorization: `Bearer ${token}` }, body };
}

test("rejects unauthenticated and oversized store import requests", async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error("must not call"); };
  const unauthorized = responseRecorder();
  await handler(request("list", {}, "wrong"), unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  const oversized = responseRecorder();
  await handler({ ...request("list"), headers: { authorization: "Bearer admin-secret", "content-length": "512001" } }, oversized);
  assert.equal(oversized.statusCode, 413);
  assert.equal(calls, 0);
});

test("begins a normalized saved-store scan", async () => {
  global.fetch = async (url, options) => {
    assert.match(url, /\/rest\/v1\/rpc\/begin_store_collection_scan$/);
    assert.deepEqual(JSON.parse(options.body), {
      p_store_key: "jabraofficialstore",
      p_store_url: "https://shopee.ph/jabraofficialstore",
      p_display_name: "JabraOfficialStore",
      p_scan_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    return { ok: true, json: async () => "660e8400-e29b-41d4-a716-446655440000" };
  };
  const res = responseRecorder();
  await handler(request("begin", { storeUrl: "https://shopee.ph/JabraOfficialStore#product_list", scanId: "550e8400-e29b-41d4-a716-446655440000" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.storeId, "660e8400-e29b-41d4-a716-446655440000");
  assert.equal(res.body.store.storeUrl, "https://shopee.ph/jabraofficialstore");
});

test("normalizes and submits one bounded product batch", async () => {
  global.fetch = async (url, options) => {
    assert.match(url, /\/rest\/v1\/rpc\/import_store_collection_batch$/);
    const body = JSON.parse(options.body);
    assert.equal(body.p_products.length, 1);
    assert.equal(body.p_products[0].externalProductId, "34");
    assert.equal(body.p_products[0].productUrl, "https://shopee.ph/product/12/34");
    assert.equal(body.p_products[0].soldOut, true);
    assert.equal(body.p_pages_current, 4);
    assert.equal(body.p_pages_total, 4);
    return { ok: true, json: async () => ({ discovered: 1, newlyQueued: 1, duplicate: 0, alreadyTracked: 0, soldOut: 1, pagesCurrent: 4, pagesTotal: 4 }) };
  };
  const res = responseRecorder();
  await handler(request("batch", {
    scanId: "550e8400-e29b-41d4-a716-446655440000",
    products: [{ shopId: "12", productId: "34", soldOut: true }, { shopId: "bad", productId: "2" }],
    pagesCurrent: 4,
    pagesTotal: 4,
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totals.newlyQueued, 1);
  assert.equal(res.body.totals.soldOut, 1);
});

test("logs the bounded Supabase RPC error body for production diagnosis", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  global.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ code: "PGRST202", message: "Function was not found" }),
  });
  try {
    const res = responseRecorder();
    await handler(request("batch", {
      scanId: "550e8400-e29b-41d4-a716-446655440000",
      products: [{ shopId: "12", productId: "34" }],
      pagesCurrent: 1,
      pagesTotal: 1,
    }), res);
    assert.equal(res.statusCode, 502);
    assert.match(String(logged[0]?.[1]?.message), /import_store_collection_batch_404.*PGRST202.*Function was not found/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("lists private Store Scan History with validated filters and pagination", async () => {
  global.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/store_scan_history");
    assert.equal(parsed.searchParams.get("status"), "eq.completed");
    assert.equal(parsed.searchParams.get("collection_stores.display_name"), "ilike.*Jabra Official*");
    assert.equal(parsed.searchParams.get("limit"), "20");
    assert.equal(parsed.searchParams.get("offset"), "20");
    assert.equal(options.headers.Prefer, "count=exact");
    return {
      ok: true,
      headers: { get: (name) => name.toLowerCase() === "content-range" ? "20-20/41" : null },
      json: async () => [{
        scan_id: "550e8400-e29b-41d4-a716-446655440000",
        store_id: "store-id",
        started_at: "2026-09-09T00:00:00Z",
        finished_at: "2026-09-09T00:03:00Z",
        status: "completed",
        discovered: 320,
        newly_queued: 45,
        duplicate: 3,
        already_tracked: 272,
        sold_out: 20,
        pages_current: 4,
        pages_total: 4,
        collection_stores: { store_url: "https://shopee.ph/jabraofficialstore", display_name: "Jabra Official" },
      }],
    };
  };
  const res = responseRecorder();
  await handler(request("history", { query: "Jabra Official", status: "completed", page: 2 }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 41);
  assert.equal(res.body.page, 2);
  assert.equal(res.body.pageSize, 20);
  assert.deepEqual(res.body.scans[0], {
    scanId: "550e8400-e29b-41d4-a716-446655440000",
    storeId: "store-id",
    storeUrl: "https://shopee.ph/jabraofficialstore",
    displayName: "Jabra Official",
    startedAt: "2026-09-09T00:00:00Z",
    finishedAt: "2026-09-09T00:03:00Z",
    status: "completed",
    discovered: 320,
    newlyQueued: 45,
    duplicate: 3,
    alreadyTracked: 272,
    soldOut: 20,
    pagesCurrent: 4,
    pagesTotal: 4,
  });
});

test("lists private saved stores in the UI contract", async () => {
  global.fetch = async (url) => {
    assert.match(url, /\/rest\/v1\/collection_stores\?/);
    return { ok: true, json: async () => [{
      store_id: "id", store_key: "jabraofficialstore", store_url: "https://shopee.ph/jabraofficialstore",
      display_name: "Jabra", first_added_at: "2026-09-08T00:00:00Z", last_scan_started_at: "2026-09-08T01:00:00Z",
      last_scan_finished_at: "2026-09-08T01:01:00Z", last_scan_status: "completed", last_discovered: 172,
      last_newly_queued: 170, last_duplicate: 1, last_already_tracked: 1,
    }] };
  };
  const res = responseRecorder();
  await handler(request("list"), res);
  assert.deepEqual(res.body.stores[0], {
    id: "id", storeKey: "jabraofficialstore", storeUrl: "https://shopee.ph/jabraofficialstore", displayName: "Jabra",
    firstAddedAt: "2026-09-08T00:00:00Z", lastScanStartedAt: "2026-09-08T01:00:00Z",
    lastScanFinishedAt: "2026-09-08T01:01:00Z", lastScanStatus: "completed",
    discovered: 172, newlyQueued: 170, duplicate: 1, alreadyTracked: 1,
  });
});

test("finishes or interrupts only a valid scan id with final page progress", async () => {
  for (const [action, status] of [["finish", "completed"], ["fail", "interrupted"]]) {
    global.fetch = async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), {
        p_scan_id: "550e8400-e29b-41d4-a716-446655440000",
        p_status: status,
        p_pages_current: 4,
        p_pages_total: 4,
      });
      return { ok: true, json: async () => ({ status }) };
    };
    const res = responseRecorder();
    await handler(request(action, { scanId: "550e8400-e29b-41d4-a716-446655440000", pagesCurrent: 4, pagesTotal: 4 }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.status, status);
  }
  const invalid = responseRecorder();
  await handler(request("finish", { scanId: "bad" }), invalid);
  assert.equal(invalid.statusCode, 400);
});
