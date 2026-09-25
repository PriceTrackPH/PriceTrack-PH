import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("Shopee activity extraction preserves exact API totals", async () => {
  const source = await readFile(new URL("../extension/product-activity.js", import.meta.url), "utf8");
  const context = vm.createContext({ globalThis: {} });
  vm.runInContext(source, context);
  const result = context.globalThis.PriceTrackProductActivity.extractProductActivity({
    historical_sold: 9547, view_count: 18234, cmt_count: 2401, liked_count: 655,
    item_rating: { rating_star: 4.91 }, raw_discount: 44,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    totalSold: 9547, viewCount: 18234, reviewCount: 2401, favoriteCount: 655, rating: 4.91, discountPercent: 44,
  });
});

test("product header counts fill missing fields without confusing store ratings or exact API counts", async () => {
  const source = await readFile(new URL("../extension/product-activity.js", import.meta.url), "utf8");
  const context = vm.createContext({ globalThis: {} });
  vm.runInContext(source, context);
  const reader = context.globalThis.PriceTrackProductActivity;
  const visible = reader.extractVisibleProductActivity({ body: { innerText:
    "OMNI Socket\n4.9\n10K+ Ratings\n10K+ Sold\n₱59\nFavorite (4.9K)\nView Shop\nRatings 148.6K\n" } }, "OMNI Socket");
  assert.deepEqual(JSON.parse(JSON.stringify(visible)), {
    totalSold: 10000, favoriteCount: 4900, ratingCount: 10000,
  });
  const merged = reader.mergeProductActivity(reader.extractProductActivity({
    historical_sold: 12345, item_rating: { rating_star: 4.927 },
  }), visible);
  assert.equal(merged.totalSold, 12345);
  assert.equal(merged.rating, 4.927);
  assert.equal(merged.favoriteCount, 4900);
  assert.equal(merged.reviewCount, null);
  assert.equal(merged.approximateTotalSold, false);
  assert.equal(reader.mergeProductActivity(null, visible).approximateTotalSold, true);
});

test("daily visits exclude the admin collector and random claims use activity ranking", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const edge = await readFile(new URL("../supabase/functions/record-price/index.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260914_feature_1_activity_ranking.sql", import.meta.url), "utf8");
  assert.match(content, /isAdminCollector/);
  assert.match(edge, /record_product_activity/);
  assert.match(migration, /product_daily_extension_visits/);
  assert.match(migration, /estimated_daily_sales[\s\S]*shopee_view_count[\s\S]*extension_visit_count_30d[\s\S]*price_drop_at[\s\S]*total_sold/i);
});
