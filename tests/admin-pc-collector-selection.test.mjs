import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { claimRandomProduct, collectorSummary, collectorHistory, saveCollectorRun } from "../api/admin-pc-collector.js";

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
    succeeded: 49, failed: 0, remaining: 477, stopStatus: "stopped",
  };
  await saveCollectorRun("https://example.supabase.co", "secret", run);
  const history = await collectorHistory("https://example.supabase.co", "secret");

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /collector_run_history/);
  assert.equal(calls[0].options.headers.Prefer, "return=representation,resolution=merge-duplicates");
  assert.match(calls[1].url, /order=stopped_at\.desc/);
  assert.equal(history[0].stopStatus, "stopped");
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

test("status checks completion for the exact claimed product", async () => {
  const source = await readFile(new URL("../api/admin-pc-collector.js", import.meta.url), "utf8");
  assert.match(source, /action === "status"/);
  assert.match(source, /product_daily_checks/);
  assert.match(source, /product_id: `eq\.\$\{productId\}`/);
});
