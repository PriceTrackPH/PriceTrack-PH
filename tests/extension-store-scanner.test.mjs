import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/store-scanner.js", import.meta.url), "utf8");
const context = vm.createContext({ URL, setTimeout, clearTimeout, globalThis: {}, location: { href: "https://shopee.ph/jabraofficialstore" } });
vm.runInContext(source, context);
const scanner = context.globalThis.PriceTrackStoreScanner;

test("extracts stable identities from both Shopee product URL formats", () => {
  assert.deepEqual({ ...scanner.productIdentityFromUrl("https://shopee.ph/Headset-i.123.456?x=1") }, { shopId: "123", externalProductId: "456" });
  assert.deepEqual({ ...scanner.productIdentityFromUrl("https://shopee.ph/product/789/1011") }, { shopId: "789", externalProductId: "1011" });
  assert.equal(scanner.productIdentityFromUrl("https://evil.example/product/1/2"), null);
  assert.equal(scanner.productIdentityFromUrl("https://shopee.ph/store"), null);
});

test("deduplicates product links without retaining arbitrary page URLs", () => {
  const products = scanner.dedupeProductLinks([
    "https://shopee.ph/One-i.12.34",
    "https://shopee.ph/product/12/34?duplicate=1",
    "https://shopee.ph/Two-i.56.78",
    "javascript:alert(1)",
  ]);
  assert.deepEqual(Array.from(products, (value) => ({ ...value })), [
    { shopId: "12", externalProductId: "34" },
    { shopId: "56", externalProductId: "78" },
  ]);
});

test("stops after stable scrolling or a safety boundary", () => {
  assert.equal(scanner.shouldStopScan({ stableRounds: 4, elapsedMs: 20_000, discovered: 100 }), false);
  assert.equal(scanner.shouldStopScan({ stableRounds: 5, elapsedMs: 20_000, discovered: 100 }), true);
  assert.equal(scanner.shouldStopScan({ stableRounds: 0, elapsedMs: 180_000, discovered: 100 }), true);
  assert.equal(scanner.shouldStopScan({ stableRounds: 0, elapsedMs: 1_000, discovered: 5_000 }), true);
});
