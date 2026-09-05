import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import handler, { claimRandomProduct, collectorSummary, collectorHistory, saveCollectorRun } from "../api/admin-pc-collector.js";

test("summary uses the database availability cross-check", async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("collector_available_summary")) {
      return { ok: true, json: async () => [{ total_tracked: 704, total_due: 603, sold_out_deferred: 101 }] };
    }
    return { ok: true, headers: new Headers({ "content-range": "0-0/7" }) };
  };
  try {
    await collectorSummary("https://example.supabase.co", "secret");
  } finally {
    global.fetch = originalFetch;
  }
  assert.ok(urls.some((url) => url.endsWith("/rest/v1/rpc/collector_available_summary")));
});

test("collector run history is written once and newest runs are returned first", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") return { ok: true, json: async () => [{ id: "run-1" }] };
    return { ok: true, json: async () => [{ id: "run-1", stop_status: "stopped" }] };
  };

  const run = {
    runId: "run-1", startedAt: "2026-09-05T00:00:00.000Z",
    stoppedAt: "2026-09-05T00:05:00.000Z", durationSeconds: 300,
    succeeded: 49, failed: 0, soldOut: 2, remaining: 477,
    recheckAt: "2026-09-20T00:05:00.000Z", stopStatus: "stopped",
  };
  await saveCollectorRun("https://example.supabase.co", "secret", run);
  const history = await collectorHistory("https://example.supabase.co", "secret");

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /collector_run_history/);
  assert.equal(calls[0].options.headers.Prefer, "return=representation,resolution=merge-duplicates");
  assert.equal(JSON.parse(calls[0].options.body).sold_out, 2);
  assert.equal(JSON.parse(calls[0].options.body).recheck_at, "2026-09-20T00:05:00.000Z");
  assert.match(calls[1].url, /order=stopped_at\.desc/);
  assert.equal(history[0].stopStatus, "stopped");
});

test("collector history migration grants service-role upsert permission", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260905_collector_run_history.sql", import.meta.url), "utf8");
  assert.match(migration, /grant select, insert, update on table public\.collector_run_history to service_role;/i);
});

test("claim uses the atomic random database function and passes prior attempts", async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return {
      ok: true,
      json: async () => [{
        product_id: 42,
        shop_id: "100",
        external_product_id: "200",
        product_url: "https://shopee.ph/item-i.100.200",
        lease_until: "2026-09-04T12:00:00.000Z",
      }],
    };
  };
  try {
    const product = await claimRandomProduct("https://example.supabase.co", "secret", [3, 9]);
    assert.equal(product.productId, 42);
  } finally {
    global.fetch = originalFetch;
  }
  assert.match(request.url, /\/rest\/v1\/rpc\/claim_random_available_product_check$/);
  assert.deepEqual(JSON.parse(request.options.body), { p_excluded_product_ids: [3, 9] });
});

test("status returns the exact product's sold-out state and scheduled recheck", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.ADMIN_HEALTH_TOKEN;
  const originalUrl = process.env.SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;
  const originalPublishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  process.env.ADMIN_HEALTH_TOKEN = "admin-token";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "secret";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "publishable";
  global.fetch = async (url) => {
    if (String(url).includes("product_daily_checks")) {
      return { ok: true, json: async () => [{ id: 1, checked_at: "2026-09-05T01:10:23.000Z" }] };
    }
    return {
      ok: true,
      json: async () => [{ all_variations_sold_out: true, next_check_at: "2026-09-20T01:10:23.000Z" }],
    };
  };
  try {
    let responseBody;
    const response = {
      status() { return this; },
      setHeader() { return this; },
      json(body) { responseBody = body; return this; },
    };
    await handler({
      method: "POST", headers: { authorization: "Bearer admin-token" },
      query: { action: "status" }, body: { productId: 42 },
    }, response);
    assert.deepEqual(responseBody, {
      ok: true,
      completed: true,
      checkedAt: "2026-09-05T01:10:23.000Z",
      soldOut: true,
      recheckAt: "2026-09-20T01:10:23.000Z",
    });
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.ADMIN_HEALTH_TOKEN; else process.env.ADMIN_HEALTH_TOKEN = originalToken;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalSecret;
    if (originalPublishable === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY; else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = originalPublishable;
  }
});

test("collector run history reads saved sold-out totals and recheck dates", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => [{
      run_id: "run-2", started_at: "2026-09-05T00:00:00.000Z",
      stopped_at: "2026-09-05T00:05:00.000Z", duration_seconds: 300,
      succeeded: 5, failed: 0, sold_out: 3, remaining: 10,
      recheck_at: "2026-09-20T00:05:00.000Z", stop_status: "stopped_safely",
    }],
  });
  try {
    const [run] = await collectorHistory("https://example.supabase.co", "secret");
    assert.equal(run.soldOut, 3);
    assert.equal(run.recheckAt, "2026-09-20T00:05:00.000Z");
  } finally {
    global.fetch = originalFetch;
  }
});
