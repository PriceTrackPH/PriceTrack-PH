import { test } from "node:test";
import assert from "node:assert/strict";
import { trialProductIds, migrationSnapshot, verifyMigrationCopy, requireCutoverEvidence } from "../server/product-migration.js";

function snapshot() {
  return {
    products: trialProductIds.map((id, index) => ({ id, platform: "shopee", external_shop_id: "123", external_product_id: String(index + 1), name: `Product ${index}`, check_lease_until: null })),
    product_variations: trialProductIds.map(id => ({ id: id + 1000000, product_id: id, name: "Small" })),
    price_observations: trialProductIds.map(id => ({ id: id + 2000000, variation_id: id + 1000000, price: 97, is_in_stock: true, observed_at: "2026-11-27T13:00:00Z" })),
    product_daily_checks: [], product_daily_extension_visits: [], personal_collection_products: [], collector_backlog_products: [],
  };
}
test("copy verification preserves complete records despite row and key order", () => {
  const source = snapshot();
  const copy = structuredClone(source);
  copy.products.reverse();
  copy.price_observations = copy.price_observations.map(row => Object.fromEntries(Object.entries(row).reverse()));
  assert.equal(verifyMigrationCopy(source, copy).products.count, 15);
});
test("equal counts cannot conceal an altered price, stock flag, or missing child table", () => {
  const source = snapshot();
  for (const field of ["price", "is_in_stock", "observed_at"]) {
    const copy = structuredClone(source);
    copy.price_observations[0][field] = "changed";
    assert.throws(() => verifyMigrationCopy(source, copy), /price_observations/);
  }
  const copy = structuredClone(source);
  delete copy.product_daily_extension_visits;
  assert.throws(() => verifyMigrationCopy(source, copy), /Missing migration table/);
});
test("active collection, missing products, and orphaned history block the trial", () => {
  const active = snapshot();
  active.products[0].check_lease_until = "2099-01-01T00:00:00Z";
  assert.throws(() => migrationSnapshot(active), /currently being collected/);
  const incomplete = snapshot();
  incomplete.products.pop();
  assert.throws(() => migrationSnapshot(incomplete), /selection is incomplete/);
  const orphaned = snapshot();
  orphaned.price_observations[0].variation_id = -1;
  assert.throws(() => migrationSnapshot(orphaned), /relationships/);
  assert.throws(() => requireCutoverEvidence({ destinationCopyVerified: true }), /sourceWritesFrozen/);
});
