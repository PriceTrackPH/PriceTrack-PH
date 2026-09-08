import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("admin bridge forwards only valid same-window store scan commands", async () => {
  const source = await readFile(new URL("../extension/admin-collector-bridge.js", import.meta.url), "utf8");
  const listeners = {};
  const sent = [];
  const pageMessages = [];
  const windowObject = {
    location: { origin: "https://pricetrackph.com", pathname: "/admin/collector" },
    addEventListener(type, listener) { listeners[type] = listener; },
    postMessage(message) { pageMessages.push(message); },
  };
  const chrome = { runtime: {
    sendMessage(message, callback) { sent.push(message); callback({ ok: true }); },
    onMessage: { addListener(listener) { listeners.runtime = listener; } },
  } };
  vm.runInContext(source, vm.createContext({ window: windowObject, chrome, URL }));

  listeners.message({ source: {}, data: { source: "pricetrack-store-scan-page", type: "start" } });
  listeners.message({ source: windowObject, data: { source: "wrong", type: "start" } });
  listeners.message({ source: windowObject, data: { source: "pricetrack-store-scan-page", type: "start", scanId: "bad", storeUrl: "https://shopee.ph/store" } });
  assert.equal(sent.length, 0);

  listeners.message({ source: windowObject, data: {
    source: "pricetrack-store-scan-page", type: "start",
    scanId: "550e8400-e29b-41d4-a716-446655440000", storeUrl: "https://shopee.ph/jabraofficialstore",
  } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "startStoreScanSession");
  assert.equal(pageMessages.at(-1).type, "ready");
});

test("background coordinator validates and expires scan sessions", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  const chrome = {
    runtime: { onMessage: { addListener() {} } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
    storage: { session: { get: async () => ({}), set: async () => {} } },
  };
  const context = vm.createContext({ chrome, URL, globalThis: {}, Date });
  vm.runInContext(source, context);
  const coordinator = context.globalThis.PriceTrackStoreCoordinator;
  assert.equal(coordinator.validStart({ type: "startStoreScanSession", scanId: "bad", storeUrl: "https://shopee.ph/store" }), false);
  assert.equal(coordinator.validStart({ type: "startStoreScanSession", scanId: "550e8400-e29b-41d4-a716-446655440000", storeUrl: "https://evil.example/store" }), false);
  assert.equal(coordinator.validStart({ type: "startStoreScanSession", scanId: "550e8400-e29b-41d4-a716-446655440000", storeUrl: "https://shopee.ph/store" }), true);
  assert.equal(coordinator.sessionExpired({ startedAt: 1_000 }, 601_001), true);
  assert.equal(coordinator.sessionExpired({ startedAt: 1_000 }, 600_999), false);
});

test("manifest registers the private admin bridge and Shopee scanner", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "1.0.4");
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("https://pricetrackph.com/admin/collector*") && entry.js.includes("admin-collector-bridge.js")));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("https://shopee.ph/*") && entry.js.includes("store-scanner.js")));
});
