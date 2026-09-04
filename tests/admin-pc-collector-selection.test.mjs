import test from "node:test";
import assert from "node:assert/strict";

import { claimRandomProduct, collectorSummary } from "../api/admin-pc-collector.js";

test("summary excludes sold-out products from the due count", async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, headers: new Headers({ "content-range": "0-0/7" }) };
  };
  try {
    await collectorSummary("https://example.supabase.co", "secret");
  } finally {
    global.fetch = originalFetch;
  }
  const dueUrl = urls.find((url) => url.includes("next_check_at=lte."));
  assert.match(dueUrl, /all_variations_sold_out=eq.false/);
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

