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

test("finishes a page after stable scrolling without treating elapsed time as store completion", () => {
  assert.equal(scanner.shouldStopScan({ stableRounds: 4, elapsedMs: 20_000, discovered: 100 }), false);
  assert.equal(scanner.shouldStopScan({ stableRounds: 5, elapsedMs: 20_000, discovered: 100 }), true);
  assert.equal(scanner.shouldStopScan({ stableRounds: 0, elapsedMs: 3_600_000, discovered: 100 }), false);
  assert.equal(scanner.shouldStopScan({ stableRounds: 0, elapsedMs: 1_000, discovered: 5_000 }), true);
});

function control({ text = "", ariaLabel = "", title = "", className = "", disabled = false, ariaDisabled = "false" } = {}) {
  return {
    textContent: text,
    className,
    disabled,
    getAttribute(name) {
      return { "aria-label": ariaLabel, title, "aria-disabled": ariaDisabled }[name] || null;
    },
  };
}

test("finds Shopee's enabled next-page control without selecting numbered page buttons", () => {
  const numbered = control({ text: "2", className: "shopee-button-no-outline" });
  const next = control({ className: "shopee-page-controller__next-btn" });
  const root = {
    querySelector: (selector) => selector.includes("shopee-page-controller__next-btn") ? next : null,
    querySelectorAll: () => [numbered],
  };

  assert.equal(scanner.findNextPageControl(root), next);
});

test("recognizes Shopee's icon-only next control and its disabled state", () => {
  const enabled = control({ className: "shopee-icon-button shopee-icon-button--right" });
  const disabled = control({ className: "shopee-icon-button shopee-icon-button--right shopee-icon-button--disabled" });

  assert.equal(scanner.isPageControlDisabled(enabled), false);
  assert.equal(scanner.isPageControlDisabled(disabled), true);
});

test("builds a stable page fingerprint independent of link order and duplicates", () => {
  const links = [
    "https://shopee.ph/Two-i.12.2",
    "https://shopee.ph/One-i.12.1",
    "https://shopee.ph/product/12/2?duplicate=1",
  ];

  assert.equal(scanner.pageFingerprint(links), "12:1|12:2");
  assert.equal(scanner.pageFingerprint([...links].reverse()), "12:1|12:2");
});

test("measures page settling from the page-local fingerprint, not globally new products", () => {
  assert.equal(scanner.nextPageStableRounds("12:1|12:2", "12:1|12:2", 2), 3);
  assert.equal(scanner.nextPageStableRounds("12:1|12:2", "12:1|12:2|12:3", 2), 0);
  assert.equal(scanner.nextPageStableRounds("", "", 2), 3);
});

test("waits for both the page marker and product grid to change during SPA navigation", () => {
  assert.equal(scanner.hasPageTransitioned("12:1|12:2", "1", "12:1|12:2", "2"), false);
  assert.equal(scanner.hasPageTransitioned("12:1|12:2", "1", "12:3|12:4", "2"), true);
  assert.equal(scanner.hasPageTransitioned("12:1|12:2", "", "12:3|12:4", ""), true);
});

test("accepts one scanner loop per scan id until that loop finishes", () => {
  assert.equal(scanner.beginScan("scan-1"), true);
  assert.equal(scanner.beginScan("scan-1"), false);
  scanner.endScan("scan-1");
  assert.equal(scanner.beginScan("scan-1"), true);
  scanner.endScan("scan-1");
});

test("only treats a zero-product page as complete when Shopee renders its empty-store state", () => {
  assert.equal(scanner.isConfirmedEmptyStore({ querySelector: () => ({}) }), true);
  assert.equal(scanner.isConfirmedEmptyStore({ querySelector: () => null }), false);
});

test("collects links only from Shopee's store-product grid", () => {
  const grid = { querySelectorAll: () => [{ href: "https://shopee.ph/Grid-product-i.12.34" }] };
  const root = {
    querySelector: (selector) => selector.includes("#product_list") ? grid : null,
    querySelectorAll: () => [{ href: "https://shopee.ph/Recommendation-i.98.76" }],
  };

  assert.deepEqual(Array.from(scanner.storeProductLinks(root)), ["https://shopee.ph/Grid-product-i.12.34"]);
});
