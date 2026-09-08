import assert from "node:assert/strict";
import test from "node:test";

import { completeCollectionQueues } from "../supabase/functions/record-price/queue-completion.ts";

test("completes both priority and store queues with the same stable identity", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200 };
  };
  const failures = await completeCollectionQueues(fetcher, "https://example.supabase.co", { apikey: "secret" }, {
    platform: "shopee", shopId: "123", productId: "456",
  });
  assert.deepEqual(calls.map((call) => call.url.split("/").at(-1)), ["complete_public_collection_request", "complete_store_collection_request"]);
  assert.deepEqual(calls[0].body, { p_platform: "shopee", p_external_shop_id: "123", p_external_product_id: "456" });
  assert.deepEqual(calls[1].body, calls[0].body);
  assert.deepEqual(failures, []);
});

test("reports one queue failure without retrying or hiding the other completion", async () => {
  let count = 0;
  const failures = await completeCollectionQueues(async () => ({ ok: ++count === 1, status: count === 1 ? 200 : 503 }), "https://example.supabase.co", {}, {
    platform: "shopee", shopId: "1", productId: "2",
  });
  assert.deepEqual(failures, [{ queue: "store", status: 503 }]);
  assert.equal(count, 2);
});
