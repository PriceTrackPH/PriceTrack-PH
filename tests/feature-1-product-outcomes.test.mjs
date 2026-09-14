import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../extension/product-page-outcome.js", import.meta.url), "utf8");
const context = vm.createContext({ globalThis: {} });
vm.runInContext(source, context);
const { classifyProductPage } = context.globalThis.PriceTrackProductPageOutcome;

test("classifies terminal Shopee product pages before price extraction", () => {
  assert.equal(classifyProductPage("The product doesn't exist"), "does_not_exist");
  assert.equal(classifyProductPage("This listing has been delisted"), "unlisted");
  assert.equal(classifyProductPage("Page Unavailable Sorry, something went wrong"), "page_error");
  assert.equal(classifyProductPage("It's us, not you. Please try to refresh the page"), "page_error");
});

test("verification takes precedence over generic page errors", () => {
  assert.equal(classifyProductPage("Verify to continue. Something went wrong."), "verification");
  assert.equal(classifyProductPage("Security verification required"), "verification");
});

test("normal product content is not falsely classified", () => {
  assert.equal(classifyProductPage("4.9 2.4K Ratings 9K+ Sold Add To Cart"), null);
});

test("content script reports terminal outcomes to its Collector opener", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const shopeeScripts = manifest.content_scripts.find((entry) => entry.matches.includes("https://shopee.ph/*") && entry.js.includes("content.js"));
  assert.ok(shopeeScripts.js.indexOf("product-page-outcome.js") < shopeeScripts.js.indexOf("content.js"));
  assert.match(content, /reportCollectorPageOutcome/);
  assert.match(content, /state:\s*"terminal"/);
});

test("Collector consumes terminal outcomes and schedules them through its authenticated API", async () => {
  const page = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../api/admin-pc-collector.js", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260914_feature_1_unavailable_schedule.sql", import.meta.url), "utf8");
  assert.match(page, /pricetrack-ph-collector-product/);
  assert.match(page, /\("outcome",/);
  assert.match(page, /pageErrorRetries/);
  assert.match(page, /api<\{ product: CollectorProduct \| null \}>\("reclaim"/);
  assert.match(api, /mark_collector_product_outcome/);
  assert.match(api, /reclaim_collector_product/);
  assert.match(migration, /does_not_exist[\s\S]*unlisted[\s\S]*page_error/i);
  assert.match(migration, /interval '15 days'/i);
  assert.match(migration, /interval '30 days'/i);
});
