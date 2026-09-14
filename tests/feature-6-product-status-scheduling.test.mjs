import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("fallback classification uses verification then sold-out, unlisted, missing, page-error precedence", async () => {
  const source = await readFile(new URL("../extension/product-page-outcome.js", import.meta.url), "utf8");
  const context = vm.createContext({ globalThis: {} });
  vm.runInContext(source, context);
  const classify = context.globalThis.PriceTrackProductPageOutcome.classifyProductPage;

  assert.equal(classify("Verify to continue. Sold Out."), "verification");
  assert.equal(classify("Sold Out. This listing has been delisted. Page unavailable."), "sold_out");
  assert.equal(classify("This listing has been delisted. Product doesn't exist."), "unlisted");
  assert.equal(classify("Product doesn't exist. Page unavailable."), "does_not_exist");
  assert.equal(classify("Page unavailable. Sorry, something went wrong."), "page_error");
  assert.equal(classify("", { variations: [{ isInStock: false }, { isInStock: false }] }), "sold_out");
});

test("product status schedules are 15 then 30 days and availability resets counters", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260914_feature_6_product_status_scheduling.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /consecutive_sold_out_checks\s*>=\s*1[\s\S]*interval '30 days'/i);
  assert.match(migration, /v_sold_out_count\s*=\s*1[\s\S]*interval '15 days'[\s\S]*interval '30 days'/i);
  assert.match(migration, /v_unavailable_count\s*=\s*1[\s\S]*interval '15 days'[\s\S]*interval '30 days'/i);
  assert.match(migration, /v_page_error_count\s*=\s*1[\s\S]*interval '0 seconds'[\s\S]*v_page_error_count\s*=\s*2[\s\S]*interval '15 days'[\s\S]*interval '30 days'/i);
  assert.match(migration, /when v_is_sold_out then consecutive_sold_out_checks else 0 end/i);
});

test("Collector and authenticated API accept fallback sold-out outcomes", async () => {
  const collector = await readFile(new URL("../src/AdminCollector.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../api/admin-pc-collector.js", import.meta.url), "utf8");
  assert.match(collector, /ProductPageOutcome = "sold_out"/);
  assert.match(collector, /pageOutcome === "sold_out"/);
  assert.match(api, /\["sold_out", "does_not_exist", "unlisted", "page_error"\]/);
});
