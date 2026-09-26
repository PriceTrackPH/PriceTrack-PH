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

test("Shopee rating breakdown saves the exact total and 1-to-5 star counts", async () => {
  const source = await readFile(new URL("../extension/product-activity.js", import.meta.url), "utf8");
  const context = vm.createContext({ globalThis: {} });
  vm.runInContext(source, context);
  const reader = context.globalThis.PriceTrackProductActivity;
  const exact = reader.extractProductActivity({
    product_review: { total_rating_count: 17527, rating_count: [17527, 77, 35, 146, 571, 16698] },
  });
  assert.equal(exact.ratingCount, 17527);
  assert.deepEqual(Array.from(exact.ratingCountsByStar), [17527, 77, 35, 146, 571, 16698]);
  const merged = reader.mergeProductActivity(exact, { ratingCount: 10000 });
  assert.equal(merged.ratingCount, 17527);
  assert.equal(merged.approximateRatingCount, false);
  assert.equal(reader.mergeProductActivity(null, { ratingCount: 10000 }).approximateRatingCount, true);
  assert.equal(reader.extractProductActivity({product_review: {
    total_rating_count: 17528, rating_count: [17527, 77, 35, 146, 571, 16698],
  }}), null);
  const edge = await readFile(new URL("../supabase/functions/record-price/index.ts", import.meta.url), "utf8");
  assert.match(edge, /rating_counts_by_star: countsByStar/);
  assert.match(edge, /rating_count_approximate: !exactRatingBreakdown/);
});

test("product review payload supplies exact comment and favorite counts", async () => {
  const source = await readFile(new URL("../extension/product-activity.js", import.meta.url), "utf8");
  const context = vm.createContext({ globalThis: {} });
  vm.runInContext(source, context);
  const activity = context.globalThis.PriceTrackProductActivity.extractProductActivity({
    product_review: { cmt_count: 53712, liked_count: 49178 },
  });
  assert.equal(activity.reviewCount, 53712);
  assert.equal(activity.favoriteCount, 49178);
  const merged = context.globalThis.PriceTrackProductActivity.mergeProductActivity(activity, { favoriteCount: 49000 });
  assert.equal(merged.favoriteCount, 49178);
  assert.equal(merged.approximateFavoriteCount, false);
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
