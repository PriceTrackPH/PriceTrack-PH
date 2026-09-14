import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { nextNonPrioritySource } from "../src/collector-queue-policy.js";
import { claimNextProduct } from "../api/admin-pc-collector.js";

test("non-priority collection repeats Store, Normal, Normal", () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, index) => nextNonPrioritySource(index)),
    ["store", "normal", "normal", "store", "normal", "normal", "store", "normal", "normal"],
  );
});
test("priority is always attempted before a preferred normal claim", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("claim_oldest_public_collection_request")) return { ok: true, json: async () => [] };
    if (String(url).includes("claim_random_available_product_check")) return { ok: true, json: async () => [{
      product_id: 42, shop_id: "100", external_product_id: "200",
      product_url: "https://shopee.ph/product/100/200", lease_until: "2026-09-14T01:00:00.000Z",
    }] };
    throw new Error(`unexpected ${url}`);
  };
  try {
    const claim = await claimNextProduct(
      "https://example.supabase.co", "secret", [], [], "2026-09-14T01:00:00.000Z", [], true, true, "normal",
    );
    assert.equal(claim.claimSource, "random");
    assert.deepEqual(calls.map((url) => url.split("/").at(-1)), [
      "claim_oldest_public_collection_request",
      "claim_random_available_product_check",
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("priority is always attempted before a preferred store claim", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("claim_oldest_public_collection_request")) return { ok: true, json: async () => [] };
    if (String(url).includes("claim_oldest_store_collection_request")) return { ok: true, json: async () => [{
      request_id: "550e8400-e29b-41d4-a716-446655440000", shop_id: "100", external_product_id: "200",
      product_url: "https://shopee.ph/product/100/200", lease_until: "2026-09-14T01:00:00.000Z",
    }] };
    throw new Error(`unexpected ${url}`);
  };
  try {
    const claim = await claimNextProduct(
      "https://example.supabase.co", "secret", [], [], "2026-09-14T01:00:00.000Z", [], true, true, "store",
    );
    assert.equal(claim.claimSource, "store");
    assert.deepEqual(calls.map((url) => url.split("/").at(-1)), [
      "claim_oldest_public_collection_request",
      "claim_oldest_store_collection_request",
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("collector page sends the next Store-Normal-Normal preference", async () => {
  const source = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  assert.match(source, /preferredSource:\s*nextNonPrioritySource\(nonPriorityCadence\.current\)/);
  assert.match(source, /if \(product\.claimSource !== "priority"\) nonPriorityCadence\.current \+= 1/);
});
