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

test("parses Shopee's current and total page counter", () => {
  const root = { querySelectorAll: () => [{ textContent: "3/4" }, { textContent: "unrelated" }] };
  assert.deepEqual({ ...scanner.readPageProgress(root) }, { current: 3, total: 4 });
  assert.equal(scanner.isFinalStorePage({ current: 4, total: 4 }, null), true);
  assert.equal(scanner.isFinalStorePage({ current: 3, total: 4 }, control()), false);
});

test("preserves Sold Out classification while deduplicating products", () => {
  const candidates = [
    { href: "https://shopee.ph/One-i.12.34", soldOut: false },
    { href: "https://shopee.ph/product/12/34", soldOut: true },
    { href: "https://shopee.ph/Two-i.12.56", soldOut: false },
  ];
  assert.deepEqual(Array.from(scanner.dedupeProductCandidates(candidates), (value) => ({ ...value })), [
    { shopId: "12", externalProductId: "34", soldOut: true },
    { shopId: "12", externalProductId: "56", soldOut: false },
  ]);
});

test("finds the Sold Out See More control and recognizes when it is exhausted", () => {
  const seeMore = control({ text: "See More" });
  const product = { href: "https://shopee.ph/Sold-i.12.34" };
  const section = { parentElement: null, querySelectorAll: (selector) => selector === "a[href]" ? [product] : [seeMore] };
  const label = { textContent: "SOLD OUT", parentElement: section };
  const root = { querySelectorAll: () => [label] };
  assert.equal(scanner.findSoldOutSeeMoreControl(root), seeMore);
  assert.equal(scanner.findSoldOutSeeMoreControl({ querySelectorAll: () => [] }), null);
});

test("keeps an exhausted Sold Out section scoped instead of climbing into regular products", () => {
  const soldProduct = { href: "https://shopee.ph/Sold-i.12.34" };
  const regularProduct = { href: "https://shopee.ph/Regular-i.12.56" };
  const page = { parentElement: null, querySelectorAll: () => [soldProduct, regularProduct] };
  const section = { parentElement: page, querySelectorAll: () => [soldProduct] };
  const label = { textContent: "SOLD OUT", parentElement: section };
  const root = { querySelectorAll: (selector) => selector === "a[href]" ? [regularProduct, soldProduct] : [label] };
  assert.equal(scanner.findSoldOutSection(root), section);
});

test("never treats a clicked Sold Out See More control disappearing without growth as completion", () => {
  assert.doesNotMatch(source, /absentRounds[\s\S]*return/);
  assert.match(source, /if \(!grew\) throw new Error\("The Sold Out section did not finish loading\."\)/);
});
