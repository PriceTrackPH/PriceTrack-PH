import assert from "node:assert/strict";
import test from "node:test";

const originalUrl = process.env.SUPABASE_URL;
const originalSecret = process.env.SUPABASE_SECRET_KEY;
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "service-secret";

const { default: handler, isMobileRequest, manilaDate } = await import("../api/public-collection-request.js");

test.after(() => {
  if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalSecret;
});

const validBody = {
  shopId: "448087759",
  productId: "49650774952",
  productUrl: "https://shopee.ph/product/448087759/49650774952",
  deviceId: "550e8400-e29b-41d4-a716-446655440000",
};

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(headers, body = validBody) {
  return { method: "POST", headers, body };
}

test("recognizes mobile context without trusting desktop browser brands", () => {
  assert.equal(isMobileRequest({ "sec-ch-ua-mobile": "?1", "user-agent": "Chrome" }), true);
  assert.equal(isMobileRequest({ "user-agent": "Mozilla/5.0 (Linux; Android 14) Mobile Safari" }), true);
  assert.equal(isMobileRequest({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }), true);
  assert.equal(isMobileRequest({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/152 Edg/152" }), false);
  assert.equal(isMobileRequest({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/152 Brave/1.0" }), false);
});

test("uses the Philippine calendar day", () => {
  assert.equal(manilaDate(new Date("2026-09-05T16:30:00.000Z")), "2026-09-06");
});

test("rejects desktop requests before contacting Supabase", async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error("must not call"); };
  const res = responseRecorder();
  await handler(request({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/152" }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(calls, 0);
});

test("queues a validated mobile request with only a hashed device id", async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/enqueue_public_collection_request");
    assert.equal(options.headers.apikey, "service-secret");
    const payload = JSON.parse(options.body);
    assert.match(payload.p_requester_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(payload.p_requester_hash, validBody.deviceId);
    assert.equal(payload.p_external_shop_id, validBody.shopId);
    assert.equal(payload.p_external_product_id, validBody.productId);
    assert.equal(payload.p_product_url, validBody.productUrl);
    assert.match(payload.p_requested_date, /^2026-09-0[56]$/);
    return { ok: true, json: async () => ({ status: "queued" }) };
  };
  const res = responseRecorder();
  await handler(request({ "sec-ch-ua-mobile": "?1", "user-agent": "Chrome Mobile" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "queued");
  assert.equal(res.body.message, "This product hasn't been tracked yet. It has been added to the PriceTrack collection queue and will be checked soon.");
});

test("returns duplicate success and the exact 100-product limit response", async () => {
  for (const [rpcStatus, statusCode] of [["duplicate", 200], ["limit_reached", 429]]) {
    global.fetch = async () => ({ ok: true, json: async () => ({ status: rpcStatus }) });
    const res = responseRecorder();
    await handler(request({ "user-agent": "Mozilla/5.0 (iPhone) Mobile" }), res);
    assert.equal(res.statusCode, statusCode);
    if (rpcStatus === "limit_reached") {
      assert.equal(res.body.error, "You've reached today's 100-product request limit. You can request more products tomorrow.");
    }
  }
});

test("rejects invalid device or mismatched Shopee identity", async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ status: "queued" }) }; };
  for (const body of [
    { ...validBody, deviceId: "not-a-uuid" },
    { ...validBody, productUrl: "https://shopee.ph/product/1/2" },
    { ...validBody, productUrl: "https://evil.example/product/448087759/49650774952" },
  ]) {
    const res = responseRecorder();
    await handler(request({ "user-agent": "Android Mobile" }, body), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});
