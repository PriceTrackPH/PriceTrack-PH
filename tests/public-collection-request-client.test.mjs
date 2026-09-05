import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalShopeeUrl,
  getPublicRequestDeviceId,
  isMobileUserAgent,
  requestUntrackedProduct,
} from "../src/public-collection-request.ts";

test("detects mobile visitors while keeping desktop Chrome Edge and Brave out", () => {
  assert.equal(isMobileUserAgent("Mozilla/5.0 (Linux; Android 14) Mobile", undefined), true);
  assert.equal(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", undefined), true);
  assert.equal(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/152", false), false);
  assert.equal(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0) Edg/152", false), false);
  assert.equal(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0) Brave/1.0", false), false);
  assert.equal(isMobileUserAgent("desktop", true), true);
});

test("keeps one anonymous UUID in local storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const generated = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(getPublicRequestDeviceId(storage, () => generated), generated);
  assert.equal(getPublicRequestDeviceId(storage, () => "must-not-be-used"), generated);
});

test("replaces a corrupted stored device identifier", () => {
  const values = new Map([["pricetrack-public-request-device-id", "corrupted"]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const generated = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(getPublicRequestDeviceId(storage, () => generated), generated);
});

test("uses one canonical identity for mobile short and full links", () => {
  assert.equal(
    canonicalShopeeUrl("448087759", "49650774952"),
    "https://shopee.ph/product/448087759/49650774952",
  );
});

test("returns the queue message and propagates the daily-limit message", async () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const stored = new Map([["pricetrack-public-request-device-id", "550e8400-e29b-41d4-a716-446655440000"]]);
  global.window = { localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } };
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body, {
        shopId: "448087759",
        productId: "49650774952",
        productUrl: "https://shopee.ph/product/448087759/49650774952",
        deviceId: "550e8400-e29b-41d4-a716-446655440000",
      });
      return { ok: true, status: 200, json: async () => ({ status: "queued", message: "queued message" }) };
    };
    assert.equal(await requestUntrackedProduct({ shopId: "448087759", productId: "49650774952" }), "queued message");

    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ status: "limit_reached", error: "limit message" }) });
    await assert.rejects(
      requestUntrackedProduct({ shopId: "448087759", productId: "49650774952" }),
      /limit message/,
    );
  } finally {
    global.fetch = originalFetch;
    global.window = originalWindow;
  }
});

test("uses a clear temporary message when the queue request cannot be sent", async () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  global.window = { localStorage: {
    getItem: () => "550e8400-e29b-41d4-a716-446655440000",
    setItem: () => undefined,
  } };
  global.fetch = async () => { throw new Error("network detail"); };
  try {
    await assert.rejects(
      requestUntrackedProduct({ shopId: "448087759", productId: "49650774952" }),
      /Unable to add this product to the collection queue\. Please try again\./,
    );
  } finally {
    global.fetch = originalFetch;
    global.window = originalWindow;
  }
});
