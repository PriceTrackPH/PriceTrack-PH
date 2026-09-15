import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260915_store_queue_listing_order.sql", import.meta.url), "utf8");

test("ranks only Store Queue claims using tracked or scanned listing signals", () => {
  assert.match(sql, /create or replace function public\.claim_oldest_store_collection_request/);
  assert.match(sql, /coalesce\(p\.total_sold, r\.total_sold\) desc nulls last/);
  assert.match(sql, /coalesce\(p\.review_count, r\.listing_review_count\) desc nulls last/);
  assert.match(sql, /coalesce\(p\.rating, r\.listing_rating\)/);
  assert.doesNotMatch(sql, /claim_random_available_product_check|claim_oldest_public_collection_request/);
});

test("places eligible scanned sold-out requests after available Store Queue products", () => {
  assert.match(sql, /coalesce\(r\.discovered_sold_out, false\)/);
  assert.match(sql, /r\.first_discovered_at asc/);
});

test("preserves claim leases and service-role-only access", () => {
  assert.match(sql, /for update of r skip locked/);
  assert.match(sql, /revoke all on function public\.claim_oldest_store_collection_request\(uuid\[\],timestamptz\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.claim_oldest_store_collection_request\(uuid\[\],timestamptz\) to service_role/);
});
